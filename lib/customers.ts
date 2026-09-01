export type CustomerSummary = {
  id: string;
  member_number: string;
  full_name: string;
  phone_e164: string;
  email: string | null;
};

export function normalizeMexicanPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0052")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("01")) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith("52")) digits = digits.slice(2);
  return digits.length === 10 ? `+52${digits}` : null;
}

export function memberCheckDigit(payload: string) {
  if (!/^\d{7}$/.test(payload)) return null;
  let sum = 0;
  for (let index = payload.length - 1; index >= 0; index -= 1) {
    let digit = Number(payload[index]);
    if ((payload.length - 1 - index) % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidMemberNumber(value: string) {
  if (!/^\d{8}$/.test(value)) return false;
  return memberCheckDigit(value.slice(0, 7)) === Number(value.at(-1));
}

export function formatCustomerPhone(phone: string) {
  const digits = phone.replace(/^\+52/, "");
  return digits.length === 10
    ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
    : phone;
}
