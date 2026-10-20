import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { quoteDoText } from "./sql-literal.mjs";
const sha = (v) => createHash("sha256").update(v).digest("hex");
export async function prepareLegacyPilot(configPath, out) {
  const path = resolve(configPath),
    config = JSON.parse(await readFile(path)),
    data = {},
    pins = {};
  for (const k of ["source_plan", "destination", "observations", "pilot"]) {
    const p = config.inputs?.[k];
    if (!p?.path || !/^[a-f0-9]{64}$/.test(p.sha256 ?? ""))
      throw Error("PIN_REQUIRED:" + k);
    const raw = await readFile(resolve(dirname(path), p.path));
    if (sha(raw) !== p.sha256) throw Error("INPUT_CHANGED:" + k);
    data[k] = JSON.parse(raw);
    pins[k] = p.sha256;
  }
  const { source_plan: plan, destination, observations, pilot } = data;
  if (
    plan.project_id !== "zsezjtswqeijboezvado" ||
    plan.scope !== "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS" ||
    plan.customers.length !== 61 ||
    pins.source_plan !== destination.batch ||
    pins.observations !== destination.source_file_sha256 ||
    config.request_id !== destination.request ||
    pilot.barcodes.length !== 12 ||
    destination.pilot.length !== 12 ||
    new Set(destination.pilot.map((r) => r.barcode)).size !== 12 ||
    !Number.isFinite(Date.parse(config.assessment_at)) ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(
      config.actor_id ?? "",
    ) ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(
      config.request_id ?? "",
    )
  )
    throw Error("STAGING_REGISTRY_CONTEXT_REQUIRED");
  const rows = destination.pilot.map((r) => {
    const found = observations.filter((o) => o.barcode === r.barcode);
    if (found.length !== 1 || !pilot.barcodes.includes(r.barcode))
      throw Error("EXACT_PILOT_OBSERVATION_REQUIRED");
    const o = found[0],
      m = /^ALMACENES\s+(\d+) PZA$/.exec(o.observed_label ?? "");
    if (
      !m ||
      !Number.isFinite(Date.parse(o.captured_at)) ||
      Date.parse(o.captured_at) > Date.parse(config.assessment_at) ||
      Date.parse(config.assessment_at) - Date.parse(o.captured_at) > 86400000
    )
      throw Error("FRESH_SOURCE_OBSERVATION_REQUIRED");
    if (
      r.observed_qty !== m[1] ||
      r.observed_at !== o.captured_at ||
      !/^[a-f0-9]{64}$/.test(r.evidence_sha256 ?? "")
    )
      throw Error("REGISTERED_OBSERVATION_CHANGED");
    return {
      ...r,
      observed_qty: m[1],
      observed_at: o.captured_at,
      evidence_sha256: r.evidence_sha256,
    };
  });
  const q = (s) => quoteDoText(s, "$seed$");
  const sql = `begin;\nset local statement_timeout='120s';\nset local request.jwt.claim.sub=${q(config.actor_id)};\nselect app.m9_register_legacy_pilot(${q(config.request_id)},${q(destination.batch)},${q(JSON.stringify(rows))}::jsonb) as result;\nrollback;\n`;
  const summary = {
    scope: plan.scope,
    legacy_accounts: 61,
    pilot_codes: 12,
    source_observed_qty: rows.reduce((n, r) => n + Number(r.observed_qty), 0),
    physical_qty: null,
    native_customers_created: 0,
    operational_credit_opened: 0,
    inventory_import_allowed: false,
    production_allowed: false,
  };
  const files = {
    "semilla.json":
      JSON.stringify({ rows, summary, inputs: pins }, null, 2) + "\n",
    "ensayo-rollback.sql": sql,
    "resumen.json": JSON.stringify(summary, null, 2) + "\n",
  };
  await mkdir(out, { mode: 0o700 });
  for (const [n, v] of Object.entries(files))
    await writeFile(resolve(out, n), v, { mode: 0o600, flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([n, v]) => [n, sha(v)])),
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT_DIR");
  console.log(await prepareLegacyPilot(...process.argv.slice(2)));
}
