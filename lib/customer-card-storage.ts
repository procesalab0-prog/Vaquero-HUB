import { isValidMemberNumber } from "./customers";

export const CUSTOMER_CARD_STORAGE_KEY = "vaquero-hub-customer-card-v1";

export type OfflineCustomerCard = {
  version: 1;
  memberNumber: string;
};

export function parseOfflineCustomerCard(value: string | null): OfflineCustomerCard | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<OfflineCustomerCard>;
    if (parsed.version !== 1 || typeof parsed.memberNumber !== "string" || !isValidMemberNumber(parsed.memberNumber)) return null;
    return { version: 1, memberNumber: parsed.memberNumber };
  } catch {
    return null;
  }
}

export function serializeOfflineCustomerCard(memberNumber: string) {
  if (!isValidMemberNumber(memberNumber)) throw new Error("INVALID_MEMBER_NUMBER");
  return JSON.stringify({ version: 1, memberNumber } satisfies OfflineCustomerCard);
}
