import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "./acceleration.mjs";
import { quoteDoText } from "./sql-literal.mjs";

// Rollback-only maintenance rehearsal. It cannot enable a permanent phase and
// does not touch stock, prices, sales, PINs, folios or web publication.
export function phaseGuardRehearsal(plan, snapshot, order) {
  if (
    plan.project_id !== "zsezjtswqeijboezvado" ||
    snapshot.project_id !== plan.project_id ||
    plan.production_allowed !== false ||
    plan.automatic_import_allowed !== false ||
    !Number.isInteger(order) ||
    order < 1 ||
    order > 3 ||
    !snapshot.audit
  )
    throw Error("READ_ONLY_STAGING_PLAN_REQUIRED");
  const reviewed = new Map(
    plan.ledger.filter((r) => r.stage !== "HELD").map((r) => [r.barcode, r]),
  );
  const members = [],
    seen = new Set();
  for (const s of plan.stages.filter((s) => s.order <= order))
    for (const b of s.batches) {
      if (digest(b.codes) !== b.identity_sha256)
        throw Error("BATCH_IDENTITY_CHANGED");
      for (const c of b.codes) {
        const r = reviewed.get(c.barcode);
        if (
          !r ||
          r.variant_id !== c.variant_id ||
          r.product_id !== c.product_id ||
          r.stage !== s.stage ||
          seen.has(c.barcode)
        )
          throw Error("HELD_OR_CHANGED_IDENTITY_IN_BATCH");
        seen.add(c.barcode);
        members.push([c.barcode, c.variant_id]);
      }
    }
  if (!members.length) throw Error("EMPTY_PHASE");
  const baseline = snapshot.audit;
  const tables = [
    "public.variants",
    "public.products",
    "public.barcodes",
    "public.inventory_by_location",
    "public.inventory_movements",
    "public.sales",
    "public.sale_items",
    "public.sale_payments",
    "public.cash_movements",
    "public.returns",
    "public.return_items",
    "public.return_payments",
    "app.supervisor_authorizations",
    "public.idempotency_keys",
    "public.folios",
    "public.audit_log",
    "app.m9_rehearsal_control",
    "app.m9_rehearsal_allowlist",
  ];
  if (
    tables.some(
      (t) =>
        !Number.isSafeInteger(baseline[t]?.count) ||
        !/^[a-f0-9]{32}$/.test(baseline[t]?.md5 ?? ""),
    )
  )
    throw Error("FULL_AUDIT_BASELINE_REQUIRED");
  const q = (s) => quoteDoText(s, "$phase$");
  const verify = (t) =>
    `if (select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(row::text,'' order by row::text),''))) from (select to_jsonb(t) row from ${t} t) x) is distinct from ${q(JSON.stringify(baseline[t]))}::jsonb then raise exception 'BASELINE_CHANGED: ${t}';end if;`;
  const review = digest({
    kind: "ROLLBACK_ONLY_PHASE_GUARD",
    plan: digest(plan),
    order,
    members,
  });
  return `-- STAGING ONLY. Every temporary review write is rolled back.\nbegin;\nset local standard_conforming_strings=on;\nset local statement_timeout='120s';\nset local lock_timeout='5s';\nlock table app.m9_rehearsal_control,app.m9_rehearsal_allowlist in share row exclusive mode;\ncreate temporary table phase_result(result jsonb) on commit drop;\ncreate temporary table phase_members(barcode text primary key,variant_id uuid unique not null) on commit drop;\ninsert into phase_members select x->>0,(x->>1)::uuid from jsonb_array_elements(${q(JSON.stringify(members))}::jsonb) x;\ndo $phase$\ndeclare sid uuid;actor uuid;allowed uuid;held uuid;result jsonb;checks integer:=0;phase_review text:=${q(review)};\nbegin\n perform app.assert_sicar_staging_enabled();\n if not exists(select 1 from app.m9_rehearsal_control where singleton and enabled) then raise exception 'GUARD_MUST_STAY_ENABLED';end if;\n ${tables.map(verify).join("\n ")}\n if (select count(*) from phase_members)<>${members.length} then raise exception 'PHASE_SCOPE_CHANGED';end if;\n if exists(select 1 from phase_members m left join app.m9_rows r on r.variant_id=m.variant_id and r.barcode=m.barcode where r.variant_id is null or r.source_row is distinct from app.m9_rehearsal_current_row(r.variant_id)) then raise exception 'PHASE_CATALOG_CHANGED';end if;checks:=checks+1;\n select id,cashier_user_id into strict sid,actor from public.cash_sessions where status='OPEN' order by opened_at desc limit 1;\n if not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'ADMIN_FIXTURE_REQUIRED';end if;\n perform set_config('request.jwt.claim.sub',actor::text,true);\n select variant_id into strict allowed from phase_members order by barcode collate "C" limit 1;\n select r.variant_id into strict held from app.m9_rows r where not exists(select 1 from phase_members m where m.variant_id=r.variant_id) order by r.barcode collate "C" limit 1;\n update app.m9_rehearsal_control set review_sha256=phase_review,expires_at=clock_timestamp()+interval '1 hour' where singleton;\n insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row) select m.variant_id,m.barcode,phase_review,app.m9_rehearsal_current_row(m.variant_id) from phase_members m on conflict(variant_id) do update set review_sha256=excluded.review_sha256,expected_row=excluded.expected_row;\n if exists(select 1 from phase_members m where app.m9_rehearsal_status(m.variant_id) is not null) then raise exception 'PHASE_MEMBER_BLOCKED';end if;checks:=checks+1;\n if exists(select 1 from app.m9_rows r where not exists(select 1 from phase_members m where m.variant_id=r.variant_id) and app.m9_rehearsal_status(r.variant_id) is distinct from 'M9_VARIANT_PENDING_REVIEW') then raise exception 'OUTSIDE_PHASE_ALLOWED';end if;checks:=checks+1;\n if (select count(*) from app.m9_rehearsal_allowlist where review_sha256=phase_review)<>${members.length} then raise exception 'PHASE_REVIEW_COUNT_CHANGED';end if;checks:=checks+1;\n if app.m9_rehearsal_status(null) is distinct from 'M9_REHEARSAL_QUICK_ITEM_DISABLED' or app.m9_rehearsal_status(gen_random_uuid()) is distinct from 'M9_VARIANT_PENDING_REVIEW' then raise exception 'QUICK_OR_NEW_VARIANT_BYPASS';end if;checks:=checks+1;\n result:=public.get_pos_variants(sid,array[allowed,held]);\n if not exists(select 1 from jsonb_array_elements(result) v where v->>'id'=allowed::text and (v->>'isActive')::boolean) or exists(select 1 from jsonb_array_elements(result) v where v->>'id'=held::text and (v->>'isActive')::boolean) then raise exception 'POS_PHASE_FILTER_FAILED';end if;checks:=checks+1;\n begin\n  update app.m9_rehearsal_allowlist set expected_row=jsonb_set(expected_row,'{price_cents}',to_jsonb((expected_row->>'price_cents')::bigint+1)) where variant_id=allowed;\n  if app.m9_rehearsal_status(allowed) is distinct from 'M9_VARIANT_REVIEW_CHANGED' then raise exception 'CHANGED_REVIEW_ALLOWED';end if;checks:=checks+1;raise exception using errcode='ZX001';\n exception when sqlstate 'ZX001' then null;end;\n if app.m9_rehearsal_status(allowed) is not null then raise exception 'LOCAL_REVIEW_ROLLBACK_FAILED';end if;checks:=checks+1;\n begin\n  update app.m9_rehearsal_control set expires_at=clock_timestamp()+interval '20 milliseconds' where singleton;perform pg_sleep(0.03);\n  if app.m9_rehearsal_status(allowed) is distinct from 'M9_REVIEW_EXPIRED' then raise exception 'EXPIRED_PHASE_ALLOWED';end if;checks:=checks+1;raise exception using errcode='ZX001';\n exception when sqlstate 'ZX001' then null;end;\n if exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(name) where has_table_privilege(name,'app.m9_rehearsal_allowlist','INSERT') or has_table_privilege(name,'app.m9_rehearsal_control','UPDATE') or has_function_privilege(name,'app.assert_m9_rehearsal_variant(uuid)','EXECUTE')) then raise exception 'CLIENT_CAN_ACTIVATE_PHASE';end if;checks:=checks+1;\n ${tables
    .filter((t) => !t.startsWith("app.m9_rehearsal_"))
    .map(verify)
    .join(
      "\n ",
    )}\n insert into phase_result values(jsonb_build_object('phase',${order},'allowed_in_transaction',${members.length},'checks',checks,'historical_data_unchanged',true,'stock_imported',false,'permanent_activation',false,'mode','ROLLBACK_ONLY'));\nend $phase$;\nselect * from phase_result;\nrollback;\n`;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [planPath, snapshotPath, out] = process.argv.slice(2);
  if (!out) throw Error("Usage: PLAN.json SNAPSHOT.json NEW_OUTPUT_DIR");
  const plan = JSON.parse(await readFile(planPath)),
    snapshot = JSON.parse(await readFile(snapshotPath));
  const scripts = [1, 2, 3].map((n) => phaseGuardRehearsal(plan, snapshot, n));
  await mkdir(out);
  for (let i = 0; i < scripts.length; i++)
    await writeFile(resolve(out, `etapa-${i + 1}-rollback.sql`), scripts[i], {
      flag: "wx",
    });
  console.log({ scripts: 3, permanent_activation: false, stock_writes: false });
}
