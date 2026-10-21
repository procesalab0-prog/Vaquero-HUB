import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mxnCents, sourceDate } from "./prepare-customer-credit.mjs";
import { digest } from "./acceleration.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const amounts = (s) => {
  const matches = String(s).match(/\$[\d,.]+/g) ?? [];
  if ((String(s).match(/\$/g) ?? []).length !== matches.length)
    throw Error("MALFORMED_SOURCE_AMOUNT");
  return matches.map(mxnCents);
};
const valueAfter = (state, label) => {
  const match = new RegExp(
    "(?:text|generic): " + label + "\\s*\\n\\s*- paragraph: (\\$[\\d,.]+)",
  ).exec(state);
  return match ? mxnCents(match[1]) : null;
};
export function openRows(state) {
  const result = [];
  for (const block of state.split("\n        - row ").slice(1)) {
    const title = block.split("\n")[0];
    if (!title.includes("$")) continue;
    if (!title.includes(" MXN ")) throw Error("SOURCE_CURRENCY_REQUIRED");
    const money = amounts(title);
    const folios = [
      ...block.matchAll(/^ {12,}- button ("(?:[^"\\]|\\.)*"):/gm),
    ].map((m) => JSON.parse(m[1]));
    const occurred =
      /^\s*- paragraph: (\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} [AP]M)$/m.exec(
        block,
      )?.[1];
    if (
      money.length !== 2 ||
      folios.length !== 1 ||
      !folios[0] ||
      folios[0] !== folios[0].trim() ||
      !occurred ||
      money[1] <= 0 ||
      money[1] > money[0]
    )
      throw Error("OPEN_ROW_EVIDENCE_REQUIRED");
    sourceDate(occurred.slice(0, 10));
    result.push({
      folio: folios[0],
      occurred_label: occurred,
      total_cents: money[0],
      balance_cents: money[1],
      source_document_id: null,
      delivery_status: "UNKNOWN",
      payment_details_verified: false,
      evidence_sha256: sha(block),
    });
  }
  if (new Set(result.map((d) => d.folio)).size !== result.length)
    throw Error("DUPLICATE_DOCUMENT_FOLIO");
  return result;
}

export function generalCustomerCensus(list, captures, previous, at) {
  const fresh = (s) =>
    Number.isFinite(Date.parse(s)) &&
    Date.parse(s) <= Date.parse(at) &&
    Date.parse(at) - Date.parse(s) <= 86400000;
  if (
    !Number.isFinite(Date.parse(at)) ||
    !fresh(list.captured_at) ||
    !list.state.includes('- combobox "Buscar"\n') ||
    !list.state.includes('- button "0":') ||
    list.state.includes("progressbar") ||
    !Array.isArray(list.rows) ||
    !list.rows.length
  )
    throw Error("UNFILTERED_TERMINAL_LIST_REQUIRED");
  if (
    captures.length !== list.rows.length ||
    new Set(captures.map((a) => a.list_index)).size !== captures.length ||
    new Set(captures.map((a) => a.client_ref)).size !== captures.length
  )
    throw Error("COMPLETE_DISTINCT_CUSTOMERS_REQUIRED");
  const rows = list.rows.map((row, i) => {
    const a = captures.find((c) => c.list_index === i),
      name = row.paragraphs[1];
    if (
      row.list_index !== i ||
      !a ||
      a.name !== name ||
      !name ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        a.client_ref,
      ) ||
      a.url.split("?")[0] !==
        `https://app.sicarx.com/clients/detail/${a.client_ref}` ||
      a.full_reload_before_read !== true ||
      !fresh(a.captured_at) ||
      !a.credit.includes(name) ||
      a.credit.includes("progressbar") ||
      a.credit.includes("token a expirado")
    )
      throw Error("CUSTOMER_IDENTITY_EVIDENCE_REQUIRED");
    const listAmounts = amounts(row.text);
    if (listAmounts.length > 1) throw Error("LIST_AMOUNT_AMBIGUOUS");
    const docs = openRows(a.credit);
    if (docs.length !== a.rows.filter((r) => r.includes("$")).length)
      throw Error("SOURCE_DOCUMENT_SCOPE_CHANGED");
    const used = valueAfter(a.credit, "Saldo utilizado"),
      overdue = valueAfter(a.credit, "Saldo vencido"),
      listBalance = listAmounts[0] ?? null;
    const documentBalance = docs.reduce((sum, d) => sum + d.balance_cents, 0);
    const old = previous.customers.find((c) => c.source_ref === a.client_ref);
    const holds = [];
    if (used === null) holds.push("SOURCE_BALANCE_MISSING");
    if (used !== null && used !== documentBalance)
      holds.push("DOCUMENT_BALANCE_MISMATCH");
    if (listBalance !== null && used !== null && listBalance !== used)
      holds.push("LIST_BALANCE_CHANGED");
    if (old && used !== null && old.used_cents !== used)
      holds.push("PREVIOUS_BALANCE_CHANGED");
    if (old) {
      const oldDocs = previous.documents
        .filter(
          (d) =>
            d.customer_key === old.customer_key &&
            d.financial_status === "OPEN",
        )
        .map((d) => d.source_folio + "|" + d.balance_cents)
        .sort();
      const current = docs.map((d) => d.folio + "|" + d.balance_cents).sort();
      if (JSON.stringify(oldDocs) !== JSON.stringify(current))
        holds.push("PREVIOUS_DOCUMENTS_CHANGED");
    }
    const key = digest({ tenant: "VSM", client_ref: a.client_ref });
    if (old && old.customer_key !== key)
      throw Error("PREVIOUS_IDENTITY_KEY_CHANGED");
    return {
      customer_key: key,
      source_ref: a.client_ref,
      name,
      list_balance_cents: listBalance,
      used_cents: used,
      overdue_cents: overdue,
      document_balance_cents: documentBalance,
      documents: docs.map((d) => ({
        ...d,
        document_key: digest({
          tenant: "VSM",
          client_ref: a.client_ref,
          folio: d.folio,
        }),
      })),
      previously_registered: !!old,
      holds,
      source_at: a.captured_at,
      source_evidence_sha256: sha(a.credit),
      native_customer_id: null,
      privacy_consent: null,
      new_credit_authorized: false,
      operational_import_allowed: false,
    };
  });
  for (const row of rows)
    if (
      rows.filter(
        (r) =>
          r.name.normalize("NFC").toLocaleUpperCase("es-MX") ===
          row.name.normalize("NFC").toLocaleUpperCase("es-MX"),
      ).length > 1
    )
      row.holds.push("DUPLICATE_NAME_NOT_MERGED");
  const missing = previous.customers
    .filter((c) => !rows.some((r) => r.source_ref === c.source_ref))
    .map((c) => c.customer_key);
  const summary = {
    accounts: rows.length,
    previous_accounts_present: rows.filter((r) => r.previously_registered)
      .length,
    new_source_accounts: rows.filter((r) => !r.previously_registered).length,
    previous_accounts_missing: missing.length,
    accounts_with_positive_used: rows.filter((r) => (r.used_cents ?? 0) > 0)
      .length,
    accounts_with_document_debt: rows.filter(
      (r) => r.document_balance_cents > 0,
    ).length,
    accounts_with_unknown_used: rows.filter((r) => r.used_cents === null)
      .length,
    open_documents: rows.reduce((s, r) => s + r.documents.length, 0),
    source_used_cents: rows.reduce((s, r) => s + (r.used_cents ?? 0), 0),
    document_balance_cents: rows.reduce(
      (s, r) => s + r.document_balance_cents,
      0,
    ),
    new_document_balance_cents: rows
      .filter((r) => !r.previously_registered)
      .reduce((s, r) => s + r.document_balance_cents, 0),
    review_accounts: rows.filter((r) => r.holds.length).length,
    accounts_financially_changed: rows.filter((r) =>
      r.holds.some((h) => h.startsWith("PREVIOUS_")),
    ).length,
  };
  return {
    version: 1,
    scope: "VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY",
    deleted_customers_included: false,
    paid_history_complete: false,
    source_at: new Date(
      Math.min(
        Date.parse(list.captured_at),
        ...captures.map((a) => Date.parse(a.captured_at)),
      ),
    ).toISOString(),
    observed_until: new Date(
      Math.max(...captures.map((a) => Date.parse(a.captured_at))),
    ).toISOString(),
    financial_details_complete: false,
    operational_import_allowed: false,
    summary,
    missing_previous_keys: missing,
    accounts: rows,
  };
}

const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function censusHTML(plan) {
  const money = (n) =>
    n === null
      ? "Sin importe legible"
      : new Intl.NumberFormat("es-MX", {
          style: "currency",
          currency: "MXN",
        }).format(n / 100);
  const s = plan.summary;
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Padrón general SICAR · Conciliación</title><style>body{font:17px/1.5 system-ui;background:#f5f2eb;color:#18313d;margin:auto;max-width:1100px;padding:24px}section,article{background:white;border:1px solid #d3d7da;border-radius:14px;padding:20px;margin:16px 0}.notice{background:#fff1bd}input,select{font:inherit;padding:12px;max-width:100%;box-sizing:border-box}label{display:inline-block;margin:8px}summary{cursor:pointer;font-weight:650}code{overflow-wrap:anywhere}small{display:block}li{margin:8px 0}[hidden]{display:none}button{font:inherit;min-height:44px}</style><h1>Padrón general SICAR</h1><section class="notice"><strong>Sólo lectura · No habilita cobros</strong><p>Listado visible sin filtro APARTADO. No incluye clientes eliminados ni todo el historial pagado. No acredita entregas, existencias o autorización de crédito nuevo.</p></section><section><h2>${s.accounts} cuentas · ${s.new_source_accounts} adicionales al alcance anterior</h2><p>${s.open_documents} documentos no pagados observados · ${money(s.document_balance_cents)} por conciliar en detalle.</p><p>Saldo utilizado legible: ${money(s.source_used_cents)}. Cuentas sin ese importe: ${s.accounts_with_unknown_used}. No se completa la diferencia con supuestos.</p><p>${s.previous_accounts_present} identidades previas presentes; ${s.accounts_financially_changed} con cambios financieros; ${s.review_accounts} cuentas con alertas.</p><small>Captura: ${escape(plan.source_at)} a ${escape(plan.observed_until)}. Las cifras corresponden al intervalo observado, no a un cierre simultáneo.</small></section><label>Buscar <input id="q" placeholder="Nombre, referencia o folio"></label><label>Mostrar <select id="filter"><option value="all">Todas</option><option value="new">Nuevas en esta revisión</option><option value="debt">Con documentos pendientes</option><option value="review">Con alertas</option></select></label><p id="count" aria-live="polite"></p><main>${plan.accounts.map((a) => `<article data-new="${!a.previously_registered}" data-debt="${a.document_balance_cents > 0}" data-review="${!!a.holds.length}"><details><summary>${escape(a.name)} · ${money(a.document_balance_cents)} en documentos</summary><p>${a.previously_registered ? "Referencia ya conocida, sin nueva alta" : "Referencia adicional: pendiente de preparación"}</p><p>Saldo utilizado: ${money(a.used_cents)} · Listado: ${money(a.list_balance_cents)}</p><code>${escape(a.source_ref)}</code><p>Alertas: ${escape(a.holds.join(", ") || "Sin diferencias en las sumas observadas")}</p><ul>${a.documents.map((d) => `<li>${escape(d.folio)} · ${money(d.balance_cents)} pendiente de ${money(d.total_cents)}. Abonos detallados y entrega aún por comprobar.</li>`).join("")}</ul><small>No se creó cliente nativo, saldo cobrable ni consentimiento.</small></details></article>`).join("")}</main><script>const q=document.getElementById('q'),f=document.getElementById('filter'),rows=[...document.querySelectorAll('article')];function update(){let n=0;for(const r of rows){const visible=r.textContent.toLocaleLowerCase('es-MX').includes(q.value.toLocaleLowerCase('es-MX'))&&(f.value==='all'||r.dataset[f.value]==='true');r.hidden=!visible;if(visible)n++;}document.getElementById('count').textContent=n+' de '+rows.length+' cuentas';}q.addEventListener('input',update);f.addEventListener('change',update);update();</script></html>`;
}

export function generalDetailQueue(plan, previous) {
  return plan.accounts.flatMap((a) =>
    a.documents.map((d) => {
      const old = previous.documents.find(
        (x) =>
          x.document_key === d.document_key && x.financial_status === "OPEN",
      );
      return {
        customer_key: a.customer_key,
        client_ref: a.source_ref,
        account_url: `https://app.sicarx.com/clients/detail/${a.source_ref}`,
        expected_name: a.name,
        document_key: d.document_key,
        folio: d.folio,
        expected_total_cents: d.total_cents,
        expected_balance_cents: d.balance_cents,
        expected_source_document_id: old?.source_document_id ?? null,
        in_previous_package: !!old,
        detail_and_linked_payments_required: true,
        delivery_status: "UNKNOWN",
        operational_import_allowed: false,
      };
    }),
  );
}

export function prepareGeneralCustomers(configPath, out) {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")),
    inputs = {};
  for (const k of ["list", "accounts", "previous"]) {
    const pin = cfg.inputs[k],
      raw = readFileSync(pin.path);
    if (sha(raw) !== pin.sha256) throw Error("INPUT_CHANGED:" + k);
    inputs[k] = JSON.parse(raw);
  }
  const plan = generalCustomerCensus(
    inputs.list,
    inputs.accounts,
    inputs.previous,
    cfg.assessment_at,
  );
  mkdirSync(resolve(out), { recursive: true, mode: 0o700 });
  writeFileSync(
    resolve(out, "cola-detalles.json"),
    JSON.stringify(generalDetailQueue(plan, inputs.previous), null, 2) + "\n",
    { mode: 0o600 },
  );
  writeFileSync(
    resolve(out, "plan-lectura.json"),
    JSON.stringify(plan, null, 2) + "\n",
    { mode: 0o600 },
  );
  writeFileSync(resolve(out, "reporte.html"), censusHTML(plan), {
    mode: 0o600,
  });
  writeFileSync(
    resolve(out, "resumen.json"),
    JSON.stringify(plan.summary, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(plan.summary));
  return plan;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  prepareGeneralCustomers(...process.argv.slice(2));
