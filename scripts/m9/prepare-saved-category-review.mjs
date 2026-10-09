import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareCatalogCategories } from "./compare-catalog-categories.mjs";

const sha = (v) => createHash("sha256").update(v).digest("hex");
const json = (v) => JSON.stringify(v, null, 2) + "\n";
const q = (v) => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameMappings = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  same(
    [...a].sort((x, y) => x.id - y.id),
    [...b].sort((x, y) => x.id - y.id),
  );
const hex = (v, n) =>
  typeof v === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(v);

// Recompute membership from original verified inputs, never trust a review label.
// This authorizes technical evidence in staging only, not publication/content edits.
export function prepareSavedCategoryReview(
  proposal,
  capture,
  snapshot,
  evidenceHash,
) {
  if (
    snapshot.project_id !== "zsezjtswqeijboezvado" ||
    snapshot.mode !== "READ_ONLY" ||
    !Array.isArray(snapshot.rows) ||
    !hex(evidenceHash, 64)
  )
    throw Error("INVALID_STAGING_REVIEW_INPUT");
  const comparison = compareCatalogCategories(proposal, capture);
  const capturedAt = new Date(capture.captured_at).toISOString();
  if (
    new Set(proposal.items.map((p) => p.product_id)).size !==
    proposal.items.length
  )
    throw Error("DUPLICATE_TARGET_PRODUCT");
  const sources = new Map(),
    sourceWoo = new Set();
  for (const row of snapshot.rows) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        row.product_id,
      ) ||
      sources.has(row.product_id) ||
      sourceWoo.has(row.woo_product_id) ||
      !Number.isSafeInteger(row.woo_product_id) ||
      row.woo_product_id <= 0
    )
      throw Error("DUPLICATE_OR_INVALID_STAGING_SOURCE");
    sources.set(row.product_id, row);
    sourceWoo.add(row.woo_product_id);
  }
  if (
    snapshot.rows.some(
      (r) =>
        !proposal.items.some(
          (p) =>
            p.product_id === r.product_id &&
            p.woo_product_id === r.woo_product_id,
        ),
    )
  )
    throw Error("UNEXPECTED_STAGING_SOURCE");
  const cases = comparison.items.map((item) => {
    const row = sources.get(item.product_id),
      original = proposal.items.find((p) => p.product_id === item.product_id);
    const issues = [...item.reasons];
    if (!row) issues.push("WEB_SOURCE_ABSENT");
    else {
      if (
        row.woo_product_id !== item.woo_product_id ||
        row.source_categories !== original.source_categories
      )
        issues.push("SOURCE_CHANGED");
      if (
        !hex(row.source_sha256, 64) ||
        ![
          row.source_fingerprint,
          row.catalog_fingerprint,
          row.draft_fingerprint,
        ].every((v) => hex(v, 32)) ||
        !Number.isInteger(row.draft_revision) ||
        row.draft_revision < 1 ||
        row.draft_revision > 999999999
      )
        issues.push("INVALID_DESTINATION_FINGERPRINT");
      if (
        !Array.isArray(row.draft_categories) ||
        !row.draft_categories.length ||
        !same(row.draft_categories, row.suggested_categories)
      )
        issues.push("HUMAN_CATEGORIES_REVIEW_REQUIRED");
      if (
        row.binding_state &&
        (row.binding_state.valid !== true ||
          !sameMappings(row.binding_state.mappings, item.capture_mappings))
      )
        issues.push("EXISTING_BINDING_REVIEW_REQUIRED");
    }
    return {
      product_id: item.product_id,
      woo_product_id: item.woo_product_id,
      state: issues.length
        ? "RESERVED"
        : row.binding_state
          ? "PRESERVE_EXISTING"
          : "TECHNICAL_REVIEW_READY",
      issues: [...new Set(issues)].sort(),
      mapping: item.capture_mappings,
      expected: row
        ? Object.fromEntries(
            [
              "source_sha256",
              "source_fingerprint",
              "catalog_fingerprint",
              "draft_revision",
              "draft_fingerprint",
              "draft_categories",
            ].map((k) => [k, row[k]]),
          )
        : null,
      captured_at: capturedAt,
      send_allowed: false,
    };
  });
  const ready = cases.filter((c) => c.state === "TECHNICAL_REVIEW_READY");
  const batches = [];
  for (let offset = 0; offset < ready.length; offset += 50) {
    const slice = ready.slice(offset, offset + 50);
    const calls = slice.map(
      (c) =>
        `select ${c.woo_product_id}::bigint as woo_product_id, app.verify_saved_draft_categories('${c.product_id}'::uuid,${c.woo_product_id},${q(c.expected)},'${evidenceHash}','${c.captured_at}'::timestamptz,${q(c.mapping)}) as result`,
    );
    // The timestamp is serialized from Date, never interpolated from source text.
    batches.push(
      "begin;\nset local lock_timeout='5s';\nset local statement_timeout='60s';\nselect app.assert_sicar_staging_enabled();\n" +
        calls.join("\nunion all\n") +
        ";\ncommit;\n",
    );
  }
  return {
    version: "m9-saved-category-review-1",
    evidence_sha256: evidenceHash,
    target: snapshot.project_id,
    cases,
    batches,
    summary: {
      products: cases.length,
      technical_reviews: ready.length,
      preserved_existing: cases.filter((c) => c.state === "PRESERVE_EXISTING")
        .length,
      reserved: cases.filter((c) => c.state === "RESERVED").length,
      batches: batches.length,
      authorized_for_dispatch: 0,
    },
    draft_writes: false,
    woo_writes: false,
    inventory_included: false,
  };
}

async function main() {
  const [proposalDir, captureDir, snapshotPath, out] = process.argv.slice(2);
  if (process.argv.length !== 6)
    throw Error("Usage: PROPOSAL_DIR CAPTURE_DIR STAGING_SNAPSHOT NEW_OUTPUT");
  async function verified(dir, file) {
    const hashes = JSON.parse(await fs.readFile(resolve(dir, "sha256.json")));
    const raw = await fs.readFile(resolve(dir, file));
    if (sha(raw) !== hashes[file]) throw Error("INPUT_HASH_CHANGED:" + file);
    return { data: JSON.parse(raw), hash: sha(raw) };
  }
  const proposal = await verified(proposalDir, "revision.json"),
    capture = await verified(captureDir, "taxonomy.json");
  // Normalize a validated capture timestamp to exclude SQL syntax in input text.
  if (!Number.isFinite(Date.parse(capture.data.captured_at)))
    throw Error("INVALID_CAPTURE_DATE");
  capture.data.captured_at = new Date(capture.data.captured_at).toISOString();
  const raw = await fs.readFile(snapshotPath);
  const result = prepareSavedCategoryReview(
    proposal.data,
    capture.data,
    JSON.parse(raw),
    capture.hash,
  );
  result.inputs = {
    proposal_sha256: proposal.hash,
    capture_sha256: capture.hash,
    snapshot_sha256: sha(raw),
  };
  const files = {
    "revision.json": json({ ...result, batches: undefined }),
    "resumen.json": json(result.summary),
  };
  result.batches.forEach(
    (sql, i) => (files[`batch-${String(i + 1).padStart(2, "0")}.sql`] = sql),
  );
  await fs.mkdir(out);
  for (const [file, content] of Object.entries(files))
    await fs.writeFile(resolve(out, file), content, { flag: "wx" });
  await fs.writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(
        Object.entries(files).map(([file, content]) => [file, sha(content)]),
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
