import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { categoryPaths } from "./review-web-families.mjs";
import { parseCategoryPaths } from "./review-catalog-categories.mjs";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const sorted = (ids) => [...ids].sort((a, b) => a - b);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const validId = (id) => Number.isSafeInteger(id) && id > 0;
const unique = (ids) => new Set(ids).size === ids.length;

// A match is evidence at the capture time, never permission to write a binding.
export function compareCatalogCategories(proposal, capture) {
  if (
    proposal.version !== "m9-catalog-category-review-1" ||
    capture.version !== "m9-catalog-public-taxonomy-1" ||
    capture.mode !== "PUBLIC_GET_ONLY" ||
    capture.pagination_complete !== true ||
    !/^[a-f0-9]{64}$/.test(proposal.sources?.snapshot_sha256 ?? "") ||
    capture.catalog_snapshot_sha256 !== proposal.sources.snapshot_sha256 ||
    !Number.isFinite(Date.parse(capture.captured_at))
  )
    throw Error("CAPTURE_PROVENANCE_REQUIRED");
  const expected = proposal.items.map((p) => p.woo_product_id);
  const requested = capture.requested_ids;
  if (
    !Array.isArray(requested) ||
    !unique(expected) ||
    !unique(requested) ||
    expected.some((id) => !validId(id)) ||
    !same(expected, requested)
  )
    throw Error("REQUEST_SCOPE_MISMATCH");
  const categories = categoryPaths(capture.categories),
    known = new Set(categories.map((c) => c.id));
  const products = new Map();
  if (
    !Array.isArray(capture.products) ||
    !Array.isArray(capture.not_returned_ids)
  )
    throw Error("CAPTURE_COLLECTION_REQUIRED");
  for (const product of capture.products) {
    if (
      !validId(product.id) ||
      !expected.includes(product.id) ||
      products.has(product.id) ||
      !Array.isArray(product.categories) ||
      product.categories.some((c) => !validId(c.id))
    )
      throw Error("INVALID_CAPTURE_PRODUCT");
    products.set(product.id, product);
  }
  const missing = expected.filter((id) => !products.has(id));
  if (
    !unique(capture.not_returned_ids) ||
    !same(missing, capture.not_returned_ids)
  )
    throw Error("CAPTURE_PARTITION_MISMATCH");
  const items = proposal.items
    .map((item) => {
      const reasons = [],
        product = products.get(item.woo_product_id);
      const current = parseCategoryPaths(
        item.source_categories,
        capture.categories,
      );
      const oldIds = item.mappings.map((m) => m.id),
        parsedIds = current.mappings.map((m) => m.id);
      if (
        item.state !== "UNIQUE_PATH_PROPOSAL" ||
        !unique(oldIds) ||
        !oldIds.length
      )
        reasons.push("ORIGINAL_PROPOSAL_REQUIRES_REVIEW");
      if (current.state !== "UNIQUE_PATH_PROPOSAL")
        reasons.push("CURRENT_PATHS_REQUIRE_REVIEW");
      else if (!same(oldIds, parsedIds))
        reasons.push("CATEGORY_ID_MAPPING_CHANGED");
      const observed = product?.categories.map((c) => c.id) ?? null;
      if (!product) reasons.push("NOT_RETURNED_PUBLICLY_NO_DELETE");
      else {
        if (!unique(observed)) reasons.push("DUPLICATE_PUBLIC_CATEGORY_ID");
        if (observed.some((id) => !known.has(id)))
          reasons.push("UNKNOWN_PUBLIC_CATEGORY_ID");
        if (!same(parsedIds, observed))
          reasons.push("PUBLIC_MEMBERSHIP_DIFFERS");
      }
      return {
        product_id: item.product_id,
        woo_product_id: item.woo_product_id,
        name: item.name,
        state: reasons.length ? "REVIEW_REQUIRED" : "MATCH_AT_CAPTURE",
        reasons: reasons.sort(),
        proposed_mappings: item.mappings,
        capture_mappings: current.mappings,
        public_membership_ids: observed === null ? null : sorted(observed),
        captured_at: capture.captured_at,
        send_allowed: false,
        destination_fingerprint_required: true,
      };
    })
    .sort((a, b) => a.woo_product_id - b.woo_product_id);
  const candidates = items
    .filter((item) => item.state === "MATCH_AT_CAPTURE")
    .map((item) => ({
      product_id: item.product_id,
      woo_product_id: item.woo_product_id,
      mappings: item.capture_mappings,
      captured_at: item.captured_at,
      destination_fingerprint_required: true,
      human_draft_protection_required: true,
      write_allowed: false,
    }));
  return {
    version: "m9-category-membership-comparison-1",
    mode: "OFFLINE_READ_ONLY",
    summary: {
      products: items.length,
      matches_at_capture: candidates.length,
      review_required: items.length - candidates.length,
      not_returned_publicly: missing.length,
      approved_for_send: 0,
      database_writes: 0,
    },
    captured_at: capture.captured_at,
    write_allowed: false,
    inventory_included: false,
    items,
    binding_review_candidates: candidates,
  };
}

async function main() {
  const [proposalDir, captureDir, out] = process.argv.slice(2);
  if (!out)
    throw Error("Usage: VERIFIED_PROPOSAL_DIR VERIFIED_CAPTURE_DIR NEW_OUTPUT");
  async function readVerified(dir, name) {
    const hashes = JSON.parse(await fs.readFile(resolve(dir, "sha256.json")));
    const raw = await fs.readFile(resolve(dir, name));
    if (sha(raw) !== hashes[name]) throw Error("INPUT_HASH_CHANGED:" + name);
    return { data: JSON.parse(raw), hash: sha(raw) };
  }
  const proposal = await readVerified(proposalDir, "revision.json"),
    capture = await readVerified(captureDir, "taxonomy.json");
  const result = compareCatalogCategories(proposal.data, capture.data);
  result.sources = {
    proposal_sha256: proposal.hash,
    capture_sha256: capture.hash,
  };
  const files = {
    "comparacion.json": json(result),
    "resumen.json": json(result.summary),
    "candidatos-revision-binding.json": json(result.binding_review_candidates),
  };
  await fs.mkdir(out);
  for (const [name, value] of Object.entries(files))
    await fs.writeFile(resolve(out, name), value, { flag: "wx" });
  await fs.writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(
        Object.entries(files).map(([name, value]) => [name, sha(value)]),
      ),
    ),
    { flag: "wx" },
  );
  console.log(result.summary);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
