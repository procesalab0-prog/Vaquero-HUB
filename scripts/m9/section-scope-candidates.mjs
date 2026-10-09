import { catalogReviewProjection } from "./catalog-stock-review.mjs";
import { sicarRetailCatalogProjection } from "./catalog-retail-review.mjs";
import { stable } from "./woo-test/plan.mjs";
import { createHash } from "node:crypto";

// Technical scope review, not a modification of the canonical reconciliation.
// Full-source uniqueness and every non-section guard remain required.
export function sectionScopeCandidates(
  rows,
  taxonomy,
  decisions,
  exclusions,
  stagedCodes,
) {
  const codes = new Set(),
    targets = new Map(),
    byCode = new Map(),
    held = new Map();
  for (const r of rows) {
    if (
      !r.barcode ||
      codes.has(r.barcode) ||
      r.barcode !== r.fields?.["clave1 *"] ||
      r.description !== r.fields?.["descripción *"]
    )
      throw Error("INVALID_CANONICAL_ROW");
    codes.add(r.barcode);
    byCode.set(r.barcode, r);
    if (r.product_id != null) {
      const key = `${r.product_id}:${r.variation_id ?? "simple"}`;
      targets.set(key, (targets.get(key) ?? 0) + 1);
    }
  }
  const staged = new Set(stagedCodes);
  for (const e of exclusions) {
    if (held.has(e.barcode) || !codes.has(e.barcode) || staged.has(e.barcode))
      throw Error("STALE_EXCLUSIONS");
    held.set(e.barcode, e);
  }
  const blocked = new Set(
    (decisions.owner_answers_2026_10_01?.responses ?? []).flatMap(
      (x) => x.woo_ids,
    ),
  );
  const bad = new Set(
    taxonomy.paths.filter((x) => x.needs_review).flatMap((x) => x.barcodes),
  );
  const projected = sicarRetailCatalogProjection(
    catalogReviewProjection(rows),
    decisions,
  );
  const candidates = [],
    evidence = [];
  for (const r of projected) {
    const e = held.get(r.barcode),
      original = byCode.get(r.barcode);
    if (
      staged.has(r.barcode) ||
      e?.reasons?.length !== 1 ||
      e.reasons[0] !== "FAMILIA_CON_SECCIONES_DISTINTAS"
    )
      continue;
    if (
      r.classification !== "MATCH_EXACT_VARIANT" ||
      r.manual_review ||
      r.display_only ||
      r.issues?.length !== 0 ||
      !Number.isSafeInteger(r.product_id) ||
      r.product_id <= 0 ||
      r.candidate_product_ids?.length !== 1 ||
      r.candidate_product_ids[0] !== r.product_id ||
      !Number.isSafeInteger(r.variation_id) ||
      r.variation_id <= 0 ||
      r.candidate_variation_ids?.length !== 1 ||
      r.candidate_variation_ids[0] !== r.variation_id ||
      ![
        "EXACT_ATTRIBUTE",
        "CONFIRMED_T_DOT",
        "CONFIRMED_SIZE_X_LENGTH",
      ].includes(r.matching_rule) ||
      r.reasons?.length !== 1 ||
      (r.reasons[0] !== "UN_PADRE_Y_UNA_VARIANTE_CON_TODOS_LOS_ATRIBUTOS" &&
        r.catalog_review_basis == null) ||
      !Array.isArray(r.commercial_checks) ||
      (r.commercial_checks.length > 0 &&
        ![
          "UNIQUE_IDENTITY_STOCK_OMITTED",
          "EXACT_IDENTITY_CONFIRMED_SICAR_RETAIL",
        ].includes(r.catalog_review_basis)) ||
      blocked.has(r.product_id) ||
      bad.has(r.barcode) ||
      !r.fields.departamento ||
      !r.fields.categoria ||
      targets.get(`${r.product_id}:${r.variation_id}`) !== 1
    )
      continue;
    const assigned = rows.filter((x) => x.product_id === r.product_id);
    if (
      assigned.some(
        (x) =>
          x.candidate_product_ids?.length !== 1 ||
          x.candidate_product_ids[0] !== r.product_id,
      ) ||
      new Set(assigned.map((x) => x.fields.categoria)).size !== 1
    )
      continue;
    const foreign = rows.filter(
      (x) =>
        (x.candidate_product_ids ?? []).includes(r.product_id) &&
        x.product_id !== r.product_id,
    );
    if (!foreign.some((x) => x.fields.categoria !== r.fields.categoria))
      continue;
    const money = r.fields.precio1;
    if (typeof money !== "string" || !/^\d+(\.\d{1,2})?$/.test(money)) continue;
    const [whole, fraction = ""] = money.split("."),
      price = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    if (price <= 0n || price > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    candidates.push({
      barcode: r.barcode,
      description: r.description,
      woo_reference: { product_id: r.product_id, variation_id: r.variation_id },
      attributes: r.attributes,
      department: r.fields.departamento,
      section: r.fields.categoria,
      retail_source: money,
      retail_cents: Number(price),
      cost: null,
      wholesale: null,
      medium_wholesale: null,
      automatic_import_allowed: false,
    });
    evidence.push({
      barcode: r.barcode,
      woo_product_id: r.product_id,
      woo_variation_id: r.variation_id,
      original_classification: original.classification,
      original_manual_review: original.manual_review,
      review_basis:
        "EXACT_CANONICAL_PARENT_SINGLE_SECTION_FOREIGN_SEARCH_CANDIDATES_HELD",
      assigned_codes: assigned.map((x) => x.barcode).sort(),
      foreign_candidate_codes: foreign.map((x) => x.barcode).sort(),
      evidence_sha256: createHash("sha256")
        .update(stable({ original, assigned, foreign, exclusion: e }))
        .digest("hex"),
      original_exclusion_preserved: true,
      destination_plan_required: true,
      import_allowed: false,
      send_allowed: false,
    });
  }
  return { candidates, evidence };
}
