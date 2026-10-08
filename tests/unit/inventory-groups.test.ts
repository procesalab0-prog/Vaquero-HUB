import { expect, it } from "vitest";
import type { InventoryItem } from "../../lib/domain";
import { groupInventory } from "../../lib/inventory-groups";

it("agrupa por identidad y conserva variantes y orden aunque los nombres coincidan", () => {
  const row = (productId: string, variantId: string) =>
    ({
      productId,
      variantId,
      productName: "Bota",
      brand: "Marca",
    }) as InventoryItem;
  const groups = groupInventory([row("a", "1"), row("b", "2"), row("a", "3")]);
  expect(
    groups.map((group) => [
      group.productId,
      group.items.map((item) => item.variantId),
    ]),
  ).toEqual([
    ["a", ["1", "3"]],
    ["b", ["2"]],
  ]);
  expect(groupInventory([])).toEqual([]);
});
