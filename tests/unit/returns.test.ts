import { describe, expect, it } from "vitest";

import {
  databaseErrorText,
  selectedReturnValue,
  unitExchangeValue,
  type ReturnableSaleItem,
} from "../../lib/returns";

describe("databaseErrorText", () => {
  it("lee el mensaje de los objetos que devuelve Supabase", () => {
    expect(
      databaseErrorText({ message: "INSUFFICIENT_STOCK", code: "P0001" }),
    ).toBe("INSUFFICIENT_STOCK");
  });

  it("conserva los errores nativos", () => {
    expect(databaseErrorText(new Error("RETURN_WINDOW_EXPIRED"))).toBe(
      "RETURN_WINDOW_EXPIRED",
    );
  });
});

function item(overrides: Partial<ReturnableSaleItem> = {}): ReturnableSaleItem {
  return {
    sale_item_id: "sale-item",
    variant_id: "variant",
    product_name: "Bota",
    variant_description: "Talla 26",
    sku: "BOT-26",
    quantity: 2,
    remaining_quantity: 2,
    paid_line_cents: 999,
    already_returned_cents: 0,
    ...overrides,
  };
}

describe("unitExchangeValue", () => {
  it("usa el valor unitario truncado mientras quedan varias piezas", () => {
    expect(unitExchangeValue(item())).toBe(499);
  });

  it("asigna al ultimo cambio el centavo restante", () => {
    expect(
      unitExchangeValue(
        item({ remaining_quantity: 1, already_returned_cents: 499 }),
      ),
    ).toBe(500);
  });
});

describe("selectedReturnValue", () => {
  it("matches SQL fractional allocations with the final cent residue", () => {
    const base = item({
      quantity: 1.25,
      remaining_quantity: 1.25,
      paid_line_cents: 15431,
      measureUnit: { code: "KILO", name: "Kilo", decimal_places: 3 },
    });
    expect(selectedReturnValue(base, 0.333)).toBe(4110);
    expect(
      selectedReturnValue(
        { ...base, remaining_quantity: 0.584, already_returned_cents: 8220 },
        0.584,
      ),
    ).toBe(7211);
    expect(selectedReturnValue(base, 0.3331)).toBe(0);
    expect(
      selectedReturnValue({ ...base, measureUnit: undefined }, 0.333),
    ).toBe(0);
  });
  it("conserva todos los centavos al devolver el último remanente", () => {
    const item = {
      quantity: 3,
      remaining_quantity: 2,
      paid_line_cents: 10001,
      already_returned_cents: 3333,
    } as ReturnableSaleItem;
    expect(selectedReturnValue(item, 1)).toBe(3333);
    expect(selectedReturnValue(item, 2)).toBe(6668);
  });
});
