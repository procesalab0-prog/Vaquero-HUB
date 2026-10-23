import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { quoteDoText } from "./sql-literal.mjs";

const changed = new Map([
  ["app.m9_rows", 1],
  ["app.m9_sicar_products", 1],
  ["app.m9_sicar_approved_rows", 1],
  ["app.m9_provisional_variants", 1],
  ["public.products", 1],
  ["public.variants", 1],
  ["public.barcodes", 1],
  ["public.m9_variant_details", 1],
  // Native audit: product INSERT, variant INSERT, barcode INSERT, product
  // department UPDATE; plus explicit catalog-create and provisional-register.
  ["public.audit_log", 6],
]);
const required = [
  ...changed.keys(),
  "public.sales",
  "public.inventory_by_location",
  "public.inventory_movements",
  "public.customer_credit_ledger",
  "public.cash_movements",
];
const lit = (x) => quoteDoText(x, "$m9incremental$");
export function incrementalProvisionalSql(plan, audit, actor, mode) {
  if (
    plan?.version !== "m9-provisional-plan-1" ||
    plan.production_allowed !== false ||
    plan.inventory_operations !== 0 ||
    plan.batches?.batches?.length !== 1 ||
    !["rollback", "commit"].includes(mode) ||
    !/^[a-f0-9-]{36}$/.test(actor)
  )
    throw Error("INCREMENTAL_STAGING_PLAN_REQUIRED");
  const packet = plan.batches.batches[0].packet;
  if (
    packet?.project_id !== "zsezjtswqeijboezvado" ||
    !/^[a-f0-9]{64}$/.test(packet.source_sha256 ?? "") ||
    !Array.isArray(packet.rows) ||
    !packet.rows.length ||
    packet.rows.length > 20 ||
    packet.rows.length !== packet.approvals?.length ||
    packet.rows.length !== plan.sourceEvidence?.length ||
    new Set(packet.rows.map((r) => r.barcode)).size !== packet.rows.length ||
    packet.rows.some(
      (r) =>
        typeof r.barcode !== "string" ||
        !r.barcode ||
        r.barcode !== r.barcode.trim() ||
        r.cost_cents !== null ||
        r.woo_variation_id !== null ||
        Object.keys(r.attributes ?? { bad: true }).length ||
        !r.family_key?.startsWith("prov-"),
    )
  )
    throw Error("INCREMENTAL_NEW_LITERAL_PROVISIONALS_ONLY");
  if (
    !Array.isArray(audit) ||
    new Set(audit.map((x) => x.name)).size !== audit.length ||
    audit.some(
      (x) =>
        !/^(app|public)\.[a-z][a-z0-9_]*$/.test(x.name) ||
        !Number.isSafeInteger(x.rows) ||
        x.rows < 0 ||
        !/^[a-f0-9]{32}$/.test(x.md5),
    ) ||
    required.some((name) => !audit.some((x) => x.name === name))
  )
    throw Error("COMPLETE_OPERATIONAL_AUDIT_REQUIRED");
  const evidence = new Map(plan.sourceEvidence.map((x) => [x.barcode, x]));
  if (
    packet.rows.some((r) => {
      const e = evidence.get(r.barcode);
      return (
        e?.fields?.["clave1 *"] !== r.barcode ||
        e.fields["descripción *"] !== r.description ||
        e.web_release !== false ||
        e.grouping_status !== "PROVISIONAL"
      );
    })
  )
    throw Error("INCREMENTAL_LITERAL_SOURCE_REQUIRED");
  const baseline = audit.map((x) => ({
    ...x,
    increment: (changed.get(x.name) ?? 0) * packet.rows.length,
  }));
  return `-- Staging only. Existing operating history is preserved, not required empty.
-- CTIDs are used only inside this transaction under write-excluding table locks.
-- PostgreSQL sequences may advance even when this rehearsal rolls back.
begin;
set local standard_conforming_strings=on;
set local statement_timeout='120s';
set local lock_timeout='5s';
set local request.jwt.claim.sub=${lit(actor)};
select app.assert_sicar_staging_enabled();
create temporary table incremental_baseline(name text primary key, n bigint, fingerprint text, old_tids tid[], increment integer) on commit drop;
create temporary table incremental_result(data jsonb) on commit drop;
do $m9incremental$
declare expected jsonb:=${lit(JSON.stringify(baseline))}::jsonb;
 payload jsonb:=${lit(JSON.stringify(packet.rows))}::jsonb;
 approvals jsonb:=${lit(JSON.stringify(packet.approvals))}::jsonb;
 sources jsonb:=${lit(JSON.stringify(packet.rows.map((r) => evidence.get(r.barcode))))}::jsonb;
 src text:=${lit(packet.source_sha256)}; e jsonb;b record;n bigint;h text;ids tid[];
 p jsonb;result jsonb;again jsonb;registered integer;replay_registered integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
 if (select array_agg(schemaname||'.'||tablename order by schemaname||'.'||tablename) from pg_catalog.pg_tables where schemaname in('app','public'))
   is distinct from (select array_agg(x->>'name' order by x->>'name') from jsonb_array_elements(expected)x)
   then raise exception 'INCREMENTAL_AUDIT_SCOPE_CHANGED';end if;
 lock table public.products in exclusive mode;
 for e in select value from jsonb_array_elements(expected) order by value->>'name' loop
  if not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname=split_part(e->>'name','.',1) and c.relname=split_part(e->>'name','.',2) and c.relkind='r'
      and not exists(select 1 from pg_catalog.pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid))
    then raise exception 'INCREMENTAL_ORDINARY_TABLE_REQUIRED';end if;
  execute format('lock table %I.%I in share row exclusive mode',split_part(e->>'name','.',1),split_part(e->>'name','.',2));
 end loop;
 for e in select value from jsonb_array_elements(expected) loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')),coalesce(array_agg(t.ctid),''{}''::tid[]) from %I.%I t',split_part(e->>'name','.',1),split_part(e->>'name','.',2)) into n,h,ids;
  if n<>(e->>'rows')::bigint or h<>e->>'md5' then raise exception 'INCREMENTAL_BASELINE_CHANGED: %',e->>'name';end if;
  insert into incremental_baseline values(e->>'name',n,h,ids,(e->>'increment')::integer);
 end loop;
 if exists(select 1 from app.m9_rows r join jsonb_array_elements(payload) x on r.barcode=x->>'barcode')
  then raise exception 'INCREMENTAL_CODE_ALREADY_LOADED';end if;
 if exists(select 1 from jsonb_array_elements(payload) x where not exists(select 1 from public.categories c where c.name=x->>'section' and c.is_active))
  then raise exception 'INCREMENTAL_EXISTING_ACTIVE_CATEGORY_REQUIRED';end if;
 insert into app.m9_sicar_approved_rows(barcode,source_sha256,payload,reviewer,reason,reviewed_at)
 select x->>'barcode',x->>'source_sha256',x->'payload',x->>'reviewer',x->>'reason',(x->>'reviewed_at')::timestamptz from jsonb_array_elements(approvals)x;
 p:=app.m9_sicar_plan(payload,src);
 if p->'write_allowed' is distinct from 'true'::jsonb then raise exception 'INCREMENTAL_DESTINATION_BLOCKED' using detail=(p->'errors')::text;end if;
 result:=app.m9_sicar_apply(payload,src,p->>'token');
 registered:=app.m9_register_provisionals(payload,sources,src);
 if (result->>'created')::integer<>jsonb_array_length(payload) or (result->>'updated')::integer<>0 or registered<>jsonb_array_length(payload)
  then raise exception 'INCREMENTAL_CREATE_COUNT_CHANGED';end if;
 p:=app.m9_sicar_plan(payload,src);
 again:=app.m9_sicar_apply(payload,src,p->>'token');
 replay_registered:=app.m9_register_provisionals(payload,sources,src);
 if (again->>'created')::integer<>0 or (again->>'updated')::integer<>0 or (again->>'unchanged')::integer<>registered or replay_registered<>0
  then raise exception 'INCREMENTAL_REPLAY_CHANGED';end if;
 set constraints all immediate;
 if exists(select 1 from jsonb_array_elements(payload)x join app.m9_rows r on r.barcode=x->>'barcode'
  left join app.m9_provisional_variants pv on pv.variant_id=r.variant_id
  where app.m9_sicar_current_row(r.variant_id) is distinct from x or pv.variant_id is null or pv.web_release or pv.grouping_status<>'PROVISIONAL')
  then raise exception 'INCREMENTAL_PROJECTION_CHANGED';end if;
 for b in select * from incremental_baseline order by name loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from %I.%I t where t.ctid=any($1)',split_part(b.name,'.',1),split_part(b.name,'.',2)) into n,h using b.old_tids;
  if n<>b.n or h<>b.fingerprint then raise exception 'INCREMENTAL_PREVIOUS_ROW_CHANGED: %',b.name;end if;
  execute format('select count(*) from %I.%I',split_part(b.name,'.',1),split_part(b.name,'.',2)) into n;
  if n<>b.n+b.increment then raise exception 'INCREMENTAL_UNEXPECTED_INSERT: %',b.name;end if;
 end loop;
 insert into incremental_result values(jsonb_build_object('created',registered,'replayed_without_change',true,'all_previous_rows_preserved',true,
 'audited_tables',jsonb_array_length(expected),'web_blocked',true,'inventory_operations',0,'new_debt_cents',0,'mode',${lit(mode)}));
end $m9incremental$;
select data from incremental_result;
${mode};
`;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [planPath, auditPath, actor, out] = process.argv.slice(2);
  if (!out) throw Error("Usage: PLAN.json AUDIT.json STAGING_ACTOR NEW_OUTPUT");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  await mkdir(out, { mode: 0o700 });
  for (const mode of ["rollback", "commit"])
    await writeFile(
      resolve(out, `${mode}.sql`),
      incrementalProvisionalSql(plan, audit, actor, mode),
      { flag: "wx", mode: 0o600 },
    );
}
