import { describe, it, expect } from "vitest";
import {
  customerReviewEnabled,
  CUSTOMER_REVIEW_STAGING_URL,
  reviewAmountCents,
  reviewFailure,
} from "../../lib/customer-migration";
describe("customer source review boundaries", () => {
  it("allows only the exact staging backend", () => {
    expect(customerReviewEnabled(CUSTOMER_REVIEW_STAGING_URL)).toBe(true);
    for (const url of [
      undefined,
      "https://drubkjlmfbdeglucakmg.supabase.co",
      CUSTOMER_REVIEW_STAGING_URL + ".evil",
      CUSTOMER_REVIEW_STAGING_URL + "/",
    ])
      expect(customerReviewEnabled(url)).toBe(false);
  });
  it("parses cent values without floating point rounding", () => {
    expect(reviewAmountCents("4.00")).toBe(400);
    expect(reviewAmountCents("6")).toBe(600);
    expect(reviewAmountCents("0.01")).toBe(1);
    expect(reviewAmountCents("10.1")).toBe(1010);
  });
  it("rejects negative, fractional cents, exponent and malformed inputs", () => {
    for (const value of [
      "",
      "0",
      "-4",
      "4.001",
      "1e2",
      "4,00",
      " 4.00",
      "01",
      "Infinity",
      "99999999",
      "NaN",
    ])
      expect(reviewAmountCents(value)).toBe(null);
  });
  it("returns safe status codes instead of leaking source or database details", () => {
    expect(reviewFailure("CREDIT_OVERPAYMENT")).toBe("sobrepago");
    expect(reviewFailure("IDEMPOTENCY_CONFLICT")).toBe("conflicto");
    expect(reviewFailure("M9_TARGET_IDENTITY_REVIEW")).toBe("sin-candidato");
    expect(reviewFailure("private customer data")).toBe("error");
  });
});
