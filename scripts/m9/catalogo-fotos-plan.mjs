import { createHash } from "node:crypto";
import { parseVariantPhotoUrls } from "./prepare-variant-photos.mjs";
import { stable } from "./woo-test/plan.mjs";
import {
  CATALOG_PHOTO_PROJECT,
  CATALOG_PHOTO_COLUMNS,
} from "./catalogo-fotos-queries.mjs";

const storage = `https://${CATALOG_PHOTO_PROJECT}.supabase.co/storage/v1/object/public/product-images/`;
const hash = (x) => createHash("sha256").update(stable(x)).digest("hex");
const uuid = (x) =>
  typeof x === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const md5 = (x) => typeof x === "string" && /^[a-f0-9]{32}$/.test(x);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const noWrites = {
  import_allowed: false,
  send_allowed: false,
  writes_performed: 0,
};
const extensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
function requireValue(ok, reason) {
  if (!ok) throw Error(reason);
}
function index(rows, key) {
  const result = new Map();
  requireValue(Array.isArray(rows), "INCOMPLETE_PHOTO_SNAPSHOT");
  for (const row of rows) {
    requireValue(
      row &&
        typeof row === "object" &&
        row[key] != null &&
        !result.has(row[key]),
      `DUPLICATE_${key.toUpperCase()}`,
    );
    result.set(row[key], row);
  }
  return result;
}
function validGallery(images, productId) {
  return (
    Array.isArray(images) &&
    images.length <= 20 &&
    images.every(
      (p) =>
        p &&
        typeof p.alt === "string" &&
        p.alt.length <= 240 &&
        ((parseVariantPhotoUrls(p.url).valid &&
          parseVariantPhotoUrls(p.url).urls.length === 1) ||
          (typeof p.url === "string" &&
            new RegExp(
              `^${storage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${productId}/[a-f0-9]{64}[.](jpg|png|webp)$`,
            ).test(p.url))),
    ) &&
    new Set(images.map((p) => p.url)).size === images.length
  );
}
function validProof(p) {
  return (
    p &&
    parseVariantPhotoUrls(p.url).valid &&
    parseVariantPhotoUrls(p.url).urls.length === 1 &&
    /^[a-f0-9]{64}$/.test(p.sha256) &&
    Number.isSafeInteger(p.bytes) &&
    p.bytes > 0 &&
    p.bytes <= 4194304 &&
    Object.hasOwn(extensions, p.mime) &&
    typeof p.alt === "string" &&
    p.alt.length <= 240
  );
}
function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[item[key]] = (counts[item[key]] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => compare(a, b)),
  );
}

// An inert adoption plan, not an importer. Metadata presence is never promoted
// to a fresh SHA256 byte verification; the existing copy helper remains required.
export function planCatalogPhotos(
  snapshot,
  before,
  after,
  woo,
  { familyLimit = 20 } = {},
) {
  requireValue(
    snapshot?.protocol === "m9-catalog-photo-snapshot-1" &&
      snapshot.project_id === CATALOG_PHOTO_PROJECT &&
      snapshot.complete === true &&
      stable(snapshot.row_columns) === stable(CATALOG_PHOTO_COLUMNS) &&
      Array.isArray(snapshot.rows) &&
      snapshot.managed_count === snapshot.rows.length &&
      snapshot.import_allowed === false &&
      snapshot.send_allowed === false &&
      snapshot.writes_performed === 0,
    "COMPLETE_READ_ONLY_STAGING_SNAPSHOT_REQUIRED",
  );
  requireValue(
    before &&
      after &&
      stable(before) === stable(after) &&
      before.m9_rows?.rows === snapshot.managed_count &&
      before.evidence?.rows === snapshot.evidence?.length &&
      before.copies?.rows === snapshot.copies?.length &&
      before.objects?.rows === snapshot.objects?.length,
    "READ_SNAPSHOT_CHANGED_OR_TRUNCATED",
  );
  requireValue(
    woo?.pagination_complete === true && Array.isArray(woo.products),
    "COMPLETE_WOO_EXPORT_REQUIRED",
  );
  requireValue(
    Number.isSafeInteger(familyLimit) && familyLimit >= 1 && familyLimit <= 200,
    "INVALID_FAMILY_LIMIT",
  );
  const products = index(snapshot.products, "product_id"),
    evidence = index(snapshot.evidence, "variant_id"),
    copies = index(snapshot.copies, "variant_id"),
    objects = index(snapshot.objects, "name"),
    parents = index(woo.products, "id");
  const variations = new Map();
  for (const parent of woo.products) {
    requireValue(
      Number.isSafeInteger(parent.id) && parent.id > 0,
      "INVALID_WOO_PARENT",
    );
    for (const v of parent.variations ?? []) {
      requireValue(
        Number.isSafeInteger(v.id) && v.id > 0 && !variations.has(v.id),
        "DUPLICATE_WOO_VARIATION",
      );
      variations.set(v.id, { parent_id: parent.id, ...v });
    }
  }
  const rows = snapshot.rows.map((tuple) => {
    requireValue(
      Array.isArray(tuple) && tuple.length === CATALOG_PHOTO_COLUMNS.length,
      "INVALID_PHOTO_ROW",
    );
    return Object.fromEntries(
      CATALOG_PHOTO_COLUMNS.map((key, i) => [key, tuple[i]]),
    );
  });
  index(rows, "variant_id");
  index(rows, "barcode");
  const claimed = new Map();
  for (const r of rows)
    if (r.woo_variation_id !== null) {
      const claims = claimed.get(r.woo_variation_id) ?? [];
      claims.push(r.variant_id);
      claimed.set(r.woo_variation_id, claims);
    }
  const items = rows
    .map((r) => {
      requireValue(
        uuid(r.variant_id) &&
          uuid(r.product_id) &&
          typeof r.barcode === "string" &&
          r.barcode.length > 0 &&
          r.barcode === r.barcode.trim() &&
          md5(r.current_hash) &&
          md5(r.binding_hash),
        "LITERAL_BOUND_PHOTO_ROW_REQUIRED",
      );
      const p = products.get(r.product_id),
        e = evidence.get(r.variant_id),
        c = copies.get(r.variant_id),
        parent = parents.get(r.woo_product_id),
        variant = variations.get(r.woo_variation_id),
        reasons = [];
      if (
        r.variant_active !== true ||
        r.product_active !== true ||
        r.barcode_matches !== true ||
        r.managed_matches !== true
      )
        reasons.push("LIVE_CATALOG_OR_LITERAL_BARCODE_CHANGED");
      if ((claimed.get(r.woo_variation_id)?.length ?? 0) > 1)
        reasons.push("DUPLICATE_WOO_VARIATION_BINDING");
      let state,
        proposal = null;
      if (r.woo_product_id === null) {
        if (r.woo_variation_id !== null || e || c)
          reasons.push("UNEXPECTED_PHOTOS_WITHOUT_WOO_BINDING");
        state = reasons.length
          ? "REVIEW_REQUIRED"
          : "SICAR_ONLY_NO_WOO_PHOTO_EXPECTED";
      } else {
        if (
          !p ||
          p.woo_product_id !== r.woo_product_id ||
          p.source_woo_product_id !== r.woo_product_id ||
          p.source_status !== "publish" ||
          !md5(p.catalog_hash) ||
          !md5(p.source_hash) ||
          !md5(p.draft_hash)
        )
          reasons.push("SAVED_PARENT_SOURCE_CHANGED");
        if (
          !parent ||
          parent.status !== "publish" ||
          parent.type !== p?.source_type
        )
          reasons.push("EXPORTED_PARENT_STATUS_OR_TYPE_CHANGED");
        if (p?.image_path !== null && p?.image_path !== undefined)
          reasons.push("MANUAL_PRODUCT_COVER_PROTECTED");
        if (
          p?.draft_present &&
          (!Array.isArray(p.draft_images) ||
            !validGallery(p.draft_images, r.product_id))
        )
          reasons.push("DRAFT_GALLERY_INVALID_OR_PARTIAL");
        if (
          p?.draft_present &&
          Array.isArray(p.draft_images) &&
          p.draft_images.length === 0
        )
          reasons.push("SAVED_EMPTY_GALLERY_PROTECTED");
        if (r.woo_variation_id === null) {
          if (parent?.type !== "simple" || e || c)
            reasons.push("SIMPLE_VARIANT_IDENTITY_CHANGED");
          state = reasons.length
            ? "REVIEW_REQUIRED"
            : "SIMPLE_USES_EXISTING_PRODUCT_GALLERY";
        } else {
          if (
            !variant ||
            variant.parent_id !== r.woo_product_id ||
            variant.status !== "publish"
          )
            reasons.push("EXPORTED_VARIATION_IDENTITY_OR_STATUS_CHANGED");
          const saved =
            p?.source_variants?.filter(
              (v) =>
                v.barcode === r.barcode &&
                v.woo_variation_id === r.woo_variation_id,
            ) ?? [];
          // Supplemental evidence may establish a missing saved variant, never a
          // conflicting saved entry. No name/suffix matching is performed here.
          if (
            saved.length !== 1 &&
            !(saved.length === 0 && e?.supplemental === true)
          )
            reasons.push("SAVED_VARIANT_BINDING_MISSING_OR_DUPLICATE");
          const urls = parseVariantPhotoUrls(variant?.images ?? "");
          if (!urls.valid) reasons.push("VARIATION_PHOTO_URL_INVALID");
          if (saved.length === 1 && saved[0].images_woo !== variant?.images)
            reasons.push("EXPORTED_VARIATION_PHOTO_CHANGED");
          if (e) {
            if (
              e.product_id !== r.product_id ||
              e.barcode !== r.barcode ||
              e.woo_product_id !== r.woo_product_id ||
              e.woo_variation_id !== r.woo_variation_id ||
              e.source_fingerprint !== p?.source_hash ||
              !md5(e.evidence_hash) ||
              e.revision !== 1 ||
              stable(e.source_variant) !==
                stable(
                  variant
                    ? {
                        id: variant.id,
                        status: variant.status,
                        attributes: variant.attributes ?? [],
                        images: variant.images,
                      }
                    : null,
                )
            )
              reasons.push("REGISTERED_EVIDENCE_IDENTITY_OR_SOURCE_CHANGED");
            if (
              !Array.isArray(e.photos) ||
              e.photos.length > 20 ||
              e.photos.some((x) => !validProof(x)) ||
              stable(e.photos.map((x) => x.url)) !== stable(urls.urls)
            )
              reasons.push("REGISTERED_PHOTO_PROOF_CHANGED");
            if (!reasons.length && !e.photos.length) {
              if (c) reasons.push("EMPTY_EVIDENCE_WITH_STORAGE_MAPPING");
              state = "REGISTERED_ABSENCE_PRESERVED";
            } else if (!reasons.length) {
              const wanted = e.photos.map((x) => ({
                url: `${storage}${r.product_id}/${x.sha256}.${extensions[x.mime]}`,
                alt: x.alt,
              }));
              if (c) {
                if (
                  c.evidence_hash !== e.evidence_hash ||
                  stable(c.photos) !== stable(wanted)
                )
                  reasons.push("EXISTING_STORAGE_MAPPING_CHANGED");
                if (
                  wanted.some((x, i) => {
                    const o = objects.get(x.url.slice(storage.length));
                    return (
                      !o ||
                      Number(o.bytes) !== e.photos[i].bytes ||
                      o.mime !== e.photos[i].mime
                    );
                  })
                )
                  reasons.push("STORAGE_OBJECT_MISSING_OR_METADATA_CHANGED");
                state = "COPIED_METADATA_CURRENT";
              } else {
                state = "EXACT_EVIDENCE_COPY_CANDIDATE";
                proposal = {
                  kind: "COPY_VARIANT_EVIDENCE",
                  variant_id: r.variant_id,
                  product_id: r.product_id,
                  barcode: r.barcode,
                  woo_product_id: r.woo_product_id,
                  woo_variation_id: r.woo_variation_id,
                  expected: {
                    binding_hash: r.binding_hash,
                    current_hash: r.current_hash,
                    catalog_hash: p.catalog_hash,
                    source_hash: p.source_hash,
                    draft_hash: p.draft_hash,
                    evidence_hash: e.evidence_hash,
                  },
                  photos: e.photos,
                  byte_reverification_required: true,
                  existing_executor: "prepareVariantPhotoCopy",
                  ...noWrites,
                };
              }
            }
          } else if (!reasons.length) {
            state = urls.urls.length
              ? "EXACT_LINK_NEEDS_BYTES_EVIDENCE"
              : "NO_OWN_VARIANT_PHOTO_PRESERVED";
            if (urls.urls.length)
              proposal = {
                kind: "VERIFY_VARIANT_BYTES_ONLY",
                variant_id: r.variant_id,
                product_id: r.product_id,
                barcode: r.barcode,
                woo_product_id: r.woo_product_id,
                woo_variation_id: r.woo_variation_id,
                urls: urls.urls,
                expected: {
                  binding_hash: r.binding_hash,
                  current_hash: r.current_hash,
                  catalog_hash: p.catalog_hash,
                  source_hash: p.source_hash,
                  draft_hash: p.draft_hash,
                },
                existing_executor: "prepareVariantPhotos",
                ...noWrites,
              };
          }
          if (reasons.length) {
            state = "REVIEW_REQUIRED";
            proposal = null;
          }
        }
        if (reasons.length) state = "REVIEW_REQUIRED";
      }
      return {
        variant_id: r.variant_id,
        product_id: r.product_id,
        barcode: r.barcode,
        state,
        reasons: [...new Set(reasons)].sort(),
        registered_evidence: Boolean(e),
        registered_copy: Boolean(c),
        proposal,
        ...noWrites,
      };
    })
    .sort((a, b) => compare(a.barcode, b.barcode));
  const families = [];
  for (const [productId, p] of products) {
    const members = items.filter((x) => x.product_id === productId),
      candidates = members.filter((x) => x.proposal),
      holds = members.filter((x) => x.state === "REVIEW_REQUIRED");
    if (!candidates.length) continue;
    families.push({
      product_id: productId,
      name: p.name,
      members: members.length,
      candidate_count: candidates.length,
      held_count: holds.length,
      eligible_for_offline_verification:
        holds.length === 0 && members.length <= 200,
      proposals: candidates.map((x) => x.proposal),
      ...noWrites,
    });
  }
  families.sort((a, b) => compare(a.product_id, b.product_id));
  const selected = families
    .filter((x) => x.eligible_for_offline_verification)
    .slice(0, familyLimit);
  const result = {
    protocol: "m9-catalog-photo-plan-1",
    mode: "OFFLINE_READ_ONLY",
    project_id: CATALOG_PHOTO_PROJECT,
    input_sha256: {
      snapshot: hash(snapshot),
      audit: hash(before),
      woo: hash(woo),
    },
    summary: {
      managed_variants: items.length,
      linked_woo_variants: rows.filter((x) => x.woo_product_id !== null).length,
      registered_evidence: snapshot.evidence.length,
      registered_copies: snapshot.copies.length,
      registered_absences: snapshot.evidence.filter(
        (x) => x.photos.length === 0,
      ).length,
      states: countBy(items, "state"),
      reasons: countBy(
        items.flatMap((x) => x.reasons.map((reason) => ({ reason }))),
        "reason",
      ),
      candidate_families: families.length,
      verification_eligible_families: families.filter(
        (x) => x.eligible_for_offline_verification,
      ).length,
      selected_families: selected.length,
      selected_variants: selected.reduce((n, x) => n + x.candidate_count, 0),
      byte_downloads_performed: 0,
      byte_integrity_asserted: false,
      inventory_touched: false,
      real_woo_touched: false,
    },
    items,
    families,
    inert_batch: {
      kind: "OFFLINE_VERIFICATION_ONLY",
      families: selected,
      executor_authorization: false,
      requires_fresh_context: true,
      ...noWrites,
    },
    ...noWrites,
  };
  return { ...result, plan_sha256: hash(result) };
}

export function assertCatalogPhotoPlanFresh(
  plan,
  snapshot,
  before,
  after,
  woo,
  options,
) {
  const current = planCatalogPhotos(snapshot, before, after, woo, options);
  requireValue(
    stable(current) === stable(plan),
    "CATALOG_PHOTO_PLAN_STALE_OR_CHANGED",
  );
  return current;
}
