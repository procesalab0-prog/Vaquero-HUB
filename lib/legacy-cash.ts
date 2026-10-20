import { legacyTrialCents } from "./legacy-finance";
export type LegacyCashPart = {
  method_code: "CASH" | "CARD" | "TRANSFER";
  amount_cents: number;
  tendered_cents?: number;
  reference?: string;
};
export function legacyCashParts(form: Pick<FormData, "get">): LegacyCashPart[] {
  const get = (key: string) => String(form.get(key) ?? "").trim();
  const result: LegacyCashPart[] = [];
  for (const [method, amountKey, extraKey] of [
    ["CASH", "cash_amount", "tendered"],
    ["CARD", "card_amount", "card_reference"],
    ["TRANSFER", "transfer_amount", "transfer_reference"],
  ] as const) {
    const raw = get(amountKey),
      extra = get(extraKey);
    if (!raw) {
      if (extra) throw Error("M9_INVALID_PAYMENT");
      continue;
    }
    const amount_cents = legacyTrialCents(raw);
    if (method === "CASH") {
      const tendered_cents = legacyTrialCents(extra);
      if (tendered_cents < amount_cents)
        throw Error("M9_INSUFFICIENT_TENDERED");
      result.push({ method_code: method, amount_cents, tendered_cents });
    } else {
      if (extra.length < 3 || extra.length > 100)
        throw Error("M9_PAYMENT_REFERENCE_REQUIRED");
      result.push({ method_code: method, amount_cents, reference: extra });
    }
  }
  if (
    !result.length ||
    result.reduce((n, p) => n + p.amount_cents, 0) > 999999999
  )
    throw Error("M9_INVALID_PAYMENT");
  return result;
}
export function legacyCashFailure(message: string) {
  if (message.includes("M9_OVERPAYMENT")) return "sobrepago";
  if (message.includes("M9_SESSION_FORBIDDEN")) return "caja";
  if (message.includes("M9_ACCOUNT_LOCATION_MISMATCH")) return "sucursal";
  if (message.includes("M9_PAYMENT_REFERENCE_REQUIRED")) return "referencia";
  if (message.includes("M9_INSUFFICIENT_TENDERED")) return "efectivo";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "conflicto";
  if (message.includes("M9_PAYMENT_METHOD_UNAVAILABLE")) return "metodo";
  return "datos";
}
export type LegacyCashContext = {
  session: { id: string; location_id: string; location: string } | null;
  last_trial: { id: string; amount_cents: number } | null;
};
export type LegacyCashReceipt = {
  id: string;
  request: string;
  folio: string;
  customer_name: string;
  received_at: string;
  account: string;
  session: string;
  amount_cents: number;
  before_cents: number;
  after_cents: number;
  retained_balance_cents: number;
  cash_delta_cents: number;
  change_cents: number;
  allocations: Array<{
    document: string;
    source_folio: string;
    amount_cents: number;
  }>;
  parts: Array<LegacyCashPart & { name: string; change_cents?: number }>;
  rolled_back: true;
  valid_payment_receipt: false;
};
