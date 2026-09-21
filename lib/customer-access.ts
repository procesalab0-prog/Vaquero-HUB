import { normalizeMexicanPhone } from "./customers";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type CustomerSelfRegistration = {
  fullName: string;
  phone: string;
  email: string;
  birthdate: string | null;
  privacyAccepted: boolean;
  marketingConsent: boolean;
};

export type CustomerIdentifier =
  { channel: "email"; value: string } | { channel: "phone"; value: string };

export function customerAuthIdentityAttributes(identifier: CustomerIdentifier) {
  return identifier.channel === "email"
    ? { email: identifier.value, email_confirm: true as const }
    : { phone: identifier.value, phone_confirm: true as const };
}

export function parseCustomerIdentifier(
  raw: string,
): CustomerIdentifier | null {
  const value = raw.trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return EMAIL_PATTERN.test(email)
      ? { channel: "email", value: email }
      : null;
  }
  const phone = normalizeMexicanPhone(value);
  return phone ? { channel: "phone", value: phone } : null;
}

export function parseCustomerSelfRegistration(input: {
  fullName?: unknown;
  phone?: unknown;
  email?: unknown;
  birthdate?: unknown;
  privacyAccepted?: unknown;
  marketingConsent?: unknown;
}): CustomerSelfRegistration | null {
  const fullName =
    typeof input.fullName === "string" ? input.fullName.trim() : "";
  const phone =
    typeof input.phone === "string" ? normalizeMexicanPhone(input.phone) : null;
  const identifier = parseCustomerIdentifier(
    typeof input.email === "string" ? input.email : "",
  );
  const birthdate =
    typeof input.birthdate === "string" && input.birthdate.trim()
      ? input.birthdate.trim()
      : null;

  if (
    fullName.length < 2 ||
    fullName.length > 120 ||
    !phone ||
    identifier?.channel !== "email" ||
    input.privacyAccepted !== true ||
    (birthdate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(birthdate))
  ) {
    return null;
  }

  if (birthdate) {
    const date = new Date(`${birthdate}T00:00:00Z`);
    const today = new Date();
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() < 1900 ||
      date > today
    ) {
      return null;
    }
  }

  return {
    fullName,
    phone,
    email: identifier.value,
    birthdate,
    privacyAccepted: true,
    marketingConsent: input.marketingConsent === true,
  };
}

/**
 * Destino del enlace de acceso del cliente.
 *
 * Este valor decide a dónde viaja un token de autenticación, así que no se
 * adivina: fuera de desarrollo local exige `CUSTOMER_APP_URL` configurada.
 * Si falta, se lanza el error y no se envía nada — es preferible que el
 * acceso no funcione a que el enlace llegue a un dominio equivocado.
 */
export function customerRedirectUrl(requestUrl: string) {
  const configured = process.env.CUSTOMER_APP_URL?.trim();
  if (configured) return new URL(configured).toString();

  const request = new URL(requestUrl);
  if (request.hostname === "localhost" || request.hostname === "127.0.0.1") {
    return new URL("/mi", request.origin).toString();
  }

  throw new Error(
    "CUSTOMER_APP_URL_NOT_CONFIGURED: falta configurar el origen de la PWA de clientes.",
  );
}
