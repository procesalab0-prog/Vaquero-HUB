// Cuánto de un apartado está pagado, para dibujarlo y decirlo con texto.

export function paidFraction(paidCents: number, totalCents: number) {
  if (!Number.isFinite(paidCents) || !Number.isFinite(totalCents)) return 0;
  if (totalCents <= 0) return paidCents > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, paidCents / totalCents));
}

// Redondeo hacia abajo: un apartado no se muestra al 100 % mientras quede un
// centavo por pagar.
export function paidPercent(paidCents: number, totalCents: number) {
  const fraction = paidFraction(paidCents, totalCents);
  return fraction >= 1 ? 100 : Math.floor(fraction * 100);
}
