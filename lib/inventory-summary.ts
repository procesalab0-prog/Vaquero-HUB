// Both Inicio and Inventario summarize the same catalogue snapshot, including
// variants which have never had an inventory_by_location row (zero available).
export const INVENTORY_SNAPSHOT_LIMIT = 500;

export function summarizeInventory(
  items: ReadonlyArray<{ availableQuantity: number }>,
) {
  let outCount = 0;
  let lowCount = 0;
  for (const item of items) {
    if (item.availableQuantity <= 0) outCount += 1;
    else if (item.availableQuantity <= 2) lowCount += 1;
  }
  return { outCount, lowCount };
}
