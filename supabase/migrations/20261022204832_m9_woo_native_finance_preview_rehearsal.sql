begin;
select app.assert_sicar_staging_enabled();
create table app.m9_woo_native_finance_rehearsals(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.app_users(id),
 session_id uuid not null references public.cash_sessions(id),operation_id uuid not null,request_sha256 text not null,
 result jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(actor_id,operation_id)
);
create index m9_native_finance_rehearsal_actor_idx on app.m9_woo_native_finance_rehearsals(actor_id,created_at desc);
create index m9_native_finance_rehearsal_session_idx on app.m9_woo_native_finance_rehearsals(session_id);
alter table app.m9_woo_native_finance_rehearsals enable row level security;
revoke all on app.m9_woo_native_finance_rehearsals from public,anon,authenticated,service_role;
create trigger m9_native_finance_rehearsal_immutable before update or delete on app.m9_woo_native_finance_rehearsals for each row execute function app.m9_woo_pilot_immutable();

create function app.m9_woo_rehearsal_packet(eid uuid,op text,version bigint,action text default 'POST')returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('store_origin',origin,'order_id',order_id,'expected_version',version,'operation_id',op,'action',action,'evidence_id',id,'evidence_sha256',source_sha256)from app.m9_woo_finance_test_evidence where id=eid;
$$;
create function app.m9_woo_rehearsal_evidence(oid bigint,source_lines jsonb,kind text default 'PAYMENT',original uuid default null)returns uuid language plpgsql security invoker set search_path='' as $$
declare eid uuid;full_lines jsonb;total bigint;
begin
 select jsonb_agg(x||jsonb_build_object('unit_price_cents',v.price_cents,'line_total_cents',v.price_cents*(x->>'quantity')::bigint)order by(x->>'line_id')::bigint),sum(v.price_cents*(x->>'quantity')::bigint)
 into full_lines,total from jsonb_array_elements(source_lines)x join app.m9_woo_pilot_links l on l.woo_product_id=(x->>'product_id')::bigint and l.woo_variation_id=(x->>'variation_id')::bigint join public.variants v on v.id=l.variant_id;
 insert into app.m9_woo_finance_test_evidence(origin,order_id,actor_id,kind,gateway_mode,source_sha256,reference,currency,total_cents,observed_at,lines,components,original_evidence_id,refunded_cents,physical_reference,physical_lines)
 values('https://salmon-nightingale-251188.hostingersite.com',oid,app.current_user_id(),kind,'SYNTHETIC_TEST_ONLY',repeat('f',64),'SYNTHETIC-'||gen_random_uuid(),'MXN',total,clock_timestamp(),full_lines,
 jsonb_build_object('items_subtotal',total,'discount_total',0,'shipping_total',0,'shipping_tax',0,'fees_total',0,'total_tax',0,'refunded_total',0,'total',total),original,case when kind='FULL_CANCEL' then total else 0 end,
 case when kind='FULL_CANCEL' then 'SYNTHETIC-physical-'||oid end,case when kind='FULL_CANCEL' then full_lines else '[]' end)returning id into eid;return eid;
end $$;
revoke all on function app.m9_woo_rehearsal_packet(uuid,text,bigint,text),app.m9_woo_rehearsal_evidence(bigint,jsonb,text,uuid)from public,anon,authenticated,service_role;

create function app.m9_woo_native_rehearsal(session_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid;loc uuid;v1 uuid;v2 uuid;lines jsonb;e uuid;refund uuid;p jsonb;posted jsonb;again jsonb;cancelled jsonb;proof jsonb;ticket jsonb;
 base_sales bigint;base_cash bigint;base_movements bigint;base_reservations bigint;base_keys bigint;base_folios text;oid bigint:=9000005001;
begin
 if current_user<>'postgres' then raise exception 'WOO_REHEARSAL_MAINTENANCE_ONLY'using errcode='42501';end if;
 actor:=app.m9_legacy_actor();
 select s.location_id into loc from public.cash_sessions s join public.locations l on l.id=s.location_id where s.id=session_id and s.cashier_user_id=actor and s.status='OPEN' and l.code='LAP' and l.is_active;
 if loc is null then raise exception 'WOO_REHEARSAL_OWN_SESSION_REQUIRED'using errcode='42501';end if;
 lock table app.m9_woo_finance_pilot_control,app.m9_woo_pilot_control,app.m9_woo_pilot_links,app.m9_rehearsal_control,app.m9_rehearsal_allowlist in share row exclusive mode;
 if exists(select 1 from app.m9_woo_finance_pilot_control where enabled)or exists(select 1 from app.m9_woo_pilot_control where enabled)or exists(select 1 from app.m9_woo_finance_test_evidence)or exists(select 1 from app.m9_woo_finance_postings)or exists(select 1 from app.m9_woo_pilot_orders)or exists(select 1 from app.m9_woo_pilot_links)or exists(select 1 from public.payment_methods where code='M9_WEB_TEST')then raise exception 'WOO_REHEARSAL_BASELINE_CHANGED';end if;
 select variant_id into strict v1 from app.m9_rows where barcode='236';select variant_id into strict v2 from app.m9_rows where barcode='10521';
 if exists(select 1 from public.inventory_by_location where location_id=loc and variant_id in(v1,v2)and(qty<>0 or reserved_qty<>0))or exists(select 1 from public.variants where id in(v1,v2)and(cost_cents is not null or price_cents<=0))then raise exception 'WOO_REHEARSAL_BASELINE_CHANGED';end if;
 select count(*)into base_sales from public.sales;select count(*)into base_cash from public.cash_movements;select count(*)into base_movements from public.inventory_movements;select count(*)into base_reservations from public.inventory_reservation_movements;select count(*)into base_keys from public.idempotency_keys;
 select md5(coalesce(string_agg(to_jsonb(f)::text,'|'order by to_jsonb(f)::text),''))into base_folios from public.folios f;
 begin
  update app.m9_woo_finance_pilot_control set enabled=true,actor_id=actor,location_id=loc,cash_session_id=session_id,expires_at=clock_timestamp()+interval '5 minutes'where singleton;
  update app.m9_woo_pilot_control set enabled=true,actor_id=actor,location_id=loc,expires_at=clock_timestamp()+interval '5 minutes'where singleton;
  update app.m9_rehearsal_control set review_sha256=repeat('f',64),expires_at=clock_timestamp()+interval '5 minutes'where singleton;
  update app.m9_rehearsal_allowlist set review_sha256=repeat('f',64),expected_row=app.m9_rehearsal_current_row(variant_id)where variant_id in(v1,v2);
  insert into public.payment_methods(code,name,kind,requires_reference)values('M9_WEB_TEST','SYNTHETIC WEB QA; no gateway','OTHER',true);
  insert into app.m9_woo_pilot_links(origin,woo_product_id,woo_variation_id,variant_id,barcode,evidence_sha256)values('https://salmon-nightingale-251188.hostingersite.com',9000006001,0,v1,'236',repeat('f',64)),('https://salmon-nightingale-251188.hostingersite.com',9000006002,0,v2,'10521',repeat('f',64));
  perform app.apply_movement(v1,loc,'INITIAL_IMPORT',5,'M9_WOO_PREVIEW_REHEARSAL','rollback-only','{"synthetic":true}');perform app.apply_movement(v2,loc,'INITIAL_IMPORT',3,'M9_WOO_PREVIEW_REHEARSAL','rollback-only','{"synthetic":true}');
  lines:=jsonb_build_array(jsonb_build_object('line_id',1,'product_id',9000006001::bigint,'variation_id',0,'barcode','236','quantity',2),jsonb_build_object('line_id',2,'product_id',9000006002::bigint,'variation_id',0,'barcode','10521','quantity',1));
  perform app.m9_woo_pilot_command(jsonb_build_object('store_origin','https://salmon-nightingale-251188.hostingersite.com','order_id',oid,'operation_id','reserve','expected_version',0,'action','RESERVE','evidence_sha256',repeat('f',64),'reason','SYNTHETIC Preview rollback rehearsal, no remote order or source counts','lines',lines));
  e:=app.m9_woo_rehearsal_evidence(oid,lines);p:=app.m9_woo_rehearsal_packet(e,'post',1);posted:=app.m9_woo_native_finance(p);again:=app.m9_woo_native_finance(p);
  if again->'replayed'<>'true'::jsonb or again->>'receipt_id'<>posted->>'receipt_id' or not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=3 and reserved_qty=0)or not exists(select 1 from public.inventory_by_location where variant_id=v2 and location_id=loc and qty=2 and reserved_qty=0)then raise exception 'WOO_REHEARSAL_POST_FAILED';end if;
  if(select count(*)from public.inventory_movements where reference_type='SALE'and reference_id=posted->>'sale_id')<>2 or(select count(*)from public.sale_payments where sale_id=(posted->>'sale_id')::uuid and method_code='M9_WEB_TEST')<>1 or exists(select 1 from public.sale_items where sale_id=(posted->>'sale_id')::uuid and unit_cost_cents is not null)then raise exception 'WOO_REHEARSAL_NATIVE_DOCUMENT_FAILED';end if;
  ticket:=public.get_sale_ticket_by_folio(loc,posted->>'sale_folio');if ticket->>'id'<>posted->>'sale_id' or jsonb_array_length(ticket->'items')<>2 then raise exception 'WOO_REHEARSAL_TICKET_FAILED';end if;
  refund:=app.m9_woo_rehearsal_evidence(oid,lines,'FULL_CANCEL',e);p:=app.m9_woo_rehearsal_packet(refund,'cancel',2,'FULL_CANCEL');cancelled:=app.m9_woo_native_finance(p);again:=app.m9_woo_native_finance(p);
  if again->'replayed'<>'true'::jsonb or again->>'receipt_id'<>cancelled->>'receipt_id' or not exists(select 1 from public.sales where id=(posted->>'sale_id')::uuid and status='CANCELLED')or not exists(select 1 from public.inventory_by_location where variant_id=v1 and location_id=loc and qty=5 and reserved_qty=0)or not exists(select 1 from public.inventory_by_location where variant_id=v2 and location_id=loc and qty=3 and reserved_qty=0)then raise exception 'WOO_REHEARSAL_CANCEL_FAILED';end if;
  if(select count(*)from public.inventory_movements where reference_type='SALE_CANCELLATION'and reference_id=posted->>'sale_id')<>2 or(select count(*)from public.cash_movements)<>base_cash or(select count(*)from app.m9_woo_finance_ticket_outbox)<>2 then raise exception 'WOO_REHEARSAL_DOUBLE_MOVEMENT';end if;
  proof:=jsonb_build_object('protocol','m9-native-finance-rehearsal-1','synthetic',true,'real_gateway_payment',false,'remote_order_created',false,'native_sale_verified',true,'native_payment_verified',true,'native_ticket_verified',true,'post_replay_verified',true,'cancel_replay_verified',true,'physical_cash_movements',0,'unknown_cost_preserved',true,'deduction_movements',2,'restoration_movements',2,'sale_lines',2,'quantities',jsonb_build_object('seed','5 / 3','after_sale','3 / 2','after_full_cancel','5 / 3'));
  raise exception using errcode='ZX001',message='M9_NATIVE_FINANCE_REHEARSAL_ROLLBACK';
 exception when sqlstate 'ZX001' then if sqlerrm<>'M9_NATIVE_FINANCE_REHEARSAL_ROLLBACK'then raise;end if;
 end;
 if proof is null or(select count(*)from public.sales)<>base_sales or(select count(*)from public.cash_movements)<>base_cash or(select count(*)from public.inventory_movements)<>base_movements or(select count(*)from public.inventory_reservation_movements)<>base_reservations or(select count(*)from public.idempotency_keys)<>base_keys or base_folios<>(select md5(coalesce(string_agg(to_jsonb(f)::text,'|'order by to_jsonb(f)::text),''))from public.folios f) or exists(select 1 from app.m9_woo_finance_pilot_control where enabled)or exists(select 1 from app.m9_woo_pilot_control where enabled)or exists(select 1 from app.m9_woo_finance_test_evidence)or exists(select 1 from app.m9_woo_finance_postings)or exists(select 1 from app.m9_woo_finance_receipts)or exists(select 1 from app.m9_woo_finance_ticket_outbox)or exists(select 1 from app.m9_woo_pilot_orders)or exists(select 1 from app.m9_woo_pilot_links)or exists(select 1 from public.payment_methods where code='M9_WEB_TEST')or exists(select 1 from public.inventory_by_location where variant_id in(v1,v2)and location_id=loc and(qty<>0 or reserved_qty<>0))then raise exception 'WOO_REHEARSAL_ROLLBACK_NOT_CLEAN';end if;
 return proof||'{"all_synthetic_operations_rolled_back":true,"operational_sale_persisted":false}'::jsonb;
end $$;
revoke all on function app.m9_woo_native_rehearsal(uuid)from public,anon,authenticated,service_role;

create function app.m9_run_woo_native_rehearsal(sid uuid,op uuid) returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid:=app.m9_legacy_actor();old app.m9_woo_native_finance_rehearsals;result jsonb;h text;rid uuid;
begin
 if sid is null or op is null or not exists(select 1 from public.cash_sessions s join public.locations l on l.id=s.location_id where s.id=sid and s.cashier_user_id=actor and s.status='OPEN'and l.code='LAP')then raise exception 'WOO_REHEARSAL_OWN_SESSION_REQUIRED'using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-native-rehearsal/'||actor,0));h:=encode(extensions.digest(sid::text||'/m9-native-finance-rehearsal-1','sha256'),'hex');
 select * into old from app.m9_woo_native_finance_rehearsals where actor_id=actor and operation_id=op;
 if old.id is not null then if old.request_sha256<>h then raise exception 'WOO_REHEARSAL_OPERATION_REUSED';end if;return jsonb_build_object('id',old.id,'result',old.result,'created_at',old.created_at,'replayed',true);end if;
 if exists(select 1 from app.m9_woo_native_finance_rehearsals where actor_id=actor and created_at>clock_timestamp()-interval '30 seconds')then raise exception 'WOO_REHEARSAL_COOLDOWN';end if;
 result:=app.m9_woo_native_rehearsal(sid);
 insert into app.m9_woo_native_finance_rehearsals(actor_id,session_id,operation_id,request_sha256,result)values(actor,sid,op,h,result)returning id into rid;
 return jsonb_build_object('id',rid,'result',result,'replayed',false);
end $$;
revoke all on function app.m9_run_woo_native_rehearsal(uuid,uuid)from public,anon,service_role;grant execute on function app.m9_run_woo_native_rehearsal(uuid,uuid)to authenticated;
create function public.m9_run_woo_native_rehearsal(p_session uuid,p_operation uuid)returns jsonb language sql security invoker set search_path=''as $$select app.m9_run_woo_native_rehearsal(p_session,p_operation);$$;
revoke all on function public.m9_run_woo_native_rehearsal(uuid,uuid)from public,anon,service_role;grant execute on function public.m9_run_woo_native_rehearsal(uuid,uuid)to authenticated;
create function app.m9_woo_native_rehearsal_context()returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid:=app.m9_legacy_actor();sessions jsonb;logs jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'location',l.name,'register',r.name)order by s.opened_at desc),'[]')into sessions from public.cash_sessions s join public.locations l on l.id=s.location_id join public.cash_registers r on r.id=s.register_id where s.cashier_user_id=actor and s.status='OPEN'and l.code='LAP'and l.is_active;
 select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]')into logs from(select jsonb_build_object('id',id,'created_at',created_at,'result',result)x from app.m9_woo_native_finance_rehearsals where actor_id=actor order by created_at desc limit 10)t;
 return jsonb_build_object('sessions',sessions,'runs',logs,'synthetic_only',true,'real_gateway_enabled',false,'operational_activation_allowed',false);
end $$;
revoke all on function app.m9_woo_native_rehearsal_context()from public,anon,service_role;grant execute on function app.m9_woo_native_rehearsal_context()to authenticated;
create function public.m9_woo_native_rehearsal_context()returns jsonb language sql security invoker set search_path=''as $$select app.m9_woo_native_rehearsal_context();$$;
revoke all on function public.m9_woo_native_rehearsal_context()from public,anon,service_role;grant execute on function public.m9_woo_native_rehearsal_context()to authenticated;
commit;
