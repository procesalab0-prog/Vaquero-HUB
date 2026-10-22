import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./acceleration.mjs";
import { reconcileGeneralCredit } from "./reconcile-general-credit-details.mjs";

const PROJECT = "zsezjtswqeijboezvado";
const LOCATION = "467765fe-d18e-43bb-be68-326adbf05ce1";
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const rawSha = (x) => createHash("sha256").update(x).digest("hex");
const requireValue = (ok, message) => {
  if (!ok) throw Error(message);
};
const cents = (v) => Number.isSafeInteger(v) && v >= 0;
const literal = (v) => typeof v === "string" && v.length > 0 && v === v.trim();
const isoUTC = (v) => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)
  )
    return false;
  const stamp = Date.parse(v);
  return (
    Number.isFinite(stamp) &&
    new Date(stamp).toISOString() ===
      (v.includes(".") ? v : v.replace("Z", ".000Z"))
  );
};
const controls = (v) =>
  Array.from(v).some((c) => {
    const code = c.codePointAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
const sum = (values) => {
  const n = values.reduce((s, v) => s + BigInt(v), 0n);
  requireValue(n >= 0n && n <= BigInt(Number.MAX_SAFE_INTEGER), "UNSAFE_SUM");
  return Number(n);
};
const fresh = (stamp, at, max = 86400000) =>
  isoUTC(stamp) &&
  isoUTC(at) &&
  Date.parse(stamp) <= Date.parse(at) &&
  Date.parse(at) - Date.parse(stamp) <= max;
const sort = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const unique = (rows, field, error) => {
  requireValue(Array.isArray(rows), error);
  const m = new Map();
  for (const r of rows) {
    requireValue(r && literal(r[field]) && !m.has(r[field]), error);
    m.set(r[field], r);
  }
  return m;
};
const sameSet = (a, b) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  [...a].sort(sort).every((x, i) => x === [...b].sort(sort)[i]);

// This fingerprint binds a review to amounts, identity, literal codes AND the
// active/cancelled payment state; equal totals alone never validate a refresh.
export function clientesDocumentFingerprint(plan, key) {
  const d = plan.documents.find((x) => x.document_key === key);
  requireValue(d, "DOCUMENT_REQUIRED");
  return digest({
    document: d,
    payments: plan.payments
      .filter((p) => p.document_key === key)
      .sort((a, b) => sort(a.payment_key, b.payment_key)),
    lines: plan.lines
      .filter((l) => l.document_key === key)
      .sort((a, b) => a.line_index - b.line_index),
  });
}

function validatePlan(plan) {
  requireValue(
    plan?.version === "m9-general-credit-details-1" &&
      plan.project_id === PROJECT &&
      plan.production_allowed === false &&
      plan.operational_import_allowed === false &&
      plan.inventory_import_allowed === false &&
      plan.baseline_refreshed === false &&
      plan.simultaneous_closing_cut === false &&
      Array.isArray(plan.issues) &&
      Array.isArray(plan.missing_expected),
    "READONLY_RECONCILIATION_REQUIRED",
  );
  const accounts = unique(
    plan.accounts,
    "customer_key",
    "ACCOUNT_DUPLICATE_OR_INVALID",
  );
  const docs = unique(
    plan.documents,
    "document_key",
    "DOCUMENT_DUPLICATE_OR_INVALID",
  );
  unique(plan.documents, "source_document_id", "SOURCE_DOCUMENT_ID_REUSED");
  unique(plan.payments, "payment_key", "PAYMENT_DUPLICATE_OR_INVALID");
  const lineKeys = new Set();
  for (const a of accounts.values()) {
    requireValue(
      UUID.test(a.client_ref) &&
        a.customer_key ===
          digest({ tenant: "VSM", client_ref: a.client_ref }) &&
        cents(a.used_cents) &&
        Array.isArray(a.holds),
      "ACCOUNT_IDENTITY_INVALID",
    );
  }
  for (const d of docs.values()) {
    requireValue(
      accounts.has(d.customer_key) &&
        accounts.get(d.customer_key).client_ref === d.client_ref &&
        d.document_key ===
          digest({
            tenant: "VSM",
            client_ref: d.client_ref,
            folio: d.source_folio,
          }) &&
        /^[a-f0-9]{24}$/.test(d.source_document_id) &&
        literal(d.source_folio) &&
        cents(d.balance_cents) &&
        cents(d.paid_to_date_cents) &&
        cents(d.total_cents) &&
        d.total_cents > 0 &&
        d.total_cents === sum([d.balance_cents, d.paid_to_date_cents]) &&
        Array.isArray(d.holds) &&
        d.operational_import_allowed === false &&
        d.delivery_status === "UNKNOWN" &&
        typeof d.linked_history_complete === "boolean" &&
        (d.balance_cents === 0
          ? d.financial_status === "PAID"
          : d.financial_status === "OPEN" && isoUTC(d.due_date + "T00:00:00Z")),
      "DOCUMENT_INVALID",
    );
  }
  for (const p of plan.payments) {
    requireValue(
      docs.has(p.document_key) &&
        cents(p.amount_cents) &&
        p.amount_cents > 0 &&
        typeof p.cancelled === "boolean" &&
        p.replay_as_cash === false &&
        p.payment_key === digest({ tenant: "VSM", source_ref: p.source_ref }),
      "PAYMENT_INVALID",
    );
  }
  requireValue(Array.isArray(plan.lines), "LINES_REQUIRED");
  for (const l of plan.lines) {
    const key = l.document_key + ":" + l.line_index;
    requireValue(
      docs.has(l.document_key) &&
        Number.isSafeInteger(l.line_index) &&
        l.line_index >= 0 &&
        !lineKeys.has(key) &&
        literal(l.barcode) &&
        /^[1-9]\d{0,8}$/.test(l.quantity) &&
        (l.variant_id === null || UUID.test(l.variant_id)) &&
        Array.isArray(l.holds) &&
        l.delivery_status === "UNKNOWN" &&
        l.reserved_qty === null &&
        l.stock_deduction === null,
      "LITERAL_LINE_OR_UNKNOWN_DELIVERY_INVALID",
    );
    lineKeys.add(key);
  }
  for (const d of docs.values()) {
    requireValue(
      plan.lines.some((l) => l.document_key === d.document_key) &&
        sum(
          plan.payments
            .filter((p) => p.document_key === d.document_key && !p.cancelled)
            .map((p) => p.amount_cents),
        ) === d.paid_to_date_cents,
      "ACTIVE_PAYMENTS_OR_LINES_INCOMPLETE",
    );
  }
  for (const a of accounts.values()) {
    requireValue(
      a.used_cents ===
        sum(
          plan.documents
            .filter((d) => d.customer_key === a.customer_key)
            .map((d) => d.balance_cents),
        ),
      "ACCOUNT_TOTAL_MISMATCH",
    );
  }
  return { accounts, docs };
}

function validateDestination(d, at) {
  requireValue(
    d?.protocol === "m9-clientes-destination-snapshot-1" &&
      d.project_id === PROJECT &&
      d.complete === true &&
      isoUTC(at),
    "COMPLETE_STAGING_DESTINATION_REQUIRED",
  );
  const sources = unique(
    d.sources,
    "customer_key",
    "DESTINATION_SOURCE_DUPLICATE",
  );
  unique(d.sources, "source_ref", "DESTINATION_REF_DUPLICATE");
  const registries = unique(d.registries, "customer_key", "REGISTRY_DUPLICATE");
  unique(d.registries, "registry_id", "REGISTRY_ID_DUPLICATE");
  const docs = unique(
    d.documents,
    "document_key",
    "DESTINATION_DOCUMENT_DUPLICATE",
  );
  const mapping = unique(d.mapping, "barcode", "DESTINATION_MAPPING_DUPLICATE");
  for (const m of mapping.values())
    requireValue(
      Array.isArray(m.variants) &&
        new Set(m.variants).size === m.variants.length &&
        m.variants.every((v) => UUID.test(v)),
      "DESTINATION_MAPPING_INVALID",
    );
  unique(d.payments, "payment_key", "DESTINATION_PAYMENT_DUPLICATE");
  requireValue(
    Array.isArray(d.openings) && Array.isArray(d.native_openings),
    "OPENING_SNAPSHOT_REQUIRED",
  );
  for (const s of sources.values())
    requireValue(
      SHA.test(s.customer_key) &&
        [
          "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS",
          "SYNTHETIC_QA_NOT_SICAR",
        ].includes(s.source_scope) &&
        (s.source_scope === "SYNTHETIC_QA_NOT_SICAR"
          ? literal(s.source_ref)
          : UUID.test(s.source_ref)) &&
        SHA.test(s.batch_sha256) &&
        cents(s.used_cents) &&
        [s.target_customer_id, s.opening_event_id, s.reversed_event_id].every(
          (v) => v === null || UUID.test(v),
        ),
      "DESTINATION_SOURCE_INVALID",
    );
  for (const r of registries.values())
    requireValue(
      sources.has(r.customer_key) &&
        UUID.test(r.registry_id) &&
        r.batch_sha256 === sources.get(r.customer_key).batch_sha256,
      "REGISTRY_SOURCE_MISMATCH",
    );
  for (const x of docs.values())
    requireValue(
      sources.has(x.customer_key) &&
        cents(x.total_cents) &&
        cents(x.balance_cents) &&
        cents(x.paid_cents) &&
        x.total_cents === sum([x.balance_cents, x.paid_cents]) &&
        [x.opening_ledger_id, x.reversal_ledger_id].every(
          (v) => v === null || UUID.test(v),
        ),
      "DESTINATION_DOCUMENT_INVALID",
    );
  for (const p of d.payments)
    requireValue(
      docs.has(p.document_key) &&
        cents(p.amount_cents) &&
        p.amount_cents > 0 &&
        typeof p.cancelled === "boolean",
      "DESTINATION_PAYMENT_INVALID",
    );
  for (const o of d.openings)
    requireValue(
      docs.has(o.document_key) &&
        [...registries.values()].some((r) => r.registry_id === o.registry_id) &&
        [
          "OPEN",
          "REVERSE",
          "PAYMENT_TRIAL",
          "PAYMENT",
          "PAYMENT_VOID",
        ].includes(o.kind) &&
        Number.isSafeInteger(o.amount_cents),
      "DESTINATION_OPENING_INVALID",
    );
  for (const o of d.native_openings)
    requireValue(
      SHA.test(o.document_key) && Number.isSafeInteger(o.amount_cents),
      "NATIVE_OPENING_INVALID",
    );
  return { sources, registries, docs, mapping };
}

function paymentChanges(plan, destination, key) {
  const current = plan.payments.filter((p) => p.document_key === key),
    previous = destination.payments.filter((p) => p.document_key === key),
    now = new Map(current.map((p) => [p.payment_key, p])),
    before = new Map(previous.map((p) => [p.payment_key, p])),
    changes = [];
  for (const p of previous) {
    const n = now.get(p.payment_key);
    if (!n)
      changes.push({ type: "PAYMENT_REMOVED", payment_key: p.payment_key });
    else {
      if (n.source_ref !== p.source_ref || n.amount_cents !== p.amount_cents)
        changes.push({
          type: "PAYMENT_IDENTITY_OR_AMOUNT_CHANGED",
          payment_key: p.payment_key,
        });
      if (n.cancelled !== p.cancelled)
        changes.push({
          type: n.cancelled ? "PAYMENT_CANCELLED" : "PAYMENT_REACTIVATED",
          payment_key: p.payment_key,
        });
    }
  }
  for (const p of current)
    if (!before.has(p.payment_key))
      changes.push({ type: "PAYMENT_ADDED", payment_key: p.payment_key });
  return changes;
}

/** A read-only rehearsal gate, NOT an import payload or approval authority.
 * No amount is opened here; every account remains operationally disabled. */
export function evaluateClientesStages(
  { plan, source_sha256, destination, cut = null, reviews = [] },
  at,
) {
  requireValue(SHA.test(source_sha256 ?? ""), "PINNED_SOURCE_REQUIRED");
  const { accounts, docs } = validatePlan(plan);
  const existing = validateDestination(destination, at);
  const reviewMap = unique(
    reviews,
    "document_key",
    "REVIEW_DUPLICATE_OR_INVALID",
  );
  for (const r of reviews)
    requireValue(
      docs.has(r.document_key) &&
        SHA.test(r.document_fingerprint ?? "") &&
        SHA.test(r.evidence_sha256 ?? "") &&
        UUID.test(r.reviewed_by ?? "") &&
        fresh(r.reviewed_at, at) &&
        r.source_identity_confirmed === true &&
        r.current_finances_confirmed === true &&
        r.target === "HERITAGE_REGISTRY" &&
        Array.isArray(r.resolved_holds) &&
        r.resolved_holds.every((x) =>
          [
            "HISTORICAL_CUSTOMER_NAME_DIFFERS",
            "AMOUNT_CHANGED_SINCE_BASELINE",
            "NEW_DOCUMENT_SINCE_BASELINE",
          ].includes(x),
        ),
      "REVIEW_EVIDENCE_INVALID",
    );
  const globalHolds = [];
  if (
    plan.issues.length ||
    plan.missing_expected.length ||
    [...accounts.values()].some((a) => a.holds.length)
  )
    globalHolds.push("SOURCE_RECONCILIATION_INCOMPLETE");
  if (
    ![
      plan.source_from,
      plan.source_until,
      ...plan.accounts.map((a) => a.source_at),
      ...plan.documents.map((d) => d.source_at),
    ].every((s) => fresh(s, at))
  )
    globalHolds.push("SOURCE_CUT_STALE_OR_FUTURE");
  if (!fresh(destination.captured_at, at, 3600000))
    globalHolds.push("DESTINATION_SNAPSHOT_STALE_OR_FUTURE");
  if (!cut) globalHolds.push("CLOSING_CUT_NOT_ATTESTED");
  else {
    requireValue(
      cut.protocol === "m9-clientes-cut-1" &&
        cut.project_id === PROJECT &&
        cut.source_plan_sha256 === source_sha256 &&
        cut.source_from === plan.source_from &&
        cut.source_until === plan.source_until &&
        Array.isArray(cut.account_keys) &&
        cut.scope === "OBSERVED_INDEBTED_ACCOUNT_SUBSET" &&
        cut.total_directory === false &&
        cut.warehouse === "Default" &&
        cut.location_id === LOCATION &&
        cents(cut.observed_balance_cents) &&
        SHA.test(cut.evidence_sha256 ?? "") &&
        UUID.test(cut.confirmed_by ?? ""),
      "CUT_SOURCE_IDENTITY_INVALID",
    );
    if (
      !sameSet(cut.account_keys, [...accounts.keys()]) ||
      cut.includes_all_open_documents !== true ||
      cut.observed_balance_cents !==
        sum(plan.documents.map((d) => d.balance_cents))
    )
      globalHolds.push("CLOSING_SCOPE_INCOMPLETE");
    if (
      cut.warehouse_scope_confirmed !== true ||
      cut.closing_confirmed !== true ||
      !fresh(cut.confirmed_at, at)
    )
      globalHolds.push("CLOSING_CUT_NOT_ATTESTED");
  }
  const rows = [...docs.values()]
    .map((d) => {
      const holds = [...globalHolds],
        fingerprint = clientesDocumentFingerprint(plan, d.document_key),
        review = reviewMap.get(d.document_key),
        old = existing.docs.get(d.document_key),
        source = existing.sources.get(d.customer_key),
        registry = existing.registries.get(d.customer_key),
        lines = plan.lines.filter((l) => l.document_key === d.document_key),
        changes = paymentChanges(plan, destination, d.document_key);
      if (controls(d.source_folio))
        holds.push("SOURCE_IDENTIFIER_CONTROL_CHARACTER_REVIEW");
      if (!["DEFAULT", "Default"].includes(d.warehouse))
        holds.push("DOCUMENT_WAREHOUSE_SCOPE_DIFFERS");
      const validReview = review?.document_fingerprint === fingerprint;
      if (!validReview)
        holds.push(
          review ? "REVIEW_SOURCE_CHANGED" : "SOURCE_IDENTITY_REVIEW_REQUIRED",
        );
      for (const h of d.holds)
        if (!validReview || !review.resolved_holds.includes(h)) holds.push(h);
      if (!source || !registry) holds.push("SOURCE_REGISTRY_ADAPTER_REQUIRED");
      else if (
        source.source_ref !== d.client_ref ||
        source.source_scope === "SYNTHETIC_QA_NOT_SICAR"
      )
        holds.push("SOURCE_REGISTRY_IDENTITY_MISMATCH");
      if (
        source &&
        [
          source.target_customer_id,
          source.opening_event_id,
          source.reversed_event_id,
        ].some((v) => v !== null)
      )
        holds.push("NATIVE_LINK_OR_OPENING_ALREADY_EXISTS");
      if (
        destination.openings.some((o) => o.document_key === d.document_key) ||
        destination.native_openings.some(
          (o) => o.document_key === d.document_key,
        ) ||
        (old &&
          (old.opening_ledger_id !== null || old.reversal_ledger_id !== null))
      )
        holds.push("OPENING_HISTORY_ALREADY_EXISTS");
      if (!old) holds.push("GENERAL_SCOPE_DOCUMENT_ADAPTER_REQUIRED");
      else {
        if (
          old.customer_key !== d.customer_key ||
          old.source_folio !== d.source_folio ||
          old.source_document_id !== d.source_document_id
        )
          holds.push("REGISTERED_DOCUMENT_IDENTITY_CHANGED");
        if (
          old.balance_cents !== d.balance_cents ||
          old.total_cents !== d.total_cents ||
          old.paid_cents !== d.paid_to_date_cents ||
          old.due_date !== d.due_date ||
          old.financial_status !== d.financial_status
        )
          holds.push("REGISTERED_FINANCES_REQUIRE_EXPLICIT_RECONCILIATION");
        if (changes.length) holds.push("HISTORICAL_PAYMENTS_CHANGED");
      }
      const warnings = [];
      if (!d.linked_history_complete) {
        warnings.push("CANCELLED_HISTORY_NOT_OBSERVED");
        if (
          d.paid_to_date_cents !== 0 ||
          d.payment_evidence !==
            "EXPLICIT_ZERO_ACTIVE_BREAKDOWN_LINKED_HISTORY_NOT_OBSERVED"
        )
          holds.push("ACTIVE_PAYMENT_SCOPE_NOT_ACCREDITED");
      }
      const physicalHolds = [
        "DELIVERY_NOT_ACCREDITED",
        "PHYSICAL_COMMITMENTS_NOT_ACCREDITED",
      ];
      if (lines.some((l) => controls(l.barcode)))
        physicalHolds.push("BARCODE_CONTROL_CHARACTER_REVIEW");
      if (
        lines.some(
          (l) =>
            l.variant_id === null ||
            l.holds.some((h) => h !== "DELIVERY_NOT_OBSERVED"),
        )
      )
        physicalHolds.push("MERCHANDISE_LINK_OR_AMOUNT_REVIEW_REQUIRED");
      if (
        lines.some((l) => {
          const current = existing.mapping.get(l.barcode);
          return (
            !current ||
            current.variants.length !== 1 ||
            current.variants[0] !== l.variant_id
          );
        })
      )
        physicalHolds.push(
          "CURRENT_LITERAL_VARIANT_MAPPING_CHANGED_OR_INCOMPLETE",
        );
      return {
        document_key: d.document_key,
        customer_key: d.customer_key,
        source_folio: d.source_folio,
        document_fingerprint: fingerprint,
        balance_cents: d.balance_cents,
        financial_status: d.financial_status,
        registry_id: registry?.registry_id ?? null,
        status:
          d.balance_cents === 0
            ? "ARCHIVE_PAID_DO_NOT_REOPEN"
            : "PENDING_ACCOUNT_GATE",
        financial_holds: [...new Set(holds)].sort(sort),
        physical_holds: physicalHolds,
        documentary_warnings: warnings,
        linked_history_complete: d.linked_history_complete,
        payment_changes: changes,
        exact_lines: lines.filter((l) => l.variant_id !== null).length,
        pending_lines: lines.filter((l) => l.variant_id === null).length,
        line_count: lines.length,
        delivery_status: "UNKNOWN",
        reserve_qty: null,
        stock_deduction: null,
        operational_import_allowed: false,
        inventory_import_allowed: false,
        stock_operations_allowed: false,
        delivery_operations_allowed: false,
      };
    })
    .sort((a, b) => sort(a.document_key, b.document_key));
  const accountRows = [...accounts.values()]
    .map((a) => {
      const docs = rows.filter((d) => d.customer_key === a.customer_key),
        open = docs.filter((d) => d.balance_cents > 0),
        holds = [...new Set(open.flatMap((d) => d.financial_holds))].sort(sort);
      for (const d of open) {
        if (holds.length && !d.financial_holds.length)
          d.financial_holds.push("ACCOUNT_ATOMIC_STAGE_HELD");
        d.status = holds.length
          ? "HOLD_ACCOUNT"
          : "CANDIDATE_STAGING_REHEARSAL_ONLY";
      }
      return {
        customer_key: a.customer_key,
        document_keys: docs.map((d) => d.document_key),
        open_documents: open.length,
        source_balance_cents: a.used_cents,
        candidate_balance_cents: holds.length
          ? 0
          : sum(open.map((d) => d.balance_cents)),
        holds,
        operational_import_allowed: false,
      };
    })
    .sort((a, b) => sort(a.customer_key, b.customer_key));
  for (const row of rows)
    row.money_opening_eligibility =
      row.balance_cents === 0
        ? "PAID_ARCHIVE"
        : row.status === "CANDIDATE_STAGING_REHEARSAL_ONLY"
          ? "STAGING_REHEARSAL_CANDIDATE"
          : "HELD";
  const candidate = rows.filter(
      (r) => r.status === "CANDIDATE_STAGING_REHEARSAL_ONLY",
    ),
    counts = {};
  for (const r of rows.filter((d) => d.balance_cents > 0))
    for (const h of r.financial_holds) counts[h] = (counts[h] ?? 0) + 1;
  const accountCounts = {};
  for (const a of accountRows)
    for (const h of a.holds) accountCounts[h] = (accountCounts[h] ?? 0) + 1;
  return {
    protocol: "m9-clientes-stage-gate-1",
    project_id: PROJECT,
    assessed_at: at,
    source_plan_sha256: source_sha256,
    source_from: plan.source_from,
    source_until: plan.source_until,
    destination_sha256: digest(destination),
    cut_sha256: cut ? digest(cut) : null,
    source_scope: "OBSERVED_INDEBTED_ACCOUNT_SUBSET_NOT_WHOLE_DIRECTORY",
    production_allowed: false,
    operational_import_allowed: false,
    inventory_import_allowed: false,
    generates_import_sql: false,
    historical_payments_replayed: false,
    summary: {
      accounts: accounts.size,
      held_accounts: accountRows.filter(
        (a) => a.open_documents > 0 && a.holds.length > 0,
      ).length,
      staging_rehearsal_candidate_accounts: accountRows.filter(
        (a) => a.open_documents > 0 && a.holds.length === 0,
      ).length,
      account_hold_counts: Object.fromEntries(
        Object.entries(accountCounts).sort(([a], [b]) => sort(a, b)),
      ),
      documents: docs.size,
      open_documents: rows.filter((r) => r.balance_cents > 0).length,
      paid_archived_documents: rows.filter((r) => r.balance_cents === 0).length,
      observed_balance_cents: sum(rows.map((r) => r.balance_cents)),
      historical_active_cents: sum(
        plan.payments.filter((p) => !p.cancelled).map((p) => p.amount_cents),
      ),
      cancelled_excluded_cents: sum(
        plan.payments.filter((p) => p.cancelled).map((p) => p.amount_cents),
      ),
      staging_rehearsal_candidate_documents: candidate.length,
      staging_rehearsal_candidate_cents: sum(
        candidate.map((d) => d.balance_cents),
      ),
      held_open_documents: rows.filter((r) => r.status === "HOLD_ACCOUNT")
        .length,
      existing_opening_documents: rows.filter((r) =>
        r.financial_holds.includes("OPENING_HISTORY_ALREADY_EXISTS"),
      ).length,
      credit_lines: plan.lines.length,
      exact_lines: rows.reduce((n, r) => n + r.exact_lines, 0),
      pending_lines: rows.reduce((n, r) => n + r.pending_lines, 0),
      unaccredited_deliveries: plan.lines.length,
      linked_history_unobserved_documents: rows.filter(
        (r) => !r.linked_history_complete,
      ).length,
      delivery_operations_allowed: 0,
      financial_hold_counts: Object.fromEntries(
        Object.entries(counts).sort(([a], [b]) => sort(a, b)),
      ),
    },
    accounts: accountRows,
    documents: rows,
  };
}

const escapeHTML = (x) =>
  String(x).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function clientesStageReport(plan) {
  const s = plan.summary,
    amount = (n) =>
      (n / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>M9 · Apertura por etapas</title><style>body{font:17px system-ui;max-width:1050px;margin:30px auto;padding:0 20px;background:#f4f1e9;color:#183443}h1{font-size:30px}section{background:white;padding:20px;margin:18px 0;border-radius:14px}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}.scroll{overflow:auto}strong{color:#7c331c}code{overflow-wrap:anywhere}</style><h1>Créditos y apartados: apertura por etapas</h1><p>Evaluación local de sólo lectura · ${escapeHTML(plan.assessed_at)}.</p><section><strong>Este reporte no abre deuda ni habilita cobros o entregas.</strong><p>El alcance es el subconjunto observado de cuentas con deuda; no todo el padrón ni un cierre simultáneo acreditado. Se conserva cada UUID fuente. Los abonos históricos nunca se convierten en ingresos nuevos.</p></section><section><h2>Lo ya conciliado</h2><p>${s.accounts} cuentas · ${s.documents} documentos (${s.open_documents} abiertos y ${s.paid_archived_documents} pagados) · ${amount(s.observed_balance_cents)} observado.</p><p>Abonos activos históricos: ${amount(s.historical_active_cents)}. Cancelados excluidos: ${amount(s.cancelled_excluded_cents)}. ${s.exact_lines}/${s.credit_lines} líneas con variante literal; ${s.pending_lines} pendientes.</p></section><section><h2>Compuerta de la siguiente tanda</h2><p>${s.staging_rehearsal_candidate_documents} documentos candidatos a ensayo; ${s.held_open_documents} abiertos retenidos. ${s.existing_opening_documents} ya tienen historial de apertura y requieren conciliación, nunca otra apertura.</p><div class="scroll"><table><thead><tr><th>Bloqueo</th><th>Documentos</th></tr></thead><tbody>${Object.entries(
    s.financial_hold_counts,
  )
    .map(([h, n]) => `<tr><td>${escapeHTML(h)}</td><td>${n}</td></tr>`)
    .join(
      "",
    )}</tbody></table></div></section><section><h2>Cómo avanzar sin cobrar dos veces</h2><ol><li>Renovar el listado y todos los documentos abiertos de cada cuenta de la tanda. Fijar el corte, Default→La Piedad y su evidencia.</li><li>Conciliar cada abono activo/cancelado, vencimiento e identidad literal frente al archivo anterior. Una suma igual no basta.</li><li>Conservar las aperturas existentes. Toda diferencia exige plan de conciliación o compensación; este evaluador no las sobrescribe.</li><li>Acreditar vínculo de cuenta y resolver sólo las discrepancias concretas. Ensayar por cuenta completa con rollback y auditoría.</li><li>Tratar entregas y compromisos físicos por separado: ${s.unaccredited_deliveries} entregas siguen UNKNOWN, con reservas/descuentos NULL.</li></ol></section><p>Sin datos personales en este HTML. El detalle privado y las huellas están en el mismo expediente. No hay SQL de importación, red, cambios a SICAR/Woo ni escrituras remotas en este evaluador.</p></html>\n`;
}

export function prepareClientesStages(configPath, output) {
  const cfg = JSON.parse(readFileSync(configPath)),
    inputs = {},
    data = {};
  for (const name of ["source_config", "destination", "cut", "reviews"]) {
    const pin = cfg.inputs?.[name];
    if ((name === "cut" || name === "reviews") && pin === null) {
      data[name] = name === "reviews" ? [] : null;
      continue;
    }
    requireValue(
      literal(pin?.path) && SHA.test(pin?.sha256 ?? ""),
      "PIN_REQUIRED:" + name,
    );
    const path = resolve(dirname(configPath), pin.path),
      raw = readFileSync(path);
    requireValue(rawSha(raw) === pin.sha256, "INPUT_CHANGED:" + name);
    data[name] = JSON.parse(raw);
    inputs[name] = pin.sha256;
    if (name === "source_config") data.source_path = path;
  }
  const source = { project_id: PROJECT };
  for (const name of ["queue", "accounts", "details", "mapping"]) {
    const pin = data.source_config.inputs?.[name];
    requireValue(
      literal(pin?.path) && SHA.test(pin?.sha256 ?? ""),
      "SOURCE_PIN_REQUIRED:" + name,
    );
    const raw = readFileSync(resolve(dirname(data.source_path), pin.path));
    requireValue(rawSha(raw) === pin.sha256, "SOURCE_INPUT_CHANGED:" + name);
    source[name] = JSON.parse(raw);
    inputs["source_" + name] = pin.sha256;
  }
  // Rebuild at the original observation time, then test freshness at the new
  // assessment time. Never redate source evidence to make a cut appear fresh.
  const reconciled = {
      ...reconcileGeneralCredit(source, data.source_config.assessment_at),
      inputs: Object.fromEntries(
        ["queue", "accounts", "details", "mapping"].map((name) => [
          name,
          data.source_config.inputs[name].sha256,
        ]),
      ),
    },
    sourceRaw = JSON.stringify(reconciled, null, 2) + "\n",
    result = evaluateClientesStages(
      {
        plan: reconciled,
        source_sha256: rawSha(sourceRaw),
        destination: data.destination,
        cut: data.cut,
        reviews: data.reviews,
      },
      cfg.assessment_at,
    );
  const files = {
    "evaluacion-privada.json":
      JSON.stringify({ ...result, inputs }, null, 2) + "\n",
    "resumen.json": JSON.stringify(result.summary, null, 2) + "\n",
    "reporte.html": clientesStageReport(result),
  };
  mkdirSync(output, { mode: 0o700 });
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(output, name), body, { mode: 0o600, flag: "wx" });
  writeFileSync(
    join(output, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(files).map(([name, body]) => [name, rawSha(body)]),
      ),
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return result.summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  requireValue(process.argv.length === 4, "Usage: PINNED_CONFIG NEW_OUTPUT");
  console.log(
    prepareClientesStages(resolve(process.argv[2]), resolve(process.argv[3])),
  );
}
