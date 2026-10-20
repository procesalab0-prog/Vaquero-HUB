import { reviewAmountCents } from "./customer-migration";
export function legacyTrialCents(value: string) {
  const n = reviewAmountCents(value);
  if (n === null || n > 999999999) throw Error("M9_POSITIVE_AMOUNT_REQUIRED");
  return n;
}
export function legacyFinanceFailure(message: string) {
  if (message.includes("M9_OVERPAYMENT")) return "sobrepago";
  if (message.includes("M9_NO_OPEN_DEBT")) return "sin-saldo";
  if (message.includes("M9_POSITIVE_AMOUNT_REQUIRED")) return "importe";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return "conflicto";
  return "error";
}
export type LegacyFinanceView = {
  accounts: Array<{
    id: string;
    name: string;
    balance_cents: number;
    documents: number;
    entries: Array<{ folio: string; amount_cents: number; due: string | null }>;
  }>;
  last_trial: LegacyFinanceTrial | null;
  trial_count: number;
  cash_collection_enabled: false;
  staging_only: true;
};
export type LegacyFinanceTrial = {
  amount_cents: number;
  before_cents: number;
  after_cents: number;
  retained_balance_cents: number;
  allocations: Array<{ document: string; amount_cents: number }>;
  rolled_back: true;
  replay_verified: true;
  trial_only: true;
};
