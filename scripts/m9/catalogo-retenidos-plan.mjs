import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stable } from "./woo-test/plan.mjs";
import { digest } from "./acceleration.mjs";
export const HELD_REASONS = Object.freeze([
  "DISPLAY_OR_SALES_RESTRICTION",
  "TAXONOMY_REVIEW",
  "PUBLIC_PRICE_INVALID",
  "CATEGORY_CONFLICT",
]);
const sha = (x) => createHash("sha256").update(x).digest("hex"),
  same = (a, b) => stable(a) === stable(b),
  must = (ok, msg) => {
    if (!ok) throw Error(msg);
  };
const projection = (r) => ({
  description: r.description,
  department: r.fields.departamento,
  section: r.fields.categoria,
  retail_source: r.fields.precio1,
});
export function prepareHeldReferences({
  source,
  heldPlan,
  stageCodes,
  archive,
  request_id,
  source_sha256,
}) {
  must(
    source_sha256 ===
      "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93" &&
      heldPlan.source_sha256 === source_sha256,
    "SICAR22_SOURCE_REQUIRED",
  );
  must(
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request_id),
    "HELD_REQUEST_UUID_REQUIRED",
  );
  must(
    heldPlan.version === "m9-provisional-plan-1" &&
      heldPlan.source_rows_sha256 === digest(source),
    "HELD_SOURCE_REPORT_PROVENANCE_CHANGED",
  );
  const codes = stageCodes.map((x) => (typeof x === "string" ? x : x.barcode)),
    known = new Set(codes),
    byCode = new Map(source.map((r) => [r.barcode, r]));
  must(
    new Set(codes).size === codes.length &&
      byCode.size === source.length &&
      source.length === 16396,
    "SOURCE_AND_DESTINATION_CODES_UNIQUE",
  );
  must(
    codes.every((code) => byCode.has(code)),
    "DESTINATION_CODES_OUTSIDE_SOURCE",
  );
  const absent = source
      .filter((r) => !known.has(r.barcode))
      .map((r) => r.barcode)
      .sort(),
    held = [...heldPlan.held].sort((a, b) => (a.barcode < b.barcode ? -1 : 1));
  must(
    absent.length === 435 &&
      same(
        absent,
        held.map((r) => r.barcode),
      ),
    "EXACT_435_HELD_SCOPE_REQUIRED",
  );
  const existing = new Map(archive.rows.map((r) => [r.barcode, r]));
  must(existing.size === archive.rows.length, "DUPLICATE_ARCHIVE_REFERENCE");
  const counts = Object.fromEntries(HELD_REASONS.map((k) => [k, 0])),
    combinations = {},
    rows = [];
  for (const h of held) {
    const s = byCode.get(h.barcode),
      a = existing.get(h.barcode),
      p = projection(s),
      overlay = {};
    must(
      s.fields["clave1 *"] === h.barcode &&
        s.fields["descripción *"] === s.description &&
        h.barcode === h.barcode.trim() &&
        h.barcode.length > 0 &&
        h.barcode.length <= 80,
      "LITERAL_SOURCE_CODE_REQUIRED",
    );
    must(
      Object.values(p).every(
        (v) => typeof v === "string" && v.length <= 4000,
      ) &&
        h.reasons.length > 0 &&
        new Set(h.reasons).size === h.reasons.length &&
        h.reasons.every((r) => HELD_REASONS.includes(r)),
      "HELD_SOURCE_REASON_INVALID",
    );
    for (const r of h.reasons) counts[r]++;
    const combo = [...h.reasons].sort().join("|");
    combinations[combo] = (combinations[combo] ?? 0) + 1;
    if (a) {
      must(
        a.evidence.barcode === h.barcode &&
          /^[a-f0-9]{64}$/.test(a.cut_sha) &&
          /^[a-f0-9]{64}$/.test(a.evidence_sha256),
        "ORIGINAL_ARCHIVE_HASH_REQUIRED",
      );
      for (const [k, v] of Object.entries(p))
        if (a.evidence[k] !== v) overlay[k] = v;
    } else Object.assign(overlay, p);
    rows.push({
      barcode: h.barcode,
      reasons: h.reasons,
      display_restricted: h.reasons.includes("DISPLAY_OR_SALES_RESTRICTION"),
      origin_cut_sha: a?.cut_sha ?? null,
      origin_evidence_sha256: a?.evidence_sha256 ?? null,
      overlay,
    });
  }
  must(
    same(counts, {
      DISPLAY_OR_SALES_RESTRICTION: 316,
      TAXONOMY_REVIEW: 86,
      PUBLIC_PRICE_INVALID: 40,
      CATEGORY_CONFLICT: 3,
    }),
    "HELD_REASON_TOTALS_CHANGED",
  );
  const reused = rows.filter(
      (r) => r.origin_cut_sha && Object.keys(r.overlay).length === 0,
    ).length,
    newRows = rows.filter((r) => !r.origin_cut_sha).length,
    changed = rows.filter(
      (r) => r.origin_cut_sha && Object.keys(r.overlay).length > 0,
    ).length;
  must(
    reused === 433 && newRows === 1 && changed === 1,
    "ARCHIVE_REUSE_SCOPE_CHANGED",
  );
  const queue = HELD_REASONS.map((reason) => ({
    reason,
    count: counts[reason],
    state:
      reason === "DISPLAY_OR_SALES_RESTRICTION"
        ? "POLICY_ALREADY_CONFIRMED"
        : "SOURCE_REVIEW_BY_TYPE",
    examples: held
      .filter((h) => h.reasons.includes(reason))
      .slice(0, 3)
      .map((h) => ({
        barcode: h.barcode,
        ...projection(byCode.get(h.barcode)),
      })),
  }));
  const price_formats = {};
  for (const h of held.filter((h) =>
    h.reasons.includes("PUBLIC_PRICE_INVALID"),
  )) {
    const raw = byCode.get(h.barcode).fields.precio1;
    price_formats[raw] = (price_formats[raw] ?? 0) + 1;
  }
  queue.find((q) => q.reason === "PUBLIC_PRICE_INVALID").literal_price_groups =
    price_formats;
  const rows_json = JSON.stringify(rows),
    payload = {
      protocol: "m9-held-reference-index-1",
      project_id: "zsezjtswqeijboezvado",
      request_id,
      source_sha256,
      source_date: "2026-10-22",
      source_count: source.length,
      managed_count_at_preparation: codes.length,
      observed_at: new Date(archive.observed_at).toISOString(),
      rows_json,
      rows_sha256: sha(rows_json),
    };
  return {
    protocol: "m9-held-reference-plan-1",
    summary: {
      reference_count: 435,
      reused_without_copy: reused,
      overlays: changed,
      new_reference: newRows,
      reason_counts: counts,
      exclusive_combinations: combinations,
      active_catalog_codes: codes.length,
      catalog_created: 0,
      variants_created: 0,
      stock_woo_cost_price_writes: 0,
    },
    queue,
    excluded_historical_codes: archive.rows
      .filter((r) => !byCode.has(r.barcode))
      .map((r) => r.barcode),
    payload,
    write_allowed: false,
    operational_authorization: false,
  };
}
export async function writeHeldReferencePlan(configPath, out) {
  const c = JSON.parse(await readFile(configPath, "utf8")),
    input = {};
  for (const [k, pin] of Object.entries(c.inputs)) {
    const b = await readFile(pin.path);
    must(sha(b) === pin.sha256, "HELD_INPUT_SHA_CHANGED:" + k);
    input[k] = JSON.parse(b);
  }
  const p = prepareHeldReferences({ ...input, ...c.metadata });
  await mkdir(out, { recursive: false, mode: 0o700 });
  for (const [name, v] of Object.entries({
    "plan.json": p,
    "payload.json": p.payload,
    "summary.json": p.summary,
    "queue.json": p.queue,
  }))
    await writeFile(resolve(out, name), JSON.stringify(v, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  return p.summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4) throw Error("USAGE: CONFIG NEW_OUTPUT");
  console.log(
    JSON.stringify(
      await writeHeldReferencePlan(
        resolve(process.argv[2]),
        resolve(process.argv[3]),
      ),
    ),
  );
}
