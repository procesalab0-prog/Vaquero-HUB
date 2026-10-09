/** Display only: never rewrites a size, barcode, family or source snapshot. */
const natural = new Intl.Collator("es-MX", {
  numeric: true,
  sensitivity: "base",
});
const apparel = new Map([
  ["XXXS", 0],
  ["3XS", 0],
  ["XXS", 1],
  ["2XS", 1],
  ["XS", 2],
  ["S", 3],
  ["M", 4],
  ["L", 5],
  ["XL", 6],
  ["XXL", 7],
  ["2XL", 7],
  ["XXXL", 8],
  ["3XL", 8],
  ["4XL", 9],
  ["5XL", 10],
  ["6XL", 11],
]);
export function compareVariantSizes(left: string, right: string) {
  const a = left.trim().toUpperCase(),
    b = right.trim().toUpperCase();
  const ar = apparel.get(a),
    br = apparel.get(b);
  if (ar !== undefined && br !== undefined) return ar - br;
  if (ar !== undefined || br !== undefined) return ar !== undefined ? -1 : 1;
  return natural.compare(a, b);
}
export function sortVariantsBySize<T>(
  rows: readonly T[],
  size: (row: T) => string,
) {
  return [...rows].sort((a, b) => compareVariantSizes(size(a), size(b)));
}
/** Keep family order and identity; sort only the variants inside each family. */
export function orderVariantFamilies<T>(
  rows: readonly T[],
  family: (row: T) => string,
  size: (row: T) => string,
) {
  const families = new Map<string, T[]>();
  for (const row of rows) {
    const key = family(row),
      members = families.get(key) ?? [];
    members.push(row);
    families.set(key, members);
  }
  return [...families.values()].flatMap((members) =>
    sortVariantsBySize(members, size),
  );
}
