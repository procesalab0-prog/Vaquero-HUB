export const CUSTOMER_REVIEW_STAGING_URL =
  "https://zsezjtswqeijboezvado.supabase.co";
export function customerReviewEnabled(url: string | undefined) {
  return url === CUSTOMER_REVIEW_STAGING_URL;
}
export function reviewAmountCents(value: string) {
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) return null;
  const [pesos, cents = ""] = value.split(".");
  const result = Number(pesos) * 100 + Number(cents.padEnd(2, "0"));
  return result > 0 && Number.isSafeInteger(result) ? result : null;
}
export function reviewFailure(message: string) {
  if (message.includes("CREDIT_OVERPAYMENT")) return "sobrepago";
  if (message.includes("CREDIT_BALANCE_EMPTY")) return "sin-saldo";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "conflicto";
  if (message.includes("NOT_AUTHORIZED")) return "sin-permiso";
  if (message.includes("M9_TARGET_IDENTITY_REVIEW")) return "sin-candidato";
  if (message.includes("M9_SOURCE_CUT_STALE")) return "corte-vencido";
  return "error";
}
export type SourceReviewList = {
  summary: {
    accounts: number;
    pending_cents: number;
    missing_contact: number;
    reviewed: number;
  };
  total: number;
  qa_available: boolean;
  rows: Array<{
    key: string;
    name: string;
    phone: string | null;
    balance_cents: number;
    holds: string[];
    review: string | null;
  }>;
};
export type SourceReviewDetail = {
  key: string;
  name: string;
  phone: string | null;
  balance_cents: number;
  source_at: string;
  holds: string[];
  review: { disposition: string; target: string | null; note: string } | null;
  candidates: Array<{ id: string; name: string; phone: string }>;
  documents: Array<{
    key: string;
    folio: string;
    status: "OPEN" | "PAID";
    total_cents: number;
    paid_cents: number;
    balance_cents: number;
    due_date: string | null;
    payments: Array<{
      reference: string;
      amount_cents: number;
      cancelled: boolean;
    }>;
    lines: Array<{ barcode: string; quantity: number; mapped: boolean }>;
  }>;
};
export type SourceTrialResult = {
  run: string;
  mode: string;
  balance_cents: number;
  last_amount_cents: number;
  payment_count: number;
  native_rollback: boolean;
  valid_payment_receipt: boolean;
  replayed: boolean;
};
