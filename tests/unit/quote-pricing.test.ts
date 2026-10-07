import { describe, expect, it } from "vitest";
import { quoteLinePricing } from "@/lib/quote-pricing";

describe("quoteLinePricing", () => {
  it("omits blank overrides, preserving regular authorization", () => {
    expect(quoteLinePricing("v", 2, 10000)).toEqual({
      variant_id: "v",
      quantity: 2,
    });
  });
  it("keeps discounts per line in cents and accepts decimal comma", () => {
    expect(quoteLinePricing("v", 2, 10000, "90,50", "10.25")).toEqual({
      variant_id: "v",
      quantity: 2,
      unit_price_cents: 9050,
      discount_cents: 1025,
    });
  });
  it.each(["-1", "NaN", "1e3", "0.001", "Infinity"])(
    "rejects malformed price %s when supplied as a discount",
    (value) => {
      expect(() => quoteLinePricing("v", 1, 100, "", value)).toThrow(
        "INVALID_QUOTE_PRICING",
      );
    },
  );
  it("rejects excess discount and fractional quantities", () => {
    expect(() => quoteLinePricing("v", 1, 100, "", "2")).toThrow();
    expect(() => quoteLinePricing("v", 0.5, 100)).toThrow();
  });
});
