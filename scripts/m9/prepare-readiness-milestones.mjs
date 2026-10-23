import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateMigrationMilestones } from "./readiness-milestones.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const digest = (x) => createHash("sha256").update(x).digest("hex");
const json = (x) => JSON.stringify(x, null, 2) + "\n";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const needed = (ok, code) => {
  if (!ok) throw Error(code);
};
function unwrap(x) {
  if (!x?.content) return x;
  needed(x.isError !== true && x.content.length === 1, "SELECT_TOOL_FAILED");
  const w = JSON.parse(x.content[0].text);
  const m =
    typeof w.result === "string" &&
    w.result.match(/<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/);
  needed(m, "SELECT_RESULT_REQUIRED");
  return JSON.parse(m[1]);
}
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function html(r) {
  const n = (x) => (x === null ? "Sin medir" : x.toLocaleString("es-MX"));
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M9 · Preparación por hitos</title><style>body{font:17px/1.6 system-ui;max-width:1100px;margin:30px auto;padding:0 18px;color:#20313a;background:#f2f0eb}header,section{background:white;border-radius:16px;padding:24px;margin:20px 0}h1,h2{line-height:1.2}.warn{background:#fff1ce;padding:16px;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}.metric{background:#edf3f5;padding:16px;border-radius:12px}.num{font-size:30px;font-weight:750}small{display:block;overflow-wrap:anywhere;color:#51616a}li{margin:8px 0}code{overflow-wrap:anywhere;font-size:.86em}@media(max-width:500px){body{font-size:16px}section,header{padding:18px}}</style><header><h1>Qué está preparado y qué falta para arrancar</h1><p>Medición de staging: ${esc(r.measured_at)}. Consulta privada por hitos, sin datos individuales de clientes.</p><p class="warn">El bloque Preview 0.90 está verificado. Esta medición no autoriza operar ni calcula un porcentaje global o una fecha de entrega: códigos, fotos, campos físicos, documentos y ensayos tienen unidades distintas.</p></header>${r.milestones.map((m) => `<section><h2>${esc(m.title)}</h2><div class="grid">${m.metrics.map((k) => `<article class="metric"><div class="num">${n(k.numerator)}${k.denominator === null ? "" : ` / ${n(k.denominator)}`}</div><b>${esc(k.label)}</b><small>${esc(k.unit)}</small><p>${esc(k.limitation)}</p></article>`).join("")}</div>${m.id === "catalog" ? `<p><b>${r.milestones[0].metrics[0].percent_in_this_scope ?? "Sin medir"}% de presencia de códigos del corte</b>; faltan ${n(r.observations.missing_catalog_codes)} códigos en este alcance. No es el porcentaje de toda la migración.</p>` : ""}<details><summary>Observaciones que no se suman al avance</summary><ul>${m.observations.map((o) => `<li>${esc(o.label)}: <b>${n(o.value)}</b> ${esc(o.unit)}</li>`).join("")}</ul></details><p><b>Bloqueos:</b></p><ul>${m.blockers.map((b) => `<li><code>${esc(b)}</code></li>`).join("")}</ul></section>`).join("")}<section><h2>Próximo paso Woo</h2><p>El archivo Woo completo sigue siendo del ${esc(r.observations.woo_source_date)}. El siguiente ensayo completo necesita proveedor y cuenta sandbox acreditados, un perfil de aislamiento limitado, evidencia de captura independiente, lectura autenticada del pedido completo y adaptación del canal web separado de caja física.</p><p>El código actual bloquea salidas HTTP, gateways, carrito y checkout. El lector financiero sólo admite pedidos sintéticos cancelados. Una firma QA, fecha de pago o cambio de status no acredita una compra.</p><p>No se crearon pedidos ni se activaron compuertas. No habrá un sexto ensayo ni cambio al límite existente en este bloque.</p><p>Consultar el checklist mínimo en <code>docs/M9_PREPARACION_POR_HITOS_Y_PUENTE_SANDBOX.md</code>. <a href="preparacion.json">JSON medible</a> · <a href="manifest.json">Hashes y fuentes</a></p></section></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--verify") {
    const out = resolve(args[1]);
    const m = JSON.parse(await readFile(resolve(out, "manifest.json")));
    needed(
      m.protocol === "m9-readiness-package-hashes-1" &&
        m.operational_authorization === false,
      "READINESS_MANIFEST_REQUIRED",
    );
    for (const [name, sha] of Object.entries(m.files)) {
      needed(
        !name.includes("..") && !name.startsWith("/"),
        "RELATIVE_OUTPUT_REQUIRED",
      );
      needed(
        digest(await readFile(resolve(out, name))) === sha,
        "OUTPUT_HASH_CHANGED",
      );
    }
    for (const [path, sha] of Object.entries(m.inputs))
      needed(digest(await readFile(path)) === sha, "INPUT_HASH_CHANGED");
    console.log(
      json({
        protocol: "m9-readiness-package-verification-1",
        verified_output_files: Object.keys(m.files).length,
        verified_inputs: Object.keys(m.inputs).length,
        no_network: true,
        database_operations: 0,
        files_written: 0,
        operational_authorization: false,
      }),
    );
    return;
  }
  const [
    closureDirRaw,
    coverageDirRaw,
    measurementRaw,
    outRaw,
    asOf,
    measurementAuditPath,
    codesFile = "codigos-staging.json",
    coverageFile = "cobertura.json",
  ] = args;
  needed(
    asOf,
    "Usage: CLOSURE_DIR COVERAGE_DIR MEASUREMENT.json NEW_OUTPUT ISO_REVIEW_TIME; or --verify OUTPUT",
  );
  const closureDir = resolve(closureDirRaw),
    coverageDir = resolve(coverageDirRaw),
    measurementPath = resolve(measurementRaw),
    out = resolve(outRaw);
  const hashes = {};
  async function read(path) {
    const raw = await readFile(path);
    hashes[path] = digest(raw);
    return raw;
  }
  async function parse(path) {
    return JSON.parse(await read(path));
  }
  const closureManifest = await parse(resolve(closureDir, "manifest.json"));
  needed(
    closureManifest.protocol === "m9-block3-final-hashes-1" &&
      closureManifest.operational_authorization === false,
    "FINAL_CLOSURE_HASHES_REQUIRED",
  );
  for (const [name, sha] of Object.entries(closureManifest.files)) {
    needed(
      !name.includes("..") && !name.startsWith("/"),
      "RELATIVE_CLOSURE_FILE_REQUIRED",
    );
    needed(
      digest(await read(resolve(closureDir, name))) === sha,
      "CLOSURE_HASH_CHANGED",
    );
  }
  needed(
    digest(await read(resolve(closureDir, "verificar-bloque.mjs"))) ===
      closureManifest.verifier_sha256,
    "CLOSURE_VERIFIER_CHANGED",
  );
  const sourceMetadata = await parse(resolve(closureDir, "fuente-sicar.json"));
  needed(
    digest(await read(sourceMetadata.source)) === sourceMetadata.sha256,
    "ORIGINAL_SICAR_CHANGED",
  );
  const sourceRows = await parse(
    resolve(closureDir, "conciliacion-1/filas.json"),
  );
  const coverage = await parse(resolve(coverageDir, coverageFile)),
    stagingCodes = await parse(resolve(coverageDir, codesFile));
  const measurement = await parse(measurementPath);
  const suffix = measurementPath.includes("-3.json") ? "3" : "2";
  const rawTool = unwrap(
    await parse(
      resolve(dirname(measurementPath), `staging-tool-response-${suffix}.json`),
    ),
  );
  needed(
    rawTool.length === 1 && same(rawTool[0].measurement, measurement),
    "MEASUREMENT_NOT_TOOL_RESULT",
  );
  await read(resolve(dirname(measurementPath), `staging-read-${suffix}.sql`));
  const auditRaw = unwrap(
    await parse(resolve(closureDir, "block3_audit_after_ui.json")),
  );
  const closureAudit = auditRaw[0].audit;
  const measurementAudit = measurementAuditPath
    ? unwrap(await parse(resolve(measurementAuditPath)))[0].audit
    : closureAudit;
  const closureVerification = await parse(
    resolve(closureDir, "verificacion-final.json"),
  );
  const code = async (path) => (await read(resolve(root, path))).toString();
  const guard = await code("scripts/m9/woo-remote/m9-test-isolation.php");
  const financeReader = await code("scripts/m9/woo-remote/finance-read.mjs");
  const receiver = await code("scripts/m9/woo-sandbox-auth-quarantine.mjs");
  const native = await code(
    "supabase/migrations/20261022203711_m9_woo_native_finance_atomic_pilot.sql",
  );
  const webBook = await code("scripts/m9/woo-web-settlement.sql");
  needed(
    /pre_http_request[\s\S]*?m9_test_outbound_blocked/.test(guard) &&
      /woocommerce_available_payment_gateways', '__return_empty_array'/.test(
        guard,
      ) &&
      /woocommerce_add_to_cart_validation', '__return_false'/.test(guard) &&
      /woocommerce_is_purchasable', '__return_false'/.test(guard),
    "ISOLATION_CONTRACT_CHANGED",
  );
  needed(
    financeReader.includes('reference.status !== "cancelled"') &&
      financeReader.includes('s.payment.method !== "m9_synthetic_no_payment"'),
    "SYNTHETIC_FINANCE_READER_CHANGED",
  );
  needed(
    receiver.includes("enabled: false") &&
      receiver.includes("accredited_providers: Object.freeze([])") &&
      receiver.includes("SANDBOX_PROVIDER_NOT_ACCREDITED_RECEIVER_DISABLED"),
    "PROVIDER_RECEIVER_CHANGED",
  );
  needed(
    native.includes("gateway_mode='SYNTHETIC_TEST_ONLY'") &&
      webBook.includes("SYNTHETIC_TEST_ONLY"),
    "SYNTHETIC_MONEY_MODES_CHANGED",
  );
  const connector = {
    protocol: "m9-sandbox-code-gap-evidence-1",
    observation_scope: "REPOSITORY_CONTRACT_NOT_REMOTE_PLUGIN_ATTESTATION",
    test_origin: "https://salmon-nightingale-251188.hostingersite.com",
    global_outbound_blocked: true,
    available_gateways_forced_empty: true,
    public_checkout_blocked: true,
    financial_reader_scope: "CANCELLED_SYNTHETIC_ONLY",
    provider_receiver_enabled: false,
    accredited_providers: 0,
    native_money_mode: "SYNTHETIC_TEST_ONLY",
  };
  const result = evaluateMigrationMilestones({
    sourceRows,
    stagingCodes,
    sourceMetadata,
    coverage,
    measurement,
    closureAudit,
    measurementAudit,
    closureVerification,
    connector,
    asOf,
  });
  await read(resolve(root, "scripts/m9/readiness-milestones.mjs"));
  await read(fileURLToPath(import.meta.url));
  await read(
    resolve(root, "docs/M9_PREPARACION_POR_HITOS_Y_PUENTE_SANDBOX.md"),
  );
  const files = {
    "preparacion.json": json(result),
    "reporte.html": html(result),
    "connector-code-evidence.json": json(connector),
  };
  await mkdir(out, { mode: 0o700 });
  for (const [name, raw] of Object.entries(files))
    await writeFile(resolve(out, name), raw, { flag: "wx", mode: 0o600 });
  await writeFile(
    resolve(out, "manifest.json"),
    json({
      protocol: "m9-readiness-package-hashes-1",
      operational_authorization: false,
      sources_are_snapshots_not_execution_permission: true,
      inputs: hashes,
      files: Object.fromEntries(
        Object.entries(files).map(([k, raw]) => [k, digest(raw)]),
      ),
    }),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    json({
      global_percent: result.global_percent,
      estimated_delivery_at: result.estimated_delivery_at,
      metrics: result.milestones.flatMap((m) =>
        m.metrics.map((k) => ({
          id: k.id,
          numerator: k.numerator,
          denominator: k.denominator,
          unit: k.unit,
        })),
      ),
      operational_authorization: false,
    }),
  );
}
await main();
