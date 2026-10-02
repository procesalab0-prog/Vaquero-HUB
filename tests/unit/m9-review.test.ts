import { describe, expect, it } from "vitest";
import { parseCatalogCents } from "../../lib/catalog-money";
import { reviewFilters, reviewHref, reviewMoney } from "../../lib/m9-review";

describe("Revisión M9", () => {
  it("rechaza costo vacío también en el servidor", () => {
    expect(parseCatalogCents("")).toBe(null);
    expect(parseCatalogCents("  ")).toBe(null);
    expect(parseCatalogCents("0")).toBe(0);
    expect(parseCatalogCents("12.50")).toBe(1250);
  });
  it("conserva ceros y espacios en consulta exacta, sin reinterpretarlos", () => {
    expect(reviewFilters({ q: "000007779", mode: "exact" }).q).toBe(
      "000007779",
    );
    expect(reviewFilters({ q: " 10 ", mode: "exact" }).q).toBe(" 10 ");
  });
  it("conserva clasificación y modo al paginar", () => {
    const filters = reviewFilters({
      q: "000007779",
      mode: "exact",
      department: "NIÑO",
      section: "BOTAS & ROPA",
    });
    const url = new URL(reviewHref(filters, 2), "http://localhost");
    expect(reviewFilters(Object.fromEntries(url.searchParams))).toEqual({
      ...filters,
      page: 2,
    });
  });
  it.each(["0", "-1", "1.5", "1e3", "100001", "NaN"])(
    "rechaza página %s",
    (page) => {
      expect(() => reviewFilters({ page })).toThrow();
    },
  );
  it("no muestra cero como sustituto de costo o mayoreo ausente", () => {
    expect(reviewMoney(null, "Sin capturar")).toBe("Sin capturar");
    expect(reviewMoney(null, "Sin definir")).toBe("Sin definir");
    expect(reviewMoney(0, "Sin capturar")).toContain("0.00");
    expect(reviewMoney(91000, "Sin definir")).toContain("910.00");
  });
});
