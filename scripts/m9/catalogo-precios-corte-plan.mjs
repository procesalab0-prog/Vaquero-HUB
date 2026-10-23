import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const project = "zsezjtswqeijboezvado";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
const secondary = new Set([
  "precio2",
  "precio3",
  "precio4",
  "mayoreo2",
  "mayoreo3",
  "mayoreo4",
]);
const sourceRequired = [
  "clave1 *",
  "descripción *",
  "departamento",
  "categoria",
  "precio1",
  "precio2",
  "precio3",
  "precio4",
  "mayoreo2",
  "mayoreo3",
  "mayoreo4",
  "costo",
  "existencia",
  "unidad",
  "(s/n) mostrar en ventas",
  "(s/n) inventariable",
  "(s/n) precio con impuestos",
  "(s/n) granel",
  "(s/n) receta",
  "(s/n) lotes",
];
const m9Keys = [
  "attributes",
  "barcode",
  "cost_cents",
  "department",
  "description",
  "family_key",
  "price_cents",
  "product_name",
  "section",
  "woo_variation_id",
];
const liveKeys = [
  "barcode",
  "variant_id",
  "product_id",
  "source_sha256",
  "source_row",
  "current_row",
  "barcode_bindings",
  "barcode_variant_id",
  "price_cents",
  "cost_cents",
  "woo_product_id",
  "woo_variation_id",
];
const plain = (x) =>
  x !== null &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  Object.getPrototypeOf(x) === Object.prototype;
const canonical = (x) => {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (plain(x))
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`)
      .join(",")}}`;
  if (
    x === null ||
    typeof x === "string" ||
    typeof x === "boolean" ||
    (typeof x === "number" && Number.isFinite(x))
  )
    return JSON.stringify(x);
  throw Error("NON_JSON_VALUE");
};
const hash = (x) => createHash("sha256").update(x).digest("hex");
const same = (a, b) => canonical(a) === canonical(b);
const literal = (x) => typeof x === "string" && x.length > 0 && x === x.trim();
const iso = (x) =>
  typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) &&
  Number.isFinite(Date.parse(x)) &&
  new Date(x).toISOString() === x;
export function publicPriceCents(x) {
  if (typeof x !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(x)) return null;
  const [units, decimals = ""] = x.split(".");
  const value = BigInt(units) * 100n + BigInt(decimals.padEnd(2, "0"));
  return value > 0n && value <= 999999999999n ? Number(value) : null;
}
function index(rows) {
  if (!Array.isArray(rows)) throw Error("ROWS_ARRAY_REQUIRED");
  const result = new Map();
  for (const r of rows) {
    if (!plain(r) || !literal(r.barcode)) throw Error("LITERAL_CODE_REQUIRED");
    result.set(r.barcode, [...(result.get(r.barcode) ?? []), r]);
  }
  return result;
}
function sourceValid(r) {
  return (
    plain(r.fields) &&
    sourceRequired.every((k) => typeof r.fields[k] === "string") &&
    r.fields["clave1 *"] === r.barcode &&
    literal(r.description) &&
    r.fields["descripción *"] === r.description &&
    ["departamento", "categoria"].every((k) => literal(r.fields[k])) &&
    Array.isArray(r.issues) &&
    r.issues.length === 0 &&
    Array.isArray(r.commercial_checks) &&
    r.commercial_checks.length === 0 &&
    Array.isArray(r.candidate_product_ids) &&
    Array.isArray(r.candidate_variation_ids) &&
    Object.hasOwn(r, "product_id") &&
    Object.hasOwn(r, "variation_id") &&
    r.display_only !== true &&
    r.fields.unidad === "PIEZA" &&
    r.fields["(s/n) mostrar en ventas"] === "s" &&
    r.fields["(s/n) inventariable"] === "s" &&
    r.fields["(s/n) precio con impuestos"] === "s" &&
    ["(s/n) granel", "(s/n) receta", "(s/n) lotes"].every(
      (k) => r.fields[k] === "n",
    )
  );
}
// A snapshot-conditional technical proposal. This module has no database client,
// SQL generator, owner-approval field, or authority to apply a price.
export function catalogoPreciosCortePlan(before, after, snapshot, asOf) {
  canonical([before, after, snapshot]);
  if (
    snapshot?.version !== "m9-catalog-price-snapshot-1" ||
    snapshot.project_id !== project ||
    snapshot.mode !== "READ_ONLY_SELECT" ||
    !iso(snapshot.observed_at) ||
    !iso(asOf)
  )
    throw Error("EXPLICIT_STAGING_SNAPSHOT_AND_REVIEW_TIME_REQUIRED");
  const old = index(before),
    fresh = index(after),
    live = index(snapshot.rows);
  const stale =
    Date.parse(asOf) < Date.parse(snapshot.observed_at) ||
    Date.parse(asOf) - Date.parse(snapshot.observed_at) > 15 * 60000;
  const records = [],
    added = [],
    removed = [],
    stockOnly = [];
  for (const barcode of [...new Set([...old.keys(), ...fresh.keys()])].sort()) {
    const os = old.get(barcode) ?? [],
      ns = fresh.get(barcode) ?? [];
    if (!os.length) {
      added.push(barcode);
      continue;
    }
    if (!ns.length) {
      removed.push(barcode);
      continue;
    }
    const o = os[0],
      n = ns[0],
      of = o.fields ?? {},
      nf = n.fields ?? {};
    const fields = [...new Set([...Object.keys(of), ...Object.keys(nf)])]
      .sort()
      .filter((k) => !same(of[k] ?? null, nf[k] ?? null));
    const catalogFields = fields.filter((k) => k !== "existencia");
    const duplicate = os.length !== 1 || ns.length !== 1;
    if (!catalogFields.length && !duplicate) {
      if (fields.length) stockOnly.push(barcode);
      continue;
    }
    const reasons = [],
      lr = live.get(barcode) ?? [],
      l = lr[0];
    if (duplicate) reasons.push("DUPLICATE_SOURCE_CODE");
    if (!sourceValid(o) || !sourceValid(n))
      reasons.push("SOURCE_INCOMPLETE_OR_BLOCKED");
    const oldPrice = publicPriceCents(of.precio1),
      newPrice = publicPriceCents(nf.precio1);
    if (oldPrice === null || newPrice === null)
      reasons.push("INVALID_PUBLIC_PRICE");
    if (!catalogFields.includes("precio1"))
      reasons.push("NO_PUBLIC_PRICE_CHANGE");
    if (catalogFields.some((k) => secondary.has(k)))
      reasons.push("SECONDARY_PRICES_UNDEFINED");
    if (catalogFields.some((k) => k !== "precio1" && !secondary.has(k)))
      reasons.push("DESCRIPTION_IDENTITY_OR_OTHER_CATALOG_CHANGE");
    if (
      o.product_id != null ||
      n.product_id != null ||
      o.variation_id != null ||
      n.variation_id != null ||
      (o.candidate_product_ids ?? []).length ||
      (n.candidate_product_ids ?? []).length ||
      (o.candidate_variation_ids ?? []).length ||
      (n.candidate_variation_ids ?? []).length ||
      l?.woo_product_id != null ||
      l?.woo_variation_id != null
    )
      reasons.push("WOO_CONTEXT_REQUIRES_SEPARATE_REVIEW");
    if (stale) reasons.push("STALE_OR_FUTURE_SNAPSHOT");
    if (lr.length !== 1) reasons.push("MISSING_OR_DUPLICATE_STAGING_ROW");
    else {
      const s = l.source_row;
      if (!liveKeys.every((k) => Object.hasOwn(l, k)))
        reasons.push("INCOMPLETE_STAGING_SNAPSHOT");
      if (
        !uuid.test(l.variant_id) ||
        !uuid.test(l.product_id) ||
        !sha.test(l.source_sha256) ||
        l.barcode_bindings !== 1 ||
        l.barcode_variant_id !== l.variant_id
      )
        reasons.push("CODE_UUID_BINDING_INVALID");
      if (
        !plain(s) ||
        !same(Object.keys(s).sort(), m9Keys) ||
        !plain(l.current_row) ||
        !same(s, l.current_row)
      )
        reasons.push("M9_PROJECTION_DRIFT_OR_INCOMPLETE");
      if (
        !s ||
        s.barcode !== barcode ||
        s.description !== o.description ||
        s.department !== of.departamento ||
        s.section !== of.categoria ||
        s.price_cents !== oldPrice ||
        l.price_cents !== oldPrice ||
        s.cost_cents !== null ||
        l.cost_cents !== null ||
        s.woo_variation_id !== null ||
        !literal(s.family_key) ||
        !literal(s.product_name) ||
        !plain(s.attributes)
      )
        reasons.push("BASELINE_IDENTITY_PRICE_OR_COST_MISMATCH");
    }
    const status = reasons.length
      ? "HELD_FOR_REVIEW"
      : "PUBLIC_PRICE_CANDIDATE_NOT_AUTHORIZED";
    const preconditions =
      l && liveKeys.every((k) => Object.hasOwn(l, k))
        ? Object.fromEntries(liveKeys.map((k) => [k, l[k]]))
        : null;
    records.push({
      barcode,
      description_before: o.description,
      description_after: n.description,
      changed_fields: catalogFields,
      observed_stock_change_excluded: fields.includes("existencia"),
      secondary_price_fields: catalogFields.filter((k) => secondary.has(k)),
      previous_public_cents: oldPrice,
      proposed_public_cents: newPrice,
      status,
      reasons,
      apply_allowed: false,
      owner_approval: null,
      baseline_uuid_evidence: "CURRENT_STAGING_SNAPSHOT_NOT_HISTORICAL_XLSX",
      preconditions,
      preconditions_sha256: preconditions
        ? hash(canonical(preconditions))
        : null,
      source_before_sha256: hash(canonical(o)),
      source_after_sha256: hash(canonical(n)),
    });
  }
  const candidates = records.filter(
    (r) => r.status === "PUBLIC_PRICE_CANDIDATE_NOT_AUTHORIZED",
  );
  const summary = {
    changed_catalog_codes: records.length,
    public_price_only_source_changes: records.filter((r) =>
      same(r.changed_fields, ["precio1"]),
    ).length,
    public_price_baseline_exact_but_woo_held: records.filter(
      (r) =>
        same(r.changed_fields, ["precio1"]) &&
        same(r.reasons, ["WOO_CONTEXT_REQUIRES_SEPARATE_REVIEW"]),
    ).length,
    public_price_only_candidates: candidates.length,
    held: records.length - candidates.length,
    secondary_price_changes: records.filter(
      (r) => r.secondary_price_fields.length,
    ).length,
    identity_or_other_changes: records.filter((r) =>
      r.reasons.includes("DESCRIPTION_IDENTITY_OR_OTHER_CATALOG_CHANGE"),
    ).length,
    added_codes_excluded: added.length,
    removed_codes_excluded: removed.length,
    stock_only_codes_excluded: stockOnly.length,
    authorized_updates: 0,
  };
  return {
    version: "m9-catalog-price-cut-plan-1",
    mode: "READ_ONLY_NOT_AUTHORIZED",
    project_id: project,
    observed_at: snapshot.observed_at,
    reviewed_at: asOf,
    snapshot_stale: stale,
    policy: {
      public_price_source: "SICAR.precio1",
      secondary_prices: "UNDEFINED_NOT_MAPPED",
      inventory_operations: 0,
      cost_operations: 0,
      woo_operations: 0,
      owner_approval_generated: false,
      requires_locked_revalidation_and_rollback: true,
    },
    sources: {
      before_sha256: hash(canonical(before)),
      after_sha256: hash(canonical(after)),
      snapshot_sha256: hash(canonical(snapshot)),
    },
    summary,
    records,
    added_codes_excluded: added,
    removed_codes_excluded: removed,
    stock_only_codes_excluded: stockOnly,
  };
}
async function main() {
  const [oldDir, newDir, snapshotPath, out, asOf] = process.argv.slice(2);
  if (!asOf)
    throw Error(
      "Usage: OLD_REPORT NEW_REPORT SNAPSHOT.json NEW_OUTPUT ISO_REVIEW_TIME",
    );
  const inputHashes = {};
  async function verified(dir, name) {
    const raw = await readFile(resolve(dir, name));
    const sums = JSON.parse(
      await readFile(resolve(dir, "sha256.json"), "utf8"),
    );
    if (hash(raw) !== sums[name]) throw Error("SOURCE_REPORT_HASH_CHANGED");
    inputHashes[resolve(dir, name)] = hash(raw);
    return JSON.parse(raw);
  }
  const before = await verified(oldDir, "filas.json"),
    after = await verified(newDir, "filas.json");
  const oldManifest = await verified(oldDir, "manifest.json"),
    newManifest = await verified(newDir, "manifest.json");
  if (
    ![oldManifest.sicar_sha256, newManifest.sicar_sha256].every((x) =>
      sha.test(x),
    )
  )
    throw Error("SOURCE_MANIFEST_INVALID");
  const rawSnapshot = await readFile(snapshotPath);
  inputHashes[resolve(snapshotPath)] = hash(rawSnapshot);
  const plan = catalogoPreciosCortePlan(
    before,
    after,
    JSON.parse(rawSnapshot),
    asOf,
  );
  plan.source_manifests = {
    previous_sicar_sha256: oldManifest.sicar_sha256,
    current_sicar_sha256: newManifest.sicar_sha256,
    woo_historical_unchanged: oldManifest.woo_sha256 === newManifest.woo_sha256,
    input_files_sha256: inputHashes,
  };
  await mkdir(out, { mode: 0o700 });
  const report = JSON.stringify(plan, null, 2) + "\n";
  await writeFile(resolve(out, "plan.json"), report, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify({ "plan.json": hash(report) }, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(plan.summary));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
