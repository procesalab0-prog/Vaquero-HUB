import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "./acceleration.mjs";
import { quoteDoText } from "./sql-literal.mjs";

const project = "zsezjtswqeijboezvado";
const hash = (raw) => createHash("sha256").update(raw).digest("hex");
const literal = (v) => typeof v === "string" && v.length > 0 && v === v.trim();
const moneyPattern = /\$(?:0|[1-9]\d{0,2}(?:,\d{3})*)\.\d{2}(?!\d)/g;
export function mxnCents(value) {
  if (!/^\$(?:0|[1-9]\d{0,2}(?:,\d{3})*)\.\d{2}$/.test(value ?? ""))
    throw Error("INVALID_MXN_AMOUNT");
  const [pesos, cents] = value.slice(1).replaceAll(",", "").split(".");
  const n = BigInt(pesos) * 100n + BigInt(cents);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("AMOUNT_TOO_LARGE");
  return Number(n);
}
function amounts(text) {
  const matches = String(text).match(moneyPattern) ?? [];
  // Reject partial matches of malformed currency, rather than silently accepting them.
  if ((String(text).match(/\$/g) ?? []).length !== matches.length)
    throw Error("MALFORMED_CURRENCY");
  return matches.map(mxnCents);
}
function total(values) {
  const n = values.reduce((a, b) => a + BigInt(b), 0n);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("TOTAL_TOO_LARGE");
  return Number(n);
}
export function sourceDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? "");
  if (!m) throw Error("SOURCE_DATE_REQUIRED");
  const [, month, day, year] = m;
  const iso = `${year}-${month}-${day}`;
  const d = new Date(iso + "T12:00:00Z");
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== iso)
    throw Error("INVALID_SOURCE_DATE");
  return iso;
}
export function phoneCandidate(label) {
  if (label === null) return null;
  if (typeof label !== "string" || !/^Celular\s*/.test(label))
    throw Error("INVALID_CONTACT_LABEL");
  // SICAR's rendered contact button ends with a semicolon from its icon.
  // Preserve the raw label; strip only that known terminal UI artifact.
  const raw = label.replace(/^Celular\s*:?\s*/, "").replace(/;$/, "");
  if (!/^[+\d\s()-]+$/.test(raw)) return null;
  const digits = raw.replace(/[\s()-]/g, "");
  return /^\+52\d{10}$/.test(digits) ? digits : null;
}
export function parseLinkedAbonos(detail) {
  const expected = /Documentos vinculados\s*\((\d+)\)/.exec(detail.detail_text);
  if (!expected || !detail.linked_text.startsWith("Documentos vinculados"))
    throw Error("LINKED_PAYMENT_EVIDENCE_REQUIRED");
  const pattern =
    /(?:^|\n)(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} [AP]M)\s*\n+Abono (\d+)\b/g;
  const matches = [...detail.linked_text.matchAll(pattern)];
  if (matches.length !== Number(expected[1]))
    throw Error("LINKED_PAYMENT_COUNT_MISMATCH");
  const rows = matches.map((m, i) => {
    const chunk = detail.linked_text.slice(m.index, matches[i + 1]?.index);
    const money = amounts(chunk);
    if (money.length !== 1 || money[0] <= 0)
      throw Error("LINKED_PAYMENT_AMOUNT_REQUIRED");
    const cancelled = /Cancelado\s+\d{2}\/\d{2}\/\d{4}/.test(chunk);
    if (chunk.includes("Cancelado") && !cancelled)
      throw Error("CANCELLATION_EVIDENCE_REQUIRED");
    sourceDate(m[1].slice(0, 10));
    return {
      source_ref: "Abono " + m[2],
      occurred_label: m[1],
      amount_cents: money[0],
      cancelled,
      evidence_sha256: hash(chunk),
    };
  });
  if (new Set(rows.map((r) => r.source_ref)).size !== rows.length)
    throw Error("DUPLICATE_SOURCE_PAYMENT");
  return rows;
}

// Offline preparation only. No API, database connection or operational import.
export function customerCreditPlan(data, at) {
  const { clients, accounts, documents, details, scope, mapping } = data;
  const fresh = (s) =>
    Number.isFinite(Date.parse(s)) &&
    Date.parse(s) <= Date.parse(at) &&
    Date.parse(at) - Date.parse(s) <= 86400000;
  if (
    !Number.isFinite(Date.parse(at)) ||
    scope.search !== "APARTADO" ||
    scope.receipt_filter !== "Todos" ||
    scope.unlabelled_customers_reviewed !== false ||
    scope.terminal_page_observed !== true ||
    !fresh(scope.captured_at)
  )
    throw Error("BOUNDED_CUSTOMER_SCOPE_REQUIRED");
  if (
    !Array.isArray(clients) ||
    !clients.length ||
    clients.length !== scope.terminal_list_count ||
    accounts.length !== clients.length ||
    new Set(clients.map((c) => c.client_ref)).size !== clients.length ||
    new Set(clients.map((c) => c.list_index)).size !== clients.length
  )
    throw Error("COMPLETE_CUSTOMER_SCOPE_REQUIRED");
  if (
    mapping.project_id !== project ||
    !fresh(mapping.captured_at) ||
    !Array.isArray(mapping.rows)
  )
    throw Error("STAGING_MAPPING_REQUIRED");
  const map = new Map();
  for (const r of mapping.rows) {
    if (!literal(r.barcode) || map.has(r.barcode) || !Array.isArray(r.variants))
      throw Error("EXACT_MAPPING_REQUIRED");
    map.set(r.barcode, r.variants);
  }
  const expected = new Map(),
    names = new Map(),
    phones = new Map();
  const customers = clients.map((c) => {
    const original = accounts.find((r) => r.client_ref === c.client_ref);
    if (
      !literal(c.client_ref) ||
      !Number.isInteger(c.list_index) ||
      c.list_index < 0 ||
      c.list_index >= clients.length ||
      original?.list_index !== c.list_index ||
      !literal(c.source_display_name) ||
      !fresh(c.captured_at) ||
      c.privacy_consent !== null ||
      c.marketing_consent !== null ||
      c.email_label !== null
    )
      throw Error("EXACT_CUSTOMER_EVIDENCE_REQUIRED");
    const k = digest({ tenant: "VSM", client_ref: c.client_ref });
    const phone = phoneCandidate(c.phone_label);
    const nameKey = c.source_display_name
      .normalize("NFC")
      .toLocaleUpperCase("es-MX");
    names.set(nameKey, [...(names.get(nameKey) ?? []), k]);
    if (phone) phones.set(phone, [...(phones.get(phone) ?? []), k]);
    for (const [rows, status, old] of [
      [c.unpaid_rows, "OPEN", original.unpaid],
      [c.paid_rows, "PAID", original.paid],
    ]) {
      if (
        !Array.isArray(rows) ||
        rows.length !== old.folios.length ||
        new Set(rows.map((d) => d.folio)).size !== rows.length
      )
        throw Error("FINANCIAL_SCOPE_CHANGED");
      for (const r of rows) {
        const dk = c.client_ref + "|" + r.folio;
        const money = amounts(r.row_text);
        if (
          !old.folios.includes(r.folio) ||
          expected.has(dk) ||
          money.length !== 2 ||
          money[1] > money[0] ||
          money[0] <= 0 ||
          (status === "PAID"
            ? money[1] !== 0 || !r.row_text.includes("Pagado")
            : money[1] <= 0)
        )
          throw Error("INVALID_DOCUMENT_MONEY_OR_STATUS");
        expected.set(dk, {
          customer_key: k,
          total_cents: money[0],
          balance_cents: money[1],
          financial_status: status,
        });
      }
    }
    const used = /Saldo utilizado\s*(\$[\d,.]+)\s*Saldo vencido/.exec(
      c.credit_summary_text,
    )?.[1];
    const overdue = /Saldo vencido\s*(\$[\d,.]+)/.exec(
      c.credit_summary_text,
    )?.[1];
    if (!used || !overdue) throw Error("CUSTOMER_BALANCE_EVIDENCE_REQUIRED");
    const sum = total(
      [...expected.values()]
        .filter((d) => d.customer_key === k)
        .map((d) => d.balance_cents),
    );
    if (mxnCents(used) !== sum) throw Error("CUSTOMER_BALANCE_MISMATCH");
    const holds = [
      "PRIVACY_CONSENT_NOT_OBSERVED",
      "LEGACY_IDENTITY_ADAPTER_REQUIRED",
    ];
    if (!phone)
      holds.push(
        c.phone_label === null ? "CONTACT_MISSING" : "CONTACT_INVALID",
      );
    return {
      customer_key: k,
      source_ref: c.client_ref,
      source_display_name: c.source_display_name,
      raw_phone_label: c.phone_label,
      phone_candidate: phone,
      email: null,
      privacy_consent_at: null,
      marketing_consent: null,
      auth_user_id: null,
      target_customer_id: null,
      used_cents: sum,
      overdue_cents: mxnCents(overdue),
      holds,
      operational_import_allowed: false,
    };
  });
  for (const c of customers) {
    if (
      names.get(
        c.source_display_name.normalize("NFC").toLocaleUpperCase("es-MX"),
      ).length > 1
    )
      c.holds.push("POSSIBLE_DUPLICATE_NAME");
    if (c.phone_candidate && phones.get(c.phone_candidate).length > 1)
      c.holds.push("SHARED_PHONE_REVIEW");
  }
  const seen = new Set(),
    seenDetails = new Set(),
    payments = [],
    lines = [];
  const creditDocuments = documents.map((d) => {
    const key = d.client_ref + "|" + d.folio,
      e = expected.get(key);
    if (
      !e ||
      seen.has(key) ||
      e.financial_status !== d.financial_status ||
      d.delivery_status !== "UNKNOWN" ||
      !fresh(d.captured_at) ||
      !d.lines?.length
    )
      throw Error("EXACT_DOCUMENT_REQUIRED");
    seen.add(key);
    const document_key = digest({
      tenant: "VSM",
      client_ref: d.client_ref,
      folio: d.folio,
    });
    let due_date = null,
      source_document_id = null,
      payment_evidence = "NOT_CAPTURED_ARCHIVE_ONLY";
    if (e.financial_status === "OPEN") {
      const found = details.filter(
        (x) => x.client_ref === d.client_ref && x.folio === d.folio,
      );
      if (found.length !== 1 || !fresh(found[0].captured_at))
        throw Error("OPEN_DOCUMENT_DETAIL_REQUIRED");
      const detail = found[0];
      seenDetails.add(detail);
      if (!detail.detail_text.startsWith(d.folio + "\n"))
        throw Error("DETAIL_FOLIO_MISMATCH");
      source_document_id =
        /Cód Doc\.\s*([a-f0-9]{24})\b/.exec(detail.detail_text)?.[1] ?? null;
      const balance = /Saldo (\$[\d,.]+)/.exec(detail.detail_text)?.[1];
      const sourceTotal = /(?:^|\n)MXN (\$[\d,.]+)/.exec(
        detail.detail_text,
      )?.[1];
      const due = /Venc(?:e|ió) el (\d{2}\/\d{2}\/\d{4})/.exec(
        detail.detail_text,
      )?.[1];
      if (
        !source_document_id ||
        !balance ||
        !sourceTotal ||
        mxnCents(balance) !== e.balance_cents ||
        mxnCents(sourceTotal) !== e.total_cents
      )
        throw Error("DETAIL_MONEY_MISMATCH");
      due_date = sourceDate(due);
      const observed = parseLinkedAbonos(detail);
      if (
        total(
          observed.filter((p) => !p.cancelled).map((p) => p.amount_cents),
        ) !==
        e.total_cents - e.balance_cents
      )
        throw Error("ACTIVE_ABONOS_DO_NOT_RECONCILE");
      for (const p of observed)
        payments.push({
          ...p,
          document_key,
          payment_key: digest({ tenant: "VSM", source_ref: p.source_ref }),
          replay_as_cash: false,
        });
      payment_evidence = "ACTIVE_AND_CANCELLED_RECONCILED";
    }
    const lineIndices = new Set();
    for (const l of d.lines) {
      if (
        !literal(l.barcode) ||
        typeof l.quantity !== "string" ||
        !/^[1-9]\d{0,8}$/.test(l.quantity) ||
        !Number.isInteger(l.line_index) ||
        l.line_index < 0 ||
        lineIndices.has(l.line_index)
      )
        throw Error("LITERAL_CREDIT_LINE_REQUIRED");
      lineIndices.add(l.line_index);
      if (!map.has(l.barcode)) throw Error("MAPPING_SCOPE_INCOMPLETE");
      const candidates = map.get(l.barcode);
      const unique =
        candidates.length === 1 && /^[a-f0-9-]{36}$/.test(candidates[0]);
      lines.push({
        document_key,
        line_index: l.line_index,
        barcode: l.barcode,
        quantity: l.quantity,
        variant_id: unique ? candidates[0] : null,
        delivery_status: "UNKNOWN",
        reserved_qty: null,
        additional_stock_deduction: null,
        holds: [
          "DELIVERY_NOT_OBSERVED",
          ...(!unique ? ["VARIANT_MAPPING_REVIEW"] : []),
        ],
      });
    }
    return {
      ...e,
      document_key,
      source_folio: d.folio,
      source_document_id,
      due_date,
      paid_to_date_cents: e.total_cents - e.balance_cents,
      opening_candidate_cents: e.balance_cents,
      delivery_status: "UNKNOWN",
      payment_evidence,
      operational_import_allowed: false,
    };
  });
  if (
    seen.size !== expected.size ||
    seenDetails.size !== details.length ||
    new Set(payments.map((p) => p.payment_key)).size !== payments.length
  )
    throw Error("INCOMPLETE_OR_DUPLICATE_FINANCIAL_SCOPE");
  const summary = {
    customers: customers.length,
    phone_missing_or_invalid: customers.filter((c) => !c.phone_candidate)
      .length,
    shared_phone_customers: customers.filter((c) =>
      c.holds.includes("SHARED_PHONE_REVIEW"),
    ).length,
    duplicate_name_customers: customers.filter((c) =>
      c.holds.includes("POSSIBLE_DUPLICATE_NAME"),
    ).length,
    documents: creditDocuments.length,
    paid_documents: creditDocuments.filter((d) => d.financial_status === "PAID")
      .length,
    open_documents: creditDocuments.filter((d) => d.financial_status === "OPEN")
      .length,
    indebted_customers: customers.filter((c) => c.used_cents > 0).length,
    opening_candidate_cents: total(creditDocuments.map((d) => d.balance_cents)),
    linked_payments: payments.length,
    cancelled_payments: payments.filter((p) => p.cancelled).length,
    active_historical_payments_cents: total(
      payments.filter((p) => !p.cancelled).map((p) => p.amount_cents),
    ),
    credit_lines: lines.length,
    mapped_lines: lines.filter((l) => l.variant_id).length,
    unknown_deliveries: lines.length,
    operational_imported_customers: 0,
  };
  return {
    version: "m9-customer-credit-1",
    mode: "PRIVATE_PREPARATION_ROLLBACK_ONLY",
    project_id: project,
    assessed_at: at,
    production_allowed: false,
    operational_import_allowed: false,
    inventory_import_allowed: false,
    scope: "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS",
    summary,
    customers,
    documents: creditDocuments,
    payments,
    lines,
  };
}

export function customerCreditRehearsalSQL(plan) {
  if (
    plan.version !== "m9-customer-credit-1" ||
    plan.project_id !== project ||
    plan.production_allowed !== false ||
    plan.operational_import_allowed !== false ||
    plan.inventory_import_allowed !== false ||
    !plan.documents.length
  )
    throw Error("PRIVATE_STAGING_PLAN_REQUIRED");
  // Only opaque keys and financial evidence go to TEMP. No names, phones or emails.
  const payload = {
    customers: plan.customers.map((c) => ({
      key: c.customer_key,
      used: c.used_cents,
    })),
    documents: plan.documents.map((d) => ({
      key: d.document_key,
      customer: d.customer_key,
      total: d.total_cents,
      balance: d.balance_cents,
      paid: d.paid_to_date_cents,
      status: d.financial_status,
    })),
    payments: plan.payments.map((p) => ({
      key: p.payment_key,
      document: p.document_key,
      amount: p.amount_cents,
      cancelled: p.cancelled,
    })),
  };
  const q = (s) => quoteDoText(s, "$clients$");
  return `-- TEMP preparation, pseudonymized identities. No native customers or balances imported.
begin;
set local standard_conforming_strings=on;
set local statement_timeout='120s';
create temporary table m9_credit_clients(key text primary key, used bigint not null check(used>=0)) on commit drop;
create temporary table m9_credit_docs(key text primary key, customer text not null references m9_credit_clients(key), total bigint not null check(total>0), balance bigint not null check(balance>=0 and balance<=total), paid bigint not null check(paid>=0), status text not null check(status in ('OPEN','PAID')), check(total=paid+balance), check((status='PAID' and balance=0) or (status='OPEN' and balance>0))) on commit drop;
create temporary table m9_credit_payments(key text primary key, document text not null references m9_credit_docs(key), amount bigint not null check(amount>0), cancelled boolean not null) on commit drop;
create temporary table m9_credit_replay(key text primary key,payload jsonb not null) on commit drop;
create temporary table m9_credit_result(result jsonb) on commit drop;
do $clients$
declare p jsonb:=${q(JSON.stringify(payload))}::jsonb; r jsonb; rejected int:=0; replayed int:=0;
begin
 perform app.assert_sicar_staging_enabled();
 for r in select value from jsonb_array_elements(p->'customers') loop
  insert into m9_credit_clients values(r->>'key',(r->>'used')::bigint);
 end loop;
 for r in select value from jsonb_array_elements(p->'documents') loop
  insert into m9_credit_docs values(r->>'key',r->>'customer',(r->>'total')::bigint,(r->>'balance')::bigint,(r->>'paid')::bigint,r->>'status');
 end loop;
 for r in select value from jsonb_array_elements(p->'payments') loop
  insert into m9_credit_payments values(r->>'key',r->>'document',(r->>'amount')::bigint,(r->>'cancelled')::boolean);
 end loop;
 if exists(select 1 from m9_credit_clients c left join m9_credit_docs d on d.customer=c.key group by c.key,c.used having c.used<>coalesce(sum(d.balance),0)) then raise exception 'CLIENT_DEBT_MISMATCH';end if;
 if exists(select 1 from m9_credit_docs d left join m9_credit_payments p on p.document=d.key and not p.cancelled where d.status='OPEN' group by d.key,d.paid having d.paid<>coalesce(sum(p.amount),0)) then raise exception 'ACTIVE_PAYMENT_MISMATCH';end if;
 for r in select value from jsonb_array_elements((p->'customers')||(p->'documents')||(p->'payments')) loop
  insert into m9_credit_replay values(r->>'key',r);
 end loop;
 for r in select value from jsonb_array_elements((p->'customers')||(p->'documents')||(p->'payments')) loop
  insert into m9_credit_replay values(r->>'key',r) on conflict(key) do update set payload=case when m9_credit_replay.payload=excluded.payload then excluded.payload else null end;
  replayed:=replayed+1;
 end loop;
 begin
  r:=p->'documents'->0;
  insert into m9_credit_replay values(r->>'key',r||'{"balance":-1}'::jsonb) on conflict(key) do update set payload=case when m9_credit_replay.payload=excluded.payload then excluded.payload else null end;
  raise exception 'CONFLICT_NOT_REJECTED';
 exception when not_null_violation then rejected:=rejected+1;end;
 begin
  insert into m9_credit_docs values('invalid-negative',(p->'customers'->0->>'key'),100,-1,101,'OPEN');
  raise exception 'NEGATIVE_BALANCE_NOT_REJECTED';
 exception when check_violation then rejected:=rejected+1;end;
 begin
  insert into m9_credit_docs values('orphan','absent',100,100,0,'OPEN');
  raise exception 'ORPHAN_NOT_REJECTED';
 exception when foreign_key_violation then rejected:=rejected+1;end;
 set constraints all immediate;
 insert into m9_credit_result values(jsonb_build_object('mode','TEMP_SOURCE_PREPARATION_ROLLBACK','customers',(select count(*) from m9_credit_clients),'documents',(select count(*) from m9_credit_docs),'open_documents',(select count(*) from m9_credit_docs where status='OPEN'),'opening_candidate_cents',(select sum(balance) from m9_credit_docs),'payments',(select count(*) from m9_credit_payments),'cancelled_excluded',(select count(*) from m9_credit_payments where cancelled),'idempotent_replays',replayed,'negative_checks',rejected,'native_customers_imported',0,'stock_movements_created',0));
end $clients$;
select * from m9_credit_result;
rollback;
`;
}

export async function prepareCustomerCredit(configPath, out) {
  const file = resolve(configPath),
    config = JSON.parse(await readFile(file)),
    data = {},
    inputs = {};
  for (const name of [
    "clients",
    "accounts",
    "documents",
    "details",
    "scope",
    "mapping",
  ]) {
    const pin = config.inputs?.[name];
    if (
      typeof pin?.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(pin.sha256 ?? "")
    )
      throw Error("PINNED_CUSTOMER_INPUT_REQUIRED:" + name);
    const raw = await readFile(resolve(dirname(file), pin.path));
    if (hash(raw) !== pin.sha256) throw Error("CUSTOMER_INPUT_CHANGED:" + name);
    data[name] = JSON.parse(raw);
    inputs[name] = pin.sha256;
  }
  const plan = { ...customerCreditPlan(data, config.assessment_at), inputs };
  const s = plan.summary;
  const files = {
    "plan-privado.json": JSON.stringify(plan, null, 2) + "\n",
    "ensayo-preparacion-rollback.sql": customerCreditRehearsalSQL(plan),
    "reporte.html": `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M9 clientes y créditos</title><style>body{font:18px/1.5 system-ui;max-width:900px;margin:32px auto;padding:20px;background:#f5f2e9;color:#182f3a}section{background:white;border-radius:14px;padding:24px;margin:20px 0}</style><h1>Clientes, créditos y apartados</h1><p>Preparación privada y ensayos con rollback. Sin carga operativa ni cambios en producción.</p><section><h2>${s.customers} cuentas · ${s.documents} documentos</h2><p>Alcance: clientes de la búsqueda APARTADO, no todo el padrón SICAR. ${s.paid_documents} documentos pagados se conservan sin reabrir deuda. ${s.open_documents} pendientes en ${s.indebted_customers} cuentas: $${(s.opening_candidate_cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}.</p></section><section><h2>Abonos separados de los cobros nuevos</h2><p>${s.linked_payments} abonos vinculados leídos en los documentos abiertos; ${s.cancelled_payments} cancelado(s), excluidos del dinero abonado. No vuelven a ingresar a caja. El historial de abonos de documentos pagados aún requiere exportación completa.</p></section><section><h2>Identidad y entregas pendientes</h2><p>${s.phone_missing_or_invalid} cuentas sin teléfono utilizable; ${s.shared_phone_customers} con teléfono compartido. El consentimiento no está observado. ${s.mapped_lines} de ${s.credit_lines} líneas tienen variante única por código literal. La entrega de las ${s.unknown_deliveries} líneas sigue sin confirmar; no genera reservas ni descuentos de inventario.</p></section><section><h2>Siguiente paso</h2><p>Obtener el padrón completo y estados de cuenta con abonos/cancelaciones y entregas. Preparar el adaptador de identidad heredada y apertura de deuda, validar responsables y corte, y aceptar el piloto en Preview antes de cualquier carga real.</p></section>`,
  };
  await mkdir(out);
  for (const [name, content] of Object.entries(files))
    await writeFile(resolve(out, name), content, { flag: "wx", mode: 0o600 });
  await writeFile(
    resolve(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([n, c]) => [n, hash(c)])),
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return s;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT_DIR");
  console.log(await prepareCustomerCredit(...process.argv.slice(2)));
}
