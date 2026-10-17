-- Run only in staging, before loading the permanent review. Always ROLLBACK.
begin;
select app.assert_sicar_staging_enabled();
create temporary table m9_rehearsal_test_result(checks integer);
do $test$
declare allowed uuid; held uuid; session_id uuid; actor uuid; result jsonb; checks integer:=0; msg text;
begin
 if exists(select 1 from app.m9_rehearsal_control where enabled) or exists(select 1 from app.m9_rehearsal_allowlist) then raise exception 'TEST_REQUIRES_DISABLED_EMPTY_REVIEW'; end if;
 select variant_id into strict allowed from app.m9_rows where barcode='2396';
 select variant_id into strict held from app.m9_rows where barcode='1180';
 select id,cashier_user_id into strict session_id,actor from public.cash_sessions where status='OPEN' order by opened_at desc limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if app.m9_rehearsal_status(held) is not null then raise exception 'DISABLED_MODE_CHANGED_BEHAVIOR'; end if; checks:=checks+1;
 insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row)
 values(allowed,'2396',repeat('a',64),app.m9_rehearsal_current_row(allowed));
 update app.m9_rehearsal_control set enabled=true,review_sha256=repeat('a',64),expires_at=clock_timestamp()+interval '1 hour';
 if app.m9_rehearsal_status(allowed) is not null then raise exception 'CONFIRMED_VARIANT_BLOCKED'; end if; checks:=checks+1;
 if app.m9_rehearsal_status(held)<>'M9_VARIANT_PENDING_REVIEW' then raise exception 'HELD_VARIANT_ALLOWED'; end if; checks:=checks+1;
 if app.m9_rehearsal_status(gen_random_uuid())<>'M9_VARIANT_PENDING_REVIEW' then raise exception 'NEW_VARIANT_ALLOWED'; end if; checks:=checks+1;
 if app.m9_rehearsal_status(null)<>'M9_REHEARSAL_QUICK_ITEM_DISABLED' then raise exception 'QUICK_BYPASS_ALLOWED'; end if; checks:=checks+1;
 result:=public.get_pos_variants(session_id,array[allowed,held]);
 if not exists(select 1 from jsonb_array_elements(result) v where v->>'id'=allowed::text and (v->>'isActive')::boolean)
  or exists(select 1 from jsonb_array_elements(result) v where v->>'id'=held::text and (v->>'isActive')::boolean)
 then raise exception 'POS_CATALOG_NOT_GUARDED'; end if; checks:=checks+1;
 begin perform public.resolve_pos_scan(session_id,'1180');raise exception 'HELD_SCAN_ALLOWED';
 exception when others then if sqlerrm<>'M9_VARIANT_PENDING_REVIEW' then raise; end if;end; checks:=checks+1;
 begin perform public.resolve_pos_scan(session_id,'2396');raise exception 'ZERO_STOCK_SCAN_ALLOWED';
 exception when others then if sqlerrm<>'SCAN_NOT_AVAILABLE' then raise; end if;end; checks:=checks+1;
 begin
  perform public.create_sale(gen_random_uuid(),session_id,jsonb_build_array(jsonb_build_object('variant_id',held,'quantity',1)),jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',74000,'tendered_cents',74000)));
  raise exception 'DIRECT_CHECKOUT_BYPASS_ALLOWED';
 exception when others then if sqlerrm<>'M9_VARIANT_PENDING_REVIEW' then raise; end if;end; checks:=checks+1;
 begin
  perform set_config('app.sales_write','on',true);
  insert into public.sale_items(sale_id,line_number,variant_id,product_name,sku,quantity,unit_price_cents,unit_cost_cents,gross_cents,line_total_cents)
  values(gen_random_uuid(),1,held,'Synthetic guard test','QA',1,74000,0,74000,74000);
  raise exception 'DIRECT_ITEM_BYPASS_ALLOWED';
 exception when others then if sqlerrm<>'M9_VARIANT_PENDING_REVIEW' then raise; end if;end; checks:=checks+1;
 begin
  perform set_config('app.layaway_write','on',true);
  insert into public.layaway_items select (jsonb_populate_record(null::public.layaway_items,jsonb_build_object('variant_id',held,'quantity',1))).*;
  raise exception 'LAYAWAY_BYPASS_ALLOWED';
 exception when others then if sqlerrm<>'M9_VARIANT_PENDING_REVIEW' then raise; end if;end; checks:=checks+1;
 begin
  update public.variants set price_cents=price_cents+1 where id=allowed;
  if app.m9_rehearsal_status(allowed)<>'M9_VARIANT_REVIEW_CHANGED' then raise exception 'CHANGED_PRICE_ALLOWED'; end if;
  checks:=checks+1;raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
 if app.m9_rehearsal_status(allowed) is not null then raise exception 'TEST_PRICE_ROLLBACK_FAILED'; end if; checks:=checks+1;
 begin
  update app.m9_rehearsal_control set review_sha256=repeat('b',64);
  if app.m9_rehearsal_status(allowed)<>'M9_VARIANT_PENDING_REVIEW' then raise exception 'OTHER_REVIEW_ACCEPTED'; end if;
  checks:=checks+1;raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
 begin
  update app.m9_rehearsal_control set expires_at=clock_timestamp()+interval '20 milliseconds';
  perform pg_sleep(0.03);
  if app.m9_rehearsal_status(allowed)<>'M9_REVIEW_EXPIRED' then raise exception 'EXPIRED_REVIEW_ACCEPTED'; end if;
  checks:=checks+1;raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;end;
 begin
  update app.sicar_sync_control set catalog_writes_enabled=false;
  perform app.m9_rehearsal_status(allowed);raise exception 'WRONG_ENVIRONMENT_ACCEPTED';
 exception when insufficient_privilege then checks:=checks+1;end;
 if exists(select 1 from (values('anon'),('authenticated'),('service_role')) roles(name)
  where has_table_privilege(name,'app.m9_rehearsal_control','UPDATE') or has_table_privilege(name,'app.m9_rehearsal_allowlist','INSERT')
   or has_function_privilege(name,'app.assert_m9_rehearsal_variant(uuid)','EXECUTE')) then raise exception 'CLIENT_CAN_CHANGE_OR_BYPASS_GUARD';end if;checks:=checks+1;
 if (select count(*) from public.inventory_by_location)<>0 or (select count(*) from public.inventory_movements)<>0 then raise exception 'INVENTORY_CHANGED';end if;checks:=checks+1;
 insert into m9_rehearsal_test_result values(checks);
end $test$;
select * from m9_rehearsal_test_result;
rollback;
