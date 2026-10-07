import type { InventoryItem } from "./domain";

/** Group by identity, never by name: different products may share a title. */
export function groupInventory(items: InventoryItem[]) {
  const groups = new Map<string, { productId: string; name: string; brand: string; items: InventoryItem[] }>();
  for (const item of items) {
    let group = groups.get(item.productId);
    if (!group) {
      group = { productId: item.productId, name: item.productName, brand: item.brand, items: [] };
      groups.set(item.productId, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
