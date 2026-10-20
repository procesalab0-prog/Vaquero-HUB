import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { reconcileCustomers } from "../../lib/customer-reconciliation.ts";
import { mxnCents, parseLinkedAbonos } from "./prepare-customer-credit.mjs";
const sha = (v) => createHash("sha256").update(v).digest("hex");
export function validateRenewedOpenAccounts(plan, accounts, details, at) {
  const expectedCustomers = plan.customers.filter((c) => c.used_cents > 0);
  const expectedDocs = plan.documents.filter(
    (d) => d.financial_status === "OPEN",
  );
  const fresh = (s) =>
    Number.isFinite(Date.parse(s)) &&
    Date.parse(s) <= Date.parse(at) &&
    Date.parse(at) - Date.parse(s) <= 86400000;
  if (
    !Number.isFinite(Date.parse(at)) ||
    accounts.length !== expectedCustomers.length ||
    details.length !== expectedDocs.length ||
    new Set(accounts.map((a) => a.client_ref)).size !== accounts.length ||
    new Set(details.map((d) => d.client_ref + "|" + d.folio)).size !==
      details.length
  )
    throw Error("RENEWAL_SCOPE_INCOMPLETE");
  for (const c of expectedCustomers) {
    const a = accounts.find((a) => a.client_ref === c.source_ref);
    const used = /text: Saldo utilizado\s*\n\s*- paragraph: (\$[\d,.]+)/.exec(
      a?.state ?? "",
    )?.[1];
    const folios = [...(a?.state ?? "").matchAll(/button "(VSM\d+)"/g)]
      .map((m) => m[1])
      .sort();
    const expected = expectedDocs
      .filter((d) => d.customer_key === c.customer_key)
      .map((d) => d.source_folio)
      .sort();
    if (
      !a ||
      !fresh(a.captured_at) ||
      !used ||
      mxnCents(used) !== c.used_cents ||
      JSON.stringify(folios) !== JSON.stringify(expected)
    )
      throw Error("RENEWED_ACCOUNT_CHANGED");
  }
  let active = 0,
    cancelled = 0,
    payments = 0;
  for (const d of expectedDocs) {
    const c = plan.customers.find((c) => c.customer_key === d.customer_key);
    const detail = details.find(
      (x) => x.client_ref === c.source_ref && x.folio === d.source_folio,
    );
    if (
      !detail ||
      !fresh(detail.captured_at) ||
      !detail.detail_text.startsWith(d.source_folio + "\n") ||
      /Cód Doc\.\s*([a-f0-9]{24})\b/.exec(detail.detail_text)?.[1] !==
        d.source_document_id
    )
      throw Error("RENEWED_DOCUMENT_IDENTITY_CHANGED");
    const total = /(?:^|\n)MXN (\$[\d,.]+)/.exec(detail.detail_text)?.[1];
    const balance = /Saldo (\$[\d,.]+)/.exec(detail.detail_text)?.[1];
    const observed = parseLinkedAbonos(detail);
    const old = plan.payments.filter((p) => p.document_key === d.document_key);
    const shape = (a) =>
      a
        .map((p) => ({
          ref: p.source_ref,
          amount: p.amount_cents,
          cancelled: p.cancelled,
        }))
        .sort((a, b) => a.ref.localeCompare(b.ref));
    if (
      !total ||
      !balance ||
      mxnCents(total) !== d.total_cents ||
      mxnCents(balance) !== d.balance_cents ||
      JSON.stringify(shape(old)) !== JSON.stringify(shape(observed))
    )
      throw Error("RENEWED_FINANCIAL_EVIDENCE_CHANGED");
    const applied = observed
      .filter((p) => !p.cancelled)
      .reduce((n, p) => n + p.amount_cents, 0);
    if (applied !== d.paid_to_date_cents)
      throw Error("RENEWED_PAYMENTS_DO_NOT_RECONCILE");
    active += applied;
    cancelled += observed
      .filter((p) => p.cancelled)
      .reduce((n, p) => n + p.amount_cents, 0);
    payments += observed.length;
  }
  return {
    scope: "OPEN_DOCUMENTS_ONLY_NOT_FULL_RENEWAL",
    accounts: accounts.length,
    documents: details.length,
    payments,
    active_cents: active,
    cancelled_excluded_cents: cancelled,
    source_financial_change: false,
    identity_approved: false,
    delivery_confirmed: false,
  };
}
export async function prepareCustomerReconciliation(configPath, out) {
  const path = resolve(configPath),
    config = JSON.parse(await readFile(path)),
    input = {},
    pins = {};
  for (const key of [
    "graph",
    "source_plan",
    "renewed_accounts",
    "renewed_details",
    "pilot",
  ]) {
    const pin = config.inputs?.[key];
    if (!pin?.path || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? ""))
      throw Error("PIN_REQUIRED:" + key);
    const raw = await readFile(resolve(dirname(path), pin.path));
    if (sha(raw) !== pin.sha256) throw Error("INPUT_CHANGED:" + key);
    pins[key] = pin.sha256;
    input[key] = JSON.parse(raw);
  }
  if (input.source_plan.project_id !== "zsezjtswqeijboezvado")
    throw Error("STAGING_PLAN_REQUIRED");
  const graph = input.graph;
  // The independent old source plan must match the exact persisted graph.
  if (
    graph.accounts.length !== input.source_plan.customers.length ||
    graph.documents.length !== input.source_plan.documents.length ||
    graph.lines.length !== input.source_plan.lines.length
  )
    throw Error("STAGING_SOURCE_SCOPE_CHANGED");
  for (const c of input.source_plan.customers)
    if (
      !graph.accounts.some(
        (a) => a.key === c.customer_key && a.used_cents === c.used_cents,
      )
    )
      throw Error("STAGING_CUSTOMER_CHANGED");
  for (const d of input.source_plan.documents)
    if (
      !graph.documents.some(
        (a) =>
          a.key === d.document_key &&
          a.account === d.customer_key &&
          a.folio === d.source_folio &&
          a.status === d.financial_status &&
          a.total_cents === d.total_cents &&
          a.paid_cents === d.paid_to_date_cents &&
          a.balance_cents === d.balance_cents,
      )
    )
      throw Error("STAGING_DOCUMENT_CHANGED");
  for (const l of input.source_plan.lines)
    if (
      !graph.lines.some(
        (a) =>
          a.document === l.document_key &&
          a.index === l.line_index &&
          a.barcode === l.barcode &&
          Number(a.quantity) === Number(l.quantity) &&
          a.variant === l.variant_id,
      )
    )
      throw Error("STAGING_LINE_CHANGED");
  const report = reconcileCustomers(
    graph,
    input.pilot.barcodes,
    config.assessment_at,
  );
  if (!report.financial_pass) throw Error("FINANCIAL_RECONCILIATION_FAILED");
  const renewal = validateRenewedOpenAccounts(
    input.source_plan,
    input.renewed_accounts,
    input.renewed_details,
    config.assessment_at,
  );
  const s = report.summary;
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conciliación del piloto</title><style>body{font:18px/1.5 system-ui;max-width:950px;margin:30px auto;padding:20px;background:#f6f2e9;color:#183440}section{padding:22px;background:white;border:1px solid #ddd;border-radius:12px;margin:18px 0}</style><h1>Conciliación del piloto · staging</h1><p>Sin aperturas, cobros ni movimientos de inventario. Alcance APARTADO; no todo el padrón.</p><section><h2>${s.accounts} cuentas · ${s.documents} documentos</h2><p>${s.open_documents} abiertos, $${(s.pending_cents / 100).toFixed(2)} pendientes. ${s.paid_documents} pagados archivados. Diferencias financieras: ${s.financial_exceptions}.</p><p>Renovación parcial desde SICAR: ${renewal.accounts} cuentas y ${renewal.documents} documentos, sin cambios financieros. Abonos activos: $${(renewal.active_cents / 100).toFixed(2)}; cancelados excluidos: $${(renewal.cancelled_excluded_cents / 100).toFixed(2)}.</p></section><section><h2>Identidad y entrega siguen separadas</h2><p>${s.native_candidates} coincidencias candidatas con clientes nativos. ${s.linked_accounts} vínculos registrados. No se fabricaron datos o consentimiento. ${s.exact_variant_lines}/${s.source_lines} líneas conservan variante exacta vigente; ${s.unknown_delivery_lines} entregas sin evidencia física.</p></section><section><h2>Mercancía del piloto</h2><p>${s.pilot_codes} códigos; ${s.pilot_with_document} con antecedente documental. Una billetera pagada en 2025 no prueba entrega hoy. Los once sin coincidencia en este alcance no equivalen a compromisos cero. Cantidades importables/reservadas/disponibles sin definir.</p></section><section><h2>Siguiente</h2><p>Acreditar identidad y contacto o conservar la cuenta como origen pendiente; confirmar entrega física por documento y conteo del piloto, completar padrón fuera de APARTADO y renovar corte antes de operar. Sin preguntas individuales nuevas publicadas automáticamente.</p></section>`;
  await mkdir(out, { mode: 0o700 });
  const files = {
    "conciliacion-privada.json":
      JSON.stringify({ report, renewal, inputs: pins }, null, 2) + "\n",
    "reporte.html": html,
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(resolve(out, name), value, { flag: "wx", mode: 0o600 });
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return { summary: s, renewal };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT_DIR");
  console.log(await prepareCustomerReconciliation(...process.argv.slice(2)));
}
