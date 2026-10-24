// Preparation ONLY: no database client, credentials, network or execution path.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
export const POLICY = Object.freeze({
  project: "zsezjtswqeijboezvado",
  origin: "https://salmon-nightingale-251188.hostingersite.com",
  campaigns: 5,
  tables: 179,
  source_sicar:
    "b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93",
  source_woo:
    "8d212b77985baadad276006bf92f4fa6f032c069989eb4f501f07904b121dd26",
  helper_body:
    "f2415db7008fc29a4dfea834593f7a0372e5e21ba413f1b7e5899166ac5d125c",
  helper_definition:
    "ae44d5e0c8fe90fe6a8f7206e0c0ebe8ea388fbdcfda55ea496c7389a2597ff6",
  definitions: Object.freeze({
    cancel_base:
      "95aa17669545b38fed970e6e9db537e2ce10f9aec14798ed792e3a4933b2dff6",
    writer: "d2386c2ece57731a215087aeecbd3f5a82a323dbcb24adc5588100b6f0c312c6",
    guard: "ef2601ca291c8733262ea9541098e67e7059c7f3eb9ec2c29c1e9f541db3a5b4",
    reader: "604905fa62f795ab824266bc33d51257312625867297cb4b0dbf3b556950b17c",
    public_wrapper:
      "85951fb3c330aff9dde5bfa07036bfc2de34c5316b3e3fb2e698739818b96d11",
  }),
});
export const SUPPORT_SIGNATURES = Object.freeze([
  "app.m9_woo_pilot_command(jsonb)",
  "app.m9_woo_rehearsal_evidence(bigint,jsonb,text,uuid)",
  "app.m9_woo_rehearsal_packet(uuid,text,bigint,text)",
  "app.m9_current_row(uuid)",
  "app.apply_movement(uuid,uuid,text,numeric,text,text,jsonb)",
  "public.open_cash_session(uuid,bigint)",
  "public.close_cash_session(uuid,bigint,text)",
  "public.create_sale(uuid,uuid,jsonb,jsonb,uuid,jsonb,text)",
  "app.create_sale_engine(uuid,uuid,jsonb,jsonb,uuid,jsonb,text,uuid)",
]);
const need = (v, m) => {
  if (!v) throw Error(m);
};
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, ks) =>
  obj(v) && Object.keys(v).sort().join("|") === [...ks].sort().join("|");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    v,
  );
const date = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const sqlLit = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const identity = (seed, name) => {
  const h = sha(seed + "/" + name);
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-5" +
    h.slice(13, 16) +
    "-a" +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
};
const requiredTables = [
  "app.m9_woo_connected_trials",
  "app.m9_woo_finance_pilot_control",
  "app.m9_woo_pilot_control",
  "app.m9_rehearsal_control",
  "app.m9_rows",
  "app.m9_woo_finance_receipts",
  "app.m9_woo_finance_postings",
  "public.sales",
  "public.sale_payments",
  "public.cash_sessions",
  "public.inventory_by_location",
  "public.inventory_movements",
  "public.inventory_reservation_movements",
  "public.products",
  "public.variants",
  "public.barcodes",
];
const gates = [
  "capture",
  "native_finance",
  "stock_pilot",
  "web_settlement",
  "worker",
];
export function prepareWooIntegralRehearsal(input) {
  need(
    keys(input, [
      "protocol",
      "project_id",
      "origin",
      "mode",
      "namespace",
      "actor_id",
      "as_of",
      "snapshot_at",
      "audit",
      "gates",
      "campaigns",
      "native_receipts",
      "definitions_sha256",
      "support_definitions",
      "helper",
      "source_sha256",
      "input_sha256",
    ]),
    "EXACT_INPUT_REQUIRED",
  );
  need(
    input.protocol === "m9-woo-integral-preparation-1" &&
      input.mode === "PREPARE_ONLY_NO_EXECUTION",
    "PREPARATION_ONLY_REQUIRED",
  );
  need(
    input.project_id === POLICY.project && input.origin === POLICY.origin,
    "FIXED_STAGING_TEST_ORIGIN_REQUIRED",
  );
  need(uuid(input.actor_id), "EXISTING_ACTOR_UUID_REQUIRED");
  need(
    typeof input.namespace === "string" &&
      /^SYNTHETIC-WOO-INTEGRAL-[A-Z0-9-]{1,24}$/.test(input.namespace),
    "SYNTHETIC_NAMESPACE_REQUIRED",
  );
  need(
    date(input.as_of) && date(input.snapshot_at),
    "CANONICAL_SNAPSHOT_CLOCK_REQUIRED",
  );
  need(
    Date.parse(input.as_of) >= Date.parse(input.snapshot_at) &&
      Date.parse(input.as_of) - Date.parse(input.snapshot_at) <= 900000,
    "SNAPSHOT_TOO_OLD_FOR_STATED_AS_OF",
  );
  need(
    Array.isArray(input.audit) && input.audit.length === POLICY.tables,
    "EXACT_179_TABLE_AUDIT_REQUIRED",
  );
  const audit = input.audit
    .map((r) => {
      need(
        keys(r, ["name", "rows", "md5"]) &&
          typeof r.name === "string" &&
          /^(app|public)\.[a-z][a-z0-9_]{0,62}$/.test(r.name) &&
          Number.isSafeInteger(r.rows) &&
          r.rows >= 0 &&
          typeof r.md5 === "string" &&
          /^[a-f0-9]{32}$/.test(r.md5),
        "INVALID_TABLE_AUDIT",
      );
      return { name: r.name, rows: r.rows, md5: r.md5 };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  need(
    new Set(audit.map((r) => r.name)).size === 179 &&
      requiredTables.every((n) => audit.some((r) => r.name === n)),
    "TABLE_SCOPE_DUPLICATE_OR_INCOMPLETE",
  );
  need(
    keys(input.gates, gates) &&
      Object.values(input.gates).every((v) => v === false),
    "ALL_FIVE_GATES_MUST_BE_FALSE",
  );
  need(
    input.campaigns === 5 && input.native_receipts === 0,
    "CAMPAIGN_OR_NATIVE_RECEIPT_BASELINE_CHANGED",
  );
  need(
    keys(input.definitions_sha256, Object.keys(POLICY.definitions)) &&
      Object.entries(POLICY.definitions).every(
        ([k, v]) => input.definitions_sha256[k] === v,
      ),
    "INSTALLED_DEFINITION_PREIMAGE_CHANGED",
  );
  need(
    keys(input.support_definitions, SUPPORT_SIGNATURES) &&
      Object.values(input.support_definitions).every(hash),
    "EXACT_SUPPORT_PREIMAGES_REQUIRED",
  );
  need(
    keys(input.helper, [
      "owner",
      "definer",
      "volatility",
      "search_path",
      "acl",
      "body_sha256",
      "definition_sha256",
    ]) &&
      input.helper.owner === "postgres" &&
      input.helper.definer === false &&
      input.helper.volatility === "v" &&
      same(input.helper.search_path, ['search_path=""']) &&
      keys(input.helper.acl, ["anon", "authenticated", "service_role"]) &&
      Object.values(input.helper.acl).every((v) => v === false) &&
      input.helper.body_sha256 === POLICY.helper_body &&
      input.helper.definition_sha256 === POLICY.helper_definition,
    "PRIVATE_HELPER_PREIMAGE_OR_ACL_CHANGED",
  );
  need(
    keys(input.source_sha256, ["sicar", "woo"]) &&
      input.source_sha256.sicar === POLICY.source_sicar &&
      input.source_sha256.woo === POLICY.source_woo,
    "SOURCE_CUT_CHANGED_REVIEW_REQUIRED",
  );
  need(
    keys(input.input_sha256, [
      "audit",
      "controls",
      "gates",
      "definitions",
      "helper",
      "support",
      "sicar",
      "woo",
    ]) && Object.values(input.input_sha256).every(hash),
    "PINNED_INPUT_BYTES_REQUIRED",
  );
  need(
    input.input_sha256.sicar === input.source_sha256.sicar &&
      input.input_sha256.woo === input.source_sha256.woo,
    "INPUT_SOURCE_PIN_MISMATCH",
  );
  const seed = sha(
    JSON.stringify({
      namespace: input.namespace,
      actor: input.actor_id,
      audit,
      source: input.source_sha256,
    }),
  );
  const fixture = {
    namespace: input.namespace,
    source_sha256: sha("SYNTHETIC_FIXTURE_ONLY/" + seed),
    order_id: 9600000000 + (parseInt(seed.slice(0, 8), 16) % 900000),
    location: identity(seed, "location"),
    register: identity(seed, "register"),
    category: identity(seed, "category"),
    products: [identity(seed, "product1"), identity(seed, "product2")],
    variants: [identity(seed, "variant1"), identity(seed, "variant2")],
    barcodes: [identity(seed, "barcode1"), identity(seed, "barcode2")],
    codes: [input.namespace + "-01", input.namespace + "-02"],
  };
  const plan = {
    protocol: "m9-woo-integral-prepared-plan-1",
    project_id: POLICY.project,
    origin: POLICY.origin,
    mode: "PREPARE_ONLY_NO_EXECUTION",
    as_of: input.as_of,
    snapshot_at: input.snapshot_at,
    actor_id: input.actor_id,
    fixture,
    expected_audit: audit,
    expected_definition_sha256: {
      ...POLICY.definitions,
      helper: POLICY.helper_definition,
    },
    source_sha256: { ...input.source_sha256 },
    support_definitions: { ...input.support_definitions },
    input_sha256: { ...input.input_sha256 },
    execution_authorized: false,
    sql_executed: false,
    sql_acceptance_passed: false,
    requires_reviewed_authorization_before_execution: true,
    requires_new_local_SQL_acceptance: true,
    requires_fresh_staging_snapshot_at_execution: true,
    temporary_controls_if_separately_authorized: [
      "m9_rehearsal_control",
      "m9_woo_pilot_control",
      "m9_woo_finance_pilot_control",
    ],
    durable_seed_rows_allowed: 0,
    external_orders_allowed: 0,
    connected_campaigns_after: 5,
    real_gateway_authenticated: false,
    operational_24h_ready: false,
    sequence_changes_may_persist: true,
    sequence_reset_allowed: false,
    sequence_exceptions:
      "Native nextval/audit identity sequences may advance despite ROLLBACK. Capture before/after; never reset or hide gaps.",
    blocking_conditions: [
      "NO_SQL_ACCEPTANCE_WITH_CURRENT_DOCKER_UNAVAILABLE",
      "ROOT_REVIEW_AND_DISTINCT_POSITIVE_REHEARSAL_AUTHORIZATION_REQUIRED",
      "RUNTIME_BASELINE_AND_PREIMAGES_MUST_MATCH_EXACTLY",
      "EXTERNAL_PROVIDER_AND_RENEWED_AUTHENTICATED_WOO_STILL_PENDING",
      "SINGLE_TRANSACTION_DOES_NOT_TEST_NETWORK_ACK_LOSS_OR_CROSS_CONNECTION_COMMIT",
    ],
  };
  return { plan, sql: renderSql(plan) };
}
function auditBlock(expected, phase) {
  return `declare expected jsonb:=${sqlLit(JSON.stringify(expected))}::jsonb;t record;actual jsonb:='[]';v jsonb;names text[];begin
 select array_agg(schemaname||'.'||tablename order by(schemaname||'.'||tablename)collate"C")into names from pg_tables where schemaname in('app','public');
 if names is distinct from(select array_agg(x->>'name'order by(x->>'name')collate"C")from jsonb_array_elements(expected)x)then raise exception 'INTEGRAL_${phase}_AUDIT_SCOPE_CHANGED';end if;
 for t in select schemaname,tablename from pg_tables where schemaname in('app','public')order by(schemaname||'.'||tablename)collate"C" loop
  execute format('select jsonb_build_object(''name'',%L,''rows'',count(*),''md5'',md5(coalesce(string_agg(j,''|''order by j),'''')))from(select to_jsonb(q)::text j from %I.%I q)x',t.schemaname||'.'||t.tablename,t.schemaname,t.tablename)into v;actual:=actual||jsonb_build_array(v);
 end loop;
 if actual is distinct from expected then raise exception 'INTEGRAL_${phase}_AUDIT_CONTENT_CHANGED';end if;
end;`;
}
function renderSql(p) {
  const f = p.fixture,
    lit = sqlLit,
    source = lit(f.source_sha256),
    ns = lit(f.namespace),
    actor = lit(p.actor_id);
  const functionNames = {
    cancel_base: "app.cancel_sale_base(uuid,text)",
    writer: "app.m9_woo_native_finance(jsonb)",
    guard: "app.m9_woo_assert_finance_sale(uuid)",
    reader: "app.m9_woo_native_finance_receipt(jsonb)",
    public_wrapper: "public.cancel_sale(uuid,text)",
    helper: "app.m9_woo_cancel_capability(uuid,uuid,boolean)",
  };
  const definitions = Object.entries(functionNames)
    .map(
      ([k, sig]) =>
        ` if encode(extensions.digest(pg_get_functiondef(${lit(sig)}::regprocedure),'sha256'),'hex')<>${lit(p.expected_definition_sha256[k])}then raise exception 'INTEGRAL_DEFINITION_CHANGED_${k.toUpperCase()}';end if;`,
    )
    .join("\n");
  const supportDefinitions = Object.entries(p.support_definitions)
    .map(
      ([sig, h]) =>
        ` if encode(extensions.digest(pg_get_functiondef(${lit(sig)}::regprocedure),'sha256'),'hex')<>${lit(h)}then raise exception 'INTEGRAL_SUPPORT_DEFINITION_CHANGED';end if;`,
    )
    .join("\n");
  const header = `-- PREPARED ONLY. NOT EXECUTED OR ACCEPTED. Requires separate reviewed root authorization.
-- Synthetic native kernel only: NO network/Woo order, NO sixth connected campaign.
-- This script WOULD enable three isolated controls transiently inside BEGIN.
-- Mandatory ROLLBACK removes fixture rows and all transactional effects.
-- Native nextval/audit sequence gaps are NOT rolled back and must be disclosed.
-- No psql command, credential, gateway configuration, cron, worker or activation.
begin;
set local lock_timeout='3s';set local statement_timeout='45s';set local timezone='UTC';
select app.assert_sicar_staging_enabled();
`;
  const preflight = `do $preflight$
declare t record;begin
 if current_user<>'postgres'or session_user<>'postgres'or current_setting('role')not in('none','postgres')then raise insufficient_privilege;end if;
 perform set_config('request.jwt.claim.sub',${actor},true);
 if not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=${actor}::uuid and u.is_active and r.code='ADMIN')then raise exception 'INTEGRAL_EXISTING_ADMIN_REQUIRED';end if;
 if not app.has_perm('pos.sell')or not app.has_perm('sales.cancel')or not app.has_perm('cash.open')or not app.has_perm('cash.close')or not app.has_perm('inventory.adjust')then raise insufficient_privilege;end if;
 if clock_timestamp()<${lit(p.snapshot_at)}::timestamptz or clock_timestamp()>${lit(p.snapshot_at)}::timestamptz+interval'15 minutes'then raise exception 'INTEGRAL_SNAPSHOT_EXPIRED_RENEW_AND_REVIEW';end if;
 if exists(select 1 from public.cash_sessions where cashier_user_id=${actor}::uuid and status='OPEN')then raise exception 'INTEGRAL_ACTOR_ALREADY_HAS_OPEN_SESSION';end if;
${definitions}
${supportDefinitions}
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid='app.m9_woo_cancel_capability(uuid,uuid,boolean)'::regprocedure
  and pg_catalog.pg_get_userbyid(p.proowner)='postgres'and not p.prosecdef and p.provolatile='v'
  and p.proconfig=array['search_path=""']::text[]
  and not has_function_privilege('anon',p.oid,'EXECUTE')and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not has_function_privilege('service_role',p.oid,'EXECUTE'))then raise exception 'INTEGRAL_PRIVATE_HELPER_PREIMAGE_OR_ACL_CHANGED';end if;
 if not exists(select 1 from app.m9_web_settlement_control where singleton and project_ref='zsezjtswqeijboezvado')then raise exception 'INTEGRAL_EXACT_PROJECT_REQUIRED';end if;
 if(select count(*)from app.m9_woo_connected_trials)<>5 then raise exception 'INTEGRAL_CONNECTED_CAMPAIGN_CHANGED';end if;
 if not exists(select 1 from app.m9_woo_worker_control where singleton and enabled=false)or not exists(select 1 from app.m9_availability_control where singleton and enabled=false)
 or not exists(select 1 from app.m9_web_settlement_control where singleton and enabled=false)or not exists(select 1 from app.m9_woo_finance_pilot_control where singleton and enabled=false)
 or not exists(select 1 from app.m9_woo_pilot_control where singleton and enabled=false)or not exists(select 1 from app.m9_rehearsal_control where singleton and enabled=false)
 then raise exception 'INTEGRAL_GATES_MUST_ALREADY_BE_FALSE';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('m9-synthetic-integral-rehearsal',0))then raise lock_not_available;end if;
 lock table public.products in exclusive mode nowait;lock table public.variants in exclusive mode nowait;
 for t in select schemaname,tablename from pg_tables where schemaname in('app','public')and(schemaname||'.'||tablename)not in('public.products','public.variants')order by schemaname,tablename loop
  execute format('lock table %I.%I in share row exclusive mode nowait',t.schemaname,t.tablename);
 end loop;
end; $preflight$;
do $baseline$
${auditBlock(p.expected_audit, "BEFORE")}
$baseline$;
`;
  const vars = `declare actor uuid:=${actor};loc uuid:=${lit(f.location)};reg uuid:=${lit(f.register)};cat uuid:=${lit(f.category)};session_id uuid;eid uuid;refund_id uuid;oid bigint:=${f.order_id};
 product_ids uuid[]:=array[${f.products.map(lit).join(",")}]::uuid[];variant_ids uuid[]:=array[${f.variants.map(lit).join(",")}]::uuid[];barcode_ids uuid[]:=array[${f.barcodes.map(lit).join(",")}]::uuid[];
 codes text[]:=array[${f.codes.map(lit).join(",")}];i int;serial bigint;current_row jsonb;lines jsonb:='[]';packet jsonb;post_packet jsonb;cancel_packet jsonb;posted jsonb;cancelled jsonb;replayed jsonb;receipt jsonb;before_closed jsonb;before_payment jsonb;actual jsonb;count_before bigint;`;
  const chain = `do $synthetic_chain$
${vars}
begin
 if exists(select 1 from public.locations where id=loc or code=${ns})or exists(select 1 from public.cash_registers where id=reg)
 or exists(select 1 from public.categories where id=cat or name=${ns})or exists(select 1 from public.products where id=any(product_ids))or exists(select 1 from public.variants where id=any(variant_ids))
 or exists(select 1 from public.barcodes where id=any(barcode_ids)or code=any(codes))or exists(select 1 from app.m9_woo_pilot_orders where origin=${lit(POLICY.origin)}and order_id=oid)
 or exists(select 1 from app.m9_woo_pilot_links where origin=${lit(POLICY.origin)}and woo_product_id between oid+1000001 and oid+1000002)
 then raise exception 'INTEGRAL_SYNTHETIC_ID_COLLISION';end if;
 insert into public.locations(id,code,name,type)values(loc,${ns},${ns},'STORE');
 insert into public.cash_registers(id,location_id,code,name)values(reg,loc,${ns},${ns});
 session_id:=(public.open_cash_session(reg,0)).id;
 if exists(select 1 from public.payment_methods where code='M9_WEB_TEST'and(kind<>'OTHER'or not requires_reference))then raise exception 'INTEGRAL_TEST_METHOD_CONFLICT';end if;
 insert into public.payment_methods(code,name,kind,requires_reference)values('M9_WEB_TEST','SYNTHETIC ONLY; NOT A GATEWAY','OTHER',true)on conflict(code)do update set is_active=true;
 insert into public.categories(id,name)values(cat,${ns});
 for i in 1..2 loop
  insert into public.products(id,name,category_id)values(product_ids[i],codes[i],cat);
  serial:=nextval('app.variant_serial_seq');
  insert into public.variants(id,product_id,sku,cost_cents,price_cents)values(variant_ids[i],product_ids[i],serial::text||'-'||app.luhn_check_digit(serial::text),null,10000);
  insert into public.barcodes(id,variant_id,code,symbology,source,is_primary)values(barcode_ids[i],variant_ids[i],codes[i],'CODE128','SICAR',true);
  insert into public.m9_variant_details(variant_id,department,section,source_description)values(variant_ids[i],'SYNTHETIC FIXTURE ONLY',${ns},'SYNTHETIC NOT SICAR SOURCE');
  current_row:=app.m9_current_row(variant_ids[i]);if current_row is null then raise exception 'INTEGRAL_CURRENT_ROW_INCOMPLETE';end if;
  insert into app.m9_rows(barcode,variant_id,source_row,source_sha256)values(codes[i],variant_ids[i],current_row,${source});
  insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row)values(variant_ids[i],codes[i],${source},current_row);
  insert into app.m9_woo_pilot_links(origin,woo_product_id,woo_variation_id,variant_id,barcode,evidence_sha256)values(${lit(POLICY.origin)},oid+1000000+i,0,variant_ids[i],codes[i],${source});
  perform app.apply_movement(variant_ids[i],loc,'INITIAL_IMPORT',3,'SYNTHETIC_INTEGRAL_SEED',${ns},'{"synthetic":true}');
  lines:=lines||jsonb_build_array(jsonb_build_object('line_id',i,'product_id',oid+1000000+i,'variation_id',0,'barcode',codes[i],'quantity',2));
 end loop;
 update app.m9_rehearsal_control set enabled=true,review_sha256=${source},expires_at=clock_timestamp()+interval'10 minutes'where singleton;
 update app.m9_woo_pilot_control set enabled=true,actor_id=actor,location_id=loc,expires_at=clock_timestamp()+interval'10 minutes'where singleton;
 update app.m9_woo_finance_pilot_control set enabled=true,actor_id=actor,location_id=loc,cash_session_id=session_id,expires_at=clock_timestamp()+interval'10 minutes'where singleton;
 packet:=jsonb_build_object('store_origin',${lit(POLICY.origin)},'order_id',oid,'operation_id',${ns}||'-reserve','expected_version',0,'action','RESERVE','evidence_sha256',${source},'reason','SYNTHETIC TECHNICAL QA ONLY','lines',lines);
 perform app.m9_woo_pilot_command(packet);
 eid:=app.m9_woo_rehearsal_evidence(oid,lines,'PAYMENT',null);post_packet:=app.m9_woo_rehearsal_packet(eid,${ns}||'-post',1,'POST');
 posted:=app.m9_woo_native_finance(post_packet);
 if posted->>'action'<>'POST'or posted->'amount_cents'<>'40000'::jsonb or posted->'synthetic'<>'true'::jsonb or posted->'cash_movement_created'<>'false'::jsonb then raise exception 'INTEGRAL_POST_RESULT_INVALID';end if;
 count_before:=(select count(*)from public.inventory_movements where location_id=loc);
 replayed:=app.m9_woo_native_finance(post_packet);
 if replayed is distinct from posted||'{"replayed":true}'::jsonb or(select count(*)from public.inventory_movements where location_id=loc)<>count_before then raise exception 'INTEGRAL_POST_REPLAY_CHANGED';end if;
 if(select count(*)from public.inventory_by_location where location_id=loc and variant_id=any(variant_ids)and qty=1 and reserved_qty=0)<>2 then raise exception 'INTEGRAL_POST_STOCK_CHANGED';end if;
 perform public.close_cash_session(session_id,0,'SYNTHETIC ORIGINAL CASH CLOSURE');
 select to_jsonb(s)into before_closed from public.cash_sessions s where id=session_id;if before_closed->>'status'<>'CLOSED'then raise exception 'INTEGRAL_ORIGINAL_NOT_CLOSED';end if;
 select jsonb_agg(to_jsonb(x)order by x.id)into before_payment from public.sale_payments x where sale_id=(posted->>'sale_id')::uuid;
 begin perform app.m9_woo_native_finance(post_packet);raise exception 'INTEGRAL_CLOSED_POST_UNEXPECTEDLY_ACCEPTED';exception when others then if SQLERRM<>'WOO_FINANCE_SESSION_REQUIRED'then raise;end if;end;
 receipt:=app.m9_woo_native_finance_receipt(post_packet);
 if receipt->'receipt'is distinct from posted or receipt->>'current_sale_status'<>'COMPLETED'or receipt->'repost_allowed'<>'false'::jsonb then raise exception 'INTEGRAL_POST_READ_AFTER_CLOSE_CHANGED';end if;
 refund_id:=app.m9_woo_rehearsal_evidence(oid,lines,'FULL_CANCEL',eid);cancel_packet:=app.m9_woo_rehearsal_packet(refund_id,${ns}||'-cancel',2,'FULL_CANCEL');
 cancelled:=app.m9_woo_native_finance(cancel_packet);
 if cancelled->>'action'<>'FULL_CANCEL'or cancelled->'cash_movement_created'<>'false'::jsonb then raise exception 'INTEGRAL_CANCEL_RESULT_INVALID';end if;
 if(select to_jsonb(s)from public.cash_sessions s where id=session_id)is distinct from before_closed or(select jsonb_agg(to_jsonb(x)order by x.id)from public.sale_payments x where sale_id=(posted->>'sale_id')::uuid)is distinct from before_payment then raise exception 'INTEGRAL_CLOSED_SESSION_OR_PAYMENT_MUTATED';end if;
 count_before:=(select count(*)from public.inventory_movements where location_id=loc);
 replayed:=app.m9_woo_native_finance(cancel_packet);
 if replayed is distinct from cancelled||'{"replayed":true}'::jsonb or(select count(*)from public.inventory_movements where location_id=loc)<>count_before then raise exception 'INTEGRAL_CANCEL_REPLAY_CHANGED';end if;
 if(select count(*)from app.m9_woo_finance_receipts where origin=${lit(POLICY.origin)}and order_id=oid)<>2 or(select count(*)from public.sales where location_id=loc and status='CANCELLED')<>1 then raise exception 'INTEGRAL_FINANCIAL_ROWCOUNT_CHANGED';end if;
 for i in 1..2 loop perform app.apply_movement(variant_ids[i],loc,'ADJUSTMENT',-3,'SYNTHETIC_INTEGRAL_RETIRE',${ns},'{"synthetic":true}');end loop;
 if exists(select 1 from public.inventory_by_location where location_id=loc and(qty<>0 or reserved_qty<>0))or exists(select 1 from public.sale_items where sale_id=(posted->>'sale_id')::uuid and unit_cost_cents is not null)
 or exists(select 1 from public.variants where id=any(variant_ids)and cost_cents is not null)or exists(select 1 from public.cash_movements where location_id=loc and amount_cents<>0)then raise exception 'INTEGRAL_BALANCE_COST_OR_CASH_INVALID';end if;
 update app.m9_woo_finance_pilot_control set enabled=false,actor_id=null,location_id=null,cash_session_id=null,expires_at=null where singleton;
 update app.m9_woo_pilot_control set enabled=false,actor_id=null,location_id=null,expires_at=null where singleton;
 update app.m9_rehearsal_control set enabled=false,review_sha256=null,expires_at=null where singleton;
 receipt:=app.m9_woo_native_finance_receipt(post_packet);
 if receipt->'receipt'is distinct from posted or receipt->>'current_sale_status'<>'CANCELLED'or receipt->'repost_allowed'<>'false'::jsonb then raise exception 'INTEGRAL_HISTORICAL_POST_CHANGED';end if;
 receipt:=app.m9_woo_native_finance_receipt(cancel_packet);
 if receipt->'receipt'is distinct from cancelled or receipt->>'current_sale_status'<>'CANCELLED'or receipt->'repost_allowed'<>'false'::jsonb then raise exception 'INTEGRAL_CANCEL_READ_CHANGED';end if;
 if to_regclass('pg_temp.m9_woo_closed_cancel_cap')is not null or(select count(*)from app.m9_woo_connected_trials)<>5 then raise exception 'INTEGRAL_TEMP_OR_CAMPAIGN_CHANGED';end if;
end; $synthetic_chain$;
-- Mandatory rollback. The following audit must match the ORIGINAL baseline.
rollback;
select app.assert_sicar_staging_enabled();
do $after_rollback$
${auditBlock(p.expected_audit, "AFTER_ROLLBACK")}
$after_rollback$;
select schemaname,sequencename,last_value from pg_sequences where schemaname in('app','public')order by schemaname,sequencename;
select jsonb_build_object('protocol','m9-woo-integral-synthetic-rollback-1','synthetic_only',true,'durable_fixture_rows',0,'connected_campaigns',5,'external_woo_orders_created',0,'requires_external_audit_review',true,'sequence_gaps_possible',true,'real_gateway_proven',false,'operational_24h_ready',false)result;
`;
  return (
    header +
    preflight +
    "select schemaname,sequencename,last_value from pg_sequences where schemaname in('app','public')order by schemaname,sequencename;\n" +
    chain
  );
}
export function unwrapReceipt(bytes, { allRows = false } = {}) {
  const raw = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  need(
    raw.isError === false &&
      Array.isArray(raw.content) &&
      raw.content.length === 1 &&
      raw.content[0].type === "text",
    "MCP_RECEIPT_REQUIRED",
  );
  let v = JSON.parse(raw.content[0].text);
  v = v.result ?? v;
  if (typeof v === "string") {
    const m =
      /^<untrusted-data-([A-Za-z0-9-]+)>\s*([\s\S]*?)\s*<\/untrusted-data-\1>$/m.exec(
        v,
      );
    need(m, "MCP_DATA_BOUNDARY_REQUIRED");
    v = JSON.parse(m[2]);
  }
  if (allRows) {
    need(Array.isArray(v), "RECEIPT_ROWS_REQUIRED");
    return v;
  }
  if (Array.isArray(v)) {
    need(v.length === 1, "ONE_RECEIPT_ROW_REQUIRED");
    v = v[0];
  }
  return keys(v, ["result"]) ? v.result : v;
}
const configKeys = [
  "protocol",
  "mode",
  "project_id",
  "origin",
  "actor_id",
  "namespace",
  "as_of",
  "inputs",
];
export async function writePreparation(configPath, out) {
  const config = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readFile(configPath),
    ),
  );
  need(keys(config, configKeys), "EXACT_CONFIG_REQUIRED");
  need(
    keys(config.inputs, [
      "audit",
      "controls",
      "gates",
      "definitions",
      "helper",
      "support",
      "sicar",
      "woo",
    ]),
    "EXACT_INPUT_PINS_REQUIRED",
  );
  const values = {},
    pins = {};
  for (const [name, pin] of Object.entries(config.inputs)) {
    need(
      keys(pin, ["path", "sha256"]) &&
        isAbsolute(pin.path) &&
        !/(^|[./_-])(env|secrets?|credentials?|passwords?|tokens?)([./_-]|$)/i.test(
          pin.path,
        ) &&
        hash(pin.sha256),
      "LOCAL_NONSECRET_PIN_REQUIRED",
    );
    const b = await readFile(pin.path);
    need(
      b.length > 0 && b.length <= 64 * 1024 * 1024 && sha(b) === pin.sha256,
      "INPUT_BYTES_CHANGED:" + name,
    );
    pins[name] = pin.sha256;
    values[name] = ["sicar", "woo"].includes(name)
      ? null
      : unwrapReceipt(b, { allRows: name === "support" });
  }
  const assembled = values.controls.overview.assembled_at;
  need(
    typeof assembled === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/.test(
        assembled,
      ),
    "CANONICAL_SERVER_TIMESTAMP_REQUIRED",
  );
  const m =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(
      assembled,
    );
  const snapshot = m[1] + "." + (m[2] ?? "").padEnd(3, "0").slice(0, 3) + "Z";
  need(date(snapshot), "IMPOSSIBLE_SERVER_TIMESTAMP");
  const support = {};
  for (const r of values.support) {
    need(keys(r, ["signature", "sha256"]), "SUPPORT_ROW_SHAPE");
    const sig = r.signature.includes(".")
      ? r.signature
      : "public." + r.signature;
    need(!Object.hasOwn(support, sig), "DUPLICATE_SUPPORT_SIGNATURE");
    support[sig] = r.sha256;
  }

  const input = {
    protocol: config.protocol,
    mode: config.mode,
    project_id: config.project_id,
    origin: config.origin,
    namespace: config.namespace,
    actor_id: config.actor_id,
    as_of: config.as_of,
    snapshot_at: snapshot,
    audit: values.audit.audit,
    gates: values.gates.gates,
    campaigns: values.controls.overview.woo.remote_connected_trials,
    native_receipts: values.controls.native_finance_receipts,
    definitions_sha256: Object.fromEntries(
      Object.entries(values.definitions).map(([k, v]) => [k, sha(v)]),
    ),
    support_definitions: support,
    helper: {
      owner: values.helper.owner,
      definer: values.helper.definer,
      volatility: values.helper.volatility,
      search_path: values.helper.search_path,
      acl: values.controls.private_acl,
      body_sha256: sha(values.helper.body),
      definition_sha256: sha(values.helper.definition),
    },
    source_sha256: { sicar: pins.sicar, woo: pins.woo },
    input_sha256: pins,
  };
  const result = prepareWooIntegralRehearsal(input);
  await mkdir(out, { recursive: false, mode: 0o700 });
  const write = (n, b) =>
    writeFile(resolve(out, n), b, { flag: "wx", mode: 0o600 });
  await write("plan.json", JSON.stringify(result.plan, null, 2) + "\n");
  await write("ensayo-preparado-NO-EJECUTADO.sql", result.sql);
  const manifest = {
    protocol: "m9-woo-integral-preparation-manifest-1",
    sql_executed: false,
    sql_acceptance_passed: false,
    execution_authorized: false,
    files: [
      {
        name: "plan.json",
        sha256: sha(JSON.stringify(result.plan, null, 2) + "\n"),
      },
      { name: "ensayo-preparado-NO-EJECUTADO.sql", sha256: sha(result.sql) },
    ],
    inputs: pins,
    producer_sha256: sha(await readFile(fileURLToPath(import.meta.url))),
  };
  await write("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  need(process.argv.length === 4, "CONFIG_AND_NEW_OUTPUT_DIRECTORY_REQUIRED");
  const manifest = await writePreparation(process.argv[2], process.argv[3]);
  console.log(
    JSON.stringify({
      prepared: true,
      sql_executed: false,
      execution_authorized: false,
      files: manifest.files.map((x) => ({ name: x.name, sha256: x.sha256 })),
    }),
  );
}
