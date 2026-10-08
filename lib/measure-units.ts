export type MeasureUnit = { code: string; name: string; decimal_places: 0 | 3 };
export const PIECE_UNIT: MeasureUnit = {
  code: "PIECE",
  name: "Pieza",
  decimal_places: 0,
};
export const DEFAULT_MEASURE_UNITS: MeasureUnit[] = [
  PIECE_UNIT,
  { code: "PAIR", name: "Par", decimal_places: 0 },
  { code: "KILO", name: "Kilo", decimal_places: 3 },
  { code: "METRE", name: "Metro", decimal_places: 3 },
];

/** Decimal text, not floating-point rounding: reject excess precision outright. */
export function parseMeasureQuantity(
  value: string,
  unit: MeasureUnit,
  allowZero = false,
): number | null {
  const normalized = value.trim().replace(",", ".");
  const pattern = unit.decimal_places === 3 ? /^\d+(?:\.\d{1,3})?$/ : /^\d+$/;
  if (!pattern.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  if (
    !Number.isSafeInteger(milli) ||
    milli > 999999999999 ||
    (allowZero ? milli < 0 : milli <= 0)
  )
    return null;
  return milli / 1000;
}

export function measureLineCents(
  unitPriceCents: number,
  quantity: number,
  unit: MeasureUnit,
): number | null {
  const parsed = parseMeasureQuantity(String(quantity), unit);
  if (
    parsed === null ||
    !Number.isSafeInteger(unitPriceCents) ||
    unitPriceCents < 0
  )
    return null;
  const milli = BigInt(Math.round(parsed * 1000));
  // Same positive half-up rounding as PostgreSQL round(numeric), one line at a time.
  const cents = (BigInt(unitPriceCents) * milli + BigInt(500)) / BigInt(1000);
  return cents > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(cents);
}

export function measureQuantityStep(unit: MeasureUnit) {
  return unit.decimal_places === 3 ? 0.001 : 1;
}

/** Transport syntax only: the database resolves and enforces the actual unit.
 * Never accept a client's choice of decimal places as authorization.
 */
export function parseQuantityTransport(value: string, allowZero = false) {
  return parseMeasureQuantity(
    value,
    { code: "TRANSPORT", name: "Cantidad", decimal_places: 3 },
    allowZero,
  );
}

export function quantityUnit(item: { measureUnit?: MeasureUnit }) {
  return item.measureUnit ?? PIECE_UNIT;
}

/** Separate unlike units: never add kilos, metres and pieces into one total. */
export function summarizeMeasureQuantities(
  items: ReadonlyArray<{
    measureUnit?: MeasureUnit;
    availableQuantity: number;
    reservedQuantity: number;
  }>,
) {
  const groups = new Map<
    string,
    { unit: MeasureUnit; availableMilli: number; reservedMilli: number }
  >();
  for (const item of items) {
    const unit = quantityUnit(item);
    const group = groups.get(unit.code) ?? {
      unit,
      availableMilli: 0,
      reservedMilli: 0,
    };
    group.availableMilli += Math.round(item.availableQuantity * 1000);
    group.reservedMilli += Math.round(item.reservedQuantity * 1000);
    groups.set(unit.code, group);
  }
  return [...groups.values()].map((group) => ({
    unit: group.unit,
    availableQuantity: group.availableMilli / 1000,
    reservedQuantity: group.reservedMilli / 1000,
  }));
}
