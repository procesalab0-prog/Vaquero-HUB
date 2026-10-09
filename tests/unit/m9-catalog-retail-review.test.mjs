import { it, expect } from "vitest";
import {
  isSicarRetailCatalogCandidate,
  sicarRetailCatalogProjection,
} from "../../scripts/m9/catalog-retail-review.mjs";
const price =
  "PRECIO_WOO_DISTINTO_PUBLICO; revisar promocion o precio normal, no corregir automaticamente";
const policy = {
  owner_answers_2026_09_29: {
    pricing: {
      source_column_mapping:
        "Confirmado por usuario: precio1 es lo que cobran al público. precio2/3/4 sin asignación comercial.",
    },
  },
};
const row = () => ({
  classification: "MATCH_EXACT_VARIANT",
  reasons: ["UN_PADRE_Y_UNA_VARIANTE_CON_TODOS_LOS_ATRIBUTOS"],
  commercial_checks: [price],
  issues: [],
  display_only: null,
  product_id: 10,
  variation_id: 20,
  candidate_product_ids: [10],
  candidate_variation_ids: [20],
  matching_rule: "EXACT_ATTRIBUTE",
  price_mapping_status: "retail_confirmed_other_levels_undefined",
  fields: { precio1: "640", existencia: "99" },
  manual_review: true,
  attributes: [{ name: "Talla", value: "M" }],
  barcode: "0042",
});
it("retains all source evidence, exact code, price and attributes with Woo review still blocked", () => {
  const r = row(),
    before = JSON.stringify(r),
    p = sicarRetailCatalogProjection([r], policy)[0];
  expect(isSicarRetailCatalogCandidate(r)).toBe(true);
  expect(JSON.stringify(r)).toBe(before);
  expect(p.fields).toEqual(r.fields);
  expect(p.attributes).toEqual(r.attributes);
  expect(p.barcode).toBe("0042");
  expect(p.commercial_checks).toEqual([price]);
  expect(p.original_manual_review).toBe(true);
  expect(p.woo_commercial_review_required).toBe(true);
  expect(p.woo_writes_allowed).toBe(false);
  expect(p.automatic_import_allowed).toBe(false);
});
it("allows only named stock observations together with an exact price difference", () => {
  const r = row();
  r.classification = "CONFLICT";
  r.reasons = ["IDENTIDAD_UNICA_CON_DIFERENCIA_COMERCIAL"];
  r.commercial_checks.push(
    "EXISTENCIA_DIFIERE; capturas y alcance pueden diferir",
  );
  expect(isSicarRetailCatalogCandidate(r)).toBe(true);
  r.commercial_checks.push("EXISTENCIA_INVALIDA");
  expect(isSicarRetailCatalogCandidate(r)).toBe(false);
});
it("holds ambiguous identities, unpublished variants, owner observations and display-only rows", () => {
  for (const change of [
    { candidate_product_ids: [10, 11] },
    { candidate_variation_ids: [20, 21] },
    { variation_id: 21 },
    { classification: "VARIANT_NOT_PUBLISHED" },
    { reasons: ["DESCRIPCION_SICAR_DUPLICADA"] },
    { issues: ["x"] },
    { display_only: true },
    { matching_rule: "EXPLICIT_LABELS" },
  ])
    expect(isSicarRetailCatalogCandidate({ ...row(), ...change })).toBe(false);
});
it("does not accept noncomparable promotions, zero/invalid retail or additional commercial checks", () => {
  for (const p of ["0", "-1", "1e3", "", "1.001"])
    expect(
      isSicarRetailCatalogCandidate({ ...row(), fields: { precio1: p } }),
    ).toBe(false);
  for (const checks of [
    ["PRECIO_WOO_NO_COMPARABLE; revisar promociones"],
    [price, "OTHER"],
    [price, price],
  ])
    expect(
      isSicarRetailCatalogCandidate({ ...row(), commercial_checks: checks }),
    ).toBe(false);
});
it("requires the existing confirmed policy and keeps every other row unchanged", () => {
  expect(() => sicarRetailCatalogProjection([row()], {})).toThrow(
    "CONFIRMED_SICAR_RETAIL_POLICY_REQUIRED",
  );
  const r = { ...row(), display_only: true };
  expect(sicarRetailCatalogProjection([r], policy)[0]).toBe(r);
});
it("requires the simple identity to point to its own parent", () => {
  const r = {
    ...row(),
    matching_rule: "EXACT_SIMPLE_BASE",
    variation_id: null,
    candidate_variation_ids: [10],
    attributes: [],
  };
  expect(isSicarRetailCatalogCandidate(r)).toBe(true);
  expect(
    isSicarRetailCatalogCandidate({ ...r, candidate_variation_ids: [11] }),
  ).toBe(false);
});
