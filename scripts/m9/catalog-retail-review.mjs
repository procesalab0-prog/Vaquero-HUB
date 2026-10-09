// Catalog-only projection. The original report and Woo commercial review remain
// intact. Existing destination plans, taxonomy and owner-case guards still apply.
const priceDifference =
  "PRECIO_WOO_DISTINTO_PUBLICO; revisar promocion o precio normal, no corregir automaticamente";
const stockChecks = new Set([
  "EXISTENCIA_DIFIERE; capturas y alcance pueden diferir",
  "EXISTENCIA_WOO_NO_DISPONIBLE",
]);
export function isSicarRetailCatalogCandidate(row) {
  return (
    ["MATCH_EXACT_VARIANT", "CONFLICT"].includes(row.classification) &&
    row.reasons?.length === 1 &&
    row.reasons[0] ===
      (row.classification === "CONFLICT"
        ? "IDENTIDAD_UNICA_CON_DIFERENCIA_COMERCIAL"
        : "UN_PADRE_Y_UNA_VARIANTE_CON_TODOS_LOS_ATRIBUTOS") &&
    Array.isArray(row.commercial_checks) &&
    row.commercial_checks.includes(priceDifference) &&
    row.commercial_checks.every(
      (c) => c === priceDifference || stockChecks.has(c),
    ) &&
    new Set(row.commercial_checks).size === row.commercial_checks.length &&
    row.issues?.length === 0 &&
    !row.display_only &&
    Number.isSafeInteger(row.product_id) &&
    row.product_id > 0 &&
    row.candidate_product_ids?.length === 1 &&
    row.candidate_product_ids[0] === row.product_id &&
    (row.matching_rule === "EXACT_SIMPLE_BASE"
      ? row.variation_id === null &&
        row.candidate_variation_ids?.length === 1 &&
        row.candidate_variation_ids[0] === row.product_id
      : Number.isSafeInteger(row.variation_id) &&
        row.variation_id > 0 &&
        row.candidate_variation_ids?.length === 1 &&
        row.candidate_variation_ids[0] === row.variation_id) &&
    [
      "EXACT_SIMPLE_BASE",
      "EXACT_ATTRIBUTE",
      "CONFIRMED_T_DOT",
      "CONFIRMED_SIZE_X_LENGTH",
    ].includes(row.matching_rule) &&
    row.price_mapping_status === "retail_confirmed_other_levels_undefined" &&
    typeof row.fields?.precio1 === "string" &&
    /^\d+(\.\d{1,2})?$/.test(row.fields.precio1) &&
    Number(row.fields.precio1) > 0
  );
}
export function sicarRetailCatalogProjection(rows, decisions) {
  if (
    decisions.owner_answers_2026_09_29?.pricing?.source_column_mapping !==
    "Confirmado por usuario: precio1 es lo que cobran al público. precio2/3/4 sin asignación comercial."
  )
    throw Error("CONFIRMED_SICAR_RETAIL_POLICY_REQUIRED");
  return rows.map((r) =>
    isSicarRetailCatalogCandidate(r)
      ? {
          ...r,
          classification: "MATCH_EXACT_VARIANT",
          manual_review: false,
          original_classification: r.classification,
          original_manual_review: r.manual_review,
          catalog_review_basis: "EXACT_IDENTITY_CONFIRMED_SICAR_RETAIL",
          woo_commercial_review_required: true,
          woo_writes_allowed: false,
          automatic_import_allowed: false,
        }
      : r,
  );
}
