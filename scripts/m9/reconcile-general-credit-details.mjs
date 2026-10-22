import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./acceleration.mjs";
import {
  mxnCents,
  sourceDate,
  parseLinkedAbonos,
} from "./prepare-customer-credit.mjs";
import { quoteDoText } from "./sql-literal.mjs";
const project = "zsezjtswqeijboezvado";
const sha = (raw) => createHash("sha256").update(raw).digest("hex");
const sum = (rows) => {
  const n = rows.reduce((a, b) => a + BigInt(b), 0n);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("UNSAFE_SUM");
  return Number(n);
};
const required = (condition, code) => {
  if (!condition) throw Error(code);
};
const one = (text, regex, code) => {
  const m = [...text.matchAll(regex)];
  required(m.length === 1, code);
  return m[0][1];
};
const money = (text, regex, code) => mxnCents(one(text, regex, code));
const keyFor = (ref, folio) =>
  digest({ tenant: "VSM", client_ref: ref, folio });
const literal = (value) =>
  typeof value === "string" && value.length > 0 && value === value.trim();
const fresh = (stamp, at) =>
  Number.isFinite(Date.parse(stamp)) &&
  Date.parse(stamp) <= Date.parse(at) &&
  Date.parse(at) - Date.parse(stamp) <= 86400000;

// Reads rendered item blocks only. Clave 1 is never coerced to a number.
export function creditDetailLines(text) {
  const lines = text.split("\n").filter((x) => x.trim().length > 0);
  const start = lines.indexOf("Almacén:"),
    end = lines.indexOf("Formas de Pago/Abonos");
  required(start >= 0 && end > start, "ITEM_SECTION_REQUIRED");
  const items = [];
  for (let i = start + 2; i < end; i++) {
    if (!/^[\d.,]+\s+[A-Z]+$/.test(lines[i])) continue;
    const m = /^([1-9]\d{0,8}) PZA$/.exec(lines[i]);
    required(m, "UNSUPPORTED_SOURCE_QUANTITY_OR_UNIT");
    required(
      i + 4 < end && literal(lines[i + 1]) && literal(lines[i + 2]),
      "ITEM_BLOCK_REQUIRED",
    );
    const unit = mxnCents(lines[i + 3]);
    let offset = 4,
      adjustment = null,
      adjustmentCents = 0;
    if (/^[-\d.]+%/.test(lines[i + 4])) {
      const adj = /^(-?\d+(?:\.\d+)?%) \((-?)(\$[\d,.]+)\)$/.exec(lines[i + 4]);
      required(adj, "SOURCE_ADJUSTMENT_INVALID");
      adjustment = lines[i + 4];
      adjustmentCents = mxnCents(adj[3]) * (adj[2] === "-" ? -1 : 1);
      offset = 5;
    }
    const amount = mxnCents(lines[i + offset]);
    items.push({
      line_index: items.length,
      barcode: lines[i + 1],
      quantity: m[1],
      unit: "PZA",
      source_description: lines[i + 2],
      unit_amount_cents: unit,
      line_amount_cents: amount,
      source_adjustment_label: adjustment,
      source_adjustment_cents: adjustmentCents,
    });
    i += offset;
  }
  required(items.length > 0, "ITEMS_REQUIRED");
  return items;
}

export function paymentBreakdownEntries(text) {
  const pattern =
    /(?:^|\n)(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} [AP]M)\s*\n+Abono (\d+)( Cancelado)?\s*\n/g;
  const matches = [...text.matchAll(pattern)];
  return matches.map((m, i) => {
    sourceDate(m[1].slice(0, 10));
    const chunk = text.slice(m.index, matches[i + 1]?.index);
    const amount = one(
      chunk,
      /(?:^|\n)(-?\$[\d,.]+) MXN(?:\n|$)/g,
      "PAYMENT_ROW_AMOUNT_REQUIRED",
    );
    const negative = amount.startsWith("-"),
      cancelled = !!m[3];
    required(negative === cancelled, "PAYMENT_REVERSAL_SIGN_INVALID");
    const cents = mxnCents(negative ? amount.slice(1) : amount);
    required(cents > 0, "PAYMENT_ROW_ZERO_INVALID");
    return { source_ref: "Abono " + m[2], amount_cents: cents, cancelled };
  });
}

export function reconcileGeneralCredit(data, at) {
  required(
    Number.isFinite(Date.parse(at)) && data.project_id === project,
    "STAGING_ASSESSMENT_REQUIRED",
  );
  const { queue, accounts, details, mapping } = data;
  required(
    Array.isArray(queue) &&
      queue.length > 0 &&
      Array.isArray(accounts) &&
      Array.isArray(details),
    "SOURCE_SCOPE_REQUIRED",
  );
  required(
    mapping?.project_id === project &&
      fresh(mapping.captured_at, at) &&
      Array.isArray(mapping.rows),
    "FRESH_EXACT_MAPPING_REQUIRED",
  );
  const map = new Map();
  for (const row of mapping.rows) {
    required(
      literal(row.barcode) &&
        !map.has(row.barcode) &&
        Array.isArray(row.variants) &&
        new Set(row.variants).size === row.variants.length &&
        row.variants.every((x) =>
          /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x),
        ),
      "MAPPING_INVALID",
    );
    map.set(row.barcode, row.variants);
  }
  const expected = new Map(),
    accountMap = new Map(),
    observed = new Map();
  for (const q of queue) {
    required(
      literal(q.folio) &&
        literal(q.expected_name) &&
        /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(q.client_ref) &&
        Number.isSafeInteger(q.expected_total_cents) &&
        q.expected_total_cents > 0 &&
        Number.isSafeInteger(q.expected_balance_cents) &&
        q.expected_balance_cents > 0 &&
        q.expected_balance_cents <= q.expected_total_cents &&
        (q.expected_source_document_id === null ||
          /^[a-f0-9]{24}$/.test(q.expected_source_document_id)) &&
        q.delivery_status === "UNKNOWN" &&
        q.document_key === keyFor(q.client_ref, q.folio) &&
        !expected.has(q.document_key) &&
        q.operational_import_allowed === false,
      "QUEUE_IDENTITY_INVALID",
    );
    expected.set(q.document_key, q);
  }
  for (const a of accounts) {
    required(
      !accountMap.has(a.client_ref) &&
        fresh(a.captured_at, at) &&
        a.full_reload_before_read === true &&
        literal(a.name) &&
        Array.isArray(a.table_folios) &&
        new Set(a.table_folios).size === a.table_folios.length,
      "ACCOUNT_SCOPE_INVALID",
    );
    required(
      queue.some(
        (q) => q.client_ref === a.client_ref && q.expected_name === a.name,
      ),
      "ACCOUNT_IDENTITY_CHANGED",
    );
    accountMap.set(a.client_ref, a);
  }
  required(
    new Set(queue.map((q) => q.client_ref)).size === accountMap.size,
    "ACCOUNT_SCOPE_INCOMPLETE",
  );
  for (const d of details) {
    required(
      d.document_key === keyFor(d.client_ref, d.folio) &&
        !observed.has(d.document_key) &&
        accountMap.has(d.client_ref) &&
        fresh(d.captured_at, at) &&
        d.full_reload_before_read === true &&
        d.delivery_status === "UNKNOWN",
      "DETAIL_SCOPE_INVALID",
    );
    observed.set(d.document_key, d);
  }
  const documents = [],
    payments = [],
    items = [],
    issues = [];
  for (const [key, d] of observed) {
    const a = accountMap.get(d.client_ref),
      q = expected.get(key);
    const holds = [];
    try {
      required(
        typeof d.detail_text === "string" &&
          d.detail_text.split("\n")[0] === d.folio,
        "DETAIL_FOLIO_INVALID",
      );
      const sourceId = one(
        d.detail_text,
        /Cód Doc\.\s*([a-f0-9]{24})\b/g,
        "SOURCE_ID_REQUIRED",
      );
      const name = one(
        d.detail_text,
        /Cliente:\s*\n+([^\n]+)\n/g,
        "DOCUMENT_CUSTOMER_REQUIRED",
      );
      const warehouse = one(
        d.detail_text,
        /Almacén:\s*\n+([^\n]+)\n/g,
        "WAREHOUSE_REQUIRED",
      );
      if (name !== a.name) holds.push("HISTORICAL_CUSTOMER_NAME_DIFFERS");
      const total = money(
        d.detail_text,
        /(?:^|\n)MXN (\$[\d,.]+)(?:\n|$)/g,
        "DOCUMENT_TOTAL_REQUIRED",
      );
      required(
        typeof d.payment_text === "string" &&
          d.payment_text.startsWith("Forma de pago"),
        "PAYMENT_BREAKDOWN_REQUIRED",
      );
      // Woo/SICAR presentation may put a space in VSM 123, only for corroboration.
      const payFolio = one(
        d.payment_text,
        /(?:^|\n)Folio\s*\n+([^\n]+)\n/g,
        "PAYMENT_FOLIO_REQUIRED",
      );
      required(
        payFolio === d.folio ||
          (/^VSM\d+$/.test(d.folio) &&
            payFolio === d.folio.replace("VSM", "VSM ")),
        "PAYMENT_FOLIO_MISMATCH",
      );
      const paid = money(
        d.payment_text,
        /(?:^|\n)Abono total: (\$[\d,.]+) MXN(?:\n|$)/g,
        "PAID_TOTAL_REQUIRED",
      );
      const balance = money(
        d.payment_text,
        /(?:^|\n)Saldo: (\$[\d,.]+)(?:\n|$)/g,
        "PAYMENT_BALANCE_REQUIRED",
      );
      const payTotal = money(
        d.payment_text,
        /(?:^|\n)Total (\$[\d,.]+) MXN(?:\n|$)/g,
        "PAYMENT_TOTAL_REQUIRED",
      );
      required(
        total === payTotal && sum([paid, balance]) === total && total > 0,
        "PAYMENT_ARITHMETIC_MISMATCH",
      );
      let due = null;
      if (balance > 0) {
        required(
          money(
            d.detail_text,
            /(?:^|\n)Saldo (\$[\d,.]+)(?:\n|$)/g,
            "DETAIL_BALANCE_REQUIRED",
          ) === balance,
          "DETAIL_BALANCE_MISMATCH",
        );
        due = sourceDate(
          one(
            d.detail_text,
            /Venc(?:e|ió) el (\d{2}\/\d{2}\/\d{4})/g,
            "DUE_DATE_REQUIRED",
          ),
        );
      }
      let linked = [],
        paymentEvidence;
      if (/Documentos vinculados\s*\(\d+\)/.test(d.detail_text)) {
        required(typeof d.linked_text === "string", "LINKED_EVIDENCE_REQUIRED");
        linked = parseLinkedAbonos(d);
        const title = one(
          d.linked_text,
          /^Documentos vinculados - Venta ([^\n]+)\n/g,
          "LINKED_FOLIO_REQUIRED",
        );
        required(
          title === d.folio ||
            (/^VSM\d+$/.test(d.folio) &&
              title === d.folio.replace("VSM", "VSM ")),
          "LINKED_FOLIO_MISMATCH",
        );
        required(
          sum(linked.filter((p) => !p.cancelled).map((p) => p.amount_cents)) ===
            paid,
          "LINKED_ACTIVE_AMOUNT_MISMATCH",
        );
        paymentEvidence = "LINKED_ACTIVE_AND_CANCELLED_RECONCILED";
      } else {
        required(
          d.linked_text === null &&
            paid === 0 &&
            !/(?:^|\n)Abono \d+/.test(d.payment_text),
          "ZERO_ACTIVE_EVIDENCE_REQUIRED",
        );
        paymentEvidence =
          "EXPLICIT_ZERO_ACTIVE_BREAKDOWN_LINKED_HISTORY_NOT_OBSERVED";
      }
      if (!q) {
        required(
          a.unexpected_folios.includes(d.folio) &&
            a.table_folios.includes(d.folio),
          "UNEXPECTED_DOCUMENT_NOT_IN_ACCOUNT",
        );
        holds.push("NEW_DOCUMENT_SINCE_BASELINE");
      } else {
        if (
          q.expected_total_cents !== total ||
          q.expected_balance_cents !== balance
        )
          holds.push("AMOUNT_CHANGED_SINCE_BASELINE");
        if (
          q.expected_source_document_id !== null &&
          q.expected_source_document_id !== sourceId
        )
          holds.push("SOURCE_ID_CHANGED");
      }
      const breakdown = paymentBreakdownEntries(d.payment_text);
      const uniqueBreakdown = new Set(
        breakdown.map((p) => p.source_ref + "|" + p.cancelled),
      );
      required(
        uniqueBreakdown.size === breakdown.length,
        "PAYMENT_BREAKDOWN_DUPLICATE",
      );
      required(
        breakdown.length ===
          linked.length + linked.filter((p) => p.cancelled).length,
        "PAYMENT_BREAKDOWN_SCOPE_MISMATCH",
      );
      for (const p of linked) {
        const original = breakdown.filter(
          (b) => b.source_ref === p.source_ref && !b.cancelled,
        );
        const reversal = breakdown.filter(
          (b) => b.source_ref === p.source_ref && b.cancelled,
        );
        required(
          original.length === 1 &&
            original[0].amount_cents === p.amount_cents &&
            reversal.length === (p.cancelled ? 1 : 0) &&
            (!p.cancelled || reversal[0].amount_cents === p.amount_cents),
          "PAYMENT_BREAKDOWN_LINK_MISMATCH",
        );
      }
      const rows = creditDetailLines(d.detail_text),
        documentItems = [];
      if (sum(rows.map((x) => x.line_amount_cents)) !== total)
        holds.push("LINE_SUM_DIFFERS_FROM_TOTAL");
      for (const row of rows) {
        required(map.has(row.barcode), "MAPPING_SCOPE_INCOMPLETE");
        const variants = map.get(row.barcode);
        const lineHolds = ["DELIVERY_NOT_OBSERVED"];
        let variant = null;
        if (
          row.barcode === "SX00000" ||
          /^DEBE\b/i.test(row.source_description)
        )
          lineHolds.push("LEGACY_GENERIC_DEBT_LINE");
        else if (variants.length === 1) variant = variants[0];
        else
          lineHolds.push(
            variants.length ? "AMBIGUOUS_BARCODE" : "BARCODE_NOT_IN_STAGING",
          );
        if (
          BigInt(row.quantity) * BigInt(row.unit_amount_cents) -
            BigInt(row.source_adjustment_cents) !==
          BigInt(row.line_amount_cents)
        )
          lineHolds.push("SOURCE_LINE_PRICE_REVIEW");
        documentItems.push({
          ...row,
          document_key: key,
          variant_id: variant,
          holds: lineHolds,
          delivery_status: "UNKNOWN",
          reserved_qty: null,
          stock_deduction: null,
        });
      }
      items.push(...documentItems);
      for (const p of linked)
        payments.push({
          ...p,
          document_key: key,
          payment_key: digest({ tenant: "VSM", source_ref: p.source_ref }),
          replay_as_cash: false,
        });
      documents.push({
        document_key: key,
        customer_key: digest({ tenant: "VSM", client_ref: d.client_ref }),
        client_ref: d.client_ref,
        source_folio: d.folio,
        source_document_id: sourceId,
        source_customer_name: name,
        warehouse,
        due_date: due,
        total_cents: total,
        balance_cents: balance,
        paid_to_date_cents: paid,
        financial_status: balance ? "OPEN" : "PAID",
        payment_evidence: paymentEvidence,
        linked_history_complete: d.linked_text !== null,
        source_at: d.captured_at,
        source_evidence_sha256: sha(JSON.stringify(d)),
        in_baseline: !!q,
        holds,
        operational_import_allowed: false,
        delivery_status: "UNKNOWN",
      });
    } catch (e) {
      issues.push({
        document_key: key,
        code: e.message,
        evidence_sha256: sha(JSON.stringify(d)),
      });
    }
  }
  required(
    new Set(documents.map((d) => d.source_document_id)).size ===
      documents.length,
    "SOURCE_DOCUMENT_ID_REUSED",
  );
  required(
    new Set(payments.map((p) => p.payment_key)).size === payments.length,
    "SOURCE_PAYMENT_REUSED",
  );
  const reconciledAccounts = [];
  for (const a of accounts) {
    const held = [];
    let used = null;
    try {
      used = money(
        a.state,
        /- text: Saldo utilizado\s*\n\s*- paragraph: (\$[\d,.]+)/g,
        "ACCOUNT_BALANCE_REQUIRED",
      );
    } catch (e) {
      held.push(e.message);
    }
    const docs = documents.filter((d) => d.client_ref === a.client_ref),
      open = docs.filter((d) => d.balance_cents > 0);
    const missing = a.table_folios.filter(
      (f) => !open.some((d) => d.source_folio === f),
    );
    const orphan = open.filter((d) => !a.table_folios.includes(d.source_folio));
    if (
      missing.length ||
      orphan.length ||
      used !== sum(open.map((d) => d.balance_cents))
    )
      held.push("ACCOUNT_DOCUMENT_BALANCE_MISMATCH");
    reconciledAccounts.push({
      client_ref: a.client_ref,
      customer_key: digest({ tenant: "VSM", client_ref: a.client_ref }),
      used_cents: used,
      document_balance_cents: sum(open.map((d) => d.balance_cents)),
      missing_folios: missing,
      holds: held,
      source_at: a.captured_at,
      operational_import_allowed: false,
    });
  }
  const missing = [...expected.keys()].filter(
    (k) => !documents.some((d) => d.document_key === k),
  );
  const stamps = [...accounts, ...details].map((d) => d.captured_at).sort();
  return {
    version: "m9-general-credit-details-1",
    mode: "READ_ONLY_SOURCE_RECONCILIATION",
    project_id: project,
    assessed_at: at,
    source_from: stamps[0],
    source_until: stamps.at(-1),
    baseline_refreshed: false,
    simultaneous_closing_cut: false,
    production_allowed: false,
    operational_import_allowed: false,
    inventory_import_allowed: false,
    summary: {
      baseline_documents: queue.length,
      captured_expected: documents.filter((d) => d.in_baseline).length,
      additional_documents: documents.filter((d) => !d.in_baseline).length,
      verified_documents: documents.length,
      missing_expected: missing.length,
      document_errors: issues.length,
      accounts: accounts.length,
      accounts_reconciled: reconciledAccounts.filter((a) => !a.holds.length)
        .length,
      open_documents: documents.filter((d) => d.balance_cents > 0).length,
      paid_documents: documents.filter((d) => d.balance_cents === 0).length,
      observed_balance_cents: sum(documents.map((d) => d.balance_cents)),
      historical_active_paid_cents: sum(
        payments.filter((p) => !p.cancelled).map((p) => p.amount_cents),
      ),
      linked_payments: payments.length,
      cancelled_payments: payments.filter((p) => p.cancelled).length,
      cancelled_amount_cents: sum(
        payments.filter((p) => p.cancelled).map((p) => p.amount_cents),
      ),
      explicit_zero_active_documents: documents.filter(
        (d) => !d.linked_history_complete,
      ).length,
      changed_amounts: documents.filter((d) =>
        d.holds.includes("AMOUNT_CHANGED_SINCE_BASELINE"),
      ).length,
      historical_name_differences: documents.filter((d) =>
        d.holds.includes("HISTORICAL_CUSTOMER_NAME_DIFFERS"),
      ).length,
      credit_lines: items.length,
      mapped_lines: items.filter((l) => l.variant_id).length,
      unknown_deliveries: items.length,
    },
    accounts: reconciledAccounts,
    documents,
    payments,
    lines: items,
    issues,
    missing_expected: missing,
  };
}

export function generalCreditDetailSQL(plan) {
  required(
    plan.project_id === project &&
      plan.version === "m9-general-credit-details-1" &&
      plan.operational_import_allowed === false &&
      plan.production_allowed === false &&
      plan.inventory_import_allowed === false &&
      plan.issues.length === 0 &&
      plan.missing_expected.length === 0 &&
      plan.accounts.every((a) => a.holds.length === 0),
    "COMPLETE_READONLY_REHEARSAL_REQUIRED",
  );
  const p = {
    accounts: plan.accounts.map((a) => ({
      key: a.customer_key,
      balance: a.used_cents,
    })),
    documents: plan.documents.map((d) => ({
      key: d.document_key,
      customer: d.customer_key,
      total: d.total_cents,
      balance: d.balance_cents,
      paid: d.paid_to_date_cents,
    })),
    payments: plan.payments.map((p) => ({
      key: p.payment_key,
      document: p.document_key,
      amount: p.amount_cents,
      cancelled: p.cancelled,
    })),
    lines: plan.lines.map((l) => ({
      document: l.document_key,
      index: l.line_index,
      barcode: l.barcode,
      quantity: l.quantity,
      variant: l.variant_id,
      delivery: l.delivery_status,
      reserved: l.reserved_qty,
      deduction: l.stock_deduction,
    })),
  };
  const literal = quoteDoText(JSON.stringify(p), "$m9details$");
  return `begin;
set local standard_conforming_strings=on;
set local statement_timeout='120s';
create temporary table m9_detail_accounts(key text primary key,balance bigint not null check(balance>=0)) on commit drop;
create temporary table m9_detail_docs(key text primary key,customer text references m9_detail_accounts(key),total bigint not null check(total>0),balance bigint not null check(balance>=0),paid bigint not null check(paid>=0),check(total=balance+paid)) on commit drop;
create temporary table m9_detail_payments(key text primary key,document text references m9_detail_docs(key),amount bigint not null check(amount>0),cancelled boolean not null) on commit drop;
create temporary table m9_detail_lines(document text references m9_detail_docs(key),line_index int,barcode text not null,quantity numeric not null check(quantity>0),variant uuid,delivery text check(delivery='UNKNOWN'),reserved numeric check(reserved is null),deduction numeric check(deduction is null),primary key(document,line_index)) on commit drop;
create temporary table m9_detail_replay(key text primary key,payload jsonb not null) on commit drop;
create temporary table m9_detail_result(result jsonb) on commit drop;
do $m9details$
declare p jsonb:=${literal}::jsonb;r jsonb;rejected int:=0;n int:=0;
begin
 perform app.assert_sicar_staging_enabled();
 for r in select value from jsonb_array_elements(p->'accounts') loop insert into m9_detail_accounts values(r->>'key',(r->>'balance')::bigint);end loop;
 for r in select value from jsonb_array_elements(p->'documents') loop insert into m9_detail_docs values(r->>'key',r->>'customer',(r->>'total')::bigint,(r->>'balance')::bigint,(r->>'paid')::bigint);end loop;
 for r in select value from jsonb_array_elements(p->'payments') loop insert into m9_detail_payments values(r->>'key',r->>'document',(r->>'amount')::bigint,(r->>'cancelled')::boolean);end loop;
 for r in select value from jsonb_array_elements(p->'lines') loop insert into m9_detail_lines values(r->>'document',(r->>'index')::int,r->>'barcode',(r->>'quantity')::numeric,(r->>'variant')::uuid,r->>'delivery',nullif(r->>'reserved','')::numeric,nullif(r->>'deduction','')::numeric);end loop;
 if exists(select 1 from m9_detail_accounts a left join m9_detail_docs d on d.customer=a.key group by a.key,a.balance having a.balance<>coalesce(sum(d.balance),0)) then raise exception 'ACCOUNT_TOTAL_DIFFERS';end if;
 if exists(select 1 from m9_detail_docs d left join m9_detail_payments p on p.document=d.key and not p.cancelled group by d.key,d.paid having d.paid<>coalesce(sum(p.amount),0)) then raise exception 'ACTIVE_PAYMENTS_DIFFER';end if;
 if exists(select 1 from m9_detail_lines l where variant is not null and (not exists(select 1 from public.barcodes b join public.variants v on v.id=b.variant_id where b.code=l.barcode and b.variant_id=l.variant) or (select count(distinct b.variant_id) from public.barcodes b where b.code=l.barcode)<>1)) then raise exception 'LITERAL_VARIANT_MAPPING_CHANGED';end if;
 for r in select value from jsonb_array_elements(p->'documents') loop insert into m9_detail_replay values(r->>'key',r);end loop;
 for r in select value from jsonb_array_elements(p->'documents') loop insert into m9_detail_replay values(r->>'key',r) on conflict(key) do update set payload=case when m9_detail_replay.payload=excluded.payload then excluded.payload else null end;n:=n+1;end loop;
 begin r:=p->'documents'->0;insert into m9_detail_replay values(r->>'key',r||'{"paid":-1}'::jsonb) on conflict(key) do update set payload=case when m9_detail_replay.payload=excluded.payload then excluded.payload else null end;raise exception 'CONFLICT_ACCEPTED';exception when not_null_violation then rejected:=rejected+1;end;
 begin insert into m9_detail_docs values('negative',p->'accounts'->0->>'key',100,-1,101);raise exception 'NEGATIVE_ACCEPTED';exception when check_violation then rejected:=rejected+1;end;
 begin insert into m9_detail_docs values('orphan','absent',100,100,0);raise exception 'ORPHAN_ACCEPTED';exception when foreign_key_violation then rejected:=rejected+1;end;
 begin insert into m9_detail_payments values('zero',p->'documents'->0->>'key',0,false);raise exception 'ZERO_PAYMENT_ACCEPTED';exception when check_violation then rejected:=rejected+1;end;
 begin insert into m9_detail_lines values(p->'documents'->0->>'key',999,'000123',1,null,'UNKNOWN',0,null);raise exception 'INVENTED_RESERVATION_ACCEPTED';exception when check_violation then rejected:=rejected+1;end;
 insert into m9_detail_result values(jsonb_build_object('mode','TEMP_DETAIL_RECONCILIATION_ROLLBACK','accounts',(select count(*) from m9_detail_accounts),'documents',(select count(*) from m9_detail_docs),'observed_balance_cents',(select sum(balance) from m9_detail_docs),'historical_payments',(select count(*) from m9_detail_payments),'cancelled_excluded',(select count(*) from m9_detail_payments where cancelled),'credit_lines',(select count(*) from m9_detail_lines),'mapped_lines',(select count(*) from m9_detail_lines where variant is not null),'replayed_documents',n,'negative_checks',rejected,'native_imports',0,'new_cash_payments',0,'stock_movements',0));
end $m9details$;
select * from m9_detail_result;
rollback;
`;
}

export function prepareGeneralCreditDetails(configPath, out) {
  const config = JSON.parse(readFileSync(configPath)),
    data = { project_id: project },
    inputs = {};
  for (const name of ["queue", "accounts", "details", "mapping"]) {
    const pin = config.inputs?.[name];
    required(
      typeof pin?.path === "string" && /^[a-f0-9]{64}$/.test(pin.sha256 ?? ""),
      "PIN_REQUIRED:" + name,
    );
    const raw = readFileSync(resolve(dirname(configPath), pin.path));
    required(sha(raw) === pin.sha256, "INPUT_CHANGED:" + name);
    data[name] = JSON.parse(raw);
    inputs[name] = pin.sha256;
  }
  const plan = {
    ...reconcileGeneralCredit(data, config.assessment_at),
    inputs,
  };
  mkdirSync(out, { mode: 0o700 });
  const files = {
    "conciliacion-privada.json": JSON.stringify(plan, null, 2) + "\n",
    "ensayo-rollback.sql": generalCreditDetailSQL(plan),
  };
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(out, name), content, { flag: "wx", mode: 0o600 });
  writeFileSync(
    join(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([n, c]) => [n, sha(c)])),
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return plan.summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  required(process.argv.length === 4, "Usage: PINNED_CONFIG NEW_OUTPUT");
  console.log(
    prepareGeneralCreditDetails(
      resolve(process.argv[2]),
      resolve(process.argv[3]),
    ),
  );
}
