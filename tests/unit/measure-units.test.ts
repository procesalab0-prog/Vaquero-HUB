import { expect, it } from "vitest";
import {
  PIECE_UNIT,
  measureLineCents,
  measureQuantityStep,
  parseMeasureQuantity,
  parseQuantityTransport,
  summarizeMeasureQuantities,
} from "../../lib/measure-units";
const kilo = { code: "KILO", name: "Kilo", decimal_places: 3 as const };

it("pieza/par enteros; kilo/metro precisos sin conversiones", () => {
  expect(parseMeasureQuantity("2", PIECE_UNIT)).toBe(2);
  expect(parseMeasureQuantity("2.5", PIECE_UNIT)).toBeNull();
  expect(parseMeasureQuantity("2,125", kilo)).toBe(2.125);
  expect(parseMeasureQuantity("2.1251", kilo)).toBeNull();
  for (const value of ["NaN", "Infinity", "1e2", "-1", "1,000.25", ""])
    expect(parseMeasureQuantity(value, kilo)).toBeNull();
  expect(parseMeasureQuantity("0", kilo)).toBeNull();
  expect(parseMeasureQuantity("0", kilo, true)).toBe(0);
  expect(measureQuantityStep(PIECE_UNIT)).toBe(1);
  expect(measureQuantityStep(kilo)).toBe(0.001);
});
it("transporta decimales sin decidir la unidad ni redondear entradas inválidas", () => {
  expect(parseQuantityTransport("0.625")).toBe(0.625);
  expect(parseQuantityTransport("0", true)).toBe(0);
  for (const value of ["", "1e2", "Infinity", "NaN", "1.0001", "-1"])
    expect(parseQuantityTransport(value, true)).toBeNull();
  expect(parseMeasureQuantity("0.625", PIECE_UNIT, true)).toBeNull();
});
it("separa totales de piezas y kilos y suma milésimas exactamente", () => {
  const totals = summarizeMeasureQuantities([
    { availableQuantity: 2, reservedQuantity: 1 },
    { measureUnit: kilo, availableQuantity: 0.1, reservedQuantity: 0.001 },
    { measureUnit: kilo, availableQuantity: 0.2, reservedQuantity: 0.002 },
  ]);
  expect(totals).toEqual([
    { unit: PIECE_UNIT, availableQuantity: 2, reservedQuantity: 1 },
    { unit: kilo, availableQuantity: 0.3, reservedQuantity: 0.003 },
  ]);
});
it("calcula centavos exactos con redondeo por renglón y sin desbordes", () => {
  expect(measureLineCents(1999, 1.125, kilo)).toBe(2249);
  expect(measureLineCents(100, 0.005, kilo)).toBe(1);
  expect(measureLineCents(100, 0.005, PIECE_UNIT)).toBeNull();
  expect(measureLineCents(Number.MAX_SAFE_INTEGER, 1000, kilo)).toBeNull();
});
