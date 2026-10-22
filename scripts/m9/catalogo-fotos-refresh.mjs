import { createHash } from "node:crypto";
import { stable } from "./woo-test/plan.mjs";
import { parseVariantPhotoUrls } from "./prepare-variant-photos.mjs";
import { CATALOG_PHOTO_PROJECT } from "./catalogo-fotos-queries.mjs";
const digest = (x) => createHash("sha256").update(stable(x)).digest("hex");
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const noWrites = {
  import_allowed: false,
  send_allowed: false,
  writes_performed: 0,
};
const must = (ok, why) => {
  if (!ok) throw Error(why);
};
const md5 = (x) => typeof x === "string" && /^[a-f0-9]{32}$/.test(x);
const uuid = (x) =>
  typeof x === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
function unique(rows, key) {
  const map = new Map();
  must(Array.isArray(rows), "COMPLETE_INPUT_REQUIRED");
  for (const row of rows) {
    must(row && row[key] != null && !map.has(row[key]), `DUPLICATE_${key}`);
    map.set(row[key], row);
  }
  return map;
}

// Full gap census + bounded, exact current contexts. It never transforms a new
// image into approved evidence, rebinds old photos, or overwrites source rows.
export function planCatalogPhotoRefresh(input) {
  const { project_id, coverage, gaps, bindings, contexts, woo, before, after } =
    input;
  must(project_id === CATALOG_PHOTO_PROJECT, "STAGING_ONLY");
  must(before && stable(before) === stable(after), "CATALOG_READ_CHANGED");
  must(
    coverage &&
      before.m9_rows?.rows === coverage.linked_woo + coverage.sicar_only &&
      coverage.without_evidence === gaps?.length &&
      before.evidence?.rows + gaps.length + coverage.linked_simple ===
        coverage.linked_woo &&
      coverage.nonempty_without_copy === 0 &&
      coverage.copies_wrong_hash === 0,
    "COMPLETE_GAP_CENSUS_REQUIRED",
  );
  must(woo?.pagination_complete === true, "COMPLETE_WOO_EXPORT_REQUIRED");
  const parents = unique(woo.products, "id"),
    products = unique(contexts, "product_id"),
    current = unique(bindings, "variant_id"),
    vars = new Map();
  for (const parent of woo.products)
    for (const v of parent.variations ?? []) {
      must(
        Number.isSafeInteger(v.id) && v.id > 0 && !vars.has(v.id),
        "DUPLICATE_WOO_VARIATION",
      );
      vars.set(v.id, { parent_id: parent.id, ...v });
    }
  const decoded = gaps.map((x) => {
    must(
      Array.isArray(x) &&
        x.length === 6 &&
        typeof x[0] === "string" &&
        x[0] === x[0].trim() &&
        x[0].length > 0 &&
        uuid(x[1]) &&
        uuid(x[2]) &&
        Number.isSafeInteger(x[3]) &&
        x[3] > 0 &&
        Number.isSafeInteger(x[4]) &&
        x[4] > 0 &&
        (x[5] === null || typeof x[5] === "string"),
      "LITERAL_GAP_BINDING_REQUIRED",
    );
    return {
      barcode: x[0],
      variant_id: x[1],
      product_id: x[2],
      woo_product_id: x[3],
      woo_variation_id: x[4],
      saved_images: x[5],
    };
  });
  unique(decoded, "barcode");
  unique(decoded, "variant_id");
  unique(decoded, "woo_variation_id");
  const rows = decoded
    .map((r) => {
      const parent = parents.get(r.woo_product_id),
        variant = vars.get(r.woo_variation_id),
        p = products.get(r.product_id),
        b = current.get(r.variant_id);
      let state,
        reasons = [],
        proposal = null;
      if (!parent || parent.status !== "publish" || parent.type !== "variable")
        state = "PARENT_NOT_PUBLISHED_OR_CHANGED";
      else if (
        !variant ||
        variant.parent_id !== parent.id ||
        variant.status !== "publish"
      )
        state = "VARIATION_NOT_PUBLISHED_OR_CHANGED";
      else if (r.saved_images === null) state = "SAVED_VARIANT_LINK_MISSING";
      else if (r.saved_images === variant.images && r.saved_images === "")
        state = "NO_OWN_PHOTO_PRESERVED";
      else {
        const urls = parseVariantPhotoUrls(variant.images);
        if (!urls.valid || urls.urls.length === 0)
          reasons.push("NEW_IMAGE_URL_INVALID_OR_REMOVAL");
        if (
          !p ||
          p.woo_product_id !== r.woo_product_id ||
          p.source_woo_product_id !== r.woo_product_id ||
          p.source_status !== "publish" ||
          p.source_type !== "variable" ||
          !md5(p.source_hash) ||
          !md5(p.catalog_hash) ||
          !md5(p.draft_hash)
        )
          reasons.push("FRESH_PARENT_CONTEXT_REQUIRED");
        if (
          !b ||
          b.variant_id !== r.variant_id ||
          b.product_id !== r.product_id ||
          b.barcode !== r.barcode ||
          b.woo_product_id !== r.woo_product_id ||
          b.woo_variation_id !== r.woo_variation_id ||
          b.active !== true ||
          b.barcode_matches !== true ||
          b.stored_matches !== true ||
          !md5(b.binding_hash) ||
          !md5(b.current_hash)
        )
          reasons.push("CURRENT_LITERAL_IDENTITY_CHANGED");
        if (p?.image_path !== null && p?.image_path !== undefined)
          reasons.push("MANUAL_PRODUCT_COVER_PROTECTED");
        if (
          p?.draft_present &&
          (!Array.isArray(p.draft_images) || p.draft_images.length === 0)
        )
          reasons.push("EMPTY_OR_PARTIAL_SAVED_GALLERY_PROTECTED");
        const saved =
          p?.source_variants?.filter(
            (v) =>
              v.barcode === r.barcode &&
              v.woo_variation_id === r.woo_variation_id,
          ) ?? [];
        if (
          saved.length !== 1 ||
          saved[0].images_woo !== r.saved_images ||
          stable(saved[0].attributes_woo) !==
            stable(variant.attributes ?? []) ||
          stable(saved[0].attributes_sicar) !== stable(b?.attributes)
        )
          reasons.push("SAVED_VARIANT_ATTRIBUTES_OR_BINDING_CHANGED");
        if (r.saved_images !== "")
          reasons.push("EXISTING_VARIANT_PHOTO_REPLACEMENT_HELD");
        state = reasons.length
          ? "TECHNICAL_REVIEW_REQUIRED"
          : "EXACT_ADDITION_OFFLINE_CANDIDATE";
        if (!reasons.length)
          proposal = {
            kind: "PREPARE_SOURCE_AND_PHOTO_EVIDENCE",
            ...r,
            new_images: variant.images,
            urls: urls.urls,
            expected: {
              source_hash: p.source_hash,
              draft_hash: p.draft_hash,
              catalog_hash: p.catalog_hash,
              binding_hash: b.binding_hash,
              current_hash: b.current_hash,
            },
            preserve_product_gallery: true,
            preserve_existing_evidence: true,
            byte_reverification_required: true,
            application_blockers: [
              "NO_FRESH_BYTES_PROOF",
              "SOURCE_REFRESH_NOT_AUTHORIZED_BY_THIS_PLAN",
              ...(p.existing_evidence_count > 0
                ? ["EXISTING_EVIDENCE_MUST_BE_REVALIDATED_ATOMICALLY"]
                : []),
            ],
            ...noWrites,
          };
      }
      return { ...r, state, reasons, proposal, ...noWrites };
    })
    .sort((a, b) => cmp(a.barcode, b.barcode));
  const candidates = rows.filter((x) => x.proposal),
    families = [];
  for (const productId of [
    ...new Set(candidates.map((x) => x.product_id)),
  ].sort(cmp)) {
    const p = products.get(productId),
      members = candidates.filter((x) => x.product_id === productId);
    families.push({
      product_id: productId,
      woo_product_id: p.woo_product_id,
      name: p.name,
      new_variant_photos: members.length,
      existing_evidence_to_revalidate: p.existing_evidence_count,
      expected: {
        source_hash: p.source_hash,
        draft_hash: p.draft_hash,
        catalog_hash: p.catalog_hash,
      },
      variant_ids: members.map((x) => x.variant_id),
      ...noWrites,
    });
  }
  const states = {};
  for (const r of rows) states[r.state] = (states[r.state] ?? 0) + 1;
  const result = {
    protocol: "m9-photo-gap-refresh-1",
    mode: "OFFLINE_READ_ONLY",
    project_id,
    input_sha256: {
      gaps: digest(gaps),
      bindings: digest(bindings),
      contexts: digest(contexts),
      woo: digest(woo),
      audit: digest(before),
    },
    summary: {
      catalog_variants: before.m9_rows.rows,
      linked_woo_variants: coverage.linked_woo,
      sicar_only: coverage.sicar_only,
      simple_woo_variants: coverage.linked_simple,
      registered_evidence: before.evidence.rows,
      registered_copies: before.copies.rows,
      gap_variants: rows.length,
      states,
      new_photos_to_prepare: candidates.length,
      families_to_prepare: families.length,
      existing_evidence_to_revalidate: families.reduce(
        (n, f) => n + f.existing_evidence_to_revalidate,
        0,
      ),
      actual_import_batch_size: 0,
      downloads: 0,
      owner_questions_added: 0,
      byte_integrity_asserted: false,
    },
    rows,
    families,
    inert_batch: {
      purpose: "TECHNICAL_PREPARATION_ONLY",
      items: candidates.map((x) => x.proposal),
      executable: false,
      stage_write_authorized: false,
      requires_plan_rollback_audit: true,
      ...noWrites,
    },
    ...noWrites,
  };
  return { ...result, plan_sha256: digest(result) };
}
