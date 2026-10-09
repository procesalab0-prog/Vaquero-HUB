import { expect, it } from "vitest";
import { sectionScopeCandidates } from "../../scripts/m9/section-scope-candidates.mjs";
const policy = {
  owner_answers_2026_09_29: {
    pricing: {
      source_column_mapping:
        "Confirmado por usuario: precio1 es lo que cobran al público. precio2/3/4 sin asignación comercial.",
    },
  },
};
function fixture() {
  const row = {
    barcode: "0042",
    description: "AM",
    classification: "MATCH_EXACT_VARIANT",
    manual_review: false,
    display_only: false,
    issues: [],
    reasons: ["UN_PADRE_Y_UNA_VARIANTE_CON_TODOS_LOS_ATRIBUTOS"],
    commercial_checks: [],
    product_id: 10,
    variation_id: 11,
    candidate_product_ids: [10],
    candidate_variation_ids: [11],
    matching_rule: "EXACT_ATTRIBUTE",
    attributes: [{ name: "Talla", value: "M" }],
    fields: {
      "clave1 *": "0042",
      "descripción *": "AM",
      departamento: "CABALLERO",
      categoria: "CAMISAS",
      precio1: "740.00",
    },
  };
  const other = {
    ...structuredClone(row),
    barcode: "55",
    description: "OTHER",
    classification: "CONFLICT",
    manual_review: true,
    product_id: null,
    variation_id: null,
    fields: {
      ...row.fields,
      "clave1 *": "55",
      "descripción *": "OTHER",
      categoria: "BOTAS",
    },
  };
  return {
    rows: [row, other],
    tax: { paths: [] },
    decisions: structuredClone(policy),
    excluded: [
      { barcode: "0042", reasons: ["FAMILIA_CON_SECCIONES_DISTINTAS"] },
    ],
    staged: [],
  };
}
const run = (f) =>
  sectionScopeCandidates(f.rows, f.tax, f.decisions, f.excluded, f.staged);
it("prepares a unique exact identity while retaining foreign rows and original holds", () => {
  const f = fixture(),
    before = structuredClone(f),
    r = run(f);
  expect(r.candidates[0].barcode).toBe("0042");
  expect(r.candidates[0].retail_cents).toBe(74000);
  expect(r.evidence[0].foreign_candidate_codes).toEqual(["55"]);
  expect(r.evidence[0].import_allowed).toBe(false);
  expect(f).toEqual(before);
});
it("never accepts genuine mixed assigned sections, ambiguity, owners or taxonomy holds", () => {
  for (const mutate of [
    (f) => (f.rows[1].product_id = 10),
    (f) => (f.rows[0].manual_review = true),
    (f) => f.rows[0].candidate_product_ids.push(20),
    (f) =>
      (f.decisions.owner_answers_2026_10_01 = {
        responses: [{ woo_ids: [10] }],
      }),
    (f) => (f.tax.paths = [{ needs_review: true, barcodes: ["0042"] }]),
    (f) => f.excluded[0].reasons.push("OTHER"),
    (f) => (f.rows[0].fields.precio1 = "0"),
    (f) => f.rows[0].issues.push("UNKNOWN"),
    (f) => f.rows[0].commercial_checks.push("UNKNOWN_COMMERCIAL_CHECK"),
  ]) {
    const f = fixture();
    mutate(f);
    expect(run(f).candidates).toEqual([]);
  }
});
it("checks duplicate destinations across all rows including blocked foreign candidates", () => {
  const f = fixture();
  f.rows[1].product_id = 10;
  f.rows[1].variation_id = 11;
  f.rows[1].fields.categoria = "CAMISAS";
  expect(run(f).candidates).toEqual([]);
});
it("rejects stale exclusions and changed literal barcodes", () => {
  const f = fixture();
  f.staged = ["0042"];
  expect(() => run(f)).toThrow("STALE_EXCLUSIONS");
  f.staged = [];
  f.rows[0].barcode = "42";
  expect(() => run(f)).toThrow("INVALID_CANONICAL_ROW");
});
