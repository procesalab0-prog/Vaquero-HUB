import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { authorizeRule, digest } from "./acceleration.mjs";

const PROJECT = "zsezjtswqeijboezvado";
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const code = (s) =>
  typeof s === "string" && s.length > 0 && s.length <= 80 && s === s.trim();
const uuid = (s) =>
  typeof s === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(s);
const time = (s) =>
  typeof s === "string" &&
  /T.*(?:Z|[+-]\d\d:\d\d)$/.test(s) &&
  Number.isFinite(Date.parse(s));
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function cents(s) {
  if (typeof s !== "string" || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const n = BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
  return n > 0n && n <= 100000000n ? Number(n) : null;
}
const counts = (rows, key) =>
  Object.fromEntries(
    [...new Set(rows.map((r) => r[key]))]
      .sort(compare)
      .map((k) => [k, rows.filter((r) => r[key] === k).length]),
  );

// Planning only. There is deliberately no database client, SQL writer, stock
// quantity default or production switch. Historical review is not a live lease.
export function planPhasedLaunch({
  rows,
  snapshot,
  ruleCohort,
  ruleAuthorization,
  sourceCut,
  asOf,
  batchSize = 250,
}) {
  if (
    snapshot?.project_id !== PROJECT ||
    !Array.isArray(snapshot.rows) ||
    snapshot.managed_count !== snapshot.rows.length
  )
    throw Error("COMPLETE_STAGING_SNAPSHOT_REQUIRED");
  if (
    !time(asOf) ||
    !time(snapshot.captured_at) ||
    Date.parse(snapshot.captured_at) > Date.parse(asOf) ||
    Date.parse(asOf) - Date.parse(snapshot.captured_at) > 86400000
  )
    throw Error("RECENT_PINNED_SNAPSHOT_REQUIRED");
  if (
    !snapshot.control?.enabled ||
    !/^[a-f0-9]{64}$/.test(snapshot.control.review_sha256 ?? "") ||
    !time(snapshot.control.expires_at)
  )
    throw Error("ENABLED_GUARD_REQUIRED_NEVER_DISABLE_TO_START");
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 500
  )
    throw Error("SOURCE_AND_BATCH_SCOPE_REQUIRED");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(sourceCut?.sicar_date ?? "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(sourceCut?.woo_date ?? "") ||
    !/^[a-f0-9]{64}$/.test(sourceCut.sicar_sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(sourceCut.woo_sha256 ?? "") ||
    Date.parse(sourceCut.sicar_date) > Date.parse(asOf) ||
    Date.parse(sourceCut.woo_date) > Date.parse(asOf)
  )
    throw Error("DATED_SOURCE_CUT_REQUIRED");
  // Re-verify the historical rule and sample; never promote it into an owner answer.
  authorizeRule(
    ruleCohort,
    ruleAuthorization.authorization,
    ruleAuthorization.sampleReview,
  );
  if (
    ruleCohort.source_sha256 !== sourceCut.sicar_sha256 ||
    ruleCohort.source_rows_sha256 !== digest(rows)
  )
    throw Error("RULE_SOURCE_CUT_CHANGED");
  const rule = new Map();
  for (const f of ruleCohort.eligible)
    for (const m of f.members) {
      if (rule.has(m.barcode)) throw Error("DUPLICATE_RULE_CODE");
      rule.set(m.barcode, {
        family: f.case_id,
        name: f.product_name_proposed,
        size: m.proposed.suffix,
      });
    }
  const source = new Map(),
    staged = new Map(),
    ids = new Set();
  for (const r of rows) {
    if (
      !code(r.barcode) ||
      source.has(r.barcode) ||
      r.fields?.["clave1 *"] !== r.barcode ||
      r.description !== r.fields?.["descripción *"]
    )
      throw Error("SOURCE_LITERAL_IDENTITY_CHANGED");
    source.set(r.barcode, r);
  }
  for (const r of snapshot.rows) {
    if (
      !code(r.barcode) ||
      staged.has(r.barcode) ||
      !uuid(r.variant_id) ||
      ids.has(r.variant_id) ||
      !uuid(r.product_id) ||
      !r.current
    )
      throw Error("STAGING_IDENTITY_SCOPE_INVALID");
    staged.set(r.barcode, r);
    ids.add(r.variant_id);
  }
  const ledger = [];
  for (const barcode of [...source.keys()].sort(compare)) {
    const s = source.get(barcode),
      r = staged.get(barcode),
      reasons = [];
    const f = s.fields,
      price = cents(f.precio1),
      binding = rule.get(barcode);
    if (!r) reasons.push("NOT_LOADED_REVIEW_REQUIRED");
    if (price === null) reasons.push("PUBLIC_PRICE_INVALID");
    if (
      s.display_only ||
      /MUESTRA/i.test(s.description) ||
      f["(s/n) mostrar en ventas"] !== "s"
    )
      reasons.push("DISPLAY_OR_SALES_RESTRICTION");
    if (
      [f.departamento, f.categoria].some(
        (v) =>
          typeof v !== "string" ||
          !v.trim() ||
          /^(D1|C1|\.|SIN DEFINIR)$/i.test(v),
      )
    )
      reasons.push("TAXONOMY_REVIEW");
    if (
      f.unidad !== "PIEZA" ||
      f["(s/n) inventariable"] !== "s" ||
      ["(s/n) granel", "(s/n) receta", "(s/n) lotes"].some((k) => f[k] !== "n")
    )
      reasons.push("OPERATING_MODE_REVIEW");
    if (r) {
      const c = r.current;
      for (const [key, expected] of Object.entries({
        barcode,
        description: s.description,
        department: f.departamento,
        section: f.categoria,
        price_cents: price,
      }))
        if (c[key] !== expected) reasons.push("SOURCE_DESTINATION_DIFF:" + key);
      if (!r.stored_matches) reasons.push("DESTINATION_EDIT_REVIEW");
      if (!r.barcode_matches) reasons.push("LITERAL_BARCODE_NOT_BOUND");
      if (!r.is_active) reasons.push("INACTIVE_NO_REACTIVATION");
      if (r.unit_code !== "PIECE") reasons.push("UNIT_REVIEW");
      if (c.cost_cents !== null) reasons.push("COST_REVIEW_NO_OVERWRITE");
      if (r.allowlisted && !r.review_matches)
        reasons.push("HISTORICAL_REVIEW_CHANGED");
      if (
        r.provisional &&
        (r.provisional !== "PROVISIONAL" ||
          r.web_release ||
          c.woo_product_id ||
          c.woo_variation_id)
      )
        reasons.push("PROVISIONAL_WEB_OR_GROUPING_REVIEW");
      if (
        binding &&
        (c.product_name !== binding.name ||
          c.attributes?.TALLA !== binding.size ||
          Object.keys(c.attributes ?? {}).length !== 1)
      )
        reasons.push("RULE_DESTINATION_CHANGED");
      if (!r.allowlisted && !binding && !r.provisional)
        reasons.push("NO_REVIEW_AUTHORITY");
    }
    let stage = "HELD";
    if (!reasons.length)
      stage = r.allowlisted ? "REVIEWED" : binding ? "RULE_T" : "PROVISIONAL";
    ledger.push({
      barcode,
      variant_id: r?.variant_id ?? null,
      product_id: r?.product_id ?? null,
      description: s.description,
      department: f.departamento,
      section: f.categoria,
      public_price_cents: price,
      unknown_cost_cents: null,
      stage,
      reasons,
      rule_family: binding?.family ?? null,
      candidate_for_staging_rehearsal: stage !== "HELD",
      live_sale_authorized: false,
      woo_release_authorized: false,
      stock_quantity: null,
    });
  }
  // A rule must still be complete at the destination; do not release siblings
  // around a changed/missing member. Already reviewed rows keep their own scope.
  const byCode = new Map(ledger.map((r) => [r.barcode, r]));
  for (const f of ruleCohort.eligible)
    if (
      f.members.some(
        (m) =>
          !byCode.has(m.barcode) || byCode.get(m.barcode).stage !== "RULE_T",
      )
    )
      for (const m of f.members) {
        const r = byCode.get(m.barcode);
        if (r?.stage === "RULE_T") {
          r.stage = "HELD";
          r.reasons.push("RULE_FAMILY_NOT_READY");
          r.candidate_for_staging_rehearsal = false;
        }
      }
  const orphans = snapshot.rows
    .filter((r) => !source.has(r.barcode))
    .map((r) => ({
      barcode: r.barcode,
      variant_id: r.variant_id,
      state: "ABSENT_SOURCE_KEEP_AND_REVIEW",
      delete_allowed: false,
    }));
  const stages = ["REVIEWED", "RULE_T", "PROVISIONAL"].map((stage, i) => {
    const members = ledger.filter((r) => r.stage === stage),
      batches = [];
    for (let off = 0; off < members.length; off += batchSize) {
      const codes = members
        .slice(off, off + batchSize)
        .map(({ barcode, variant_id, product_id }) => ({
          barcode,
          variant_id,
          product_id,
        }));
      batches.push({
        index: batches.length + 1,
        count: codes.length,
        identity_sha256: digest(codes),
        codes,
        activation_allowed: false,
      });
    }
    return {
      order: i + 1,
      stage,
      count: members.length,
      batches,
      depends_on: i
        ? ["PREVIOUS_STAGE_ACCEPTED_WITH_REAL_STOCK"]
        : ["REFRESHED_CUT_AND_VERIFIED_STOCK"],
      web_release: false,
      activation_allowed: false,
    };
  });
  const locations = snapshot.locations.filter(
    (l) => l.is_active && l.type === "STORE",
  );
  if (
    !locations.length ||
    locations.some((l) => !uuid(l.id)) ||
    new Set(locations.map((l) => l.id)).size !== locations.length
  )
    throw Error("STORE_SCOPE_REQUIRED");
  const stockTemplate = {
    mode: "REVIEW_TEMPLATE_NOT_IMPORTABLE",
    missing_means_zero: false,
    location_scope_complete: false,
    all_sicar_locations_must_be_confirmed: true,
    rows: locations.flatMap((l) =>
      ledger
        .filter((r) => r.stage !== "HELD")
        .map((r) => ({
          barcode: r.barcode,
          variant_id: r.variant_id,
          location_id: l.id,
          location_name: l.name,
          measure_unit: "PIECE",
          quantity: null,
          reserved_quantity: null,
          counted_at: null,
          evidence_sha256: null,
          reviewer: null,
          import_allowed: false,
        })),
    ),
  };
  const leaseCurrent =
    Date.parse(snapshot.control.expires_at) > Date.parse(asOf);
  const gates = [
    "FRESH_COMPLETE_SICAR_AND_AUTHENTICATED_WOO_CUT",
    "ALL_LOCATIONS_AND_RESERVED_STOCK_RECONCILED",
    "OWNERS_APPROVE_STAGE_SCOPE",
    "BACKUP_AND_RESTORE_OF_TARGET_VERIFIED",
    "STAGING_ACCEPTANCE_WITH_STAGE_ALLOWLIST",
    "RECHECK_DESTINATION_AND_CONCURRENT_OPERATIONS",
    "EXPLICIT_PRODUCTION_CUT_AUTHORIZATION",
  ];
  return {
    version: "m9-phased-launch-1",
    mode: "OFFLINE_READ_ONLY",
    project_id: PROJECT,
    as_of: asOf,
    source_cut: sourceCut,
    snapshot_captured_at: snapshot.captured_at,
    production_allowed: false,
    automatic_import_allowed: false,
    woo_writes_allowed: false,
    archive_allowed: false,
    inventory_included: false,
    review_lease_current: leaseCurrent,
    guard_must_remain_enabled: true,
    ledger_history_must_be_preserved: true,
    operational_baseline: snapshot.operational,
    summary: {
      source_codes: ledger.length,
      staged_codes: snapshot.rows.length,
      candidate_codes: ledger.filter((r) => r.stage !== "HELD").length,
      held_codes: ledger.filter((r) => r.stage === "HELD").length,
      held_loaded: ledger.filter((r) => r.stage === "HELD" && r.variant_id)
        .length,
      not_loaded: ledger.filter((r) => !r.variant_id).length,
      orphan_staged_codes: orphans.length,
      stages: counts(ledger, "stage"),
      stock_quantities_provided: 0,
      stock_template_rows: stockTemplate.rows.length,
    },
    gates,
    stages,
    ledger,
    orphans,
    stock_template: stockTemplate,
  };
}

export async function preparePhasedLaunch(configPath, out) {
  const config = JSON.parse(await readFile(configPath)),
    inputs = {},
    data = {},
    base = dirname(resolve(configPath));
  for (const name of [
    "rows",
    "snapshot",
    "ruleCohort",
    "ruleAuthorization",
    "manifest",
  ]) {
    const p = config.inputs?.[name];
    if (!p || !/^[a-f0-9]{64}$/.test(p.sha256))
      throw Error("PINNED_INPUT_REQUIRED:" + name);
    const raw = await readFile(resolve(base, p.path));
    if (sha(raw) !== p.sha256) throw Error("INPUT_CHANGED:" + name);
    inputs[name] = { sha256: p.sha256 };
    data[name] = JSON.parse(raw);
  }
  if (
    data.manifest.sicar_sha256 !== config.sourceCut?.sicar_sha256 ||
    data.manifest.woo_sha256 !== config.sourceCut?.woo_sha256
  )
    throw Error("MANIFEST_CUT_MISMATCH");
  const plan = planPhasedLaunch({
    ...data,
    sourceCut: config.sourceCut,
    asOf: config.asOf,
    batchSize: config.batchSize,
  });
  plan.inputs = inputs;
  const stock = plan.stock_template;
  delete plan.stock_template;
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arranque por etapas M9</title><style>body{font:17px system-ui;max-width:1050px;margin:32px auto;padding:18px;background:#f3f0e8;color:#182c35}section{background:white;padding:20px;margin:16px 0;border-radius:12px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:9px;border-bottom:1px solid #ccc}code{overflow-wrap:anywhere}strong{color:#744817}</style><h1>Arranque por etapas</h1><p>Preparación con el corte SICAR ${escape(config.sourceCut.sicar_date)}. No activa ventas ni importa existencias. Producción sin cambios.</p><section><h2>Lo que podemos preparar</h2><p>${plan.summary.source_codes} códigos revisados. ${plan.summary.candidate_codes} candidatos a ensayo y ${plan.summary.held_codes} retenidos. Tener catálogo cargado no equivale a autorización de venta.</p><table><tr><th>Etapa</th><th>Códigos</th><th>Lotes</th></tr>${plan.stages.map((s) => `<tr><td>${escape({ REVIEWED: "1 · Revisión anterior conservada", RULE_T: "2 · Regla técnica de tallas", PROVISIONAL: "3 · Provisionales por código" }[s.stage])}</td><td>${s.count}</td><td>${s.batches.length}</td></tr>`).join("")}</table><p>Cada lote conserva el código de barras literal y variant_id; no modifica agrupaciones. Los provisionales no se envían a Woo.</p></section><section><h2>Antes de cobrar de verdad</h2><ol><li>Renovar SICAR y Woo completos del mismo corte; repetir comparación sin borrar ausentes.</li><li>Confirmar sucursales, existencias y reservas. La plantilla deja cantidades vacías: vacío no significa cero.</li><li>Elegir el primer alcance y ensayarlo con lista autorizada vigente; después comprobar búsqueda, cobro, devolución y saldos.</li><li>Verificar respaldo y recuperación del destino, momento del corte y autorización de producción.</li></ol><p>El historial de staging se conserva: ${snapshotText(plan.operational_baseline)}. La revisión de venta estaba ${plan.review_lease_current ? "vigente" : "vencida"} al capturar; no se renovó ni deshabilitó.</p></section><section><h2>Pendientes, separados del arranque</h2><p>${plan.summary.held_loaded} retenidos ya cargados y ${plan.summary.not_loaded} sin cargar; no aparecen en los lotes de ensayo. No se archiva por falta de ventas o stock sin reportes completos.</p><details><summary>Ejemplos de los primeros 12 pendientes</summary>${plan.ledger
    .filter((r) => r.stage === "HELD")
    .slice(0, 12)
    .map(
      (r) =>
        `<p><code>${escape(r.barcode)}</code> · ${escape(r.description)}<br>${r.reasons.map(escape).join(", ")}</p>`,
    )
    .join(
      "",
    )}</details><p>Detalle completo en plan.json y pendientes.json; plantilla-existencias.json no es un archivo de importación.</p></section></html>`;
  const files = {
    "plan.json": json(plan),
    "resumen.json": json(plan.summary),
    "pendientes.json": json(plan.ledger.filter((r) => r.stage === "HELD")),
    "lotes.json": json(plan.stages),
    "plantilla-existencias.json": json(stock),
    "reporte.html": html,
  };
  await mkdir(out);
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(out, name), value, { flag: "wx" });
  await writeFile(
    resolve(out, "sha256.json"),
    json(
      Object.fromEntries(Object.entries(files).map(([n, v]) => [n, sha(v)])),
    ),
    { flag: "wx" },
  );
  return plan.summary;
}
function snapshotText(o) {
  return `${escape(o.sales)} ventas, ${escape(o.returns)} devoluciones y ${escape(o.inventory_movements)} movimientos de inventario`;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT_DIR");
  console.log(await preparePhasedLaunch(...process.argv.slice(2)));
}
