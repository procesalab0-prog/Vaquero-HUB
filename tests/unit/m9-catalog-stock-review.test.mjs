import { it, expect } from "vitest";
import {
  isStockOnlyCatalogCandidate,
  catalogReviewProjection,
} from "../../scripts/m9/catalog-stock-review.mjs";
const fixture = () => ({
  classification: "CONFLICT",
  reasons: ["IDENTIDAD_UNICA_CON_DIFERENCIA_COMERCIAL"],
  commercial_checks: ["EXISTENCIA_DIFIERE; capturas y alcance pueden diferir"],
  issues: [],
  display_only: false,
  product_id: 1,
  candidate_product_ids: [1],
  variation_id: 2,
  candidate_variation_ids: [2],
  matching_rule: "EXACT_ATTRIBUTE",
  price_mapping_status: "retail_confirmed_other_levels_undefined",
  manual_review: true,
  automatic_import_allowed: false,
});
it("retains the original conflict without granting import permission", () => {
  const r = fixture();
  const [p] = catalogReviewProjection([r]);
  expect(p.classification).toBe("MATCH_EXACT_VARIANT");
  expect(p.automatic_import_allowed).toBe(false);
  expect(r.classification).toBe("CONFLICT");
  expect(p.commercial_checks).toEqual(r.commercial_checks);
});
it("keeps price discrepancies reserved", () => {
  const r = fixture();
  r.commercial_checks.push("PRICE");
  expect(isStockOnlyCatalogCandidate(r)).toBe(false);
});
it("never bypasses identity issues or multiple candidates", () => {
  const r = fixture();
  r.candidate_variation_ids.push(3);
  expect(isStockOnlyCatalogCandidate(r)).toBe(false);
  r.candidate_variation_ids = [2];
  r.issues = ["DUPLICATE"];
  expect(isStockOnlyCatalogCandidate(r)).toBe(false);
});
it("keeps exhibition and unknown matching rules reserved", () => {
  const r = fixture();
  r.display_only = true;
  expect(isStockOnlyCatalogCandidate(r)).toBe(false);
  r.display_only = false;
  r.matching_rule = "GUESS";
  expect(isStockOnlyCatalogCandidate(r)).toBe(false);
});
it("allows catalog review for exact identity with only unavailable Woo stock", () => {
  const r = fixture();
  r.classification = "MATCH_EXACT_VARIANT";
  r.reasons = ["UN_PADRE_Y_UNA_VARIANTE_CON_TODOS_LOS_ATRIBUTOS"];
  r.commercial_checks = ["EXISTENCIA_WOO_NO_DISPONIBLE"];
  const [projected] = catalogReviewProjection([r]);
  expect(projected.manual_review).toBe(false);
  expect(projected.automatic_import_allowed).toBe(false);
  expect(projected.original_classification).toBe("MATCH_EXACT_VARIANT");
  expect(r.manual_review).toBe(true);
  r.commercial_checks.push("PRECIO_WOO_DISTINTO_PUBLICO");
  expect(isStockOnlyCatalogCandidate(r)).toBe(false);
});
it("rejects unavailable stock without the exact identity proof", () => {
  const r = fixture();
  r.commercial_checks = ["EXISTENCIA_WOO_NO_DISPONIBLE"];
  expect(isStockOnlyCatalogCandidate(r)).toBe(false);
  r.classification = "VARIANT_NOT_PUBLISHED";
  r.reasons = ["UN_PADRE_Y_UNA_VARIANTE_CON_TODOS_LOS_ATRIBUTOS"];
  expect(isStockOnlyCatalogCandidate(r)).toBe(false);
});
it("recognizes the reconciler's confirmed size and length rule", () => {
  const r = fixture();
  r.matching_rule = "CONFIRMED_SIZE_X_LENGTH";
  expect(isStockOnlyCatalogCandidate(r)).toBe(true);
  r.matching_rule = "CONFIRMED_TALLA_LARGO_X";
  expect(isStockOnlyCatalogCandidate(r)).toBe(false);
});
