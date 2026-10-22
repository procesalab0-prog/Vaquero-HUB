import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./acceleration.mjs";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const cents = (n) => Number.isSafeInteger(n) && n >= 0;
const text = (s, max) =>
  typeof s === "string" && s.length > 0 && s.length <= max && s === s.trim();
export function censusArchive(plan, sourceSha, at) {
  if (
    !/^[a-f0-9]{64}$/.test(sourceSha) ||
    !Number.isFinite(Date.parse(at)) ||
    plan.version !== 1 ||
    plan.scope !== "VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY" ||
    plan.deleted_customers_included !== false ||
    plan.paid_history_complete !== false ||
    plan.financial_details_complete !== false ||
    plan.operational_import_allowed !== false ||
    !Number.isFinite(Date.parse(plan.source_at)) ||
    !Number.isFinite(Date.parse(plan.observed_until)) ||
    Date.parse(plan.source_at) > Date.parse(plan.observed_until) ||
    Date.parse(plan.observed_until) > Date.parse(at) ||
    Date.parse(plan.observed_until) - Date.parse(plan.source_at) > 86400000 ||
    !Array.isArray(plan.accounts) ||
    plan.accounts.length < 1 ||
    plan.accounts.length > 5000
  )
    throw Error("CENSUS_ARCHIVE_SCOPE_INVALID");
  const keys = new Set(),
    refs = new Set(),
    docs = new Set();
  const accounts = plan.accounts
    .map((a) => {
      if (
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.source_ref) ||
        a.customer_key !==
          digest({ tenant: "VSM", client_ref: a.source_ref }) ||
        keys.has(a.customer_key) ||
        refs.has(a.source_ref) ||
        !text(a.name, 500) ||
        !cents(a.used_cents) ||
        !cents(a.document_balance_cents) ||
        !(a.list_balance_cents === null || cents(a.list_balance_cents)) ||
        !(a.overdue_cents === null || cents(a.overdue_cents)) ||
        !/^[a-f0-9]{64}$/.test(a.source_evidence_sha256) ||
        !Number.isFinite(Date.parse(a.source_at)) ||
        Date.parse(a.source_at) < Date.parse(plan.source_at) ||
        Date.parse(a.source_at) > Date.parse(plan.observed_until) ||
        a.native_customer_id !== null ||
        a.privacy_consent !== null ||
        a.new_credit_authorized !== false ||
        a.operational_import_allowed !== false ||
        typeof a.previously_registered !== "boolean" ||
        !Array.isArray(a.holds) ||
        a.holds.some((h) => h !== "DUPLICATE_NAME_NOT_MERGED") ||
        !Array.isArray(a.documents)
      )
        throw Error("CENSUS_ARCHIVE_ACCOUNT_INVALID");
      keys.add(a.customer_key);
      refs.add(a.source_ref);
      const documents = a.documents.map((d) => {
        if (
          !text(d.folio, 100) ||
          d.document_key !==
            digest({
              tenant: "VSM",
              client_ref: a.source_ref,
              folio: d.folio,
            }) ||
          docs.has(d.document_key) ||
          !cents(d.total_cents) ||
          !cents(d.balance_cents) ||
          d.balance_cents <= 0 ||
          d.total_cents < d.balance_cents ||
          d.source_document_id !== null ||
          d.delivery_status !== "UNKNOWN" ||
          d.payment_details_verified !== false ||
          !text(d.occurred_label, 40) ||
          !/^[a-f0-9]{64}$/.test(d.evidence_sha256)
        )
          throw Error("CENSUS_ARCHIVE_DOCUMENT_INVALID");
        docs.add(d.document_key);
        return {
          key: d.document_key,
          folio: d.folio,
          total_cents: d.total_cents,
          balance_cents: d.balance_cents,
          occurred_label: d.occurred_label,
          evidence_sha256: d.evidence_sha256,
        };
      });
      if (
        documents.reduce((s, d) => s + d.balance_cents, 0) !== a.used_cents ||
        a.document_balance_cents !== a.used_cents
      )
        throw Error("CENSUS_ARCHIVE_TOTALS_CHANGED");
      return {
        key: a.customer_key,
        ref: a.source_ref,
        name: a.name,
        source_at: a.source_at,
        evidence_sha256: a.source_evidence_sha256,
        used_cents: a.used_cents,
        overdue_cents: a.overdue_cents,
        list_balance_cents: a.list_balance_cents,
        previously_registered: a.previously_registered,
        holds: a.holds,
        documents,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  const s = plan.summary;
  if (
    s.accounts !== accounts.length ||
    s.open_documents !== docs.size ||
    s.source_used_cents !== accounts.reduce((s, a) => s + a.used_cents, 0) ||
    s.document_balance_cents !== s.source_used_cents ||
    s.previous_accounts_present !==
      accounts.filter((a) => a.previously_registered).length ||
    s.new_source_accounts !==
      accounts.filter((a) => !a.previously_registered).length ||
    s.accounts_with_unknown_used !== 0 ||
    plan.missing_previous_keys.length !== 0
  )
    throw Error("CENSUS_ARCHIVE_SUMMARY_CHANGED");
  return {
    protocol: "m9-census-archive-1",
    source_plan_sha256: sourceSha,
    source_at: plan.source_at,
    observed_until: plan.observed_until,
    scope: "VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY",
    accounts,
  };
}
export function prepareCensusArchive(source, expectedSha, out, at) {
  const raw = readFileSync(source);
  if (sha(raw) !== expectedSha) throw Error("CENSUS_SOURCE_CHANGED");
  const payload = censusArchive(JSON.parse(raw), expectedSha, at);
  mkdirSync(out, { mode: 0o700 });
  const hex = Buffer.from(JSON.stringify(payload)).toString("hex");
  const call = `select app.m9_archive_general_census(convert_from(decode('${hex}','hex'),'UTF8')::jsonb) as receipt;`;
  const auth = `select set_config('request.jwt.claims','{"sub":"2b5e4ba1-00f2-48c7-bbe0-273340629711","role":"authenticated"}',true);`;
  for (const [name, content] of Object.entries({
    "payload.json": JSON.stringify(payload, null, 2),
    "ensayo.sql": `begin;\n${auth}\n${call}\n${call}\nrollback;\n`,
    "carga-staging.sql": `begin;\n${auth}\n${call}\ncommit;\n`,
  }))
    writeFileSync(join(out, name), content, { mode: 0o600 });
  return {
    accounts: payload.accounts.length,
    documents: payload.accounts.reduce((s, a) => s + a.documents.length, 0),
    source_at: payload.source_at,
    archive_only: true,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(prepareCensusArchive(...process.argv.slice(2))));
