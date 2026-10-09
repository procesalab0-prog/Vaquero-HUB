// A stock discrepancy does not establish an identity conflict. This only
// narrows candidates for the existing catalog validator; it never authorizes writes.
export function isStockOnlyCatalogCandidate(row) {
  return (
    row.reasons?.length === 1 &&
    row.commercial_checks?.length === 1 &&
    ((row.classification === "CONFLICT" &&
      row.reasons[0] === "IDENTIDAD_UNICA_CON_DIFERENCIA_COMERCIAL" &&
      row.commercial_checks[0] ===
        "EXISTENCIA_DIFIERE; capturas y alcance pueden diferir") ||
      (row.classification === "MATCH_EXACT_VARIANT" &&
        row.reasons[0] === "UN_PADRE_Y_UNA_VARIANTE_CON_TODOS_LOS_ATRIBUTOS" &&
        row.commercial_checks[0] === "EXISTENCIA_WOO_NO_DISPONIBLE")) &&
    row.issues?.length === 0 &&
    !row.display_only &&
    Number.isSafeInteger(row.product_id) &&
    row.product_id > 0 &&
    row.candidate_product_ids?.length === 1 &&
    row.candidate_product_ids[0] === row.product_id &&
    Number.isSafeInteger(row.variation_id) &&
    row.variation_id > 0 &&
    row.candidate_variation_ids?.length === 1 &&
    row.candidate_variation_ids[0] === row.variation_id &&
    ["EXACT_ATTRIBUTE", "CONFIRMED_T_DOT", "CONFIRMED_SIZE_X_LENGTH"].includes(
      row.matching_rule,
    ) &&
    row.price_mapping_status === "retail_confirmed_other_levels_undefined"
  );
}
export function catalogReviewProjection(rows) {
  return rows.map((r) =>
    isStockOnlyCatalogCandidate(r)
      ? {
          ...r,
          classification: "MATCH_EXACT_VARIANT",
          manual_review: false,
          automatic_import_allowed: false,
          catalog_review_basis: "UNIQUE_IDENTITY_STOCK_OMITTED",
          original_classification: r.classification,
        }
      : r,
  );
}
