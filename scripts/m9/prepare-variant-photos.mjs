import { createHash } from "node:crypto";
import { auditStagedCatalog } from "./audit-staged-catalog.mjs";
import { stable } from "./woo-test/plan.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const blocked = { import_allowed: false, send_allowed: false };

export function parseVariantPhotoUrls(value) {
  if (typeof value !== "string") return { valid: false, urls: [] };
  if (!value.trim()) return { valid: true, urls: [] };
  // Woo CSV joins image URLs with comma-space. A comma inside an encoded or
  // literal upload filename is not itself a separator.
  const urls = value.split(/,\s+(?=https?:\/\/)/).map((s) => s.trim());
  const valid =
    urls.length <= 20 &&
    new Set(urls).size === urls.length &&
    urls.every((s) => {
      try {
        const u = new URL(s);
        return (
          u.origin === "https://vaquerosm.com" &&
          u.pathname.startsWith("/wp-content/uploads/") &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          s.length <= 2000 &&
          !/[\s\\]/.test(s)
        );
      } catch {
        return false;
      }
    });
  return { valid, urls: valid ? urls : [] };
}

// Full catalog diagnostic, deliberately neither an importer nor an executable
// RPC packet. Missing variant photos never inherit a parent photo implicitly.
export function prepareVariantPhotos(
  snapshot,
  context,
  canonical,
  woo,
  proofs = [],
) {
  if (
    snapshot.project_id !== "zsezjtswqeijboezvado" ||
    context.project_id !== snapshot.project_id ||
    context.rows !== snapshot.rows.length ||
    snapshot.inventory_balances !== 0 ||
    snapshot.inventory_movements !== 0 ||
    woo.pagination_complete !== true
  )
    throw Error("ISOLATED_STAGING_CONTEXT_REQUIRED");
  const unique = (items, key, error) => {
    const map = new Map();
    for (const item of items) {
      const id = item[key];
      if (id == null || map.has(id)) throw Error(error);
      map.set(id, item);
    }
    return map;
  };
  unique(snapshot.rows, "variant_id", "DUPLICATE_VARIANT_UUID");
  unique(
    snapshot.rows.map((r) => r.current),
    "barcode",
    "DUPLICATE_BARCODE",
  );
  const parents = unique(woo.products, "id", "DUPLICATE_WOO_PARENT");
  const products = unique(
    context.products,
    "product_id",
    "DUPLICATE_PRODUCT_UUID",
  );
  const variations = new Map();
  for (const parent of woo.products) {
    if (!Number.isSafeInteger(parent.id) || parent.id <= 0)
      throw Error("INVALID_WOO_ID");
    for (const v of parent.variations ?? []) {
      if (!Number.isSafeInteger(v.id) || v.id <= 0 || variations.has(v.id))
        throw Error("DUPLICATE_OR_INVALID_WOO_VARIATION");
      variations.set(v.id, { parent_id: parent.id, variant: v });
    }
  }
  const proofByUrl = unique(proofs, "url", "DUPLICATE_PHOTO_PROOF");
  for (const proof of proofs) {
    const file = proof.bytes_buffer;
    const mime = proof.mime;
    const magic =
      Buffer.isBuffer(file) &&
      ((mime === "image/jpeg" &&
        file[0] === 0xff &&
        file[1] === 0xd8 &&
        file[2] === 0xff) ||
        (mime === "image/png" &&
          file
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (mime === "image/webp" &&
          file.toString("ascii", 0, 4) === "RIFF" &&
          file.toString("ascii", 8, 12) === "WEBP"));
    if (
      !parseVariantPhotoUrls(proof.url).valid ||
      parseVariantPhotoUrls(proof.url).urls.length !== 1 ||
      !magic ||
      file.length === 0 ||
      file.length > 4 * 1024 * 1024 ||
      file.length !== proof.bytes ||
      !/^[a-f0-9]{64}$/.test(proof.sha256) ||
      hash(file) !== proof.sha256
    )
      throw Error("INVALID_PHOTO_BYTES_PROOF");
  }
  const audit = auditStagedCatalog(snapshot, canonical);
  const audits = new Map(audit.results.map((r) => [r.variant_id, r]));
  const items = snapshot.rows
    .map((row) => {
      const c = row.current,
        parent = parents.get(c.woo_product_id),
        product = products.get(row.product_id),
        result = audits.get(row.variant_id),
        reasons = [],
        source = product?.source?.snapshot;
      if (result.state !== "EXACT_SOURCE_MATCH")
        reasons.push("CANONICAL_IDENTITY_REVIEW");
      if (
        !parent ||
        !product ||
        product.woo_id !== c.woo_product_id ||
        source?.woo_product_id !== c.woo_product_id
      )
        reasons.push("PARENT_SOURCE_LINK_REVIEW");
      const variant = variations.get(c.woo_variation_id);
      if (
        c.woo_variation_id !== null &&
        (!variant || variant.parent_id !== c.woo_product_id)
      )
        reasons.push("VARIATION_PARENT_REVIEW");
      if (parent && parent.status !== "publish")
        reasons.push("SOURCE_NOT_PUBLISHED");
      if (variant && variant.variant.status !== "publish")
        reasons.push("VARIATION_NOT_PUBLISHED");
      const saved = source?.variants?.filter((v) => v.barcode === c.barcode);
      if (
        saved?.length !== 1 ||
        saved[0].woo_variation_id !== c.woo_variation_id
      )
        reasons.push("SAVED_SOURCE_VARIANT_REVIEW");
      if (parent && !["simple", "variable"].includes(parent.type))
        reasons.push("UNSUPPORTED_PARENT_TYPE");
      if (parent?.type === "simple" && c.woo_variation_id !== null)
        reasons.push("SIMPLE_HAS_VARIATION");
      if (parent?.type === "variable" && c.woo_variation_id === null)
        reasons.push("VARIABLE_HAS_NO_VARIATION");
      const parsed = parseVariantPhotoUrls(variant?.variant.images ?? "");
      if (!parsed.valid) reasons.push("PHOTO_URL_REVIEW");
      const cover = parseVariantPhotoUrls(parent?.images ?? "").urls[0] ?? null;
      const photos = parsed.urls.map((url, position) => {
        const proof = proofByUrl.get(url);
        return {
          position,
          url,
          same_as_parent_cover: url === cover,
          state: proof ? "BYTES_VERIFIED_LOCAL_ONLY" : "BYTES_PENDING",
          sha256: proof?.sha256 ?? null,
          bytes: proof?.bytes ?? null,
          mime: proof?.mime ?? null,
          ...blocked,
        };
      });
      const state = reasons.length
        ? "REVIEW_REQUIRED"
        : parent.type === "simple"
          ? "SIMPLE_USES_PRODUCT_GALLERY"
          : !photos.length
            ? "NO_VARIATION_PHOTO"
            : photos.every((p) => p.sha256)
              ? "VARIATION_BYTES_VERIFIED"
              : "VARIATION_BYTES_PENDING";
      return {
        product_id: row.product_id,
        variant_id: row.variant_id,
        barcode: c.barcode,
        woo_product_id: c.woo_product_id,
        woo_variation_id: c.woo_variation_id,
        state,
        reasons: reasons.sort(),
        catalog_fingerprint: hash(stable(row)),
        source_fingerprint: source ? hash(stable(source)) : null,
        current_sicar_price_cents: c.price_cents,
        attributes: c.attributes,
        source_photo_changed:
          saved?.length === 1 && variant
            ? saved[0].images_woo !== variant.variant.images
            : false,
        photos,
        parent_gallery_modified: false,
        ...blocked,
      };
    })
    .sort((a, b) =>
      a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0,
    );
  const states = {};
  for (const item of items) states[item.state] = (states[item.state] ?? 0) + 1;
  const candidates = items.filter((i) =>
    ["VARIATION_BYTES_PENDING", "VARIATION_BYTES_VERIFIED"].includes(i.state),
  );
  const downloads = new Map();
  for (const item of candidates)
    for (const photo of item.photos) {
      const entry = downloads.get(photo.url) ?? {
        url: photo.url,
        sha256: photo.sha256,
        bytes: photo.bytes,
        mime: photo.mime,
        references: [],
        ...blocked,
      };
      entry.references.push({
        product_id: item.product_id,
        variant_id: item.variant_id,
        barcode: item.barcode,
        woo_product_id: item.woo_product_id,
        woo_variation_id: item.woo_variation_id,
      });
      downloads.set(photo.url, entry);
    }
  return {
    version: "m9-variant-photo-evidence-1",
    mode: "OFFLINE_READ_ONLY",
    items,
    downloads: [...downloads.values()].sort((a, b) =>
      a.url.localeCompare(b.url, "en"),
    ),
    summary: {
      staged_variants: items.length,
      states,
      candidate_variants: candidates.length,
      unique_candidate_urls: downloads.size,
      verified_candidate_urls: [...downloads.values()].filter((p) => p.sha256)
        .length,
      photo_references: candidates.reduce((n, r) => n + r.photos.length, 0),
      missing_variant_photos: items.filter(
        (i) => i.state === "NO_VARIATION_PHOTO",
      ).length,
      parent_cover_references: candidates
        .flatMap((i) => i.photos)
        .filter((p) => p.same_as_parent_cover).length,
      different_from_parent_cover_references: candidates
        .flatMap((i) => i.photos)
        .filter((p) => !p.same_as_parent_cover).length,
      source_photo_changes: items.filter((i) => i.source_photo_changed).length,
      writes: 0,
    },
    ...blocked,
  };
}
