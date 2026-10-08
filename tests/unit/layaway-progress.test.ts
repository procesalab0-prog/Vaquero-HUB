import { describe, expect, it } from "vitest";

import { paidFraction, paidPercent } from "../../lib/layaway-progress";

describe("lo pagado de un apartado", () => {
  it("se dibuja como fracción del total", () => {
    expect(paidFraction(25_000, 100_000)).toBe(0.25);
    expect(paidFraction(0, 100_000)).toBe(0);
    expect(paidFraction(100_000, 100_000)).toBe(1);
  });

  it("no pasa de lleno ni baja de vacío", () => {
    expect(paidFraction(120_000, 100_000)).toBe(1);
    expect(paidFraction(-5, 100_000)).toBe(0);
  });

  it("no dice 100 % mientras falte un centavo", () => {
    expect(paidPercent(99_999, 100_000)).toBe(99);
    expect(paidPercent(100_000, 100_000)).toBe(100);
  });
});
