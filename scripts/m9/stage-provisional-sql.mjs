import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { quoteDoText } from "./sql-literal.mjs";
const [planPath, baselinePath, out] = process.argv.slice(2);
if (!out) throw Error("Usage: PROVISIONAL_PLAN BASELINE NEW_OUTPUT");
const plan = JSON.parse(await readFile(planPath)),
  baseline = JSON.parse(await readFile(baselinePath));
const quote = (s) => quoteDoText(s, "$m9prov$");
const evidence = new Map(plan.sourceEvidence.map((x) => [x.barcode, x]));
const fingerprint = `(select md5(string_agg(jsonb_build_object('variant_id',r.variant_id,'product_id',v.product_id,'current',app.m9_rehearsal_current_row(r.variant_id),'stored',r.source_row)::text,'' order by r.barcode)) from app.m9_rows r join public.variants v on v.id=r.variant_id where not exists(select 1 from app.m9_provisional_variants pv where pv.variant_id=r.variant_id))`;
const guard = `if ${fingerprint} is distinct from ${quote(baseline.fingerprint)} then raise exception 'PREVIOUS_CATALOG_CHANGED';end if;
if exists(select 1 from public.inventory_by_location) or exists(select 1 from public.inventory_movements) or exists(select 1 from public.sales) or exists(select 1 from public.layaways) then raise exception 'OPERATING_LEDGER_CHANGED';end if;`;
const sqlFor = (p, index, expected, mode) => {
  const rows = quote(JSON.stringify(p.rows)) + "::jsonb",
    approvals = quote(JSON.stringify(p.approvals)) + "::jsonb",
    sources =
      quote(JSON.stringify(p.rows.map((r) => evidence.get(r.barcode)))) +
      "::jsonb";
  return `-- Independent one-code/one-variant provisional import.\nbegin;\nset local standard_conforming_strings=on;\nselect app.assert_sicar_staging_enabled();\ncreate temporary table provisional_result(result jsonb) on commit drop;\ndo $m9prov$\ndeclare payload jsonb:=${rows}; src text:=${quote(p.source_sha256)};plan jsonb;result jsonb;registered int;\nbegin
perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
${guard}
if (select count(*) from app.m9_rows)<>${expected} then raise exception 'STAGING_COUNT_CHANGED';end if;
insert into app.m9_sicar_approved_rows(barcode,source_sha256,payload,reviewer,reason,reviewed_at) select x->>'barcode',x->>'source_sha256',x->'payload',x->>'reviewer',x->>'reason',(x->>'reviewed_at')::timestamptz from jsonb_array_elements(${approvals}) x;
plan:=app.m9_sicar_plan(payload,src);
if (plan->>'write_allowed')::boolean is distinct from true then raise exception 'DESTINATION_PLAN_BLOCKED' using detail=(plan->'errors')::text;end if;
result:=app.m9_sicar_apply(payload,src,plan->>'token');
registered:=app.m9_register_provisionals(payload,${sources},src);
if registered<>${p.rows.length} or (result->>'created')::int<>registered or (result->>'updated')::int<>0 then raise exception 'PROVISIONAL_CREATE_COUNT_CHANGED';end if;
set constraints all immediate;
if exists(select 1 from jsonb_array_elements(payload) x left join app.m9_rows r on r.barcode=x->>'barcode' left join app.m9_provisional_variants pv on pv.variant_id=r.variant_id where r.variant_id is null or pv.variant_id is null or pv.grouping_status<>'PROVISIONAL' or pv.web_release or app.m9_sicar_current_row(r.variant_id) is distinct from x) then raise exception 'PROVISIONAL_PROJECTION_CHANGED';end if;
${guard}
insert into provisional_result values(jsonb_build_object('batch',${index},'mode',${quote(mode)},'created',registered,'old_catalog_preserved',true,'web_blocked',true,'inventory_operations',0));
end $m9prov$;\nselect * from provisional_result;\n${mode === "rehearsal" ? "rollback" : "commit"};\n`;
};
await mkdir(out);
let previous = 0;
for (const b of plan.batches.batches) {
  for (const mode of ["rehearsal", "apply"])
    await writeFile(
      resolve(out, `batch-${b.index}-${mode}.sql`),
      sqlFor(
        b.packet,
        b.index,
        baseline.codes.length + (mode === "apply" ? previous : 0),
        mode,
      ),
      { flag: "wx" },
    );
  previous += b.packet.rows.length;
}
console.log({ batches: plan.batches.batches.length, codes: previous });
