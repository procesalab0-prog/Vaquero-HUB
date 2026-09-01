import { normalizeMexicanPhone } from "./customers";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
  if (configured) return new URL("/", configured).toString();

  const request = new URL(requestUrl);
  if (request.hostname === "localhost" || request.hostname === "127.0.0.1") {
    return new URL("/mi", request.origin).toString();
  }

  throw new Error(
    "CUSTOMER_APP_URL_NOT_CONFIGURED: falta configurar el origen de la PWA de clientes.",
  );
}
