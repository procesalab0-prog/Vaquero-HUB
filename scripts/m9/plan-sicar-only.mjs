import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const digest = (x) => createHash("sha256").update(json(x)).digest("hex");
const sorted = (xs) =>
  [...xs].sort((a, b) =>
    a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0,
  );
export const evidenceFor = (rows) =>
  digest(
    sorted(rows).map((r) => [
      r.barcode,
      r.evidence_sha256,
      r.description,
      r.department,
      r.section,
      r.retail_cents,
      [...r.issues].sort(),
    ]),
  );
const validText = (s, n) =>
  typeof s === "string" && s.length > 0 && s.length <= n && s.trim() === s;
// This is a catalog proposal, not a database payload or authorization to apply.
export function planSicarOnly(review, decisions) {
  if (
    review.version !== "m9-sicar-only-review-1" ||
    !Array.isArray(review.records) ||
    !Array.isArray(decisions)
  )
    throw Error("INVALID_INPUT");
  const records = new Map();
  for (const r of review.records) {
    if (records.has(r.barcode)) throw Error("DUPLICATE_SOURCE_CODE");
    records.set(r.barcode, r);
  }
  const claimed = new Set(),
    ids = new Set(),
    families = [],
    errors = [];
  // Count claims before validation so an invalid decision cannot hide an overlap.
  const claims = new Map();
  for (const d of decisions)
    for (const m of d.members ?? [])
      claims.set(m.barcode, (claims.get(m.barcode) ?? 0) + 1);
  for (const d of decisions) {
    const reasons = [];
    if (
      !validText(d.family_key, 80) ||
      !/^[a-zA-Z0-9_-]+$/.test(d.family_key) ||
      ids.has(d.family_key)
    )
      reasons.push("INVALID_OR_DUPLICATE_FAMILY_KEY");
    ids.add(d.family_key);
    if (
      d.status !== "approved" ||
      !validText(d.reviewer, 160) ||
      !validText(d.reason, 2000) ||
      typeof d.reviewed_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d.reviewed_at) ||
      !Number.isFinite(Date.parse(d.reviewed_at)) ||
      new Date(d.reviewed_at).toISOString().slice(0, 10) !== d.reviewed_at
    )
      reasons.push("REVIEW_REQUIRED");
    if (
      !validText(d.product_name, 160) ||
      !Array.isArray(d.members) ||
      d.members.length === 0
    )
      reasons.push("INVALID_FAMILY");
    const members = Array.isArray(d.members) ? d.members : [];
    const source = members.map((m) => records.get(m.barcode));
    if (source.some((r) => !r)) reasons.push("UNKNOWN_CODE");
    else if (evidenceFor(source) !== d.evidence_sha256)
      reasons.push("STALE_EVIDENCE");
    const attributes = new Set();
    const rows = [];
    for (const m of members) {
      const r = records.get(m.barcode);
      if (claims.get(m.barcode) !== 1)
        reasons.push("CODE_CLAIMED_MULTIPLE_TIMES");
      if (!r) continue;
      if (r.issues.length) reasons.push("SOURCE_ISSUES");
      if (
        !validText(r.barcode, 80) ||
        !validText(r.description, 2000) ||
        !validText(r.department, 2000) ||
        !validText(r.section, 2000) ||
        !Number.isSafeInteger(r.retail_cents) ||
        r.retail_cents <= 0
      )
        reasons.push("INVALID_SOURCE_DATA");
      if (
        !m.attributes ||
        typeof m.attributes !== "object" ||
        Array.isArray(m.attributes) ||
        Object.entries(m.attributes).some(
          ([k, v]) =>
            !["TALLA", "COLOR", "LARGO"].includes(k) || !validText(v, 80),
        )
      ) {
        reasons.push("INVALID_ATTRIBUTES");
        continue;
      }
      const attrs = Object.fromEntries(
        Object.entries(m.attributes).sort(([a], [b]) =>
          a.localeCompare(b, "en"),
        ),
      );
      const key = JSON.stringify(attrs);
      if (attributes.has(key)) reasons.push("DUPLICATE_ATTRIBUTES");
      attributes.add(key);
      rows.push({
        barcode: r.barcode,
        description: r.description,
        department: r.department,
        section: r.section,
        price_cents: r.retail_cents,
        cost_cents: null,
        wholesale_cents: null,
        medium_wholesale_cents: null,
        attributes: attrs,
        woo_product_id: null,
        woo_variation_id: null,
      });
    }
    if (new Set(source.filter(Boolean).map((r) => r.section)).size > 1)
      reasons.push("MULTIPLE_SECTIONS_REVIEW");
    if (
      new Set(rows.map((r) => JSON.stringify(Object.keys(r.attributes)))).size >
      1
    )
      reasons.push("INCONSISTENT_DIMENSIONS");
    if (reasons.length)
      errors.push({
        family_key: d.family_key ?? null,
        reasons: [...new Set(reasons)].sort(),
      });
    else {
      rows.forEach((r) => claimed.add(r.barcode));
      families.push({
        identity_namespace: "SICAR",
        family_key: d.family_key,
        product_name: d.product_name,
        evidence_sha256: d.evidence_sha256,
        reviewer: d.reviewer,
        reviewed_at: d.reviewed_at,
        reason: d.reason,
        rows: sorted(rows),
      });
    }
  }
  families.sort((a, b) => (a.family_key < b.family_key ? -1 : 1));
  return {
    version: "m9-sicar-only-plan-1",
    destination: "STAGING_ONLY",
    write_allowed: false,
    inventory_included: false,
    woo_writes: false,
    sources: review.sources ?? null,
    families,
    errors,
    pending_codes: sorted(review.records)
      .filter((r) => !claimed.has(r.barcode))
      .map((r) => r.barcode),
    summary: {
      source_rows: records.size,
      reviewed_rows: claimed.size,
      pending_rows: records.size - claimed.size,
      reviewed_families: families.length,
      blocked_decisions: errors.length,
    },
  };
}
// Recompute from source and decisions; never trust a caller-supplied plan.
export function prepareSicarDatabasePacket(review, decisions) {
  const plan = planSicarOnly(review, decisions);
  if (plan.errors.length) throw Error("BLOCKED_DECISIONS");
  if (!/^[a-f0-9]{64}$/.test(review.sources?.sicar_sha256 ?? ""))
    throw Error("SOURCE_HASH_REQUIRED");
  const rows = [],
    approvals = [];
  for (const family of plan.families) {
    for (const source of family.rows) {
      const payload = {
        attributes: source.attributes,
        barcode: source.barcode,
        cost_cents: null,
        department: source.department,
        description: source.description,
        family_key: family.family_key,
        price_cents: source.price_cents,
        product_name: family.product_name,
        section: source.section,
        woo_variation_id: null,
      };
      rows.push(payload);
      approvals.push({
        barcode: source.barcode,
        source_sha256: review.sources.sicar_sha256,
        payload,
        reviewer: family.reviewer,
        reason: family.reason,
        reviewed_at: family.reviewed_at,
        evidence_sha256: family.evidence_sha256,
      });
    }
  }
  if (rows.length > 1000) throw Error("BATCH_LIMIT_SPLIT_BY_FAMILY");
  return {
    version: "m9-sicar-database-packet-1",
    project_id: "zsezjtswqeijboezvado",
    source_sha256: review.sources.sicar_sha256,
    rows,
    approvals,
    requires_destination_plan: true,
    write_allowed: false,
    inventory_operations: 0,
  };
}
// Validate the entire decision set before splitting: cross-batch collisions count.
export function prepareSicarBatches(review, decisions, limit = 500) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw Error("INVALID_BATCH_LIMIT");
  const plan = planSicarOnly(review, decisions);
  if (plan.errors.length) throw Error("BLOCKED_DECISIONS");
  const batches = [],
    group = [];
  let size = 0;
  const flush = () => {
    if (!group.length) return;
    const packet = prepareSicarDatabasePacket(review, group);
    batches.push({ index: batches.length + 1, sha256: digest(packet), packet });
    group.length = 0;
    size = 0;
  };
  const byKey = new Map(decisions.map((d) => [d.family_key, d]));
  for (const family of plan.families) {
    if (family.rows.length > limit) throw Error("FAMILY_EXCEEDS_BATCH_LIMIT");
    if (size + family.rows.length > limit) flush();
    group.push(byKey.get(family.family_key));
    size += family.rows.length;
  }
  flush();
  // Validate provenance even when there are no approved decisions.
  if (!batches.length) prepareSicarDatabasePacket(review, []);
  return {
    version: "m9-sicar-batches-1",
    limit,
    source_sha256: review.sources.sicar_sha256,
    rows: plan.summary.reviewed_rows,
    families: plan.families.length,
    pending_rows: plan.summary.pending_rows,
    batches,
    write_allowed: false,
  };
}
async function main() {
  const [reviewPath, decisionsPath, out] = process.argv.slice(2);
  if (!out) throw Error("Usage: REVIEW.json DECISIONS.json NEW_OUTPUT");
  const bytes = await readFile(reviewPath);
  const checks = JSON.parse(
    await readFile(resolve(dirname(reviewPath), "sha256.json"), "utf8"),
  );
  if (
    createHash("sha256").update(bytes).digest("hex") !== checks["revision.json"]
  )
    throw Error("REVIEW_HASH_CHANGED");
  const review = JSON.parse(bytes);
  const decisions = JSON.parse(await readFile(decisionsPath, "utf8"));
  const result = planSicarOnly(review, decisions);
  const batches = prepareSicarBatches(review, decisions);
  await mkdir(out);
  await writeFile(resolve(out, "plan.json"), json(result), { flag: "wx" });
  await writeFile(resolve(out, "batches.json"), json(batches), {
    flag: "wx",
  });
  await writeFile(
    resolve(out, "sha256.json"),
    json({
      "batches.json": digest(batches),
      "plan.json": createHash("sha256").update(json(result)).digest("hex"),
    }),
    { flag: "wx" },
  );
  console.log(result.summary);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
