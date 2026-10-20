import { describe, it, expect } from "vitest";
import {
  legacyTrialCents,
  legacyFinanceFailure,
} from "../../lib/legacy-finance";
describe("legacy financial trial input", () => {
  it("preserves cents exactly without floating point multiplication", () => {
    expect(legacyTrialCents("0.29")).toBe(29);
    expect(legacyTrialCents("2190.00")).toBe(219000);
    expect(legacyTrialCents("9999999.99")).toBe(999999999);
  });
  it("rejects missing, zero, negative, fractional cents, exponent and oversized values", () => {
    for (const v of [
      "",
      "0",
      "0.00",
      "-1",
      "1.001",
      "1e3",
      "1,000",
      " 1",
      "01",
      "10000000",
    ])
      expect(() => legacyTrialCents(v)).toThrow("M9_POSITIVE_AMOUNT_REQUIRED");
  });
  it("does not expose database data in error notices", () => {
    expect(legacyFinanceFailure("M9_OVERPAYMENT")).toBe("sobrepago");
    expect(legacyFinanceFailure("M9_NO_OPEN_DEBT")).toBe("sin-saldo");
    expect(legacyFinanceFailure("private customer name")).toBe("error");
  });
});
