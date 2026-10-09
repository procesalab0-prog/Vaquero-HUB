import { createHash } from "node:crypto";
import { reviewDistinctNamedParents } from "./review-distinct-named-parents.mjs";
import { isSicarRetailCatalogCandidate } from "./catalog-retail-review.mjs";
import { isStockOnlyCatalogCandidate } from "./catalog-stock-review.mjs";
import { stable } from "./woo-test/plan.mjs";
const sha = (x) => createHash("sha256").update(x).digest("hex");
export function prepareNameReviews(ledger, rows, woo, source, contexts) {
  if (
    ledger.version !== "m9-complete-cut-1" ||
    woo.pagination_complete !== true
  )
    throw Error("VERIFIED_CUT_REQUIRED");
  const proofs = new Map(
    reviewDistinctNamedParents(woo).map((p) => [p.woo_product_id, p]),
  );
  const byCode = new Map();
  for (const r of source)
    byCode.set(r.barcode, [...(byCode.get(r.barcode) ?? []), r]);
  const context = new Map(contexts.map((c) => [c.name, c.context_sha256]));
  if (context.size !== contexts.length) throw Error("DUPLICATE_CONTEXT");
  const seen = new Set(),
    cases = new Map();
  for (const r of rows) {
    const audit = ledger.ledger.find((x) => x.barcode === r.barcode),
      s = byCode.get(r.barcode),
      p = woo.products.find((p) => p.id === r.woo_product_id);
    if (
      seen.has(r.barcode) ||
      s?.length !== 1 ||
      !audit ||
      audit.state !== "DESTINATION_NAME_REVIEW" ||
      audit.preparation_holds?.length ||
      proofs.get(r.woo_product_id)?.state !== "DISTINCT_LITERAL_BASES"
    )
      throw Error("IDENTITY_REVIEW_REQUIRED");
    seen.add(r.barcode);
    const x = s[0];
    if (
      !(
        (x.classification === "MATCH_EXACT_VARIANT" && !x.manual_review) ||
        isSicarRetailCatalogCandidate(x) ||
        isStockOnlyCatalogCandidate(x)
      ) ||
      x.issues.length ||
      x.display_only ||
      p.status !== "publish"
    )
      throw Error("SOURCE_CONTROLS_PENDING");
    const attrs = Object.fromEntries(
      x.attributes.map((a) => [
        { Talla: "TALLA", Color: "COLOR", Largo: "LARGO" }[a.name] ?? a.name,
        a.value,
      ]),
    );
    const [whole, part = ""] = x.fields.precio1.split(".");
    const expected = {
      barcode: x.barcode,
      description: x.description,
      department: x.fields.departamento,
      section: x.fields.categoria,
      price_cents: Number(whole) * 100 + Number(part.padEnd(2, "0")),
      cost_cents: null,
      attributes: attrs,
      product_name: p.name,
      woo_product_id: x.product_id,
      woo_variation_id: x.variation_id,
    };
    if (
      stable(expected) !== stable(r) ||
      !/^\d+(\.\d{1,2})?$/.test(x.fields.precio1) ||
      !Number.isSafeInteger(expected.price_cents) ||
      expected.price_cents <= 0
    )
      throw Error("SOURCE_ROW_CHANGED");
    const fingerprint = context.get(p.name);
    if (!/^[a-f0-9]{64}$/.test(fingerprint ?? ""))
      throw Error("DESTINATION_CONTEXT_REQUIRED");
    if (!cases.has(p.id))
      cases.set(p.id, { woo_id: p.id, context_sha256: fingerprint, rows: [] });
    cases.get(p.id).rows.push(r);
  }
  const sorted = [...cases.values()].sort((a, b) => a.woo_id - b.woo_id);
  for (const c of sorted)
    c.rows.sort((a, b) => a.barcode.localeCompare(b.barcode));
  const parents = woo.products
    .map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      base_original: p.short_description,
    }))
    .sort((a, b) => a.id - b.id);
  const evidence_sha256 = sha(stable({ cases: sorted, parents }));
  return {
    version: "m9-name-review-1",
    cases: sorted,
    parents,
    evidence_sha256,
    summary: {
      parents: sorted.length,
      variants: rows.length,
      publication_allowed: false,
      inventory_included: false,
    },
  };
}
