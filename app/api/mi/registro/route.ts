import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  customerRedirectUrl,
  parseCustomerSelfRegistration,
} from "@/lib/customer-access";
import { requestSourceHash } from "@/lib/auth-throttle";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const genericResponse = {
  accepted: true,
  message: "Revisa tu correo para continuar con el registro.",
};

function publicAuthClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function isExistingUserError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    message.includes("already") ||
    message.includes("registered")
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let createdUserId: string | null = null;
  try {
    const privacyVersion = process.env.CUSTOMER_PRIVACY_NOTICE_VERSION?.trim();
    const privacyUrl = process.env.CUSTOMER_PRIVACY_NOTICE_URL?.trim();
    if (!privacyVersion || !privacyUrl) {
      return Response.json(
        {
          accepted: false,
          message:
            "El registro se habilitará cuando esté publicado el aviso de privacidad.",
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const registration = parseCustomerSelfRegistration(body);
    if (!registration) {
      return Response.json(
        {
          accepted: false,
          message: "Revisa nombre, teléfono, correo y aceptación del aviso.",
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const sourceHash = requestSourceHash(request);
    if (sourceHash) {
      const { data: allowed, error: throttleError } = await admin.rpc(
        "reserve_auth_request_by_source",
        { p_source_hash: sourceHash },
      );
      if (throttleError) throw throttleError;
      if (allowed === false) return delayedGeneric(startedAt);
    }

    // El alta global de Auth permanece cerrada. El servidor crea únicamente
    // una identidad de cliente pendiente y el perfil CRM nace después de que
    // la persona demuestra acceso al correo mediante OTP.
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: registration.email,
        email_confirm: true,
        app_metadata: { account_type: "customer_pending" },
      });
    if (createError && !isExistingUserError(createError)) throw createError;
    createdUserId = created.user?.id ?? null;

    const auth = publicAuthClient();
    const { error: otpError } = await auth.auth.signInWithOtp({
      email: registration.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: customerRedirectUrl(request.url),
      },
    });
    if (otpError) throw otpError;

    return delayedGeneric(startedAt);
  } catch (error) {
    if (createdUserId) {
      try {
        await createAdminClient().auth.admin.deleteUser(createdUserId);
      } catch {
        // La limpieza se intenta sin ocultar la causa original en el servidor.
      }
    }
    console.error("[api/mi/registro] request failed", {
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
