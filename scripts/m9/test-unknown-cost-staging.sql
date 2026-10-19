-- Run only on M9 staging. Every financial/inventory/customer/auth/review write
-- is synthetic and rolled back. Never renew the live review outside this TX.
begin;
create temporary table m9_cost_test_result(result jsonb);
do $test$
declare sid uuid; actor uuid; loc uuid; vid uuid; denied uuid; amount bigint;
 key1 uuid:=gen_random_uuid(); key2 uuid:=gen_random_uuid(); key3 uuid:=gen_random_uuid();
 sale public.sales; repeat_sale public.sales; cancelled public.sales;
 review text; data jsonb; returned jsonb; repeated_return jsonb; item uuid; auth_token uuid;
 lay jsonb; fulfilled jsonb; repeated_fulfill jsonb; customer uuid; cash_before bigint; cash_after bigint;
begin
 perform app.assert_sicar_staging_enabled();
 if (select count(*) from public.inventory_by_location)<>0
 or (select count(*) from public.sales)<>0 then raise exception 'EMPTY_OPERATIONAL_STAGING_REQUIRED'; end if;
 select id,cashier_user_id,location_id into strict sid,actor,loc from public.cash_sessions where status='OPEN' order by opened_at desc limit 1;
 if not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'ADMIN_SESSION_REQUIRED'; end if;
 select r.variant_id into strict vid from app.m9_rows r where r.barcode='2396';
 select price_cents into amount from public.variants where id=vid and cost_cents is null;
 if amount is null or amount<=0 then raise exception 'UNKNOWN_COST_FIXTURE_REQUIRED'; end if;
 if not exists(select 1 from public.barcodes where variant_id=vid and code='2396' and source='SICAR') then raise exception 'LITERAL_BARCODE_MISSING'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if app.m9_rehearsal_status(vid) is distinct from 'M9_REVIEW_EXPIRED' then raise exception 'EXPECTED_EXPIRED_CONTROL'; end if;
 select coalesce(sum(amount_cents),0) into cash_before from public.cash_movements where session_id=sid;
 -- Temporary test authority; no persistent review renewal or broader release.
 update app.m9_rehearsal_control set expires_at=clock_timestamp()+interval '1 hour' where singleton returning review_sha256 into review;
 insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row)
 values(vid,'2396',review,app.m9_rehearsal_current_row(vid))
 on conflict(variant_id) do update set review_sha256=excluded.review_sha256,expected_row=excluded.expected_row;
 perform public.apply_inventory_adjustment(vid,loc,0,3,'CONTEO_FISICO','QA SINTETICO COSTO, ROLLBACK obligatorio; no conteo real');
 sale:=public.create_sale(key1,sid,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',2)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',amount*2,'tendered_cents',amount*2)));
 repeat_sale:=public.create_sale(key1,sid,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',2)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',amount*2,'tendered_cents',amount*2)));
 if sale.id<>repeat_sale.id or sale.total_cents<>amount*2 or (select qty from public.inventory_by_location where variant_id=vid and location_id=loc)<>1 then raise exception 'SALE_OR_REPEAT_FAILED'; end if;
 if exists(select 1 from public.sale_items where sale_id=sale.id and unit_cost_cents is not null) then raise exception 'UNKNOWN_COST_REPLACED'; end if;
 data:=public.get_inventory_report_v2(loc);
 if data->'summary'->'cost_value_cents' is distinct from 'null'::jsonb
 or data->'summary'->'cost_valuation_complete' is distinct from 'false'::jsonb
 or (data->'summary'->>'unvalued_stock_variant_count')::int<>1 then raise exception 'INCOMPLETE_VALUATION_FAILED'; end if;
 data:=public.get_returnable_sale(sale.id); item:=(data->'items'->0->>'sale_item_id')::uuid;
 insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at)
 values(actor,actor,'returns.authorize',now()+interval '5 minutes') returning id into auth_token;
 returned:=public.create_return_exchange(key2,sid,sale.id,jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',1,'condition','RESELLABLE')),'[]','[]','[]',auth_token,'QA SINTETICO devolución de costo desconocido');
 repeated_return:=public.create_return_exchange(key2,sid,sale.id,jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',1,'condition','RESELLABLE')),'[]','[]','[]',auth_token,'QA SINTETICO devolución de costo desconocido');
 if returned->>'id' is distinct from repeated_return->>'id' or (returned->>'returned_cents')::bigint<>amount
 or (select qty from public.inventory_by_location where variant_id=vid and location_id=loc)<>2 then raise exception 'RETURN_OR_REPEAT_FAILED'; end if;
 cancelled:=public.create_sale(gen_random_uuid(),sid,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',1)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',amount,'tendered_cents',amount)));
 perform public.cancel_sale(cancelled.id,'QA SINTETICO cancelación costo desconocido');
 if (select status from public.sales where id=cancelled.id)<>'CANCELLED'
 or (select qty from public.inventory_by_location where variant_id=vid and location_id=loc)<>2 then raise exception 'CANCEL_FAILED'; end if;
 insert into public.customers(full_name,phone_e164,privacy_consent_at,privacy_notice_version)
 values('QA SINTETICO, se revierte','+523521234569',now(),'QA') returning id into customer;
 lay:=public.create_layaway(gen_random_uuid(),sid,customer,current_date+30,jsonb_build_array(jsonb_build_object('variant_id',vid,'quantity',1,'gift_receipt',false)));
 perform public.record_layaway_payment(gen_random_uuid(),sid,(lay->>'id')::uuid,jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',amount,'tendered_cents',amount)));
 fulfilled:=public.fulfill_layaway(key3,sid,(lay->>'id')::uuid);
 repeated_fulfill:=public.fulfill_layaway(key3,sid,(lay->>'id')::uuid);
 if fulfilled->>'sale_id' is distinct from repeated_fulfill->>'sale_id'
 or (select qty from public.inventory_by_location where variant_id=vid and location_id=loc)<>1 then raise exception 'LAYAWAY_FAILED'; end if;
 if exists(select 1 from public.sale_items where unit_cost_cents is not null) then raise exception 'UNKNOWN_SNAPSHOT_CHANGED'; end if;
 select coalesce(sum(amount_cents),0) into cash_after from public.cash_movements where session_id=sid;
 if cash_after-cash_before<>amount*2 then raise exception 'CASH_NET_OR_DOUBLE_CHARGE_FAILED'; end if;
 select pv.variant_id into strict denied from app.m9_provisional_variants pv
 where not exists(select 1 from app.m9_rehearsal_allowlist a where a.variant_id=pv.variant_id) limit 1;
 perform public.apply_inventory_adjustment(denied,loc,0,1,'CONTEO_FISICO','QA SINTETICO rechazo pendiente, ROLLBACK');
 select price_cents into amount from public.variants where id=denied;
 begin
  perform public.create_sale(gen_random_uuid(),sid,jsonb_build_array(jsonb_build_object('variant_id',denied,'quantity',1)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',amount,'tendered_cents',amount)));
  raise exception 'PENDING_VARIANT_WAS_ALLOWED';
 exception when sqlstate '22023' then
  if sqlerrm<>'M9_VARIANT_PENDING_REVIEW' then raise; end if;
 end;
 insert into m9_cost_test_result values(jsonb_build_object('status','PASS','barcode','2396','unknown_snapshot',true,'sale_repeat',true,'refund_repeat',true,'cancelled',true,'layaway_delivery_repeat',true,'incomplete_valuation',true,'pending_variant_denied',true,'cash_not_double_charged',true,'synthetic_only',true,'rollback_required',true,'auth_postgrest_tested',false));
end $test$;
select * from m9_cost_test_result;
rollback;
