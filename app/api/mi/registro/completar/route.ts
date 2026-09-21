import { parseCustomerSelfRegistration } from "@/lib/customer-access";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function publicRegistrationError(message: string) {
  for (const code of [
    "PHONE_ALREADY_REGISTERED",
    "STAFF_ACCOUNT_NOT_ALLOWED",
    "CUSTOMER_ACCOUNT_ALREADY_LINKED",
  ]) {
    if (message.includes(code)) return code;
  }
  return "REGISTRATION_FAILED";
}

export async function POST(request: Request) {
  try {
    const privacyVersion = process.env.CUSTOMER_PRIVACY_NOTICE_VERSION?.trim();
    const privacyUrl = process.env.CUSTOMER_PRIVACY_NOTICE_URL?.trim();
    if (!privacyVersion || !privacyUrl) {
      return Response.json(
        { message: "PRIVACY_NOTICE_NOT_PUBLISHED" },
        { status: 503 },
      );
    }

    const registration = parseCustomerSelfRegistration(await request.json());
    if (!registration) {
      return Response.json(
        { message: "INVALID_CUSTOMER_DATA" },
        { status: 400 },
      );
    }

    const token = bearerToken(request);
    if (!token) {
      return Response.json({ message: "AUTH_REQUIRED" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: authData, error: authError } =
      await admin.auth.getUser(token);
    const user = authData.user;
    if (authError || !user?.id || !user.email_confirmed_at) {
      return Response.json(
        { message: "VERIFIED_EMAIL_REQUIRED" },
        { status: 401 },
      );
    }
    if (user.email?.trim().toLowerCase() !== registration.email) {
      return Response.json({ message: "EMAIL_MISMATCH" }, { status: 403 });
    }

    const { error } = await admin.rpc("complete_customer_self_registration", {
      p_auth_user_id: user.id,
      p_full_name: registration.fullName,
      p_phone: registration.phone,
      p_birthdate: registration.birthdate,
      p_privacy_notice_version: privacyVersion,
      p_marketing_consent: registration.marketingConsent,
    });
    if (error) throw error;

    return Response.json(
      { completed: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const privateMessage =
      error instanceof Error ? error.message : "REGISTRATION_FAILED";
    console.error("[api/mi/registro/completar] request failed", {
      message: privateMessage,
    });
    return Response.json(
      { message: publicRegistrationError(privateMessage) },
      { status: 409 },
    );
  }
}
