import { describe, expect, it } from "vitest";
import { summarizeInventory } from "../../lib/inventory-summary";

describe("resumen compartido por Inicio e Inventario", () => {
  it("cuenta agotadas por disponibilidad, incluyendo variantes sin movimientos", () => {
    expect(
      summarizeInventory([
        { availableQuantity: 0 }, // Never stocked in this branch.
        { availableQuantity: 0 }, // All pieces reserved.
        { availableQuantity: 1 },
        { availableQuantity: 2 },
        { availableQuantity: 3 },
      ]),
    ).toEqual({ outCount: 2, lowCount: 2 });
  });

  it("no arrastra agotadas de otra sucursal", () => {
    expect(summarizeInventory([{ availableQuantity: 0 }]).outCount).toBe(1);
    expect(summarizeInventory([{ availableQuantity: 4 }]).outCount).toBe(0);
    expect(summarizeInventory([])).toEqual({ outCount: 0, lowCount: 0 });
  });
});
