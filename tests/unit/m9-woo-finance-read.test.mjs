import { describe, it, expect, vi } from "vitest";
import {
  decimalCents,
  validateTrialFinance,
  readTrialFinance,
} from "../../scripts/m9/woo-remote/finance-read.mjs";
const id = "87427c06-b889-41a1-960b-930b1ed8e8df";
const reference = {
  trial_id: id,
  synthetic: true,
  status: "cancelled",
  payment_executed: false,
  quantity: 2,
  unit_price_cents: 82000,
  line_id: 501,
};
const sample = () => ({
  protocol: "m9-remote-order-finance-read-1",
  reference: structuredClone(reference),
  currency: "MXN",
  money: {
    items_subtotal: "1640.00",
    discount_total: "0.00",
    shipping_total: "0.00",
    shipping_tax: "0.00",
    cart_tax: "0.00",
    total_tax: "0.00",
    fees_total: "0.00",
    refunded_total: "0.00",
    total: "1640.00",
  },
  payment: {
    method: "m9_synthetic_no_payment",
    transaction_id: "",
    paid_at: null,
    is_paid: false,
  },
  lines: [
    {
      line_id: 501,
      subtotal: "1640.00",
      total: "1640.00",
      subtotal_tax: "0.00",
      total_tax: "0.00",
    },
  ],
  counts: { coupons: 0, shipping: 0, fees: 0, refunds: 0 },
});
describe("financial observation, not financial posting", () => {
  it("keeps observed totals separate from unconfirmed payment", () =>
    expect(validateTrialFinance(sample(), reference)).toEqual({
      classification: "CANCELLED_UNPAID",
      payment_date_observed: null,
      observed_total_cents: 164000,
      paid_amount_cents: null,
      can_record_sale: false,
      can_issue_sale_ticket: false,
      stock_write_allowed: false,
    }));
  it("a paid date without transaction remains blocked for reconciliation", () => {
    const s = sample();
    s.payment.paid_at = "2026-10-22T00:12:03+00:00";
    const p = validateTrialFinance(s, reference);
    expect(p.classification).toBe("CANCELLED_PAYMENT_DATE_REVIEW");
    expect(p.payment_date_observed).toBe(s.payment.paid_at);
    expect(p.can_record_sale).toBe(false);
    expect(p.paid_amount_cents).toBe(null);
  });
  it("parses cents exactly", () => {
    expect(decimalCents("0.29")).toBe(29);
    expect(decimalCents("9999999999999.99")).toBe(999999999999999);
  });
  for (const s of [
    "1",
    "1.0",
    "01.00",
    "1.000",
    "-0.01",
    "1e2",
    "NaN",
    "Infinity",
    "0x10",
    "1,00",
    " 1.00",
    "1.00 ",
    1.23,
    null,
  ])
    it(`rejects noncanonical money ${s}`, () =>
      expect(() => decimalCents(s)).toThrow("FINANCE_DECIMAL_INVALID"));
  for (const [path, value] of [
    [["reference", "barcode"], "different"],
    [["reference", "status"], "processing"],
    [["currency"], "USD"],
    [["protocol"], "other"],
    [["payment", "is_paid"], true],
    [["payment", "paid_at"], "not-a-date"],
    [["payment", "transaction_id"], "fake"],
    [["payment", "method"], "CASH"],
    [["counts", "coupons"], 1],
    [["counts", "refunds"], 1],
    [["money", "total"], "1639.99"],
    [["money", "shipping_total"], "1.00"],
    [["money", "cart_tax"], "0.01"],
    [["lines", 0, "total"], "1639.99"],
    [["lines", 0, "line_id"], 999],
  ])
    it(`holds changed ${path.join(".")}`, () => {
      const s = sample();
      let obj = s;
      for (const key of path.slice(0, -1)) obj = obj[key];
      obj[path.at(-1)] = value;
      expect(() => validateTrialFinance(s, reference)).toThrow();
    });
  it("rejects missing amounts and extra buyer fields", () => {
    let s = sample();
    delete s.money.shipping_total;
    expect(() => validateTrialFinance(s, reference)).toThrow();
    s = sample();
    s.email = "should not be collected";
    expect(() => validateTrialFinance(s, reference)).toThrow();
  });
  it("records only after two stable authenticated reads", async () => {
    const client = {
        financePreflight: vi.fn(),
        readFinance: vi.fn().mockImplementation(async () => sample()),
      },
      record = vi.fn().mockResolvedValue({ id: "receipt" });
    expect(
      await readTrialFinance({ id, context: { reference }, client, record }),
    ).toEqual({ id: "receipt" });
    expect(client.readFinance).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0][0].plan.can_record_sale).toBe(false);
  });
  it("does not record a changed or missing second read", async () => {
    const client = {
        financePreflight: vi.fn(),
        readFinance: vi
          .fn()
          .mockResolvedValueOnce(sample())
          .mockResolvedValueOnce(null),
      },
      record = vi.fn();
    await expect(
      readTrialFinance({ id, context: { reference }, client, record }),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });
  it("fails before any observation if protocol is unavailable", async () => {
    const client = {
        financePreflight: vi
          .fn()
          .mockRejectedValue(Error("FINANCE_PROTOCOL_REQUIRED")),
        readFinance: vi.fn(),
      },
      record = vi.fn();
    await expect(
      readTrialFinance({ id, context: { reference }, client, record }),
    ).rejects.toThrow("FINANCE_PROTOCOL_REQUIRED");
    expect(client.readFinance).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
