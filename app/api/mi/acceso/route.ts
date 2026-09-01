import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  customerAuthIdentityAttributes,
  customerRedirectUrl,
  parseCustomerIdentifier,
} from "@/lib/customer-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const genericResponse = {
  accepted: true,
  message: "Si los datos coinciden, recibirás las instrucciones de acceso.",
};

function publicAuthClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = (await request.json()) as { identifier?: unknown };
    const identifier = parseCustomerIdentifier(
      typeof body.identifier === "string" ? body.identifier : "",
    );
    if (!identifier) {
      return Response.json(
        {
          accepted: false,
          message: "Escribe un teléfono mexicano o correo válido.",
        },
        { status: 400 },
      );
    }
    if (
      identifier.channel === "phone" &&
      process.env.CUSTOMER_PHONE_OTP_ENABLED !== "true"
    ) {
      return delayedGeneric(startedAt);
    }

    const admin = createAdminClient();
    const column = identifier.channel === "phone" ? "phone_e164" : "email";
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select("id, auth_user_id")
      .eq(column, identifier.value)
      .eq("is_anonymized", false)
      .maybeSingle();

    if (customerError) throw customerError;
    if (!customer) return delayedGeneric(startedAt);

    const { data: reserved, error: reserveError } = await admin.rpc(
      "reserve_customer_auth_request",
      {
        p_customer_id: customer.id,
        p_min_interval_seconds: 60,
      },
    );
    if (reserveError) throw reserveError;
    if (!reserved) return delayedGeneric(startedAt);

    let authUserId = customer.auth_user_id as string | null;
    let createdUserId: string | null = null;
    const authIdentity = customerAuthIdentityAttributes(identifier);
    if (!authUserId) {
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          ...authIdentity,
          app_metadata: { account_type: "customer" },
        });
      if (createError || !created.user)
        throw createError ?? new Error("CUSTOMER_AUTH_CREATE_FAILED");
      authUserId = created.user.id;
      createdUserId = created.user.id;

      const { data: linked, error: linkError } = await admin
        .from("customers")
        .update({ auth_user_id: authUserId })
        .eq("id", customer.id)
        .is("auth_user_id", null)
        .select("id")
        .maybeSingle();
      if (linkError || !linked) {
        await admin.auth.admin.deleteUser(createdUserId);
        throw linkError ?? new Error("CUSTOMER_AUTH_LINK_FAILED");
      }
    } else {
      const { error: confirmError } = await admin.auth.admin.updateUserById(
        authUserId,
        authIdentity,
      );
      if (confirmError) throw confirmError;
    }

    const auth = publicAuthClient();
    const { error: otpError } =
      identifier.channel === "phone"
        ? await auth.auth.signInWithOtp({
            phone: identifier.value,
            options: { shouldCreateUser: false },
          })
        : await auth.auth.signInWithOtp({
            email: identifier.value,
            options: {
              shouldCreateUser: false,
              emailRedirectTo: customerRedirectUrl(request.url),
            },
          });
    if (otpError) throw otpError;

    await admin.from("audit_log").insert({
      action: "customers.access_requested",
      entity_type: "customers",
      entity_id: customer.id,
      metadata: { channel: identifier.channel, source: "customer_pwa" },
    });
    return delayedGeneric(startedAt);
  } catch (error) {
    // La respuesta al cliente sigue siendo genérica para no filtrar qué
    // identificadores existen, pero el registro del servidor sí necesita el
    // detalle: sin él, una falla sistemática de envío es indistinguible de
    // un identificador que no existe, y nadie se entera.
    console.error("[api/mi/acceso] request failed", {
      name: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : String(error),
    });
    return delayedGeneric(startedAt);
  }
}

async function delayedGeneric(startedAt: number) {
  const remaining = 350 - (Date.now() - startedAt);
  if (remaining > 0)
    await new Promise((resolve) => setTimeout(resolve, remaining));
  return Response.json(genericResponse, {
    headers: { "Cache-Control": "no-store" },
  });
}
