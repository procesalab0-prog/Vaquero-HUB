/** Empty input means missing, including when a caller bypasses HTML required. */
export function parseCatalogCents(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100)
    : null;
}
