import { describe, it, expect } from "vitest";
import { prepareSicarOnly } from "../../scripts/m9/prepare-sicar-only.mjs";
const row = (barcode, description) => ({
  barcode,
  description,
  classification: "SICAR_ONLY",
  fields: {
    "clave1 *": barcode,
    "descripción *": description,
    departamento: "DAMA",
    categoria: "CAMISAS",
    precio1: "120.50",
    "(s/n) mostrar en ventas": "s",
    existencia: "999",
  },
});
describe("SICAR-only review", () => {
  it("keeps literal codes and never includes inventory or invents a Woo identity", () => {
    const r = prepareSicarOnly([row("0001", "ABC27")]);
    expect(r.records[0].barcode).toBe("0001");
    expect(r.records[0].proposed).toBeNull();
    expect(r.records[0].retail_cents).toBe(12050);
    expect(JSON.stringify(r)).not.toContain("999");
    expect(r.summary.approved_for_import).toBe(0);
  });
  it("proposes only explicit delimiters without authorizing import", () => {
    const r = prepareSicarOnly([row("1", "ABCT.S"), row("2", "ABCT.M")]);
    expect(r.families).toHaveLength(1);
    expect(r.families[0].import_allowed).toBe(false);
  });
  it("keeps departments separate and flags repeated suffixes", () => {
    const a = row("1", "ABCT.S"),
      b = row("2", "ABCT.S"),
      c = row("3", "ABCT.M");
    c.fields.departamento = "CABALLERO";
    const r = prepareSicarOnly([a, b, c]);
    expect(r.families).toHaveLength(2);
    expect(r.families.some((f) => f.issues.includes("REPEATED_SUFFIX"))).toBe(
      true,
    );
  });
  it("detects collisions against rows outside this subset", () => {
    const a = row("001", "A"),
      b = row("001", "B");
    b.classification = "CONFLICT";
    expect(prepareSicarOnly([a, b]).records[0].issues).toContain(
      "BARCODE_REVIEW",
    );
  });
  it("reserves price, taxonomy and visibility without fabricating values", () => {
    const a = row("1", "A");
    a.fields.precio1 = "0";
    a.fields.categoria = ".";
    a.fields["(s/n) mostrar en ventas"] = "n";
    const r = prepareSicarOnly([a]).records[0];
    expect(r.retail_cents).toBeNull();
    expect(r.issues).toEqual([
      "RETAIL_PRICE_REVIEW",
      "SALES_VISIBILITY_REVIEW",
      "TAXONOMY_REVIEW",
    ]);
  });
  it("rejects a changed source identity", () => {
    const a = row("1", "A");
    a.fields["clave1 *"] = "2";
    expect(() => prepareSicarOnly([a])).toThrow("SOURCE_IDENTITY_CHANGED");
  });
  it("is deterministic when source ordering changes", () => {
    const a = row("1", "ABCT.S"),
      b = row("2", "ABCT.M");
    expect(prepareSicarOnly([a, b])).toEqual(prepareSicarOnly([b, a]));
  });
});
