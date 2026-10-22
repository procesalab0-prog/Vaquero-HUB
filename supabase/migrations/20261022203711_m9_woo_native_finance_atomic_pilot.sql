begin;
select app.assert_sicar_staging_enabled();
create table app.m9_woo_finance_pilot_control(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 actor_id uuid references public.app_users(id),location_id uuid references public.locations(id),
 cash_session_id uuid references public.cash_sessions(id),expires_at timestamptz,
 check(not enabled or(actor_id is not null and location_id is not null and cash_session_id is not null and expires_at is not null))
);
insert into app.m9_woo_finance_pilot_control(singleton)values(true);
create table app.m9_woo_finance_test_evidence(
 id uuid primary key default gen_random_uuid(),origin text not null check(origin='https://salmon-nightingale-251188.hostingersite.com'),
 order_id bigint not null check(order_id>0),actor_id uuid not null references public.app_users(id),
 kind text not null check(kind in('PAYMENT','FULL_CANCEL')),
 gateway_mode text not null check(gateway_mode='SYNTHETIC_TEST_ONLY'),
 source_sha256 text not null check(source_sha256~'^[a-f0-9]{64}$'),
 reference text not null unique check(reference~'^SYNTHETIC-[A-Za-z0-9:_-]{1,100}$'),
 currency text not null check(currency='MXN'),total_cents bigint not null check(total_cents>0),
 observed_at timestamptz not null,lines jsonb not null,components jsonb not null,
 original_evidence_id uuid references app.m9_woo_finance_test_evidence(id),
 refunded_cents bigint not null default 0 check(refunded_cents>=0),physical_reference text,physical_lines jsonb not null default '[]',
 created_at timestamptz not null default clock_timestamp(),
 check((kind='PAYMENT' and original_evidence_id is null and refunded_cents=0 and physical_reference is null and physical_lines='[]') or
       (kind='FULL_CANCEL' and original_evidence_id is not null and refunded_cents=total_cents and physical_reference~'^SYNTHETIC-[A-Za-z0-9:_-]{1,100}$'))
);
create index m9_woo_evidence_actor_idx on app.m9_woo_finance_test_evidence(actor_id);
create index m9_woo_evidence_original_idx on app.m9_woo_finance_test_evidence(original_evidence_id);
create table app.m9_woo_finance_postings(
 id uuid primary key default gen_random_uuid(),origin text not null,order_id bigint not null,
 sale_id uuid not null unique references public.sales(id),evidence_id uuid not null unique references app.m9_woo_finance_test_evidence(id),
 actor_id uuid not null references public.app_users(id),amount_cents bigint not null check(amount_cents>0),
 created_at timestamptz not null default clock_timestamp(),unique(origin,order_id),
 foreign key(origin,order_id) references app.m9_woo_pilot_orders(origin,order_id)
);
create index m9_woo_posting_actor_idx on app.m9_woo_finance_postings(actor_id);
create table app.m9_woo_finance_receipts(
 id uuid primary key default gen_random_uuid(),origin text not null,order_id bigint not null,operation_id text not null,
 action text not null check(action in('POST','FULL_CANCEL')),posting_id uuid not null references app.m9_woo_finance_postings(id),
 evidence_id uuid not null unique references app.m9_woo_finance_test_evidence(id),actor_id uuid not null references public.app_users(id),
 request_sha256 text not null,packet jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(origin,order_id,operation_id),unique(posting_id,action)
);
create index m9_woo_finance_receipt_actor_idx on app.m9_woo_finance_receipts(actor_id);
create table app.m9_woo_finance_ticket_outbox(
 receipt_id uuid primary key references app.m9_woo_finance_receipts(id),sale_id uuid not null references public.sales(id),
 document jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index m9_woo_finance_ticket_sale_idx on app.m9_woo_finance_ticket_outbox(sale_id);
do $$declare t text;begin foreach t in array array['m9_woo_finance_pilot_control','m9_woo_finance_test_evidence','m9_woo_finance_postings','m9_woo_finance_receipts','m9_woo_finance_ticket_outbox']loop
 execute format('alter table app.%I enable row level security',t);execute format('revoke all on app.%I from public,anon,authenticated,service_role',t);
 if t<>'m9_woo_finance_pilot_control' then execute format('create trigger %I before update or delete on app.%I for each row execute function app.m9_woo_pilot_immutable()',t||'_immutable',t);end if;
end loop;end $$;

alter table app.m9_woo_pilot_stock_outbox add column finance_receipt_id uuid references app.m9_woo_finance_receipts(id);
create index m9_woo_stock_finance_receipt_idx on app.m9_woo_pilot_stock_outbox(finance_receipt_id) where finance_receipt_id is not null;

-- Native cancellation/retail return must never bypass a web settlement.
create function app.m9_woo_assert_finance_sale(sid uuid) returns void language plpgsql security invoker set search_path='' as $$
declare binding uuid;
begin
 select id into binding from app.m9_woo_finance_postings where sale_id=sid;
 if binding is not null and current_setting('app.m9_woo_finance_binding',true) is distinct from binding::text then raise exception 'WOO_FINANCE_SERVICE_REQUIRED' using errcode='42501';end if;
end $$;
revoke all on function app.m9_woo_assert_finance_sale(uuid) from public,anon,authenticated,service_role;
create function app.m9_woo_block_retail_return() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from app.m9_woo_finance_postings where sale_id=new.original_sale_id) then raise exception 'WOO_FINANCE_RETURN_REVIEW_REQUIRED';end if;return new;
end $$;
revoke all on function app.m9_woo_block_retail_return() from public,anon,authenticated,service_role;
create trigger m9_woo_retail_return_guard before insert on public.returns for each row execute function app.m9_woo_block_retail_return();
do $patch$
declare s text;needle text;
begin
 s:=pg_get_functiondef('app.cancel_sale_base(uuid,text)'::regprocedure);needle:='  if v_actor is null then';
 if position(needle in s)=0 then raise exception 'WOO_CANCEL_GUARD_SOURCE_CHANGED';end if;
 execute replace(s,needle,'  perform app.m9_woo_assert_finance_sale(p_sale_id);'||chr(10)||needle);
 s:=pg_get_functiondef('app.m9_woo_pilot_command(jsonb)'::regprocedure);
 needle:=' select * into o from app.m9_woo_pilot_orders where origin=c.origin and order_id=oid for update;';
 if position(needle in s)=0 then raise exception 'WOO_ORDER_GUARD_SOURCE_CHANGED';end if;
 s:=replace(s,needle,$guard$ if exists(select 1 from app.m9_woo_finance_postings f where f.origin=c.origin and f.order_id=oid) then raise exception 'WOO_ORDER_FINANCIALLY_BOUND';end if;
$guard$||needle);
 needle:=' perform 1 from public.inventory_by_location i join app.m9_woo_pilot_links m';
 if position(needle in s)=0 then raise exception 'WOO_STOCK_LOCK_SOURCE_CHANGED';end if;
 s:=replace(s,'available_qty=excluded.available_qty,last_receipt_id=excluded.last_receipt_id;', 'available_qty=excluded.available_qty,last_receipt_id=excluded.last_receipt_id,finance_receipt_id=null;');
 s:=replace(s,needle,$locks$ perform pg_advisory_xact_lock(hashtextextended('sale-stock:'||m.variant_id::text,0))
 from app.m9_woo_pilot_links m join jsonb_array_elements(p->'lines') x on m.woo_product_id=(x->>'product_id')::bigint and m.woo_variation_id=(x->>'variation_id')::bigint
 where m.origin=c.origin order by m.variant_id;
$locks$||needle);execute s;
end $patch$;

create function app.m9_woo_native_finance(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c app.m9_woo_finance_pilot_control;wc app.m9_woo_pilot_control;e app.m9_woo_finance_test_evidence;
 o app.m9_woo_pilot_orders;posting app.m9_woo_finance_postings;prior app.m9_woo_finance_receipts;reserve_line app.m9_woo_pilot_lines;
 sale public.sales;session public.cash_sessions;actor uuid;oid bigint;action text;h text;items jsonb:='[]';line jsonb;link app.m9_woo_pilot_links;
 rid uuid:=gen_random_uuid();k text;sum_total bigint:=0;amount bigint;previous_reserved numeric;new_reserved numeric;result jsonb;cancel_result jsonb;
 old_inventory text:=current_setting('app.inventory_write',true);old_layaway text:=current_setting('app.layaway_write',true);old_binding text:=current_setting('app.m9_woo_finance_binding',true);outbox_count int;
begin
 if current_user<>'postgres' then raise exception 'WOO_FINANCE_OPERATOR_ONLY' using errcode='42501';end if;
 perform app.assert_sicar_staging_enabled();actor:=app.current_user_id();
 select * into strict c from app.m9_woo_finance_pilot_control where singleton for share;
 select * into strict wc from app.m9_woo_pilot_control where singleton for share;
 if not c.enabled or c.expires_at<=clock_timestamp() or c.expires_at>clock_timestamp()+interval '15 minutes' or actor is distinct from c.actor_id or
  not wc.enabled or wc.expires_at<=clock_timestamp() or wc.actor_id is distinct from actor or wc.location_id is distinct from c.location_id or
  not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=actor and u.is_active and r.code='ADMIN') or
  not app.can_access_location(c.location_id) or not app.has_perm('pos.sell') then raise exception 'WOO_FINANCE_DISABLED' using errcode='42501';end if;
 if not app.m9_detail_shape(p,array['store_origin','order_id','expected_version','operation_id','action','evidence_id','evidence_sha256']) or
  jsonb_typeof(p->'store_origin') is distinct from 'string' or p->>'store_origin' is distinct from wc.origin or jsonb_typeof(p->'order_id') is distinct from 'number' or coalesce(p->>'order_id','')!~'^[1-9][0-9]{0,15}$' or (p->>'order_id')::numeric>9007199254740991 or
  jsonb_typeof(p->'expected_version') is distinct from 'number' or coalesce(p->>'expected_version','')!~'^(0|[1-9][0-9]{0,14})$' or
  jsonb_typeof(p->'operation_id') is distinct from 'string' or coalesce(p->>'operation_id','')!~'^[A-Za-z0-9:_-]{1,120}$' or jsonb_typeof(p->'action') is distinct from 'string' or p->>'action' not in('POST','FULL_CANCEL') or
  jsonb_typeof(p->'evidence_id') is distinct from 'string' or coalesce(p->>'evidence_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or jsonb_typeof(p->'evidence_sha256') is distinct from 'string' or coalesce(p->>'evidence_sha256','')!~'^[a-f0-9]{64}$'
  then raise exception 'WOO_FINANCE_PACKET_INVALID';end if;
 oid:=(p->>'order_id')::bigint;action:=p->>'action';h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 -- Same idempotency and cash-session order as native checkout. A reversal locks
 -- the existing sale first, matching cancel_sale_base. No caller controls sale ID.
 select * into posting from app.m9_woo_finance_postings where origin=wc.origin and order_id=oid;
 if action='FULL_CANCEL' then
  if posting.id is null then raise exception 'WOO_FINANCE_POSTING_REQUIRED';end if;
  select * into strict sale from public.sales where id=posting.sale_id for update;
 else
  perform pg_advisory_xact_lock(hashtextextended('create_sale:'||(p->>'evidence_id'),0));
 end if;
 select * into session from public.cash_sessions where id=c.cash_session_id and status='OPEN' and cashier_user_id=actor and location_id=c.location_id for update;
 if not found then raise exception 'WOO_FINANCE_SESSION_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(wc.origin||'/'||oid,0));
 select * into prior from app.m9_woo_finance_receipts where origin=wc.origin and order_id=oid and operation_id=p->>'operation_id';
 if prior.id is not null then
  if prior.request_sha256<>h or prior.actor_id<>actor then raise exception 'WOO_FINANCE_OPERATION_REUSED';end if;
  return prior.result||'{"replayed":true}'::jsonb;
 end if;
 select * into e from app.m9_woo_finance_test_evidence where id=(p->>'evidence_id')::uuid;
 if e.id is null or e.actor_id<>actor or e.origin<>wc.origin or e.order_id<>oid or e.source_sha256<>p->>'evidence_sha256' or
  e.gateway_mode<>'SYNTHETIC_TEST_ONLY' or e.observed_at<clock_timestamp()-interval '5 minutes' or e.observed_at>clock_timestamp()+interval '5 seconds' then raise exception 'WOO_FINANCE_EVIDENCE_REQUIRED';end if;
 if exists(select 1 from app.m9_woo_finance_receipts where evidence_id=e.id) then raise exception 'WOO_FINANCE_PAYMENT_REUSED';end if;
 if jsonb_typeof(e.lines) is distinct from 'array' or jsonb_array_length(e.lines) not between 1 and 50 or
  not app.m9_detail_shape(e.components,array['items_subtotal','discount_total','shipping_total','shipping_tax','fees_total','total_tax','refunded_total','total']) then raise exception 'WOO_FINANCE_COMPONENTS_REQUIRED';end if;
 foreach k in array array['discount_total','shipping_total','shipping_tax','fees_total','total_tax','refunded_total'] loop
  if app.m9_detail_amount(e.components->k)<>0 then raise exception 'WOO_FINANCE_COMPONENT_REVIEW_REQUIRED';end if;
 end loop;
 if e.currency<>'MXN' or app.m9_detail_amount(e.components->'total')<>e.total_cents or app.m9_detail_amount(e.components->'items_subtotal')<>e.total_cents then raise exception 'WOO_FINANCE_TOTALS_DIFFER';end if;
 select * into o from app.m9_woo_pilot_orders where origin=wc.origin and order_id=oid for update;
 if o.order_id is null or o.location_id<>c.location_id or o.version<>(p->>'expected_version')::bigint then raise exception 'WOO_FINANCE_ORDER_VERSION_CONFLICT';end if;
 if (action='POST' and (e.kind<>'PAYMENT' or posting.id is not null)) or (action='FULL_CANCEL' and(e.kind<>'FULL_CANCEL' or e.original_evidence_id is distinct from posting.evidence_id or e.total_cents<>posting.amount_cents)) then raise exception 'WOO_FINANCE_EVIDENCE_KIND_INVALID';end if;
 if (select count(distinct x->>'line_id') from jsonb_array_elements(e.lines) x)<>jsonb_array_length(e.lines) or
  (select count(distinct(x->>'product_id',x->>'variation_id')) from jsonb_array_elements(e.lines) x)<>jsonb_array_length(e.lines) or
  (select count(*) from app.m9_woo_pilot_lines where origin=wc.origin and order_id=oid)<>jsonb_array_length(e.lines) then raise exception 'WOO_FINANCE_LINE_SCOPE_CHANGED';end if;
 if action='FULL_CANCEL' and (e.refunded_cents<>posting.amount_cents or e.physical_reference is null or e.physical_lines is distinct from e.lines or sale.status<>'COMPLETED' or
   exists(select 1 from public.returns where original_sale_id=posting.sale_id)) then raise exception 'WOO_FINANCE_FULL_RETURN_PROOF_REQUIRED';end if;
 -- Freeze catalog identities and price; the row/advisory lock order matches POS.
 lock table app.m9_woo_pilot_links,app.m9_rehearsal_control,app.m9_rehearsal_allowlist,public.variants,public.products,public.barcodes in share mode;
 for line in select value from jsonb_array_elements(e.lines) loop
  if not app.m9_detail_shape(line,array['line_id','product_id','variation_id','barcode','quantity','unit_price_cents','line_total_cents']) or
   jsonb_typeof(line->'line_id') is distinct from 'number' or coalesce(line->>'line_id','')!~'^[1-9][0-9]{0,15}$' or (line->>'line_id')::numeric>9007199254740991 or
   jsonb_typeof(line->'product_id') is distinct from 'number' or coalesce(line->>'product_id','')!~'^[1-9][0-9]{0,15}$' or (line->>'product_id')::numeric>9007199254740991 or
   jsonb_typeof(line->'variation_id') is distinct from 'number' or coalesce(line->>'variation_id','')!~'^(0|[1-9][0-9]{0,15})$' or (line->>'variation_id')::numeric>9007199254740991 or
   jsonb_typeof(line->'quantity') is distinct from 'number' or coalesce(line->>'quantity','')!~'^[1-9][0-9]{0,8}$' or
   jsonb_typeof(line->'barcode') is distinct from 'string' or length(line->>'barcode') not between 1 and 160 or line->>'barcode'<>btrim(line->>'barcode') then raise exception 'WOO_FINANCE_LINE_INVALID';end if;
  select * into link from app.m9_woo_pilot_links where origin=wc.origin and woo_product_id=(line->>'product_id')::bigint and woo_variation_id=(line->>'variation_id')::bigint;
  if link.variant_id is null or link.barcode<>line->>'barcode' or not exists(select 1 from public.barcodes b join public.variants v on v.id=b.variant_id join public.products pr on pr.id=v.product_id
    where b.code=link.barcode and b.variant_id=link.variant_id and b.source='SICAR' and pr.measure_unit_code='PIECE') then raise exception 'WOO_FINANCE_IDENTITY_CHANGED';end if;
  amount:=app.m9_detail_amount(line->'unit_price_cents');
  if amount<=0 or amount*(line->>'quantity')::bigint<>app.m9_detail_amount(line->'line_total_cents') then raise exception 'WOO_FINANCE_LINE_TOTAL_INVALID';end if;
  select * into reserve_line from app.m9_woo_pilot_lines where origin=wc.origin and order_id=oid and line_id=(line->>'line_id')::bigint;
  if reserve_line.line_id is null or reserve_line.variant_id<>link.variant_id or reserve_line.barcode<>line->>'barcode' or reserve_line.woo_product_id<>link.woo_product_id or reserve_line.woo_variation_id<>link.woo_variation_id or reserve_line.ordered_qty<>(line->>'quantity')::bigint then raise exception 'WOO_FINANCE_RESERVATION_CHANGED';end if;
  if action='POST' then
   if reserve_line.reserved_qty<>reserve_line.ordered_qty or reserve_line.consumed_qty<>0 or reserve_line.released_qty<>0 or reserve_line.restocked_qty<>0 then raise exception 'WOO_FINANCE_RESERVATION_CHANGED';end if;
   if app.m9_rehearsal_status(link.variant_id) is not null or not exists(select 1 from public.variants v join public.products pr on pr.id=v.product_id where v.id=link.variant_id and v.is_active and pr.is_active and v.price_cents=amount) then raise exception 'WOO_FINANCE_CATALOG_CHANGED';end if;
  else
   if reserve_line.reserved_qty<>0 or reserve_line.consumed_qty<>reserve_line.ordered_qty or reserve_line.released_qty<>0 or reserve_line.restocked_qty<>0 or
    not exists(select 1 from public.sale_items si where si.sale_id=posting.sale_id and si.variant_id=link.variant_id and si.quantity=(line->>'quantity')::numeric and si.unit_price_cents=amount and si.line_total_cents=(line->>'line_total_cents')::bigint) then raise exception 'WOO_FINANCE_RETURN_LINES_CHANGED';end if;
  end if;
  items:=items||jsonb_build_array(jsonb_build_object('variant_id',link.variant_id,'quantity',(line->>'quantity')::bigint));sum_total:=sum_total+(line->>'line_total_cents')::bigint;
 end loop;
 if sum_total<>e.total_cents then raise exception 'WOO_FINANCE_TOTALS_DIFFER';end if;
 select jsonb_agg(x order by x->>'variant_id') into items from jsonb_array_elements(items)x;
 perform pg_advisory_xact_lock(hashtextextended('sale-stock:'||(x->>'variant_id'),0)) from jsonb_array_elements(items)x order by x->>'variant_id';
 perform 1 from public.variants v join jsonb_array_elements(items)x on v.id=(x->>'variant_id')::uuid order by v.id for update of v;
 perform 1 from public.inventory_by_location i join jsonb_array_elements(items)x on i.variant_id=(x->>'variant_id')::uuid where i.location_id=c.location_id order by i.variant_id for update of i;
 if action='POST' then
  if exists(select 1 from public.idempotency_keys where key=e.id) then raise exception 'WOO_FINANCE_NATIVE_KEY_CONFLICT';end if;
  if not exists(select 1 from public.payment_methods where code='M9_WEB_TEST' and kind='OTHER' and requires_reference and is_active) then raise exception 'WOO_FINANCE_TEST_METHOD_REQUIRED';end if;
  for reserve_line in select * from app.m9_woo_pilot_lines where origin=wc.origin and order_id=oid order by variant_id loop
   perform set_config('app.inventory_write','on',true);
   update public.inventory_by_location set reserved_qty=reserved_qty-reserve_line.reserved_qty,updated_at=now()
    where variant_id=reserve_line.variant_id and location_id=c.location_id and reserved_qty>=reserve_line.reserved_qty
    returning reserved_qty+reserve_line.reserved_qty,reserved_qty into previous_reserved,new_reserved;
   if not found then raise exception 'WOO_FINANCE_RESERVATION_TOTAL_CHANGED';end if;
   perform set_config('app.inventory_write',coalesce(old_inventory,'off'),true);perform set_config('app.layaway_write','on',true);
   insert into public.inventory_reservation_movements(variant_id,location_id,movement_type,quantity,previous_reserved_qty,new_reserved_qty,reference_type,reference_id,operation_key,user_id,metadata)
    values(reserve_line.variant_id,c.location_id,'FULFILL',-reserve_line.reserved_qty,previous_reserved,new_reserved,'M9_WOO_FINANCE',rid::text,rid,actor,jsonb_build_object('order_id',oid,'line_id',reserve_line.line_id,'synthetic',true,'financial_operation','NATIVE_SALE_ATOMIC'));
   perform set_config('app.layaway_write',coalesce(old_layaway,'off'),true);
  end loop;
  sale:=public.create_sale(e.id,c.cash_session_id,items,jsonb_build_array(jsonb_build_object('method_code','M9_WEB_TEST','amount_cents',e.total_cents,'reference',e.reference)),null,'[]','SYNTHETIC WOO FINANCE QA order '||oid||'; not a real gateway payment');
  if sale.total_cents<>e.total_cents then raise exception 'WOO_FINANCE_NATIVE_TOTAL_CHANGED';end if;
  insert into app.m9_woo_finance_postings(origin,order_id,sale_id,evidence_id,actor_id,amount_cents)values(wc.origin,oid,sale.id,e.id,actor,e.total_cents) returning * into posting;
  update app.m9_woo_pilot_lines set consumed_qty=consumed_qty+reserved_qty,reserved_qty=0 where origin=wc.origin and order_id=oid;
 else
  perform set_config('app.m9_woo_finance_binding',posting.id::text,true);
  cancel_result:=public.cancel_sale(posting.sale_id,'SYNTHETIC complete refund and physical return; '||e.physical_reference);
  perform set_config('app.m9_woo_finance_binding',coalesce(old_binding,''),true);
  if cancel_result->>'status'<>'CANCELLED' or (cancel_result->>'cash_reversed_cents')::bigint<>0 then raise exception 'WOO_FINANCE_CANCEL_RESULT_INVALID';end if;
  update app.m9_woo_pilot_lines set restocked_qty=consumed_qty where origin=wc.origin and order_id=oid;
 end if;
 update app.m9_woo_pilot_orders set version=version+1 where origin=wc.origin and order_id=oid returning * into o;
 result:=jsonb_build_object('receipt_id',rid,'posting_id',posting.id,'sale_id',posting.sale_id,'sale_folio',(select folio from public.sales where id=posting.sale_id),'order_id',oid,'action',action,'version',o.version,'amount_cents',e.total_cents,'synthetic',true,'real_gateway_payment',false,'cash_movement_created',false,'replayed',false);
 insert into app.m9_woo_finance_receipts(id,origin,order_id,operation_id,action,posting_id,evidence_id,actor_id,request_sha256,packet,result)
 values(rid,wc.origin,oid,p->>'operation_id',action,posting.id,e.id,actor,h,p,result);
 insert into app.m9_woo_pilot_stock_outbox(origin,variant_id,location_id,revision,available_qty,last_receipt_id,finance_receipt_id)
 select wc.origin,l.variant_id,c.location_id,1,i.qty-i.reserved_qty,existing.last_receipt_id,rid from app.m9_woo_pilot_lines l join public.inventory_by_location i on i.variant_id=l.variant_id and i.location_id=c.location_id
 join app.m9_woo_pilot_stock_outbox existing on existing.origin=wc.origin and existing.variant_id=l.variant_id and existing.location_id=c.location_id
 where l.origin=wc.origin and l.order_id=oid
 on conflict(origin,variant_id,location_id) do update set revision=app.m9_woo_pilot_stock_outbox.revision+1,available_qty=excluded.available_qty,finance_receipt_id=excluded.finance_receipt_id;
 get diagnostics outbox_count=row_count;
 if outbox_count<>jsonb_array_length(items) then raise exception 'WOO_FINANCE_OUTBOX_INCOMPLETE';end if;
 insert into app.m9_woo_finance_ticket_outbox(receipt_id,sale_id,document)values(rid,posting.sale_id,jsonb_build_object('kind',action,'sale_id',posting.sale_id,'folio',result->>'sale_folio','synthetic',true,'send_allowed',false));
 perform set_config('app.inventory_write',coalesce(old_inventory,'off'),true);return result;
end $$;
revoke all on function app.m9_woo_native_finance(jsonb) from public,anon,authenticated,service_role;
comment on function app.m9_woo_native_finance(jsonb) is 'STAGING MAINTENANCE ONLY: synthetic paid-order native sale/cancellation with atomic reservation fulfillment. No real payment adapter, public endpoint or remote Woo writes.';
commit;
