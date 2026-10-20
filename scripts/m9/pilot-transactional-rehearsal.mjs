import { pilotLedgerTechnicalRehearsal } from "./pilot-ledger-technical-rehearsal.mjs";
import { digest } from "./acceleration.mjs";
import { quoteDoText } from "./sql-literal.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

// Maintenance QA only. This deliberately cannot commit or authorize cutover.
// Supervisor fixtures exercise the SQL engine, not real PIN/Auth acceptance.
export function pilotTransactionalRehearsal(
  review,
  snapshot,
  observationsRaw,
  { batchIndex = 0, batchSize = 3 } = {},
) {
  const base = pilotLedgerTechnicalRehearsal(review, snapshot, observationsRaw);
  if (
    !Number.isSafeInteger(batchIndex) ||
    batchIndex < 0 ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 3 ||
    batchIndex * batchSize >= review.rows.length
  )
    throw Error("BOUNDED_QA_BATCH_REQUIRED");
  const selected = review.rows.slice(
    batchIndex * batchSize,
    (batchIndex + 1) * batchSize,
  );
  const rows = selected.map((r) => ({
    barcode: r.barcode,
    variant_id: r.variant_id,
    qty: r.observed_source_qty,
    price: snapshot.rows.find((d) => d.variant_id === r.variant_id).current
      .price_cents,
  }));
  if (
    rows.some(
      (r) =>
        !Number.isSafeInteger(r.price) ||
        r.price <= 0 ||
        !Number.isSafeInteger(r.price * Number(r.qty)),
    )
  )
    throw Error("EXACT_POSITIVE_PILOT_PRICE_REQUIRED");
  const q = (s) => quoteDoText(s, "$flow$"),
    location = q(snapshot.proposed_location_id),
    reviewHash = digest({ mode: "ROLLBACK_SQL_QA", snapshot, rows }),
    holdHash = digest({ reviewHash, mode: "REVIEW_WITHDRAWN" });
  const endpoint = "select * from pilot_ledger_result;\nrollback;\n";
  if (!base.endsWith(endpoint) || base.split(endpoint).length !== 2)
    throw Error("TECHNICAL_REHEARSAL_COMPOSITION_CHANGED");
  const lock = "set local lock_timeout='5s';\n";
  if (base.split(lock).length !== 2)
    throw Error("TECHNICAL_REHEARSAL_COMPOSITION_CHANGED");
  const prefix = base
    .slice(0, -endpoint.length)
    .replace(
      lock,
      lock +
        "lock table public.cash_sessions,public.sales,public.sale_items,public.sale_payments,public.cash_movements,public.returns,public.return_items,public.return_payments,app.supervisor_authorizations,public.idempotency_keys,public.folios in share row exclusive mode;\n",
    );
  return `${prefix}
-- The stock stage flushed deferred checks. Restore their normal transaction
-- timing for the next complete financial operation, then flush again at end.
set constraints all deferred;
-- All changes below are private to this same ROLLBACK transaction.
create temporary table pilot_flow_result(result jsonb) on commit drop;
do $flow$
declare r jsonb;sid uuid;actor uuid;vid uuid;token uuid;k uuid;rk uuid;
 sale public.sales;again public.sales;receipt jsonb;scan jsonb;ret jsonb;ret_again jsonb;
 items jsonb;payments jsonb;incoming jsonb;cash_before bigint;cash_after bigint;
 checks integer:=0;tested integer:=0;outside integer;paid bigint:=0;
begin
 perform app.assert_sicar_staging_enabled();
 select id,cashier_user_id into strict sid,actor from public.cash_sessions
  where status='OPEN' and location_id=${location}::uuid order by opened_at desc limit 1;
 if actor is distinct from app.current_user_id() then raise exception 'QA_SESSION_CHANGED';end if;
 select coalesce(sum(amount_cents),0) into cash_before from public.cash_movements where session_id=sid;
 -- The original expired guard must reject the real sale path before QA review.
 vid:=${q(rows[0].variant_id)}::uuid;
 begin
  perform public.create_sale(gen_random_uuid(),sid,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',1)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',${rows[0].price},'tendered_cents',${rows[0].price})));
  raise exception 'EXPIRED_SALE_ALLOWED';
 exception when others then if sqlerrm<>'M9_REVIEW_EXPIRED' then raise;end if;end;checks:=checks+1;
 -- A unique QA review never admits the old broader allowlist.
 update app.m9_rehearsal_control set review_sha256=${q(reviewHash)},expires_at=clock_timestamp()+interval '15 minutes' where singleton and enabled;
 update app.m9_rehearsal_allowlist set review_sha256=${q(reviewHash)}
 where variant_id in (select (value->>'variant_id')::uuid from jsonb_array_elements(${q(JSON.stringify(rows))}::jsonb));
 if (select count(*) from app.m9_rehearsal_allowlist where review_sha256=${q(reviewHash)})<>${rows.length}
  or app.m9_rehearsal_status(null) is distinct from 'M9_REHEARSAL_QUICK_ITEM_DISABLED' then raise exception 'QA_ALLOWLIST_WIDENED';end if;
 select count(*) into outside from public.variants where id not in (select (value->>'variant_id')::uuid from jsonb_array_elements(${q(JSON.stringify(rows))}::jsonb)) and app.m9_rehearsal_status(id) is null;
 if outside<>0 then raise exception 'OUTSIDE_PILOT_SELLABLE';end if;checks:=checks+1;
 for r in select value from jsonb_array_elements(${q(JSON.stringify(rows))}::jsonb) loop
  update app.m9_rehearsal_control set review_sha256=${q(reviewHash)} where singleton and enabled;
  vid:=(r->>'variant_id')::uuid;k:=gen_random_uuid();rk:=gen_random_uuid();
  scan:=public.resolve_pos_scan(sid,r->>'barcode');
  if scan->>'id' is distinct from r->>'variant_id' or scan->>'legacyCode' is distinct from r->>'barcode'
   or (scan->>'stock')::numeric<>(r->>'qty')::numeric or (scan->>'price')::numeric*100<>(r->>'price')::bigint then raise exception 'LITERAL_SCAN_MISMATCH';end if;checks:=checks+1;
  items:=jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',1));
  payments:=jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',(r->>'price')::bigint,'tendered_cents',(r->>'price')::bigint));
  sale:=public.create_sale(k,sid,items,payments,null,'[]','M9 QA TRANSACCIONAL: venta sintética ROLLBACK');
  again:=public.create_sale(k,sid,items,payments,null,'[]','M9 QA TRANSACCIONAL: venta sintética ROLLBACK');
  if sale.id<>again.id or sale.total_cents<>(r->>'price')::bigint or (select count(*) from public.sales where id=sale.id)<>1
   or (select count(*) from public.sale_items where sale_id=sale.id and variant_id=vid and quantity=1 and unit_cost_cents is null)<>1
   or (select qty from public.inventory_by_location where variant_id=vid and location_id=${location}::uuid)<>(r->>'qty')::numeric-1
   then raise exception 'SALE_OR_REPLAY_FAILED';end if;checks:=checks+1;
  begin
   perform public.create_sale(k,sid,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',2)),payments,null,'[]','M9 QA TRANSACCIONAL: venta sintética ROLLBACK');
   raise exception 'CHANGED_REPLAY_ALLOWED';
  exception when others then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise;end if;end;checks:=checks+1;
  begin
   perform public.create_sale(gen_random_uuid(),sid,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',(r->>'qty')::numeric)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',(r->>'price')::bigint*(r->>'qty')::bigint,'tendered_cents',(r->>'price')::bigint*(r->>'qty')::bigint)));
   raise exception 'OVERSELL_ALLOWED';
  exception when others then if sqlerrm<>'INSUFFICIENT_STOCK' then raise;end if;end;checks:=checks+1;
  receipt:=public.get_sale_receipt(sale.id);
  if receipt->>'id' is distinct from sale.id::text or (receipt->>'total_cents')::bigint<>(r->>'price')::bigint
   or jsonb_array_length(receipt->'items')<>1 or (receipt#>>'{items,0,quantity}')::numeric<>1
   or receipt#>>'{payments,0,method_code}'<>'CASH' then raise exception 'RECEIPT_MISMATCH';end if;checks:=checks+1;
  incoming:=jsonb_build_array(jsonb_build_object('sale_item_id',(select id from public.sale_items where sale_id=sale.id),'quantity',1,'condition','RESELLABLE'));
  begin
   perform public.create_return_exchange(gen_random_uuid(),sid,sale.id,incoming,'[]','[]','[]',null,'M9 QA: sin autorización');
   raise exception 'RETURN_WITHOUT_AUTH_ALLOWED';
  exception when others then if sqlerrm<>'RETURN_AUTHORIZATION_REQUIRED' then raise;end if;end;checks:=checks+1;
  -- Explicit SQL fixture, never a claimed PIN validation. Rolled back with all history.
  insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at)
   values(actor,actor,'returns.authorize',now()+interval '5 minutes') returning id into token;
  update app.m9_rehearsal_control set review_sha256=${q(holdHash)} where singleton and enabled;
  if app.m9_rehearsal_status(vid) is distinct from 'M9_VARIANT_PENDING_REVIEW' then raise exception 'REVIEW_WITHDRAWAL_FAILED';end if;
  begin
   perform public.create_return_exchange(gen_random_uuid(),sid,sale.id,incoming,items,'[]','[]',token,'M9 QA: cambio sin revisión');
   raise exception 'UNREVIEWED_EXCHANGE_ALLOWED';
  exception when others then if sqlerrm<>'M9_VARIANT_PENDING_REVIEW' then raise;end if;end;checks:=checks+1;
  ret:=public.create_return_exchange(rk,sid,sale.id,incoming,'[]','[]','[]',token,'M9 QA: devolución sintética ROLLBACK');
  ret_again:=public.create_return_exchange(rk,sid,sale.id,incoming,'[]','[]','[]',token,'M9 QA: devolución sintética ROLLBACK');
  if ret->>'id' is distinct from ret_again->>'id' or (ret->>'returned_cents')::bigint<>(r->>'price')::bigint
   or (select count(*) from public.return_payments where return_id=(ret->>'id')::uuid and direction='REFUND' and method_code='CASH' and amount_cents=(r->>'price')::bigint)<>1
   or not exists(select 1 from app.supervisor_authorizations where id=token and used_at is not null and resource_id=(ret->>'id')::uuid)
   or (select qty from public.inventory_by_location where variant_id=vid and location_id=${location}::uuid)<>(r->>'qty')::numeric
   then raise exception 'RETURN_OR_REPLAY_FAILED';end if;checks:=checks+1;
  begin
   perform public.create_return_exchange(gen_random_uuid(),sid,sale.id,incoming,'[]','[]','[]',token,'M9 QA: token usado');
   raise exception 'USED_AUTHORIZATION_ALLOWED';
  exception when others then if sqlerrm<>'RETURN_AUTHORIZATION_REQUIRED' then raise;end if;end;checks:=checks+1;
  if (select coalesce(sum(amount_cents),0) from public.cash_movements where session_id=sid)<>cash_before then raise exception 'CASH_NOT_NEUTRAL';end if;checks:=checks+1;
  if (select count(*) from public.inventory_movements where variant_id=vid and ((reference_type='SALE' and reference_id=sale.id::text) or (reference_type='RETURN' and reference_id=ret->>'id')))<>2 then raise exception 'MONEY_FLOW_MOVEMENTS_DUPLICATED';end if;checks:=checks+1;
  tested:=tested+1;paid:=paid+(r->>'price')::bigint;
 end loop;
 if exists(select 1 from app.m9_rehearsal_control where singleton and not enabled) then raise exception 'GUARD_DISABLED';end if;
 select coalesce(sum(amount_cents),0) into cash_after from public.cash_movements where session_id=sid;
 if cash_after<>cash_before then raise exception 'CASH_NOT_NEUTRAL';end if;
 set constraints all immediate;
 insert into pilot_flow_result values(jsonb_build_object('mode','SQL_QA_ROLLBACK_NOT_OPERATIONAL_APPROVAL','batch_index',${batchIndex},'batch_count',${Math.ceil(review.rows.length / batchSize)},'codes',tested,'barcodes',${q(JSON.stringify(rows.map((r) => r.barcode)))}::jsonb,'sales',tested,'returns',tested,'checks',checks,'sales_replayed_without_duplicate',tested,'returns_replayed_without_duplicate',tested,'overdraws_rejected',tested,'returns_without_authorization_rejected',tested,'unreviewed_exchanges_rejected',tested,'reused_authorizations_rejected',tested,'cash_collected_and_refunded_cents',paid,'cash_net_cents',cash_after-cash_before,'source_stock_approved',false,'source_reservations_imported',false,'real_pin_acceptance',false,'auth_postgrest_acceptance',false,'permanent_activation',false));
end $flow$;
select jsonb_build_object('ledger',(select result from pilot_ledger_result),'flow',(select result from pilot_flow_result)) result;
rollback;
`;
}

// Offline preparation only: inputs explicitly named and pinned; no DB client.
export async function preparePilotTransactionalRehearsal(
  configPath,
  outputDir,
) {
  const path = resolve(configPath),
    config = JSON.parse(await readFile(path, "utf8"));
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const inputs = {};
  for (const key of ["review", "snapshot", "observations"]) {
    const entry = config[key];
    if (
      typeof entry?.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")
    )
      throw Error("PINNED_FLOW_INPUT_REQUIRED: " + key);
    const raw = await readFile(resolve(dirname(path), entry.path), "utf8");
    if (sha(raw) !== entry.sha256)
      throw Error("FLOW_INPUT_HASH_CHANGED: " + key);
    inputs[key] = raw;
  }
  const review = JSON.parse(inputs.review),
    snapshot = JSON.parse(inputs.snapshot);
  const count = Math.ceil((review.rows?.length ?? 0) / 3),
    files = {};
  if (!count) throw Error("EXACT_TECHNICAL_SCOPE_REQUIRED");
  // Validate/generate every batch before creating any output.
  for (let batchIndex = 0; batchIndex < count; batchIndex++)
    files[`tanda-${batchIndex + 1}.sql`] = pilotTransactionalRehearsal(
      review,
      snapshot,
      inputs.observations,
      { batchIndex },
    );
  const summary = {
    version: "m9-pilot-transactional-preparation-1",
    mode: "OFFLINE_SQL_PREPARATION_ONLY",
    identity_sha256: review.identity_sha256,
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([k, raw]) => [k, sha(raw)]),
    ),
    codes: review.rows.length,
    batches: count,
    max_codes_per_batch: 3,
    production_allowed: false,
    inventory_import_allowed: false,
    activation_allowed: false,
    real_pin_acceptance: false,
  };
  files["plan.json"] = JSON.stringify(summary, null, 2) + "\n";
  files["sha256.json"] =
    JSON.stringify(
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
      null,
      2,
    ) + "\n";
  const out = resolve(outputDir);
  await mkdir(out, { recursive: false });
  for (const [name, content] of Object.entries(files))
    await writeFile(resolve(out, name), content, { flag: "wx" });
  return summary;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 4)
    throw Error("Usage: PINNED_CONFIG.json NEW_OUTPUT_DIR");
  console.log(
    JSON.stringify(
      await preparePilotTransactionalRehearsal(...process.argv.slice(2)),
    ),
  );
}
