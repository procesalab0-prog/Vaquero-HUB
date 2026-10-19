import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { authorizeRule, digest } from "./acceleration.mjs";
import { quoteDoText } from "./sql-literal.mjs";
const [run, beforePath, out] = process.argv.slice(2);
if (!out) throw Error("Usage: AUTHORIZED_RUN STAGING_BEFORE NEW_OUTPUT");
const batches = JSON.parse(await readFile(resolve(run, "lotes.json")));
const decision = JSON.parse(
  await readFile(resolve(run, "decision-regla.json")),
);
const before = JSON.parse(await readFile(beforePath));
const cohort = JSON.parse(await readFile(resolve(run, "conjunto.json")));
const authorized = authorizeRule(
  cohort,
  decision.authorization,
  decision.sampleReview,
);
if (
  digest(authorized.batches) !== digest(batches) ||
  digest(authorized.evidence) !== digest(decision) ||
  digest(before) !== cohort.destination_sha256
)
  throw Error("DECISION_OR_BASELINE_CHANGED");
if (before.codes.length !== new Set(before.codes.map((x) => x.barcode)).size)
  throw Error("INVALID_BASELINE");
const quote = (s) => quoteDoText(s, "$m9rule$");
const codes = batches.batches.flatMap((b) =>
  b.packet.rows.map((x) => x.barcode),
);
if (codes.some((c) => before.codes.some((x) => x.barcode === c)))
  throw Error("ALREADY_STAGED");
const codeSql = "array[" + codes.map(quote).join(",") + "]::text[]";
const fingerprint = `(select md5(string_agg(jsonb_build_object('variant_id',r.variant_id,'product_id',v.product_id,'current',app.m9_rehearsal_current_row(r.variant_id),'stored',r.source_row)::text,'' order by r.barcode)) from app.m9_rows r join public.variants v on v.id=r.variant_id where not r.barcode=any(${codeSql}))`;
await mkdir(out);
let prior = 0;
for (const b of batches.batches) {
  const p = b.packet,
    rows = quote(JSON.stringify(p.rows)) + "::jsonb",
    approvals = quote(JSON.stringify(p.approvals)) + "::jsonb";
  for (const mode of ["rehearsal", "apply"]) {
    const expected = before.codes.length + (mode === "apply" ? prior : 0);
    const sql = `-- Rule-authorized staging catalog only. No inventory or Woo operations.\nbegin;\nset local standard_conforming_strings=on;\nselect app.assert_sicar_staging_enabled();\ncreate temporary table rule_result(result jsonb) on commit drop;\ndo $m9rule$\ndeclare plan jsonb; first_run jsonb; repeated jsonb; payload jsonb := ${rows}; src text := ${quote(p.source_sha256)};\nbegin\n perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));\n if (select count(*) from app.m9_rows)<>${expected} or ${fingerprint} is distinct from ${quote(before.fingerprint)} then raise exception 'BASELINE_CHANGED';end if;\n if exists(select 1 from public.inventory_by_location) or exists(select 1 from public.inventory_movements) or exists(select 1 from public.sales) or exists(select 1 from public.layaways) then raise exception 'NONEMPTY_OPERATING_LEDGER';end if;\n insert into app.m9_sicar_approved_rows(barcode,source_sha256,payload,reviewer,reason,reviewed_at)\n select x->>'barcode',x->>'source_sha256',x->'payload',x->>'reviewer',x->>'reason',(x->>'reviewed_at')::timestamptz from jsonb_array_elements(${approvals}) x;\n plan:=app.m9_sicar_plan(payload,src);\n if (plan->>'write_allowed')::boolean is distinct from true then raise exception 'DESTINATION_PLAN_BLOCKED' using detail=(plan->'errors')::text;end if;\n first_run:=app.m9_sicar_apply(payload,src,plan->>'token');\n if (first_run->>'created')::int<>${p.rows.length} or (first_run->>'updated')::int<>0 then raise exception 'WRONG_CREATE_COUNT';end if;\n plan:=app.m9_sicar_plan(payload,src);repeated:=app.m9_sicar_apply(payload,src,plan->>'token');\n if (repeated->>'created')::int<>0 or (repeated->>'updated')::int<>0 or (repeated->>'unchanged')::int<>${p.rows.length} then raise exception 'REPLAY_NOT_IDEMPOTENT';end if;\n set constraints all immediate;\n if exists(select 1 from jsonb_array_elements(payload) x left join app.m9_rows r on r.barcode=x->>'barcode' where r.variant_id is null or app.m9_sicar_current_row(r.variant_id) is distinct from x or r.source_row is distinct from x or r.source_sha256<>src) then raise exception 'POST_APPLY_PROJECTION_CHANGED';end if;\n if ${fingerprint} is distinct from ${quote(before.fingerprint)} then raise exception 'PREVIOUS_CATALOG_CHANGED';end if;\n if exists(select 1 from public.inventory_by_location) or exists(select 1 from public.inventory_movements) or exists(select 1 from public.sales) or exists(select 1 from public.layaways) then raise exception 'OPERATING_LEDGER_CHANGED';end if;\n insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.rule.staging.apply','rule',${quote(decision.cohort_sha256)},${quote(JSON.stringify({ ...decision, batch: b.index, rows: p.rows.length }))}::jsonb);\n insert into rule_result values(jsonb_build_object('batch',${b.index},'mode',${quote(mode)},'first_run',first_run,'repeated',repeated,'old_catalog_preserved',true,'literal_projection_verified',true,'inventory_operations',0));\nend $m9rule$;\nselect * from rule_result;\n${mode === "rehearsal" ? "rollback" : "commit"};\n`;
    await writeFile(resolve(out, `batch-${b.index}-${mode}.sql`), sql, {
      flag: "wx",
    });
  }
  prior += p.rows.length;
}
console.log({
  batches: batches.batches.length,
  rows: prior,
  existing_preserved: before.codes.length,
});
