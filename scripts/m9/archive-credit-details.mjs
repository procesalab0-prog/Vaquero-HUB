import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { quoteDoText } from "./sql-literal.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
export function creditDetailArchive(plan, sourceSha, accounts, accountsSha) {
  if (
    !/^[a-f0-9]{64}$/.test(sourceSha) ||
    plan.version !== "m9-general-credit-details-1" ||
    plan.project_id !== "zsezjtswqeijboezvado" ||
    plan.production_allowed !== false ||
    plan.operational_import_allowed !== false ||
    plan.inventory_import_allowed !== false ||
    plan.baseline_refreshed !== false ||
    plan.simultaneous_closing_cut !== false ||
    plan.issues.length ||
    plan.missing_expected.length ||
    plan.accounts.some((a) => a.holds.length) ||
    accountsSha !== plan.inputs.accounts
  )
    throw Error("CONCILIATED_PINNED_SOURCE_REQUIRED");
  const rows = plan.accounts.map((a) => {
    const names = accounts.filter((c) => c.client_ref === a.client_ref);
    if (names.length !== 1 || !names[0].name)
      throw Error("EXACT_ACCOUNT_NAME_REQUIRED");
    return {
      key: a.customer_key,
      ref: a.client_ref,
      name: names[0].name,
      source_at: a.source_at,
      balance_cents: a.used_cents,
      documents: plan.documents
        .filter((d) => d.client_ref === a.client_ref)
        .map((d) => ({
          key: d.document_key,
          folio: d.source_folio,
          source_id: d.source_document_id,
          source_at: d.source_at,
          historical_name: d.source_customer_name,
          total_cents: d.total_cents,
          balance_cents: d.balance_cents,
          paid_cents: d.paid_to_date_cents,
          due_date: d.due_date,
          holds: d.holds,
          linked_history_complete: d.linked_history_complete,
          evidence_sha256: d.source_evidence_sha256,
          payments: plan.payments
            .filter((p) => p.document_key === d.document_key)
            .map((p) => ({
              key: p.payment_key,
              ref: p.source_ref,
              occurred_label: p.occurred_label,
              amount_cents: p.amount_cents,
              cancelled: p.cancelled,
              evidence_sha256: p.evidence_sha256,
            })),
          lines: plan.lines
            .filter((l) => l.document_key === d.document_key)
            .map((l) => ({
              index: l.line_index,
              barcode: l.barcode,
              quantity: l.quantity,
              description: l.source_description,
              variant_id: l.variant_id,
              holds: l.holds,
              delivery_status: l.delivery_status,
              reserved_qty: l.reserved_qty,
              stock_deduction: l.stock_deduction,
            })),
        })),
    };
  });
  return {
    protocol: "m9-credit-detail-archive-1",
    source_plan_sha256: sourceSha,
    source_from: plan.source_from,
    source_until: plan.source_until,
    operational_import_allowed: false,
    accounts: rows,
  };
}
export function creditDetailArchiveSQL(payload, actor, commit = false) {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(actor))
    throw Error("ACTOR_REQUIRED");
  return `begin;\nset local standard_conforming_strings=on;\nselect set_config('request.jwt.claim.sub','${actor}',true);\nselect app.m9_archive_credit_details(${quoteDoText(JSON.stringify(payload), "$archive$")}::jsonb);\n${commit ? "commit" : "rollback"};\n`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [planPath, accountsPath, actor, out] = process.argv.slice(2);
  if (!out) throw Error("Usage: PLAN ACCOUNTS ACTOR NEW_OUTPUT");
  const raw = readFileSync(planPath),
    rawAccounts = readFileSync(accountsPath);
  const p = creditDetailArchive(
    JSON.parse(raw),
    hash(raw),
    JSON.parse(rawAccounts),
    hash(rawAccounts),
  );
  mkdirSync(out, { mode: 0o700 });
  for (const [n, c] of Object.entries({
    "payload-privado.json": JSON.stringify(p, null, 2) + "\n",
    "ensayo-archivo.sql": creditDetailArchiveSQL(p, actor),
    "conservar-archivo.sql": creditDetailArchiveSQL(p, actor, true),
  }))
    writeFileSync(join(out, n), c, { flag: "wx", mode: 0o600 });
  console.log({
    accounts: p.accounts.length,
    documents: p.accounts.flatMap((a) => a.documents).length,
    sha: p.source_plan_sha256,
  });
}
