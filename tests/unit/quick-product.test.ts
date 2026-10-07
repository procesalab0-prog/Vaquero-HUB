import { expect, it } from "vitest";
import {
  parseQuickProduct,
  posItemInput,
  posItemVariant,
  quickProductVariant,
} from "../../lib/quick-product";

it("producto rápido guarda precio exacto, no crea código ni identidad de catálogo", () => {
  const parsed = parseQuickProduct("  Accesorio  ", "19.99", "2");
  expect(parsed).toEqual({
    quick: { name: "Accesorio", unit_price_cents: 1999 },
    quantity: 2,
  });
  const variant = quickProductVariant("line-id", parsed!.quick);
  expect(variant.legacyCode).toBe("");
  expect(variant.sku).toBeUndefined();
  const item = posItemInput({ variant, quantity: 2, giftReceipt: false });
  expect(posItemVariant(item, new Map())).toEqual(variant);
  expect(item.quick).toEqual(parsed!.quick);
});
it("rechaza precio/cantidad inválidos y costo opcional mal capturado", () => {
  for (const value of ["1.001", "-1", "1e2", "NaN", "0", "1000000.01"])
    expect(parseQuickProduct("A", value, "1")).toBeNull();
  for (const value of ["0", "1.5", "1000", "1e2"])
    expect(parseQuickProduct("A", "1", value)).toBeNull();
  expect(parseQuickProduct("A", "1", "1", "-1")).toBeNull();
  expect(parseQuickProduct("A", "1", "1", "0")?.quick.unit_cost_cents).toBe(0);
});
