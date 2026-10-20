import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareCustomerCredit } from "./prepare-customer-credit.mjs";
import { quoteDoText } from "./sql-literal.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const uuid = (s) =>
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(s ?? "");
export function sourceImportSQL(planRaw, actor, { commit = false } = {}) {
  if (typeof commit !== "boolean") throw Error("EXPLICIT_IMPORT_MODE_REQUIRED");
  const plan = JSON.parse(planRaw);
  if (
    !uuid(actor) ||
    plan.version !== "m9-customer-credit-1" ||
    plan.project_id !== "zsezjtswqeijboezvado" ||
    plan.production_allowed !== false ||
    plan.operational_import_allowed !== false ||
    plan.inventory_import_allowed !== false ||
    ![
      "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS",
      "SYNTHETIC_QA_NOT_SICAR",
    ].includes(plan.scope)
  )
    throw Error("PRIVATE_SOURCE_IMPORT_REQUIRED");
  const q = (s) => quoteDoText(s, "$import$");
  return `-- PRIVATE STAGING SOURCE RECORDS ONLY. Not native customer/debt activation.
-- Raw plan SHA256 ${sha(planRaw)}; source pins remain inside plan.
begin;
set local standard_conforming_strings=on;
set local statement_timeout='120s';
set local lock_timeout='5s';
select set_config('request.jwt.claim.sub',${q(actor)},true);
select app.m9_import_customer_sources(${q(sha(planRaw))},${q(planRaw)}::jsonb) as receipt;
set constraints all immediate;
${commit ? "commit" : "rollback"};
`;
}

// Source-only rollback is permitted only before any native opening/link.
// Keeps the import audit trail and never deletes the native credit ledger.
export function sourceImportRollbackSQL(
  planSha,
  actor,
  { commit = false } = {},
) {
  if (
    !/^[a-f0-9]{64}$/.test(planSha ?? "") ||
    !uuid(actor) ||
    typeof commit !== "boolean"
  )
    throw Error("PRIVATE_SOURCE_ROLLBACK_REQUIRED");
  const q = (s) => quoteDoText(s, "$remove$");
  return `begin;
set local standard_conforming_strings=on;
set local statement_timeout='120s';
set local lock_timeout='5s';
select set_config('request.jwt.claim.sub',${q(actor)},true);
create temporary table m9_source_removal_result(result jsonb) on commit drop;
do $remove$
declare batch app.m9_customer_batches;actor uuid;removed int;
begin
 actor:=app.m9_customer_operator();
 perform pg_advisory_xact_lock(hashtextextended('m9-customer-source-import',0));
 select * into strict batch from app.m9_customer_batches where plan_sha256=${q(planSha)} for update;
 if exists(select 1 from app.m9_customer_sources where batch_sha256=${q(planSha)} and (target_customer_id is not null or opening_event_id is not null or reversed_event_id is not null)) then raise exception 'M9_SOURCE_BATCH_HAS_NATIVE_HISTORY';end if;
 delete from app.m9_credit_source_payments p using app.m9_credit_documents d,app.m9_customer_sources c where p.document_key=d.document_key and d.customer_key=c.customer_key and c.batch_sha256=${q(planSha)};
 delete from app.m9_credit_source_lines l using app.m9_credit_documents d,app.m9_customer_sources c where l.document_key=d.document_key and d.customer_key=c.customer_key and c.batch_sha256=${q(planSha)};
 delete from app.m9_credit_documents d using app.m9_customer_sources c where d.customer_key=c.customer_key and c.batch_sha256=${q(planSha)};
 delete from app.m9_customer_sources where batch_sha256=${q(planSha)};
 get diagnostics removed=row_count;
 if removed<>(batch.receipt->>'source_accounts')::integer then raise exception 'M9_SOURCE_REMOVAL_COUNT_CHANGED';end if;
 delete from app.m9_customer_batches where plan_sha256=${q(planSha)};
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata) values(actor,'m9.customer_sources.remove','m9_customer_batches',${q(planSha)},batch.receipt||jsonb_build_object('native_history_removed',false));
 insert into m9_source_removal_result values(jsonb_build_object('source_accounts_removed',removed,'source_batch_remaining',(select count(*) from app.m9_customer_batches where plan_sha256=${q(planSha)}),'native_history_removed',false,'trial_rollback',${commit ? "false" : "true"}));
end $remove$;
select * from m9_source_removal_result;
${commit ? "commit" : "rollback"};
`;
}

// Rebuilds from the six pinned inputs, not an editable summary or hand-made CSV.
// Does not connect to Supabase; execution is an explicit, separate staging step.
export async function prepareCustomerSourceImport(config, out, actor) {
  if (!uuid(actor)) throw Error("STAGING_ACTOR_REQUIRED");
  await mkdir(out, { mode: 0o700 });
  const summary = await prepareCustomerCredit(config, resolve(out, "review"));
  const raw = await readFile(resolve(out, "review/plan-privado.json"), "utf8");
  const files = {
    "ensayo-importacion-rollback.sql": sourceImportSQL(raw, actor),
    "carga-origen-staging.sql": sourceImportSQL(raw, actor, { commit: true }),
    "ensayo-retiro-origen.sql": sourceImportRollbackSQL(sha(raw), actor),
    "retiro-origen-staging.sql": sourceImportRollbackSQL(sha(raw), actor, {
      commit: true,
    }),
  };
  for (const [name, content] of Object.entries(files))
    await writeFile(resolve(out, name), content, { flag: "wx", mode: 0o600 });
  await writeFile(
    resolve(out, "importacion-sha256.json"),
    JSON.stringify(
      {
        plan_sha256: sha(raw),
        files: Object.fromEntries(
          Object.entries(files).map(([n, c]) => [n, sha(c)]),
        ),
        production_allowed: false,
        native_activation_allowed: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return summary;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 5)
    throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT_DIR STAGING_ACTOR_UUID");
  console.log(await prepareCustomerSourceImport(...process.argv.slice(2)));
}
