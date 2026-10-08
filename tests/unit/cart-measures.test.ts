import { describe, expect, it } from "vitest";
import {
  cartLineCents,
  changeCartQuantity,
  initialCartQuantity,
} from "@/lib/cart-measures";
import { quoteLinePricing } from "@/lib/quote-pricing";
import { mockVariants } from "@/lib/mock-data";
const kilo = { code: "KILO", name: "Kilo", decimal_places: 3 as const };
const measured = {
  ...mockVariants[0],
  stock: 0.625,
  price: 123.45,
  measureUnit: kilo,
};
describe("commercial measure quantities", () => {
  it("rounds each line in cents, not the aggregate floating point total", () => {
    expect(cartLineCents({ variant: measured, quantity: 0.625 })).toBe(7716);
    expect(cartLineCents({ variant: measured, quantity: 1.25 })).toBe(15431);
  });
  it("increments in exact milliquantity and never exceeds available stock", () => {
    expect(changeCartQuantity(measured, 0.624, 0.001)).toBe(0.625);
    expect(changeCartQuantity(measured, 0.625, 0.001)).toBe(0.625);
    expect(initialCartQuantity(measured)).toBe(0.625);
    expect(initialCartQuantity({ ...measured, measureUnit: undefined })).toBe(
      0,
    );
  });
  it("requires actual unit precision and compares discounts to rounded gross", () => {
    expect(
      quoteLinePricing("v", 1.25, 12345, "", "0.31", kilo).discount_cents,
    ).toBe(31);
    expect(() => quoteLinePricing("v", 1.2501, 12345, "", "", kilo)).toThrow();
    expect(() => quoteLinePricing("v", 1.25, 12345)).toThrow();
    expect(() => quoteLinePricing("v", 0.001, 500, "", "0.02", kilo)).toThrow();
  });
});
