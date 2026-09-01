import { normalizeMexicanPhone } from "./customers";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type CustomerIdentifier =
  | { channel: "email"; value: string }
  | { channel: "phone"; value: string };

export function parseCustomerIdentifier(raw: string): CustomerIdentifier | null {
  const value = raw.trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { channel: "email", value: email } : null;
  }
  const phone = normalizeMexicanPhone(value);
  return phone ? { channel: "phone", value: phone } : null;
}

export function customerRedirectUrl(requestUrl: string) {
  const configured = process.env.CUSTOMER_APP_URL?.trim();
  if (configured) return new URL("/", configured).toString();

  const request = new URL(requestUrl);
  if (request.hostname === "localhost" || request.hostname === "127.0.0.1") {
    return new URL("/mi", request.origin).toString();
  }
  return "https://vaquero-hub.vercel.app/mi";
}
