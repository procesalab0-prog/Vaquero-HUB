// Offline report runner. No remote reads, writes, SQL or payment execution.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  paymentDocumentSha256,
  reviewWooPaymentCandidate,
} from "./woo-payment-eligibility.mjs";

const sha = (x) => createHash("sha256").update(x).digest("hex");
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join("|") === [...keys].sort().join("|");

export function buildWooPaymentReport(bundle) {
  if (
    !exact(bundle, ["protocol", "operational_import_allowed", "cases"]) ||
    bundle.protocol !== "m9-woo-payment-review-batch-1" ||
    bundle.operational_import_allowed !== false ||
    !Array.isArray(bundle.cases) ||
    !bundle.cases.length ||
    bundle.cases.length > 500
  )
    throw Error("PAYMENT_REVIEW_BATCH_INVALID");
  const keys = new Set();
  const cases = bundle.cases.map((c) => {
    if (
      !exact(c, ["key", "input"]) ||
      typeof c.key !== "string" ||
      !/^[a-z0-9:_-]{1,80}$/.test(c.key) ||
      keys.has(c.key)
    )
      throw Error("PAYMENT_REVIEW_CASE_INVALID");
    keys.add(c.key);
    return { key: c.key, result: reviewWooPaymentCandidate(c.input) };
  });
  const references = new Map(),
    orders = new Map();
  bundle.cases.forEach((c, index) => {
    const e = c.input?.evidence;
    if (
      !e ||
      ![e.provider, e.account_id, e.reference].every(
        (s) => typeof s === "string" && s.length > 0 && s.length <= 160,
      )
    )
      return;
    const key = JSON.stringify([e.provider, e.account_id, e.reference]);
    if (!references.has(key)) references.set(key, []);
    references.get(key).push(index);
    if (e.action === "PAYMENT" && Number.isSafeInteger(e.order_id)) {
      const order = JSON.stringify([
        e.provider,
        e.account_id,
        e.origin,
        e.order_id,
      ]);
      if (!orders.has(order)) orders.set(order, []);
      orders.get(order).push(index);
    }
  });
  const hold = (indices, reason) => {
    for (const index of indices) {
      cases[index].result.disposition = "HOLD";
      cases[index].result.reasons = [
        ...new Set([...cases[index].result.reasons, reason]),
      ].sort();
    }
  };
  for (const indices of references.values())
    if (indices.length > 1)
      hold(indices, "PAYMENT_REFERENCE_DUPLICATED_IN_BATCH");
  for (const indices of orders.values())
    if (indices.length > 1) hold(indices, "PAYMENT_MULTIPLE_CAPTURES_IN_BATCH");
  const counts = {};
  for (const c of cases)
    counts[c.result.disposition] = (counts[c.result.disposition] ?? 0) + 1;
  return {
    protocol: "m9-woo-payment-review-report-1",
    input_sha256: paymentDocumentSha256(bundle),
    operational_import_allowed: false,
    source_documents_authenticated: false,
    remote_orders_created: 0,
    gateway_payments_executed: 0,
    native_sales_authorized: 0,
    stock_commands_generated: 0,
    total_cases: cases.length,
    classifications: counts,
    cases,
  };
}

const esc = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
export function renderWooPaymentReport(report) {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M9 · Elegibilidad de pagos Woo</title><style>body{font:16px/1.5 system-ui;max-width:1000px;padding:24px;margin:auto;background:#f5f2eb;color:#173042}section{background:white;border:1px solid #c9c3b5;padding:20px;margin:16px 0;border-radius:12px}code{overflow-wrap:anywhere}li{margin:8px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #ddd;padding:8px}h1,h2{line-height:1.2}</style><h1>Revisión de pagos Woo · sólo lectura</h1><p>Este reporte revisa documentos locales. <strong>No autentica un proveedor ni autoriza ventas, cobros o inventario.</strong></p><section><strong>${esc(report.total_cases)} casos revisados · 0 ventas autorizadas</strong><p>0 pedidos creados, 0 pagos ejecutados y 0 comandos de inventario.</p><p>Que un pedido diga pagado, tenga fecha o referencia no acredita liquidación. La pasarela autenticada y la nueva validación atómica del servidor siguen pendientes.</p></section>${report.cases
    .map(
      (c) =>
        `<section><h2>${esc(c.key)} · ${esc(c.result.disposition)}</h2><ul>${c.result.reasons.map((r) => `<li>${esc(r)}</li>`).join("") || "<li>Consistencia documental apta para diseñar el siguiente ensayo; falta autenticar las fuentes.</li>"}</ul>${
          c.result.components_cents
            ? `<table><caption>Importes conservados en centavos MXN</caption><tbody>${Object.entries(
                c.result.components_cents,
              )
                .map(
                  ([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`,
                )
                .join("")}</tbody></table>`
            : ""
        }<p>Siguiente compuerta: <code>${esc(c.result.next_gate)}</code></p></section>`,
    )
    .join(
      "",
    )}<p>Huella de entrada: <code>${esc(report.input_sha256)}</code>. Los documentos originales permanecen en su ubicación de origen; no se copian datos de comprador al reporte.</p></html>\n`;
}

const verifier = `import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));
if(manifest.protocol!=='m9-woo-payment-report-manifest-1'||Object.keys(manifest.files??{}).sort().join('|')!=='reporte.html|reporte.json')throw Error('INVALID_MANIFEST');
for(const [name,wanted]of Object.entries(manifest.files)){
 if(!['reporte.json','reporte.html'].includes(name))throw Error('UNEXPECTED_MANIFEST_PATH');
 const got=createHash('sha256').update(await readFile(new URL('./'+name,import.meta.url))).digest('hex');
 if(got!==wanted)throw Error('PAYMENT_REPORT_HASH_CHANGED:'+name);
}
console.log('PASS: reporte de sólo lectura íntegro; no certifica fuentes ni pago.');
`;
export async function runWooPaymentReport(argv) {
  if (argv.length !== 4 || argv[0] !== "--input" || argv[2] !== "--output")
    throw Error(
      "Usage: node scripts/m9/woo-payment-report.mjs --input <batch.json> --output <new-private-directory>",
    );
  const bytes = await readFile(resolve(argv[1]));
  if (bytes.length > 4194304) throw Error("PAYMENT_REVIEW_INPUT_TOO_LARGE");
  const report = buildWooPaymentReport(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  const output = resolve(argv[3]);
  // Never overwrite a prior report. Raw input is not copied to the output.
  await mkdir(output, { mode: 0o700 });
  const files = {
    "reporte.json": JSON.stringify(report, null, 2) + "\n",
    "reporte.html": renderWooPaymentReport(report),
  };
  for (const [name, contents] of Object.entries(files))
    await writeFile(resolve(output, name), contents, {
      mode: 0o600,
      flag: "wx",
    });
  await writeFile(
    resolve(output, "manifest.json"),
    JSON.stringify(
      {
        protocol: "m9-woo-payment-report-manifest-1",
        input_file_sha256: sha(bytes),
        files: Object.fromEntries(
          Object.entries(files).map(([name, body]) => [name, sha(body)]),
        ),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(resolve(output, "verificar.mjs"), verifier, {
    mode: 0o600,
    flag: "wx",
  });
  return { output, cases: report.total_cases, native_sales_authorized: 0 };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runWooPaymentReport(process.argv.slice(2)).then(
    (r) => console.log(JSON.stringify(r)),
    (e) => {
      console.error(e.message);
      process.exitCode = 1;
    },
  );
}
