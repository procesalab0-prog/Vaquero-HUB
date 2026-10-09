import { parseCategoryPaths } from "./review-catalog-categories.mjs";
import { stable } from "./woo-test/plan.mjs";
const same = (a, b) => stable(a) === stable(b);
const flags = {
  import_allowed: false,
  refresh_allowed: false,
  send_allowed: false,
};

// Explain technical differences without rewriting literal source evidence or
// approving publication, taxonomy, variant photos or Woo promotion prices.
export function reviewEditorialDelta(
  editorial,
  context,
  woo,
  capture,
  snapshot,
) {
  if (
    context.project_id !== "zsezjtswqeijboezvado" ||
    snapshot.project_id !== context.project_id ||
    context.rows !== snapshot.rows.length ||
    snapshot.inventory_balances !== 0 ||
    snapshot.inventory_movements !== 0
  )
    throw Error("STAGING_CONTEXT_REQUIRED");
  if (
    capture.version !== "m9-catalog-public-taxonomy-1" ||
    capture.mode !== "PUBLIC_GET_ONLY" ||
    capture.pagination_complete !== true ||
    !Array.isArray(capture.requested_ids) ||
    new Set(capture.requested_ids).size !== capture.requested_ids.length ||
    woo.pagination_complete !== true
  )
    throw Error("VERIFIED_CATEGORY_CAPTURE_REQUIRED");
  const byId = (items, key) => {
    const map = new Map();
    for (const item of items) {
      if (!Number.isSafeInteger(item[key]) || map.has(item[key]))
        throw Error("DUPLICATE_OR_INVALID_PARENT");
      map.set(item[key], item);
    }
    return map;
  };
  const parents = byId(woo.products, "id"),
    products = byId(context.products, "woo_id"),
    observed = byId(capture.products, "id");
  byId(editorial, "woo_product_id");
  const items = editorial
    .map((row) => {
      const parent = parents.get(row.woo_product_id),
        product = products.get(row.woo_product_id);
      if (!parent) throw Error("CURRENT_WOO_PARENT_REQUIRED");
      if (row.product_id && row.product_id !== product?.product_id)
        throw Error("DESTINATION_LINK_CHANGED");
      const source = product?.source?.snapshot;
      if (source && source.woo_product_id !== row.woo_product_id)
        throw Error("SOURCE_LINK_CHANGED");
      const categoryChanges = row.parent_differences.filter(
        (d) => d.field === "categories_source",
      );
      const categories = categoryChanges.map((d) => {
        if (
          d.before !== source?.categories_source ||
          d.after !== parent.categories
        )
          throw Error("CATEGORY_EVIDENCE_CHANGED");
        const old = parseCategoryPaths(d.before, capture.categories),
          next = parseCategoryPaths(d.after, capture.categories),
          live = observed.get(parent.id),
          reasons = [];
        if (!capture.requested_ids.includes(parent.id))
          reasons.push("OUTSIDE_AUTHORIZED_CAPTURE");
        if (
          old.state !== "UNIQUE_PATH_PROPOSAL" ||
          next.state !== "UNIQUE_PATH_PROPOSAL"
        )
          reasons.push("CATEGORY_PATH_REVIEW");
        if (!same(old.mappings, next.mappings))
          reasons.push("CATEGORY_MEMBERSHIP_CHANGED");
        const ids = live?.categories?.map((c) => c.id).sort((a, b) => a - b);
        if (
          !ids ||
          new Set(ids).size !== ids.length ||
          !same(
            ids,
            next.mappings.map((m) => m.id),
          )
        )
          reasons.push("PUBLIC_MEMBERSHIP_REVIEW");
        return {
          state: reasons.length
            ? "CATEGORY_REVIEW_REQUIRED"
            : "SAME_MEMBERSHIP_DIFFERENT_REPRESENTATION",
          reasons,
          mappings: next.mappings,
          captured_at: capture.captured_at,
          source_literal_preserved: true,
          ...flags,
        };
      });
      const prices = [],
        photos = [];
      for (const variant of row.saved_variants) {
        const saved = source?.variants?.find(
            (v) =>
              v.woo_variation_id === variant.woo_variation_id &&
              v.barcode === variant.barcode,
          ),
          current = parent.variations.find(
            (v) => v.id === variant.woo_variation_id,
          ),
          catalog = snapshot.rows.find(
            (r) => r.current.barcode === variant.barcode,
          );
        if (
          variant.changes.length &&
          (!saved ||
            !current ||
            !catalog ||
            catalog.product_id !== row.product_id ||
            catalog.current.woo_variation_id !== variant.woo_variation_id)
        )
          throw Error("VARIATION_LINK_CHANGED");
        for (const change of variant.changes) {
          if (change.field === "regular_price_woo") {
            if (
              !same(change.before, saved.regular_price_woo) ||
              !same(change.after, current.price ?? "")
            )
              throw Error("PRICE_EVIDENCE_CHANGED");
            prices.push({
              barcode: variant.barcode,
              woo_variation_id: variant.woo_variation_id,
              retained_sicar_public_cents: catalog.current.price_cents,
              previous_woo_price: change.before,
              current_woo_price: change.after,
              state: "SICAR_RETAIL_PRESERVED_WOO_PRICE_OBSERVED",
              ...flags,
            });
          }
          if (change.field === "images_woo") {
            if (
              !same(change.before, saved.images_woo) ||
              !same(change.after, current.images)
            )
              throw Error("PHOTO_EVIDENCE_CHANGED");
            const urls =
              typeof change.after === "string"
                ? change.after
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [];
            const valid =
              urls.length > 0 &&
              urls.every((s) => {
                try {
                  const u = new URL(s);
                  return (
                    u.origin === "https://vaquerosm.com" &&
                    u.pathname.startsWith("/wp-content/uploads/") &&
                    !u.username &&
                    !u.password
                  );
                } catch {
                  return false;
                }
              });
            photos.push({
              barcode: variant.barcode,
              woo_variation_id: variant.woo_variation_id,
              state: valid
                ? "VARIATION_PHOTO_BYTES_PENDING"
                : "VARIATION_PHOTO_URL_REVIEW",
              urls: valid ? urls : [],
              parent_gallery_modified: false,
              ...flags,
            });
          }
        }
      }
      return {
        woo_product_id: parent.id,
        product_id: row.product_id,
        original_state: row.state,
        categories,
        prices,
        photos,
        other_parent_differences: row.parent_differences.filter(
          (d) => d.field !== "categories_source",
        ),
        source_literal_preserved: true,
        ...flags,
      };
    })
    .sort((a, b) => a.woo_product_id - b.woo_product_id);
  return {
    version: "m9-editorial-technical-review-1",
    mode: "OFFLINE_READ_ONLY",
    items,
    summary: {
      parents: items.length,
      same_membership_representations: items
        .flatMap((r) => r.categories)
        .filter((c) => c.state === "SAME_MEMBERSHIP_DIFFERENT_REPRESENTATION")
        .length,
      category_reviews: items
        .flatMap((r) => r.categories)
        .filter((c) => c.state === "CATEGORY_REVIEW_REQUIRED").length,
      retained_sicar_prices: items.flatMap((r) => r.prices).length,
      variation_photos_for_byte_check: items
        .flatMap((r) => r.photos)
        .filter((p) => p.state === "VARIATION_PHOTO_BYTES_PENDING").length,
      source_writes: 0,
      draft_writes: 0,
    },
    ...flags,
  };
}
