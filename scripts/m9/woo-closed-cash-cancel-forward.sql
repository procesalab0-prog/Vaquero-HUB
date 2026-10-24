begin;
select app.assert_sicar_staging_enabled();
do $preimage$
begin
 if current_user<>'postgres' or session_user<>'postgres' or current_setting('role')not in('none','postgres')then raise insufficient_privilege;end if;
 if encode(extensions.digest(pg_get_functiondef('app.cancel_sale_base(uuid,text)'::regprocedure),'sha256'),'hex')<>'9922d44935542f8077413513d24200fa70d8590cbf97a29dd72b9b0934a02e2e'
 or encode(extensions.digest(pg_get_functiondef('app.m9_woo_native_finance(jsonb)'::regprocedure),'sha256'),'hex')<>'db8309b1b0fef90b449d5474c1137f1a0341630bc946e7c2d2f31fc883e92971'
 or encode(extensions.digest(pg_get_functiondef('app.m9_woo_assert_finance_sale(uuid)'::regprocedure),'sha256'),'hex')<>'bc055438080558e9240bf949fc2084a6a894eb061fd6612dcc4858208ab72c01'
 then raise exception 'WOO_CLOSED_CANCEL_INSTALLED_PREIMAGE_CHANGED';end if;
end $preimage$;

-- A temporary, single-use capability is minted only INSIDE the existing complete
-- writer. This verifier cannot mint one. No permanent table, grant or endpoint.
create function app.m9_woo_cancel_capability(sid uuid,session_id uuid,consume boolean)returns boolean
language plpgsql security invoker set search_path='' as $$
declare actor uuid;cap record;rel record;shape jsonb;f app.m9_woo_finance_postings;
 s public.sales;cs public.cash_sessions;c app.m9_woo_finance_pilot_control;wc app.m9_woo_pilot_control;
 e app.m9_woo_finance_test_evidence;paid app.m9_woo_finance_test_evidence;r app.m9_woo_finance_receipts;
 o app.m9_woo_pilot_orders;payment public.sale_payments;affected int;line jsonb;item public.sale_items;link app.m9_woo_pilot_links;
begin
 if current_user<>'postgres'or session_user<>'postgres'or current_setting('role')not in('none','postgres')then return false;end if;
 perform app.assert_sicar_staging_enabled();actor:=app.current_user_id();
 if actor is null or not app.has_perm('pos.sell')or not app.has_perm('sales.cancel')
 or not exists(select 1 from public.app_users u join public.roles ro on ro.id=u.role_id where u.id=actor and u.is_active and ro.code='ADMIN')then return false;end if;
 select cl.*into rel from pg_catalog.pg_class cl where cl.oid=to_regclass('pg_temp.m9_woo_closed_cancel_cap');
 if not found or rel.relnamespace<>pg_my_temp_schema()or rel.relkind<>'r'or rel.relpersistence<>'t'
 or rel.relowner<>'postgres'::regrole or rel.relrowsecurity or rel.relhasrules or rel.relhastriggers
 or exists(select 1 from aclexplode(coalesce(rel.relacl,acldefault('r',rel.relowner)))a where a.grantee<>rel.relowner)
 then return false;end if;
 select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull)order by a.attnum)into shape
 from pg_catalog.pg_attribute a where a.attrelid=rel.oid and a.attnum>0 and not a.attisdropped;
 if shape is distinct from'[["backend_pid","integer",true],["transaction_id","bigint",true],["nonce","uuid",true],["actor_id","uuid",true],["posting_id","uuid",true],["sale_id","uuid",true],["evidence_id","uuid",true],["packet_sha256","text",true],["packet","jsonb",true],["consumed","boolean",true]]'::jsonb
 or(select count(*)from pg_temp.m9_woo_closed_cancel_cap)<>1 then return false;end if;
 select *into cap from pg_temp.m9_woo_closed_cancel_cap;
 if cap.backend_pid<>pg_backend_pid()or cap.transaction_id<>txid_current()or cap.actor_id<>actor or cap.sale_id is distinct from sid
 or current_setting('app.m9_woo_cancel_capability',true)is distinct from cap.nonce::text
 or current_setting('app.m9_woo_finance_binding',true)is distinct from cap.posting_id::text
 or cap.consumed is distinct from(not consume)
 or cap.packet_sha256 is distinct from encode(extensions.digest(convert_to(cap.packet::text,'UTF8'),'sha256'),'hex')
 or not app.m9_detail_shape(cap.packet,array['store_origin','order_id','expected_version','operation_id','action','evidence_id','evidence_sha256'])
 or cap.packet->>'action'is distinct from'FULL_CANCEL'or cap.packet->>'store_origin'is distinct from'https://salmon-nightingale-251188.hostingersite.com'
 or cap.packet->>'evidence_id'is distinct from cap.evidence_id::text then return false;end if;
 select *into f from app.m9_woo_finance_postings where id=cap.posting_id and sale_id=sid;
 select *into s from public.sales where id=sid;
 select *into cs from public.cash_sessions where id=s.cash_session_id;
 select *into c from app.m9_woo_finance_pilot_control where singleton;
 select *into wc from app.m9_woo_pilot_control where singleton;
 select *into e from app.m9_woo_finance_test_evidence where id=cap.evidence_id;
 select *into paid from app.m9_woo_finance_test_evidence where id=f.evidence_id;
 select *into r from app.m9_woo_finance_receipts where posting_id=f.id and action='POST';
 select *into o from app.m9_woo_pilot_orders where origin=f.origin and order_id=f.order_id;
 if f.id is null or s.id is null or cs.id is null or e.id is null or paid.id is null or r.id is null or o.order_id is null
 or s.status<>'COMPLETED'or s.total_cents<>f.amount_cents or s.cashier_user_id<>f.actor_id or cs.cashier_user_id<>s.cashier_user_id
 or cs.location_id<>s.location_id or cs.status not in('OPEN','CLOSED')or(not consume and session_id is distinct from cs.id)
 or c.enabled is distinct from true or c.actor_id is distinct from actor or c.location_id is distinct from s.location_id
 or c.cash_session_id is distinct from cs.id or c.expires_at is null or c.expires_at<=clock_timestamp()or c.expires_at>clock_timestamp()+interval'15 minutes'
 or wc.enabled is distinct from true or wc.actor_id is distinct from actor or wc.location_id is distinct from s.location_id
 or wc.origin is distinct from f.origin or wc.expires_at is null or wc.expires_at<=clock_timestamp()
 or f.origin<>'https://salmon-nightingale-251188.hostingersite.com'or not app.can_access_location(s.location_id)
 or not exists(select 1 from public.locations l where l.id=s.location_id and l.is_active and l.type='STORE')
 or o.location_id<>s.location_id or cap.packet->'order_id'is distinct from to_jsonb(f.order_id)
 or cap.packet->'expected_version'is distinct from to_jsonb(o.version)
 or e.kind<>'FULL_CANCEL'or e.actor_id<>actor or e.origin<>f.origin or e.order_id<>f.order_id
 or e.gateway_mode<>'SYNTHETIC_TEST_ONLY'or e.currency<>'MXN'or e.total_cents<>f.amount_cents or e.refunded_cents<>f.amount_cents
 or e.original_evidence_id is distinct from paid.id or e.source_sha256 is distinct from cap.packet->>'evidence_sha256'
 or e.observed_at<clock_timestamp()-interval'5 minutes'or e.observed_at>clock_timestamp()+interval'5 seconds'
 or e.physical_reference is null or e.physical_reference!~'^SYNTHETIC-[A-Za-z0-9:_-]{1,100}$'
 or e.physical_lines is distinct from e.lines or e.lines is distinct from paid.lines
 or paid.kind<>'PAYMENT'or paid.actor_id<>f.actor_id or paid.origin<>f.origin or paid.order_id<>f.order_id
 or paid.gateway_mode<>'SYNTHETIC_TEST_ONLY'or paid.currency<>'MXN'or paid.total_cents<>f.amount_cents
 or paid.components is distinct from jsonb_build_object('items_subtotal',f.amount_cents,'discount_total',0,'shipping_total',0,'shipping_tax',0,'fees_total',0,'total_tax',0,'refunded_total',0,'total',f.amount_cents)
 or e.components is distinct from paid.components
 or r.actor_id<>f.actor_id or r.evidence_id<>paid.id or r.origin<>f.origin or r.order_id<>f.order_id
 or r.request_sha256 is distinct from encode(extensions.digest(convert_to(r.packet::text,'UTF8'),'sha256'),'hex')
 or r.packet->>'action'is distinct from'POST'or r.packet->>'evidence_id'is distinct from paid.id::text
 or r.packet->>'store_origin'is distinct from f.origin or r.packet->'order_id'is distinct from to_jsonb(f.order_id)
 or r.packet->>'evidence_sha256'is distinct from paid.source_sha256
 or r.result->>'receipt_id'is distinct from r.id::text or r.result->>'action'is distinct from'POST'
 or r.result->'order_id'is distinct from to_jsonb(f.order_id)
 or r.result->>'sale_id'is distinct from sid::text or r.result->>'posting_id'is distinct from f.id::text
 or r.result->'amount_cents'is distinct from to_jsonb(f.amount_cents)or r.result->'synthetic'is distinct from'true'::jsonb
 or r.result->'real_gateway_payment'is distinct from'false'::jsonb or r.result->'cash_movement_created'is distinct from'false'::jsonb
 or exists(select 1 from public.returns where original_sale_id=sid)
 or exists(select 1 from public.usd_sale_tenders where sale_id=sid)
 or exists(select 1 from public.customer_credit_ledger where entry_type='CHARGE'and reference_type='SALE'and reference_id=sid::text)
 or(select count(*)from public.sale_payments where sale_id=sid)<>1
 or exists(select 1 from public.sale_items where sale_id=sid and(variant_id is null or quick_line_id is not null))
 then return false;end if;
 select *into payment from public.sale_payments where sale_id=sid;
 if payment.method_code<>'M9_WEB_TEST'or payment.amount_cents<>f.amount_cents or payment.reference is distinct from paid.reference
 or not exists(select 1 from public.payment_methods m where m.code=payment.method_code and m.kind='OTHER'and m.requires_reference)
 or jsonb_typeof(e.lines)is distinct from'array'or jsonb_array_length(e.lines)not between 1 and 50
 or(select count(*)from public.sale_items where sale_id=sid)<>jsonb_array_length(e.lines)
 or(select count(*)from app.m9_woo_pilot_lines where origin=f.origin and order_id=f.order_id)<>jsonb_array_length(e.lines)
 then return false;end if;
 for line in select value from jsonb_array_elements(e.lines)loop
  select *into link from app.m9_woo_pilot_links where origin=f.origin and woo_product_id=(line->>'product_id')::bigint and woo_variation_id=(line->>'variation_id')::bigint;
  select *into item from public.sale_items where sale_id=sid and variant_id=link.variant_id;
  if link.variant_id is null or link.barcode is distinct from line->>'barcode'or item.id is null
  or item.quantity<>(line->>'quantity')::numeric or item.unit_price_cents<>(line->>'unit_price_cents')::bigint
  or item.line_total_cents<>(line->>'line_total_cents')::bigint
  or not exists(select 1 from app.m9_woo_pilot_lines l where l.origin=f.origin and l.order_id=f.order_id and l.line_id=(line->>'line_id')::bigint
   and l.variant_id=link.variant_id and l.barcode=link.barcode and l.reserved_qty=0 and l.consumed_qty=l.ordered_qty and l.restocked_qty=0 and l.released_qty=0)
  then return false;end if;
 end loop;
 if consume then
  update pg_temp.m9_woo_closed_cancel_cap set consumed=true where nonce=cap.nonce and not consumed;
  get diagnostics affected=row_count;return affected=1;
 end if;
 return true;
end $$;
revoke all on function app.m9_woo_cancel_capability(uuid,uuid,boolean)from public,anon,authenticated,service_role;

-- Protect OPEN as well as CLOSED bound sales: a forged binding alone must never
-- call the native cancel independently and strand the posting without a receipt.
create or replace function app.m9_woo_assert_finance_sale(sid uuid)returns void
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from app.m9_woo_finance_postings where sale_id=sid)
 and not app.m9_woo_cancel_capability(sid,null,true)
 then raise exception 'WOO_FINANCE_SERVICE_REQUIRED'using errcode='42501';end if;
end $$;
revoke all on function app.m9_woo_assert_finance_sale(uuid)from public,anon,authenticated,service_role;

do $extend$
declare d text;old text;new text;
begin
 d:=pg_get_functiondef('app.cancel_sale_base(uuid,text)'::regprocedure);
 old:=$old$  if v_session.status <> 'OPEN' then
    raise exception 'SALE_SESSION_CLOSED' using errcode = '22023';
  end if;$old$;
 new:=$new$  if v_session.status <> 'OPEN' and not app.m9_woo_cancel_capability(v_sale.id,v_session.id,false) then
    raise exception 'SALE_SESSION_CLOSED' using errcode = '22023';
  end if;$new$;
 if(length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'WOO_CLOSED_CANCEL_NATIVE_TARGET_CHANGED';end if;
 execute replace(d,old,new);
 d:=pg_get_functiondef('app.m9_woo_native_finance(jsonb)'::regprocedure);
 old:=$old$old_binding text:=current_setting('app.m9_woo_finance_binding',true);outbox_count int;$old$;
 new:=$new$old_binding text:=current_setting('app.m9_woo_finance_binding',true);old_capability text:=current_setting('app.m9_woo_cancel_capability',true);cap_nonce uuid;outbox_count int;$new$;
 if(length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'WOO_CLOSED_CANCEL_WRITER_DECL_CHANGED';end if;d:=replace(d,old,new);
 old:=$old$ select * into session from public.cash_sessions where id=c.cash_session_id and status='OPEN' and cashier_user_id=actor and location_id=c.location_id for update;
 if not found then raise exception 'WOO_FINANCE_SESSION_REQUIRED';end if;$old$;
 new:=$new$ if action='FULL_CANCEL' then
  select * into session from public.cash_sessions where id=sale.cash_session_id and id=c.cash_session_id and location_id=c.location_id and status in('OPEN','CLOSED')for update;
  if not found or not app.has_perm('sales.cancel')or not exists(select 1 from public.locations l where l.id=c.location_id and l.is_active and l.type='STORE')then raise exception 'WOO_FINANCE_SESSION_REQUIRED';end if;
 else
  select * into session from public.cash_sessions where id=c.cash_session_id and status='OPEN' and cashier_user_id=actor and location_id=c.location_id for update;
  if not found then raise exception 'WOO_FINANCE_SESSION_REQUIRED';end if;
 end if;$new$;
 if(length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'WOO_CLOSED_CANCEL_SESSION_TARGET_CHANGED';end if;d:=replace(d,old,new);
 old:=$old$  perform set_config('app.m9_woo_finance_binding',posting.id::text,true);
  cancel_result:=public.cancel_sale(posting.sale_id,'SYNTHETIC complete refund and physical return; '||e.physical_reference);
  perform set_config('app.m9_woo_finance_binding',coalesce(old_binding,''),true);$old$;
 new:=$new$  begin
   if to_regclass('pg_temp.m9_woo_closed_cancel_cap')is not null then raise exception 'WOO_CANCEL_CAPABILITY_COLLISION';end if;
   create temporary table m9_woo_closed_cancel_cap(
    backend_pid integer not null,transaction_id bigint not null,nonce uuid primary key,
    actor_id uuid not null,posting_id uuid not null,sale_id uuid not null,evidence_id uuid not null,
    packet_sha256 text not null,packet jsonb not null,consumed boolean not null
   )on commit drop;
   revoke all on table pg_temp.m9_woo_closed_cancel_cap from public,anon,authenticated,service_role;
   cap_nonce:=gen_random_uuid();
   insert into pg_temp.m9_woo_closed_cancel_cap values(pg_backend_pid(),txid_current(),cap_nonce,actor,posting.id,posting.sale_id,e.id,h,p,false);
   perform set_config('app.m9_woo_cancel_capability',cap_nonce::text,true);
   perform set_config('app.m9_woo_finance_binding',posting.id::text,true);
   cancel_result:=public.cancel_sale(posting.sale_id,'SYNTHETIC complete refund and physical return; '||e.physical_reference);
   if not exists(select 1 from pg_temp.m9_woo_closed_cancel_cap where nonce=cap_nonce and consumed)then raise exception 'WOO_CANCEL_CAPABILITY_NOT_CONSUMED';end if;
   drop table pg_temp.m9_woo_closed_cancel_cap;
   perform set_config('app.m9_woo_cancel_capability',coalesce(old_capability,''),true);
   perform set_config('app.m9_woo_finance_binding',coalesce(old_binding,''),true);
  exception when others then
   perform set_config('app.m9_woo_cancel_capability',coalesce(old_capability,''),true);
   perform set_config('app.m9_woo_finance_binding',coalesce(old_binding,''),true);
   raise;
  end;$new$;
 if(length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'WOO_CLOSED_CANCEL_CALL_TARGET_CHANGED';end if;d:=replace(d,old,new);
 execute d;
end $extend$;
revoke all on function app.m9_woo_native_finance(jsonb),app.cancel_sale_base(uuid,text)from public,anon,authenticated,service_role;
comment on function app.m9_woo_cancel_capability(uuid,uuid,boolean)is 'STAGING MAINTENANCE ONLY: consume/verify the existing writer''s single-use temporary native cancellation capability. No mint function, no payment authentication, no public grants.';
commit;
