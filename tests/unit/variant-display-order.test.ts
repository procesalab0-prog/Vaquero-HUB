import { expect, it } from "vitest";
import {
  compareVariantSizes,
  orderVariantFamilies,
  sortVariantsBySize,
} from "../../lib/variant-display-order";
import { groupInventory } from "../../lib/inventory-groups";
import type { InventoryItem } from "../../lib/domain";

it("ordena ropa sin reescribir valores ni inventar tallas", () => {
  const original = ["XL", "M", "S", "L"];
  expect(sortVariantsBySize(original, (x) => x)).toEqual(["S", "M", "L", "XL"]);
  expect(original).toEqual(["XL", "M", "S", "L"]);
  expect(
    sortVariantsBySize(["2XL", "XS", "3XL", "XL", "S", "L", "M"], (x) => x),
  ).toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL"]);
});
it("ordena medias tallas y tallas numéricas de niño", () => {
  expect(
    sortVariantsBySize(["30", "25.5", "26", "25", "28.5"], (x) => x),
  ).toEqual(["25", "25.5", "26", "28.5", "30"]);
  expect(
    sortVariantsBySize(["16", "4", "10", "2", "14", "6"], (x) => x),
  ).toEqual(["2", "4", "6", "10", "14", "16"]);
});
it("conserva variantes, códigos y orden relativo de tallas equivalentes", () => {
  const rows = [
    { code: "0001", size: "XXL" },
    { code: "0002", size: "2XL" },
    { code: "0003", size: "M" },
  ];
  expect(sortVariantsBySize(rows, (x) => x.size).map((x) => x.code)).toEqual([
    "0003",
    "0001",
    "0002",
  ]);
  expect(compareVariantSizes(" S ", "s")).toBe(0);
});
it("agrupa sólo por identidad y conserva el orden de familias de búsqueda", () => {
  const rows = [
    { id: "a", product: "p1", size: "XL" },
    { id: "b", product: "p2", size: "M" },
    { id: "c", product: "p1", size: "S" },
  ];
  expect(
    orderVariantFamilies(
      rows,
      (x) => x.product,
      (x) => x.size,
    ).map((x) => x.id),
  ).toEqual(["c", "a", "b"]);
  expect(rows.map((x) => x.id)).toEqual(["a", "b", "c"]);
});
it("Inventario conserva cantidades y separa productos con el mismo nombre", () => {
  const rows = [
    {
      productId: "a",
      variantId: "1",
      productName: "Camisa",
      attributes: { TALLA: "XL" },
      quantity: 7,
    },
    {
      productId: "b",
      variantId: "2",
      productName: "Camisa",
      attributes: { TALLA: "M" },
      quantity: 3,
    },
    {
      productId: "a",
      variantId: "3",
      productName: "Camisa",
      attributes: { TALLA: "S" },
      quantity: 2,
    },
  ].map((row) => ({
    ...row,
    brand: "",
    sku: row.variantId,
    code: row.variantId,
    reservedQuantity: 0,
    availableQuantity: row.quantity,
    isActive: true,
    updatedAt: "2026-10-08",
  })) satisfies InventoryItem[];
  const groups = groupInventory(rows);
  expect(
    groups.map((g) => g.items.map((x) => [x.variantId, x.quantity])),
  ).toEqual([
    [
      ["3", 2],
      ["1", 7],
    ],
    [["2", 3]],
  ]);
  expect(rows[0].variantId).toBe("1");
});
it("no descarta tallas desconocidas, vacías ni iguales", () => {
  const rows = ["", "Única", "40/42", "A", "A"];
  expect(sortVariantsBySize(rows, (x) => x)).toHaveLength(5);
  expect(
    orderVariantFamilies(
      [],
      () => "",
      () => "",
    ),
  ).toEqual([]);
});
