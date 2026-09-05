begin;

alter table public.folios drop constraint folios_document_type_check;
alter table public.folios add constraint folios_document_type_check
  check (document_type in ('SALE', 'RETURN'));

create table public.returns (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  cash_session_id uuid not null references public.cash_sessions(id),
  original_sale_id uuid not null references public.sales(id),
  customer_id uuid references public.customers(id),
  folio_number bigint not null check (folio_number > 0),
  folio text not null unique check (btrim(folio) <> ''),
  type text not null check (type in ('RETURN', 'EXCHANGE')),
  returned_cents bigint not null default 0 check (returned_cents >= 0),
  delivered_cents bigint not null default 0 check (delivered_cents >= 0),
  difference_cents bigint not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  authorized_by uuid not null references public.app_users(id),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  unique (location_id, folio_number),
  constraint return_amounts_balance check (
    difference_cents = delivered_cents - returned_cents
  )
);

create table public.return_items (
  id uuid primary key default extensions.gen_random_uuid(),
  return_id uuid not null references public.returns(id),
  direction text not null check (direction in ('IN', 'OUT')),
  sale_item_id uuid references public.sale_items(id),
  variant_id uuid not null references public.variants(id),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  condition text check (condition in ('RESELLABLE', 'DAMAGED')),
  constraint return_item_direction_complete check (
    (direction = 'IN' and sale_item_id is not null and condition is not null)
    or (direction = 'OUT' and sale_item_id is null and condition is null)
  )
);

create table public.return_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  return_id uuid not null references public.returns(id),
  direction text not null check (direction in ('REFUND', 'CHARGE')),
  method_code text not null references public.payment_methods(code),
  amount_cents bigint not null check (amount_cents > 0),
  reference text check (reference is null or length(btrim(reference)) between 3 and 120),
  created_at timestamptz not null default now()
);

create index returns_location_created_idx on public.returns(location_id, created_at desc);
create index returns_original_sale_idx on public.returns(original_sale_id, created_at desc);
create index returns_cash_session_idx on public.returns(cash_session_id, created_at desc);
create index returns_customer_idx on public.returns(customer_id, created_at desc) where customer_id is not null;
create index returns_authorized_by_idx on public.returns(authorized_by, created_at desc);
create index returns_created_by_idx on public.returns(created_by, created_at desc);
create index return_items_return_idx on public.return_items(return_id);
create index return_items_sale_item_idx on public.return_items(sale_item_id) where sale_item_id is not null;
create index return_items_variant_idx on public.return_items(variant_id);
create index return_payments_return_idx on public.return_payments(return_id);
create index return_payments_method_idx on public.return_payments(method_code);

create or replace function app.guard_returns_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and current_setting('app.returns_write', true) = 'on' then
    return new;
  end if;
  raise exception 'RETURNS_LEDGER_IMMUTABLE' using errcode = '42501';
end;
$$;

create trigger returns_ledger_guard before insert or update or delete on public.returns
for each row execute function app.guard_returns_ledger();
create trigger return_items_ledger_guard before insert or update or delete on public.return_items
for each row execute function app.guard_returns_ledger();
create trigger return_payments_ledger_guard before insert or update or delete on public.return_payments
for each row execute function app.guard_returns_ledger();

create or replace function app.check_return_payment_balance()
returns trigger language plpgsql set search_path = '' as $$
declare v_return_id uuid; v_expected bigint; v_actual bigint;
begin
  if tg_table_name = 'returns' then
    v_return_id := coalesce(new.id, old.id);
  else
    v_return_id := coalesce(new.return_id, old.return_id);
  end if;
  select difference_cents into v_expected from public.returns where id = v_return_id;
  if not found then return null; end if;
  select coalesce(sum(case when direction='CHARGE' then amount_cents else -amount_cents end),0)
    into v_actual from public.return_payments where return_id = v_return_id;
  if v_actual <> v_expected then raise exception 'RETURN_PAYMENT_TOTAL_MISMATCH' using errcode = '23514'; end if;
  return null;
end;
$$;

create constraint trigger returns_payment_balance
after insert or update on public.returns deferrable initially deferred
for each row execute function app.check_return_payment_balance();
create constraint trigger return_payments_balance
after insert or update or delete on public.return_payments deferrable initially deferred
for each row execute function app.check_return_payment_balance();

create or replace function public.get_returnable_sale(p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('returns.create')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select jsonb_build_object(
    'id',s.id,'folio',s.folio,'status',s.status,'sold_at',s.sold_at,'total_cents',s.total_cents,
    'location_id',s.location_id,'customer_id',s.customer_id,
    'items',(select coalesce(jsonb_agg(jsonb_build_object(
      'sale_item_id',si.id,'variant_id',si.variant_id,'product_name',si.product_name,
      'variant_description',si.variant_description,'sku',si.sku,'quantity',si.quantity,
      'remaining_quantity',si.quantity-coalesce(pr.returned_qty,0),
      'paid_line_cents',si.line_total_cents-si.ticket_discount_cents,
      'already_returned_cents',coalesce(pr.returned_cents,0)
    ) order by si.line_number),'[]'::jsonb)
    from public.sale_items si
    left join lateral (
      select sum(ri.quantity) returned_qty,sum(ri.line_total_cents) returned_cents
      from public.return_items ri where ri.sale_item_id=si.id and ri.direction='IN'
    ) pr on true where si.sale_id=s.id)
  ) into v_result from public.sales s
  where s.id=p_sale_id and (select app.can_access_location(s.location_id));
  if v_result is null then raise exception 'SALE_NOT_FOUND' using errcode='22023'; end if;
  return v_result;
end;
$$;

create or replace function public.create_equal_exchange(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_original_sale_id uuid,
  p_items_in jsonb,
  p_items_out jsonb,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select app.current_user_id()); v_session public.cash_sessions; v_sale public.sales;
  v_existing public.idempotency_keys; v_hash text; v_folio bigint; v_return public.returns;
  v_in record; v_out record; v_sold numeric; v_previous_qty numeric; v_previous_cents bigint;
  v_original_net bigint; v_line_cents bigint; v_returned bigint := 0; v_delivered bigint := 0;
begin
  if v_actor is null or not (select app.has_perm('returns.create')) or not (select app.has_perm('pos.sell')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if p_idempotency_key is null or p_cash_session_id is null or p_original_sale_id is null
     or jsonb_typeof(p_items_in)<>'array' or jsonb_array_length(p_items_in) not between 1 and 100
     or jsonb_typeof(p_items_out)<>'array' or jsonb_array_length(p_items_out) not between 1 and 100
     or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_EXCHANGE_REQUEST' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items_in) x group by x->>'sale_item_id' having count(*)>1)
     or exists(select 1 from jsonb_array_elements(p_items_out) x group by x->>'variant_id' having count(*)>1) then raise exception 'DUPLICATE_EXCHANGE_ITEM' using errcode='22023'; end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object('session',p_cash_session_id,'sale',p_original_sale_id,'in',p_items_in,'out',p_items_out,'reason',btrim(p_reason))::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('create_exchange:'||p_idempotency_key::text,0));
  select * into v_existing from public.idempotency_keys where key=p_idempotency_key;
  if found then
    if v_existing.actor_user_id<>v_actor or v_existing.request_hash<>v_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    if v_existing.resource_id is null then raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode='40001'; end if;
    select * into v_return from public.returns where id=v_existing.resource_id;
    return jsonb_build_object('id',v_return.id,'folio',v_return.folio,'type',v_return.type,'difference_cents',v_return.difference_cents);
  end if;
  insert into public.idempotency_keys(key,actor_user_id,operation,request_hash) values(p_idempotency_key,v_actor,'CREATE_EQUAL_EXCHANGE',v_hash);

  select * into v_sale from public.sales where id=p_original_sale_id for update;
  if not found then raise exception 'SALE_NOT_FOUND' using errcode='22023'; end if;
  if v_sale.status<>'COMPLETED' then raise exception 'SALE_NOT_RETURNABLE' using errcode='22023'; end if;
  select * into v_session from public.cash_sessions where id=p_cash_session_id and status='OPEN' for update;
  if not found or v_session.cashier_user_id<>v_actor or v_session.location_id<>v_sale.location_id
     or not (select app.can_access_location(v_session.location_id)) then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;

  perform si.id from public.sale_items si join jsonb_to_recordset(p_items_in) x(sale_item_id uuid,quantity numeric) on x.sale_item_id=si.id
    where si.sale_id=v_sale.id order by si.id for update;
  if (select count(*) from jsonb_to_recordset(p_items_in) x(sale_item_id uuid,quantity numeric)) <>
     (select count(*) from public.sale_items si join jsonb_to_recordset(p_items_in) x(sale_item_id uuid,quantity numeric) on x.sale_item_id=si.id where si.sale_id=v_sale.id)
     or exists(select 1 from jsonb_to_recordset(p_items_in) x(sale_item_id uuid,quantity numeric) where x.quantity is null or x.quantity<=0 or x.quantity>999999999.999) then raise exception 'SALE_ITEM_MISMATCH' using errcode='22023'; end if;

  for v_in in select si.id,si.variant_id,si.quantity,si.line_total_cents-si.ticket_discount_cents original_net,x.quantity requested
    from public.sale_items si join jsonb_to_recordset(p_items_in) x(sale_item_id uuid,quantity numeric) on x.sale_item_id=si.id
    where si.sale_id=v_sale.id order by si.id
  loop
    select coalesce(sum(quantity),0),coalesce(sum(line_total_cents),0) into v_previous_qty,v_previous_cents
      from public.return_items where sale_item_id=v_in.id and direction='IN';
    if v_previous_qty+v_in.requested>v_in.quantity then raise exception 'RETURN_EXCEEDS_SOLD' using errcode='22023'; end if;
    v_original_net:=v_in.original_net;
    if v_previous_qty+v_in.requested=v_in.quantity then v_line_cents:=v_original_net-v_previous_cents;
    else v_line_cents:=floor(v_original_net::numeric*v_in.requested/v_in.quantity)::bigint; end if;
    v_returned:=v_returned+v_line_cents;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('sale-stock:'||(x.variant_id)::text,0))
    from jsonb_to_recordset(p_items_out) x(variant_id uuid,quantity numeric) order by x.variant_id;
  if exists(select 1 from jsonb_to_recordset(p_items_out) x(variant_id uuid,quantity numeric)
    left join public.variants v on v.id=x.variant_id left join public.products p on p.id=v.product_id
    where x.quantity is null or x.quantity<=0 or x.quantity>999999999.999 or v.id is null or p.id is null or not v.is_active or not p.is_active) then raise exception 'VARIANT_NOT_SELLABLE' using errcode='22023'; end if;
  select coalesce(sum(round(v.price_cents*x.quantity)::bigint),0) into v_delivered
    from jsonb_to_recordset(p_items_out) x(variant_id uuid,quantity numeric) join public.variants v on v.id=x.variant_id;
  if v_delivered<>v_returned then raise exception 'EXCHANGE_PRICE_DIFFERENCE_UNSUPPORTED' using errcode='22023'; end if;

  insert into public.folios(location_id,document_type,next_number) values(v_session.location_id,'RETURN',2)
  on conflict(location_id,document_type) do update set next_number=public.folios.next_number+1 returning next_number-1 into v_folio;
  perform set_config('app.returns_write','on',true);
  insert into public.returns(location_id,cash_session_id,original_sale_id,customer_id,folio_number,folio,type,returned_cents,delivered_cents,difference_cents,reason,authorized_by,created_by)
  values(v_session.location_id,v_session.id,v_sale.id,v_sale.customer_id,v_folio,(select code from public.locations where id=v_session.location_id)||'-C-'||lpad(v_folio::text,6,'0'),'EXCHANGE',v_returned,v_delivered,0,btrim(p_reason),v_actor,v_actor) returning * into v_return;
  for v_in in select si.id,si.variant_id,si.quantity,si.line_total_cents-si.ticket_discount_cents original_net,x.quantity requested
    from public.sale_items si join jsonb_to_recordset(p_items_in) x(sale_item_id uuid,quantity numeric) on x.sale_item_id=si.id where si.sale_id=v_sale.id order by si.id
  loop
    select coalesce(sum(quantity),0),coalesce(sum(line_total_cents),0) into v_previous_qty,v_previous_cents from public.return_items where sale_item_id=v_in.id and direction='IN';
    if v_previous_qty+v_in.requested=v_in.quantity then v_line_cents:=v_in.original_net-v_previous_cents;
    else v_line_cents:=floor(v_in.original_net::numeric*v_in.requested/v_in.quantity)::bigint; end if;
    insert into public.return_items(return_id,direction,sale_item_id,variant_id,quantity,unit_price_cents,line_total_cents,condition)
    values(v_return.id,'IN',v_in.id,v_in.variant_id,v_in.requested,round(v_line_cents/v_in.requested)::bigint,v_line_cents,'RESELLABLE');
    perform app.apply_movement(v_in.variant_id,v_session.location_id,'RETURN',v_in.requested,'EXCHANGE',v_return.id::text,jsonb_build_object('folio',v_return.folio,'original_sale_id',v_sale.id));
  end loop;
  for v_out in select x.variant_id,x.quantity,v.price_cents from jsonb_to_recordset(p_items_out) x(variant_id uuid,quantity numeric) join public.variants v on v.id=x.variant_id order by x.variant_id
  loop
    v_line_cents:=round(v_out.price_cents*v_out.quantity)::bigint;
    insert into public.return_items(return_id,direction,variant_id,quantity,unit_price_cents,line_total_cents)
    values(v_return.id,'OUT',v_out.variant_id,v_out.quantity,v_out.price_cents,v_line_cents);
    perform app.apply_movement(v_out.variant_id,v_session.location_id,'SALE',-v_out.quantity,'EXCHANGE',v_return.id::text,jsonb_build_object('folio',v_return.folio,'original_sale_id',v_sale.id));
  end loop;
  perform set_config('app.returns_write','off',true);
  update public.idempotency_keys set resource_id=v_return.id where key=p_idempotency_key;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,after_data,metadata)
  values(v_actor,'exchange.created','returns',v_return.id::text,v_return.location_id,to_jsonb(v_return),jsonb_build_object('original_sale_id',v_sale.id,'items_in',jsonb_array_length(p_items_in),'items_out',jsonb_array_length(p_items_out)));
  return jsonb_build_object('id',v_return.id,'folio',v_return.folio,'type',v_return.type,'difference_cents',0);
end;
$$;

alter table public.returns enable row level security;
alter table public.return_items enable row level security;
alter table public.return_payments enable row level security;
create policy returns_read on public.returns for select to authenticated using (
  (select app.can_access_location(location_id)) and ((select app.has_perm('reports.sales')) or created_by=(select app.current_user_id()))
);
create policy return_items_read on public.return_items for select to authenticated using (
  exists(select 1 from public.returns r where r.id=return_items.return_id)
);
create policy return_payments_read on public.return_payments for select to authenticated using (
  exists(select 1 from public.returns r where r.id=return_payments.return_id)
);

revoke all on public.returns,public.return_items,public.return_payments from public,anon,authenticated,service_role;
grant select on public.returns,public.return_items,public.return_payments to authenticated,service_role;
grant select,insert,update,delete on public.returns,public.return_items,public.return_payments to service_role;
revoke execute on function app.guard_returns_ledger(),app.check_return_payment_balance() from public,anon,authenticated,service_role;
revoke execute on function public.get_returnable_sale(uuid),public.create_equal_exchange(uuid,uuid,uuid,jsonb,jsonb,text) from public,anon;
grant execute on function public.get_returnable_sale(uuid),public.create_equal_exchange(uuid,uuid,uuid,jsonb,jsonb,text) to authenticated,service_role;

commit;
