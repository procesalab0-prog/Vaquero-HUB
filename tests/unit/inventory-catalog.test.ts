import { describe, expect, it } from "vitest";
import {
  mapInventoryCatalog,
  previewInventoryCatalog,
  type InventoryCatalogTransport,
} from "../../lib/inventory-catalog";
import type { InventoryItem } from "../../lib/domain";

const item = (n: number, qty = 0): InventoryItem => ({
  variantId: String(n),
  productId: String(n),
  productName: `Modelo ${n}`,
  brand: "Marca",
  sku: `sku${n}`,
  code: `000${n}`,
  attributes: { TALLA: "27" },
  quantity: qty,
  reservedQuantity: 0,
  availableQuantity: qty,
  isActive: true,
  updatedAt: "2026-10-19",
});
const query = { query: "", filter: "all" as const, page: 1, exact: false };
describe("catálogo de inventario", () => {
  it("pagina el ejemplo sin recortar sus totales a la página", () => {
    const data = previewInventoryCatalog(
      Array.from({ length: 610 }, (_, n) => item(n)),
      { ...query, page: 13 },
    );
    expect(data.items).toHaveLength(10);
    expect(data.totalCount).toBe(610);
    expect(data.summary.variantCount).toBe(610);
    expect(data.summary.outCount).toBe(610);
  });
  it("incluye una unidad en disponible y separa el filtro de últimas unidades", () => {
    const items = [item(1, 1), item(2, 3), item(3, 0)];
    expect(
      previewInventoryCatalog(items, {
        ...query,
        filter: "available",
      }).items.map((i) => i.variantId),
    ).toEqual(["1", "2"]);
    expect(
      previewInventoryCatalog(items, { ...query, filter: "last" }).items.map(
        (i) => i.variantId,
      ),
    ).toEqual(["1"]);
  });
  it("conserva ceros y rechaza un fragmento en búsqueda exacta", () => {
    expect(
      previewInventoryCatalog([item(1)], {
        ...query,
        query: "0001",
        exact: true,
      }).items[0].code,
    ).toBe("0001");
    expect(
      previewInventoryCatalog([item(1)], { ...query, query: "1", exact: true })
        .totalCount,
    ).toBe(0);
  });
  it("mantiene totales por unidad al filtrar", () => {
    const items = [
      item(1, 2),
      {
        ...item(2, 3),
        measureUnit: { code: "PAIR", name: "Par", decimal_places: 0 as const },
      },
    ];
    const data = previewInventoryCatalog(items, {
      ...query,
      query: "Modelo 1",
    });
    expect(data.items).toHaveLength(1);
    expect(data.summary.units.map((u) => u.availableQuantity)).toEqual([2, 3]);
  });
  it("mapea sólo cantidades numéricas; el código de barras permanece texto", () => {
    const raw: InventoryCatalogTransport = {
      query: "000007779",
      filter: "all",
      exact: true,
      page: 1,
      page_size: 50,
      total_count: 1,
      summary: {
        variant_count: 15877,
        out_count: 15876,
        low_count: 1,
        units: [
          {
            unit: { code: "PIECE", name: "Pieza", decimal_places: 0 },
            quantity: "1",
            reserved_quantity: "0",
            available_quantity: "1",
          },
        ],
      },
      items: [
        {
          variant_id: "variant",
          product_id: "product",
          product_name: "Modelo",
          brand_name: "Marca",
          sku: "sku",
          primary_barcode: "000007779",
          attributes: { TALLA: "59" },
          qty: "1",
          reserved_qty: "0",
          available_qty: "1",
          is_active: true,
          updated_at: "2026-10-19",
          measure_unit: { code: "PIECE", name: "Pieza", decimal_places: 0 },
        },
      ],
    };
    const data = mapInventoryCatalog(raw);
    expect(data.items[0].code).toBe("000007779");
    expect(data.items[0].availableQuantity).toBe(1);
    expect(data.summary.variantCount).toBe(15877);
  });
});
