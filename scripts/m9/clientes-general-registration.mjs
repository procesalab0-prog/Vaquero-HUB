import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./acceleration.mjs";
import { quoteDoText } from "./sql-literal.mjs";
export const GENERAL_SCOPE = "GENERAL_ARCHIVED_INDEBTED_SUBSET";
export const GENERAL_SNAPSHOT_TABLES = Object.freeze([
  "app.m9_credit_detail_archives",
  "app.m9_credit_documents",
  "app.m9_credit_source_lines",
  "app.m9_credit_source_payments",
  "app.m9_customer_batches",
  "app.m9_customer_events",
  "app.m9_customer_sources",
  "app.m9_legacy_cash_receipts",
  "app.m9_legacy_finance_allocations",
  "app.m9_legacy_finance_events",
  "app.m9_legacy_finance_ledger",
  "app.m9_legacy_registry",
  "public.customer_credit_allocations",
  "public.customer_credit_ledger",
  "public.customers",
]);
const SHA = /^[a-f0-9]{64}$/,
  UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const rawSha = (x) => createHash("sha256").update(x).digest("hex");
const needed = (ok, code) => {
  if (!ok) throw Error(code);
};
const cents = (v) => Number.isSafeInteger(v) && v >= 0;
const sum = (values) => {
  const n = values.reduce((x, y) => x + BigInt(y), 0n);
  needed(n <= BigInt(Number.MAX_SAFE_INTEGER), "UNSAFE_SUM");
  return Number(n);
};
export function buildGeneralRegistration({
  archive,
  archive_payload_hash,
  destination,
  audit,
  request_id,
}) {
  needed(
    archive?.protocol === "m9-credit-detail-archive-1" &&
      SHA.test(archive.source_plan_sha256 ?? "") &&
      archive.operational_import_allowed === false &&
      Array.isArray(archive.accounts) &&
      SHA.test(archive_payload_hash ?? "") &&
      UUID.test(request_id ?? ""),
    "PINNED_ARCHIVE_REQUIRED",
  );
  needed(
    destination?.project_id === "zsezjtswqeijboezvado" &&
      destination.complete === true &&
      Array.isArray(destination.sources) &&
      Array.isArray(audit),
    "COMPLETE_STAGING_DESTINATION_REQUIRED",
  );
  const existing = new Map();
  for (const s of destination.sources) {
    needed(
      SHA.test(s.customer_key) && !existing.has(s.customer_key),
      "DESTINATION_SOURCE_DUPLICATE",
    );
    existing.set(s.customer_key, s);
  }
  const snapshot = GENERAL_SNAPSHOT_TABLES.map((name) => {
    const rows = audit.filter((x) => x.name === name);
    needed(
      rows.length === 1 &&
        Number.isSafeInteger(rows[0].rows) &&
        rows[0].rows >= 0 &&
        /^[a-f0-9]{32}$/.test(rows[0].md5 ?? ""),
      "COMPLETE_SNAPSHOT_REQUIRED:" + name,
    );
    return rows[0];
  });
  const accounts = [],
    docs = [],
    payments = [],
    lines = [],
    keys = new Set(),
    documentKeys = new Set(),
    payKeys = new Set();
  for (const a of archive.accounts) {
    needed(
      a.key === digest({ tenant: "VSM", client_ref: a.ref }) &&
        !keys.has(a.key) &&
        UUID.test(a.ref) &&
        cents(a.balance_cents) &&
        Array.isArray(a.documents),
      "ARCHIVE_ACCOUNT_INVALID",
    );
    keys.add(a.key);
    let balance = 0;
    for (const d of a.documents) {
      needed(
        d.key ===
          digest({ tenant: "VSM", client_ref: a.ref, folio: d.folio }) &&
          !documentKeys.has(d.key) &&
          cents(d.total_cents) &&
          cents(d.balance_cents) &&
          cents(d.paid_cents) &&
          d.total_cents === sum([d.balance_cents, d.paid_cents]) &&
          Array.isArray(d.payments) &&
          Array.isArray(d.lines),
        "ARCHIVE_DOCUMENT_INVALID",
      );
      documentKeys.add(d.key);
      balance = sum([balance, d.balance_cents]);
      let active = 0;
      for (const p of d.payments) {
        needed(
          p.key === digest({ tenant: "VSM", source_ref: p.ref }) &&
            !payKeys.has(p.key) &&
            cents(p.amount_cents) &&
            p.amount_cents > 0 &&
            typeof p.cancelled === "boolean",
          "ARCHIVE_PAYMENT_INVALID",
        );
        payKeys.add(p.key);
        if (!p.cancelled) active = sum([active, p.amount_cents]);
      }
      needed(active === d.paid_cents, "ACTIVE_PAYMENTS_DIFFER");
      for (const l of d.lines)
        needed(
          typeof l.barcode === "string" &&
            l.barcode.length > 0 &&
            l.barcode === l.barcode.trim() &&
            l.delivery_status === "UNKNOWN" &&
            l.reserved_qty === null &&
            l.stock_deduction === null,
          "PHYSICAL_EFFECT_FORBIDDEN",
        );
    }
    needed(balance === a.balance_cents, "ACCOUNT_TOTALS_DIFFER");
    if (a.balance_cents === 0 || existing.has(a.key)) continue;
    accounts.push(a);
    for (const d of a.documents) {
      if (d.balance_cents === 0) continue;
      docs.push(d);
      payments.push(...d.payments);
      lines.push(...d.lines);
    }
  }
  needed(accounts.length > 0, "NO_MISSING_INDEBTED_ACCOUNTS");
  return {
    protocol: "m9-general-customer-registration-1",
    project_id: "zsezjtswqeijboezvado",
    request_id,
    archive_sha256: archive.source_plan_sha256,
    archive_payload_hash,
    expected_snapshot: snapshot,
    expected_additions: {
      accounts: accounts.length,
      documents: docs.length,
      payments: payments.length,
      lines: lines.length,
      balance_cents: sum(docs.map((d) => d.balance_cents)),
    },
    operational_import_allowed: false,
  };
}
export function generalRegistrationSQL(
  payload,
  actor,
  retireRequest,
  { retire = false, commit = false } = {},
) {
  needed(
    payload?.project_id === "zsezjtswqeijboezvado" &&
      payload.operational_import_allowed === false &&
      UUID.test(payload.request_id ?? "") &&
      UUID.test(actor ?? "") &&
      UUID.test(retireRequest ?? ""),
    "EXPLICIT_STAGING_ACTOR_REQUIRED",
  );
  const literal = quoteDoText(
    JSON.stringify(payload),
    "$general_registration$",
  );
  const call = `select app.m9_register_general_customer_archive(${literal}::jsonb) as registration;\n`;
  const reverse = `select app.m9_retire_general_customer_registration('${retireRequest}'::uuid,'${payload.request_id}'::uuid,'Reviewed archive registration retirement; no operating debt or payment') as retirement;\n`;
  return `begin;\nset local standard_conforming_strings=on;\nset local statement_timeout='120s';\nselect set_config('request.jwt.claim.sub','${actor}',true);\n${call}${call}${retire ? reverse + reverse : ""}${commit ? "commit" : "rollback"};\n`;
}
export function prepareGeneralRegistration(configPath, out) {
  const cfg = JSON.parse(readFileSync(configPath)),
    data = {},
    pins = {};
  needed(
    cfg.project_id === "zsezjtswqeijboezvado" &&
      UUID.test(cfg.actor_id ?? "") &&
      UUID.test(cfg.retire_request_id ?? ""),
    "STAGING_CONFIG_REQUIRED",
  );
  for (const name of ["archive", "destination", "audit"]) {
    const pin = cfg.inputs?.[name];
    needed(
      typeof pin?.path === "string" && SHA.test(pin.sha256 ?? ""),
      "PIN_REQUIRED:" + name,
    );
    const raw = readFileSync(resolve(dirname(configPath), pin.path));
    needed(rawSha(raw) === pin.sha256, "INPUT_CHANGED:" + name);
    data[name] = JSON.parse(raw);
    pins[name] = pin.sha256;
  }
  const payload = buildGeneralRegistration({
    ...data,
    request_id: cfg.request_id,
    archive_payload_hash: cfg.archive_payload_hash,
  });
  const summary = {
    ...payload.expected_additions,
    source_scope: GENERAL_SCOPE,
    archive_sha256: payload.archive_sha256,
    source_from: data.archive.source_from,
    source_until: data.archive.source_until,
    source_dates_preserved: true,
    debt_opened_cents: 0,
    native_customers_created: 0,
    auth_accounts_created: 0,
    consents_created: 0,
    historical_payments_replayed: false,
    inventory_effect: 0,
    operational_import_allowed: false,
    inputs: pins,
  };
  const files = {
    "payload-registro-inerte.json": JSON.stringify(payload, null, 2) + "\n",
    "resumen.json": JSON.stringify(summary, null, 2) + "\n",
    "ensayo-registro-rollback.sql": generalRegistrationSQL(
      payload,
      cfg.actor_id,
      cfg.retire_request_id,
    ),
    "ensayo-registro-retiro-rollback.sql": generalRegistrationSQL(
      payload,
      cfg.actor_id,
      cfg.retire_request_id,
      { retire: true },
    ),
    "registro-staging-explicito.sql": generalRegistrationSQL(
      payload,
      cfg.actor_id,
      cfg.retire_request_id,
      { commit: true },
    ),
  };
  mkdirSync(out, { mode: 0o700 });
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(out, name), body, { flag: "wx", mode: 0o600 });
  writeFileSync(
    join(out, "sha256.json"),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(files).map(([name, body]) => [name, rawSha(body)]),
      ),
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return summary;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  needed(process.argv.length === 4, "Usage: PINNED_CONFIG NEW_OUTPUT");
  console.log(
    prepareGeneralRegistration(
      resolve(process.argv[2]),
      resolve(process.argv[3]),
    ),
  );
}
