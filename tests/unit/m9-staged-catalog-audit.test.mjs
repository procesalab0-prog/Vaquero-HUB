import { describe, it, expect } from "vitest";
import { auditStagedCatalog } from "../../scripts/m9/audit-staged-catalog.mjs";

function fixture() {
  const source = [
    {
      barcode: "0010",
      description: "MODELOT.S",
      product_id: 10,
      variation_id: 11,
      attributes: [{ name: "Talla", value: "S" }],
      fields: {
        "clave1 *": "0010",
        "descripción *": "MODELOT.S",
        departamento: "NIÑO",
        categoria: "CAMISAS",
        precio1: "740.50",
      },
    },
  ];
  const current = {
    barcode: "0010",
    description: "MODELOT.S",
    department: "NIÑO",
    section: "CAMISAS",
    price_cents: 74050,
    cost_cents: null,
    attributes: { TALLA: "S" },
    woo_product_id: 10,
    woo_variation_id: 11,
    product_name: "Nombre editorial Woo",
  };
  const snapshot = {
    project_id: "zsezjtswqeijboezvado",
    inventory_balances: 0,
    inventory_movements: 0,
    rows: [
      {
        variant_id: "v1",
        product_id: "p1",
        current,
        stored: structuredClone(current),
      },
    ],
  };
  return { snapshot, source };
}

describe("complete staging catalog audit", () => {
  it("preserves literal codes, retail cents and independent editorial names without authorizing writes", () => {
    const { snapshot, source } = fixture();
    const result = auditStagedCatalog(snapshot, source);
    expect(result.summary.exact_rows).toBe(1);
    expect(result.results[0].barcode).toBe("0010");
    expect(result.write_allowed).toBe(false);
    expect(() =>
      auditStagedCatalog({ ...snapshot, project_id: "production" }, source),
    ).toThrow("STAGING_SNAPSHOT_REQUIRED");
  });
  it("detects source drift even if stored and current catalog rows agree with each other", () => {
    const { snapshot, source } = fixture();
    source[0].fields.precio1 = "800";
    source[0].fields.departamento = "CABALLERO";
    const result = auditStagedCatalog(snapshot, source);
    expect(result.summary.review_rows).toBe(1);
    expect(result.results[0].differences.map((d) => d.field)).toEqual([
      "department",
      "price_cents",
    ]);
  });
  it("detects an edited catalog and unknown cost replaced by zero", () => {
    const { snapshot, source } = fixture();
    snapshot.rows[0].current.cost_cents = 0;
    const reasons = auditStagedCatalog(snapshot, source).results[0].reasons;
    expect(reasons).toContain("CATALOG_DIFFERS_FROM_APPLIED_ROW");
    expect(reasons).toContain("UNKNOWN_COST_MUST_REMAIN_NULL");
  });
  it("reserves missing or duplicated source codes without proposing deletion", () => {
    const { snapshot, source } = fixture();
    expect(auditStagedCatalog(snapshot, []).results[0].reasons).toContain(
      "SOURCE_CODE_ABSENT_NO_DELETE",
    );
    expect(
      auditStagedCatalog(snapshot, [...source, ...source]).results[0].reasons,
    ).toContain("DUPLICATE_SOURCE_CODE");
  });
  it("detects duplicate destination codes and variant IDs in every affected row", () => {
    const { snapshot, source } = fixture();
    snapshot.rows.push(structuredClone(snapshot.rows[0]));
    const result = auditStagedCatalog(snapshot, source);
    expect(result.summary.review_rows).toBe(2);
    expect(
      result.results.every((r) =>
        r.reasons.includes("DUPLICATE_STAGED_BARCODE"),
      ),
    ).toBe(true);
    expect(result.results[1].reasons).toContain(
      "DUPLICATE_OR_INVALID_VARIANT_ID",
    );
  });
  it("keeps inventory activity visible and reports unimported source rows", () => {
    const { snapshot, source } = fixture();
    snapshot.inventory_movements = 1;
    source.push({ ...source[0], barcode: "other" });
    const result = auditStagedCatalog(snapshot, source);
    expect(result.summary.inventory_clean).toBe(false);
    expect(result.summary.not_staged_rows).toBe(1);
  });
  it("rejects invalid retail prices and duplicate attribute names instead of normalizing them away", () => {
    const { snapshot, source } = fixture();
    source[0].fields.precio1 = "740.500";
    source[0].attributes.push({ name: "Talla", value: "M" });
    const reasons = auditStagedCatalog(snapshot, source).results[0].reasons;
    expect(reasons).toContain("INVALID_SOURCE_PUBLIC_PRICE");
    expect(reasons).toContain("DUPLICATE_SOURCE_ATTRIBUTE");
  });
});
