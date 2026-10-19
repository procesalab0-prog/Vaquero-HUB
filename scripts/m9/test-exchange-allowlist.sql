-- Maintenance-only M9 staging rehearsal; all writes below are synthetic and
-- rolled back. Existing sales/history need not be empty and must be preserved.
-- Optional LOCAL settings qa.m9.allowed_barcode / qa.m9.held_barcode select
-- the two local fixtures. Defaults are the established staging QA codes.
-- The temporary supervisor token is a SQL fixture, NOT a PIN/Auth UI test.
begin;
create temporary table m9_exchange_result(result jsonb);
do $test$
declare sid uuid; actor uuid; loc uuid; allowed uuid; held uuid;
 allowed_code text:=coalesce(nullif(current_setting('qa.m9.allowed_barcode',true),''),'2396');
 held_code text:=coalesce(nullif(current_setting('qa.m9.held_barcode',true),''),'1180');
 review text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 amount bigint; out_amount bigint; cash_before bigint; cash_after bigint;
 sale public.sales; item uuid; token uuid; refund_token uuid; result jsonb; replay jsonb;
 exchange_key uuid:=gen_random_uuid(); denied_key uuid:=gen_random_uuid(); refund_key uuid:=gen_random_uuid();
 charges jsonb; inputs jsonb; outputs jsonb; before_failure jsonb; after_failure jsonb;
 checks integer:=0;
begin
 perform app.assert_sicar_staging_enabled();
 if not exists(select 1 from app.m9_rehearsal_control where singleton and enabled) then
  raise exception 'ENABLED_STAGING_REVIEW_REQUIRED';
 end if;
 select id,cashier_user_id,location_id into strict sid,actor,loc
 from public.cash_sessions where status='OPEN' order by opened_at desc limit 1;
 if not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id
  where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'ADMIN_SESSION_REQUIRED'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select variant_id into strict allowed from app.m9_rows where barcode=allowed_code;
 select variant_id into strict held from app.m9_rows where barcode=held_code;
 if allowed=held or exists(select 1 from public.inventory_by_location
  where variant_id in (allowed,held) and (qty<>0 or reserved_qty<>0)) then
  raise exception 'TWO_ZERO_BALANCE_QA_VARIANTS_REQUIRED';
 end if;
 select price_cents into strict amount from public.variants where id=allowed and cost_cents is null and price_cents>0;
 select price_cents into strict out_amount from public.variants where id=held and cost_cents is null and price_cents>0;
 if exists(select 1 from (values('anon'),('authenticated'),('service_role')) roles(name)
  where has_function_privilege(name,'app.guard_m9_rehearsal_exchange_item()','EXECUTE')) then
  raise exception 'PRIVATE_GUARD_EXPOSED';
 end if; checks:=checks+1;
 select coalesce(sum(amount_cents),0) into cash_before from public.cash_movements where session_id=sid;
 update app.m9_rehearsal_control set review_sha256=review,expires_at=clock_timestamp()+interval '1 hour' where singleton;
 insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row)
 values(allowed,allowed_code,review,app.m9_rehearsal_current_row(allowed))
 on conflict(variant_id) do update set review_sha256=excluded.review_sha256,expected_row=excluded.expected_row;
 perform public.apply_inventory_adjustment(allowed,loc,0,3,'CONTEO_FISICO','QA SINTETICO CAMBIOS, rollback obligatorio');
 perform public.apply_inventory_adjustment(held,loc,0,2,'CONTEO_FISICO','QA SINTETICO bloqueo de cambio, rollback obligatorio');
 sale:=public.create_sale(gen_random_uuid(),sid,jsonb_build_array(jsonb_build_object('variant_id',allowed,'quantity',2)),
  jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',amount*2,'tendered_cents',amount*2)));
 select id into strict item from public.sale_items where sale_id=sale.id and variant_id=allowed and unit_cost_cents is null;
 inputs:=jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',1,'condition','RESELLABLE'));
 outputs:=jsonb_build_array(jsonb_build_object('variant_id',held,'quantity',1));
 charges:=case when out_amount>amount then jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',out_amount-amount)) else '[]'::jsonb end;
 if exists(select 1 from public.search_exchange_variants('',null,100) where variant_id=held)
  or not exists(select 1 from public.search_exchange_variants('',null,1) where variant_id=allowed) then
  raise exception 'SEARCH_PENDING_FILTER_FAILED';
 end if; checks:=checks+1;
 if exists(select 1 from jsonb_array_elements(public.search_exchange_variants_v2('',allowed,100)) x
  where (x->>'variant_id')::uuid in (allowed,held)) then raise exception 'V2_SEARCH_EXCLUSION_FAILED'; end if; checks:=checks+1;
 begin
  perform public.create_return_exchange(gen_random_uuid(),sid,sale.id,inputs,outputs,charges,'[]',null,'QA SINTETICO sin PIN');
  raise exception 'AUTHORIZATION_BYPASSED';
 exception when sqlstate '42501' then
  if sqlerrm<>'RETURN_AUTHORIZATION_REQUIRED' then raise; end if;
 end; checks:=checks+1;
 insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at)
 values(actor,actor,'returns.authorize',now()+interval '5 minutes') returning id into token;
 before_failure:=jsonb_build_object('stock',(select jsonb_agg(to_jsonb(x) order by variant_id,location_id) from public.inventory_by_location x),
  'cash',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.cash_movements x),
  'movements',(select count(*) from public.inventory_movements),'returns',(select count(*) from public.returns),
  'lines',(select count(*) from public.return_items),'payments',(select count(*) from public.return_payments),
  'idempotency',(select count(*) from public.idempotency_keys),'folios',(select jsonb_agg(to_jsonb(x) order by location_id,document_type) from public.folios x));
 begin
  perform public.create_return_exchange(denied_key,sid,sale.id,inputs,outputs,charges,'[]',token,'QA SINTETICO rechazo pendiente');
  raise exception 'PENDING_EXCHANGE_ACCEPTED';
 exception when sqlstate '22023' then
  if sqlerrm<>'M9_VARIANT_PENDING_REVIEW' then raise; end if;
 end; checks:=checks+1;
 after_failure:=jsonb_build_object('stock',(select jsonb_agg(to_jsonb(x) order by variant_id,location_id) from public.inventory_by_location x),
  'cash',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from public.cash_movements x),
  'movements',(select count(*) from public.inventory_movements),'returns',(select count(*) from public.returns),
  'lines',(select count(*) from public.return_items),'payments',(select count(*) from public.return_payments),
  'idempotency',(select count(*) from public.idempotency_keys),'folios',(select jsonb_agg(to_jsonb(x) order by location_id,document_type) from public.folios x));
 if before_failure is distinct from after_failure or exists(select 1 from app.supervisor_authorizations where id=token and used_at is not null)
 then raise exception 'REJECTED_EXCHANGE_LEFT_SIDE_EFFECTS'; end if; checks:=checks+1;
 insert into app.m9_rehearsal_allowlist(variant_id,barcode,review_sha256,expected_row)
 values(held,held_code,review,app.m9_rehearsal_current_row(held)||'{"qa_changed":true}'::jsonb)
 on conflict(variant_id) do update set review_sha256=excluded.review_sha256,expected_row=excluded.expected_row;
 begin
  perform public.create_return_exchange(denied_key,sid,sale.id,inputs,outputs,charges,'[]',token,'QA SINTETICO datos cambiados');
  raise exception 'CHANGED_EXCHANGE_ACCEPTED';
 exception when sqlstate '22023' then
  if sqlerrm<>'M9_VARIANT_REVIEW_CHANGED' then raise; end if;
 end; checks:=checks+1;
 update app.m9_rehearsal_allowlist set expected_row=app.m9_rehearsal_current_row(held) where variant_id=held;
 if not exists(select 1 from public.search_exchange_variants('',allowed,1) where variant_id=held)
  or not exists(select 1 from jsonb_array_elements(public.search_exchange_variants_v2('',allowed,1)) x
    where (x->>'variant_id')::uuid=held and x->'measureUnit'->>'code'='PIECE') then
  raise exception 'APPROVED_SEARCH_FAILED';
 end if; checks:=checks+1;
 result:=public.create_return_exchange(exchange_key,sid,sale.id,inputs,outputs,charges,'[]',token,'QA SINTETICO cambio aprobado');
 if result->>'type'<>'EXCHANGE' or (result->>'difference_cents')::bigint<>out_amount-amount
  or (select qty from public.inventory_by_location where variant_id=allowed and location_id=loc)<>2
  or (select qty from public.inventory_by_location where variant_id=held and location_id=loc)<>1
  or not exists(select 1 from app.supervisor_authorizations where id=token and used_at is not null) then
  raise exception 'APPROVED_EXCHANGE_FAILED';
 end if; checks:=checks+1;
 -- Expiration is exercised without disabling or bypassing the guard.
 update app.m9_rehearsal_control set expires_at=clock_timestamp()+interval '100 milliseconds' where singleton;
 perform pg_sleep(0.15);
 if exists(select 1 from public.search_exchange_variants('',null,100)) then raise exception 'EXPIRED_SEARCH_LEAK'; end if; checks:=checks+1;
 replay:=public.create_return_exchange(exchange_key,sid,sale.id,inputs,outputs,charges,'[]',token,'QA SINTETICO cambio aprobado');
 if replay->>'id' is distinct from result->>'id' then raise exception 'EXCHANGE_REPLAY_DUPLICATED'; end if; checks:=checks+1;
 insert into app.supervisor_authorizations(actor_user_id,supervisor_user_id,permission_code,expires_at)
 values(actor,actor,'returns.authorize',now()+interval '5 minutes') returning id into refund_token;
 begin
  perform public.create_return_exchange(gen_random_uuid(),sid,sale.id,inputs,outputs,charges,'[]',refund_token,'QA SINTETICO revisión vencida');
  raise exception 'EXPIRED_EXCHANGE_ACCEPTED';
 exception when sqlstate '22023' then
  if sqlerrm<>'M9_REVIEW_EXPIRED' then raise; end if;
 end; checks:=checks+1;
 result:=public.create_return_exchange(refund_key,sid,sale.id,inputs,'[]','[]','[]',refund_token,'QA SINTETICO devolución aun con revisión vencida');
 replay:=public.create_return_exchange(refund_key,sid,sale.id,inputs,'[]','[]','[]',refund_token,'QA SINTETICO devolución aun con revisión vencida');
 if result->>'type'<>'RETURN' or (result->>'difference_cents')::bigint<>-amount
  or result->>'id' is distinct from replay->>'id'
  or (select qty from public.inventory_by_location where variant_id=allowed and location_id=loc)<>3 then
  raise exception 'EXPIRED_REVIEW_REFUND_FAILED';
 end if; checks:=checks+1;
 if (public.get_returnable_sale(sale.id)->'items'->0->>'remaining_quantity')::numeric<>0
  or exists(select 1 from public.sale_items where sale_id=sale.id and unit_cost_cents is not null) then
  raise exception 'RETURN_REMAINDER_OR_COST_CHANGED';
 end if; checks:=checks+1;
 select coalesce(sum(amount_cents),0) into cash_after from public.cash_movements where session_id=sid;
 if cash_after-cash_before<>out_amount then raise exception 'EXCHANGE_CASH_NOT_BALANCED'; end if; checks:=checks+1;
 -- Flush deferred financial/loyalty constraints before the outer rollback.
 set constraints all immediate;
 insert into m9_exchange_result values(jsonb_build_object('status','PASS','checks',checks,'pending_output_blocked',true,
  'changed_output_blocked',true,'expired_output_blocked',true,'refund_after_expiry',true,'search_v1_v2_filtered',true,
  'pin_still_required',true,'authorization_fixture_only',true,'exchange_and_refund_idempotence',true,
  'unknown_cost_preserved',true,'cash_balanced',true,'deferred_constraints_checked',true,
  'rollback_required',true,'browser_pin_tested',false));
end $test$;
select * from m9_exchange_result;
rollback;
