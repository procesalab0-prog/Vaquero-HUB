export const BANXICO_FIX_SERIES = "SF43718";
export const BANXICO_FIX_URL =
  "https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno";
export type FixObservation = { date: string; rateMillion: number };
export type UsdExchangeQuote = {
  id: string;
  reference_date: string;
  reference_rate_million: number;
  adjustment_million: number;
  rate_million: number;
  expires_at: string;
  refund_currency: "MXN";
  refund_rate: "ORIGINAL_SALE";
};

/** Strict decimal text. No scientific notation, separators or silent rounding. */
export function parseExchangeRate(
  value: string,
  signed = false,
): number | null {
  const text = value.trim().replace(",", ".");
  if (text.length > 20) return null;
  if (!(signed ? /^-?\d+(?:\.\d{1,6})?$/ : /^\d+(?:\.\d{1,6})?$/).test(text))
    return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const amount =
    BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
  if (amount > BigInt(1_000_000_000) || (!signed && amount === BigInt(0)))
    return null;
  return Number(negative ? -amount : amount);
}

export function parseBanxicoFix(
  payload: unknown,
  today: string,
): FixObservation | null {
  const data = payload as {
    bmx?: {
      series?: Array<{
        idSerie?: unknown;
        datos?: Array<{ fecha?: unknown; dato?: unknown }>;
      }>;
    };
  } | null;
  if (!Array.isArray(data?.bmx?.series)) return null;
  const series = data.bmx.series.filter(
    (item) => item?.idSerie === BANXICO_FIX_SERIES,
  );
  if (series.length !== 1 || !Array.isArray(series[0].datos)) return null;
  const observations: FixObservation[] = [];
  for (const row of series[0].datos) {
    if (typeof row?.fecha !== "string" || typeof row?.dato !== "string")
      continue;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.fecha);
    if (!match) continue;
    const date = `${match[3]}-${match[2]}-${match[1]}`;
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date ||
      date > today ||
      date < "2000-01-01"
    )
      continue;
    const rateMillion = parseExchangeRate(row.dato);
    if (rateMillion !== null) observations.push({ date, rateMillion });
  }
  return observations.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

/** Commercial money remains MXN. Keep received USD cents in a separate ledger.
 * Refunds use the original immutable MXN amount, not a newly fetched rate. */
export function calculateUsdTender(
  usdCents: number,
  rateMillion: number,
  saleMxnCents: number,
) {
  if (
    ![usdCents, rateMillion, saleMxnCents].every(Number.isSafeInteger) ||
    usdCents <= 0 ||
    saleMxnCents <= 0 ||
    rateMillion <= 0 ||
    rateMillion > 1_000_000_000
  )
    return null;
  const equivalent =
    (BigInt(usdCents) * BigInt(rateMillion) + BigInt(500_000)) /
    BigInt(1_000_000);
  if (
    equivalent > BigInt(Number.MAX_SAFE_INTEGER) ||
    equivalent < BigInt(saleMxnCents)
  )
    return null;
  return {
    usdCents,
    equivalentMxnCents: Number(equivalent),
    changeMxnCents: Number(equivalent) - saleMxnCents,
    refundCurrency: "MXN" as const,
  };
}
