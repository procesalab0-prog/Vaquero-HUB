import { isDeepStrictEqual } from "node:util";
const exact = (x, keys) =>
  x &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  Object.keys(x).sort().join("|") === [...keys].sort().join("|");
const moneyKeys = [
  "items_subtotal",
  "discount_total",
  "shipping_total",
  "shipping_tax",
  "cart_tax",
  "total_tax",
  "fees_total",
  "refunded_total",
  "total",
];
export function decimalCents(s) {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]{0,12})\.[0-9]{2}$/.test(s))
    throw Error("FINANCE_DECIMAL_INVALID");
  const n = BigInt(s.replace(".", ""));
  if (n > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("FINANCE_DECIMAL_INVALID");
  return Number(n);
}
export function validateTrialFinance(s, reference) {
  if (
    !exact(s, [
      "protocol",
      "reference",
      "currency",
      "money",
      "payment",
      "lines",
      "counts",
    ]) ||
    s.protocol !== "m9-remote-order-finance-read-1" ||
    !isDeepStrictEqual(s.reference, reference) ||
    reference.synthetic !== true ||
    reference.status !== "cancelled" ||
    reference.payment_executed !== false ||
    s.currency !== "MXN" ||
    !exact(s.money, moneyKeys) ||
    !exact(s.payment, ["method", "transaction_id", "paid_at", "is_paid"]) ||
    s.payment.method !== "m9_synthetic_no_payment" ||
    s.payment.transaction_id !== "" ||
    !(
      s.payment.paid_at === null ||
      (typeof s.payment.paid_at === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(
          s.payment.paid_at,
        ) &&
        Number.isFinite(Date.parse(s.payment.paid_at)))
    ) ||
    s.payment.is_paid !== false ||
    !exact(s.counts, ["coupons", "shipping", "fees", "refunds"]) ||
    Object.values(s.counts).some((n) => n !== 0) ||
    !Array.isArray(s.lines) ||
    s.lines.length !== 1 ||
    !exact(s.lines[0], [
      "line_id",
      "subtotal",
      "total",
      "subtotal_tax",
      "total_tax",
    ]) ||
    s.lines[0].line_id !== reference.line_id
  )
    throw Error("FINANCE_SNAPSHOT_CHANGED");
  const amounts = Object.fromEntries(
    moneyKeys.map((k) => [k, decimalCents(s.money[k])]),
  );
  const expected = reference.quantity * reference.unit_price_cents;
  if (
    !Number.isSafeInteger(expected) ||
    amounts.items_subtotal !== expected ||
    amounts.total !== expected ||
    moneyKeys
      .filter((k) => !["items_subtotal", "total"].includes(k))
      .some((k) => amounts[k] !== 0) ||
    decimalCents(s.lines[0].subtotal) !== expected ||
    decimalCents(s.lines[0].total) !== expected ||
    decimalCents(s.lines[0].subtotal_tax) !== 0 ||
    decimalCents(s.lines[0].total_tax) !== 0
  )
    throw Error("FINANCE_TOTALS_CHANGED");
  return {
    classification:
      s.payment.paid_at === null
        ? "CANCELLED_UNPAID"
        : "CANCELLED_PAYMENT_DATE_REVIEW",
    payment_date_observed: s.payment.paid_at,
    observed_total_cents: amounts.total,
    paid_amount_cents: null,
    can_record_sale: false,
    can_issue_sale_ticket: false,
    stock_write_allowed: false,
  };
}
export async function readTrialFinance({ id, context, client, record }) {
  await client.financePreflight();
  const first = await client.readFinance(id);
  const plan = validateTrialFinance(first, context.reference);
  const second = await client.readFinance(id);
  validateTrialFinance(second, context.reference);
  if (!isDeepStrictEqual(first, second))
    throw Error("FINANCE_OBSERVATION_CHANGED");
  return record({
    id,
    snapshot: second,
    observed_at: new Date().toISOString(),
    plan,
  });
}
