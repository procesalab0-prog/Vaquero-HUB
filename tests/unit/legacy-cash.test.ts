import { describe, it, expect } from "vitest";
import { legacyCashParts, legacyCashFailure } from "../../lib/legacy-cash";
const form = (values: Record<string, string | undefined>) => ({
  get: (key: string) => values[key] ?? null,
});
describe("legacy cash parts preserve actual cents and separate money from credit", () => {
  it("builds split tender with exact cents and cash received separate from applied", () => {
    expect(
      legacyCashParts(
        form({
          cash_amount: "100.29",
          tendered: "200.00",
          card_amount: "10",
          card_reference: " ENSAYO:terminal ",
          transfer_amount: "5.01",
          transfer_reference: "ENSAYO:banco",
        }),
      ),
    ).toEqual([
      { method_code: "CASH", amount_cents: 10029, tendered_cents: 20000 },
      { method_code: "CARD", amount_cents: 1000, reference: "ENSAYO:terminal" },
      { method_code: "TRANSFER", amount_cents: 501, reference: "ENSAYO:banco" },
    ]);
  });
  it("does not manufacture a cash leg for card-only payments", () =>
    expect(
      legacyCashParts(form({ card_amount: "5", card_reference: "ENSAYO" })),
    ).toEqual([
      { method_code: "CARD", amount_cents: 500, reference: "ENSAYO" },
    ]));
  it("rejects underpaid cash and orphaned tender without amount", () => {
    expect(() =>
      legacyCashParts(form({ cash_amount: "2", tendered: "1" })),
    ).toThrow("M9_INSUFFICIENT_TENDERED");
    expect(() => legacyCashParts(form({ tendered: "1" }))).toThrow(
      "M9_INVALID_PAYMENT",
    );
  });
  it("requires references and positive nonfractional cents", () => {
    for (const v of [
      {},
      { card_amount: "1" },
      { card_amount: "1", card_reference: "xx" },
      { cash_amount: "0", tendered: "1" },
      { cash_amount: "1.001", tendered: "2" },
      { transfer_amount: "1", transfer_reference: "x".repeat(101) },
    ])
      expect(() => legacyCashParts(form(v))).toThrow();
  });
  it("caps the combined amount, not only individual legs", () =>
    expect(() =>
      legacyCashParts(
        form({
          cash_amount: "9999999.99",
          tendered: "9999999.99",
          card_amount: "0.01",
          card_reference: "ENSAYO",
        }),
      ),
    ).toThrow("M9_INVALID_PAYMENT"));
  it("maps failures without exposing customer or database details", () => {
    expect(legacyCashFailure("M9_SESSION_FORBIDDEN")).toBe("caja");
    expect(legacyCashFailure("M9_PAYMENT_REFERENCE_REQUIRED")).toBe(
      "referencia",
    );
    expect(legacyCashFailure("private bank details")).toBe("datos");
  });
});
