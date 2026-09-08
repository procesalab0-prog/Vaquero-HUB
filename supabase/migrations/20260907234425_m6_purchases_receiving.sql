-- M6: proveedores, ordenes de compra y recepciones parciales.
-- Una orden nunca modifica inventario; solo receive_purchase_order lo hace.

create table public.suppliers (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code = upper(btrim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  name text not null check (btrim(name) <> '' and length(btrim(name)) <= 160),
  contact_name text check (contact_name is null or length(btrim(contact_name)) <= 160),
  phone text check (phone is null or length(btrim(phone)) <= 40),
  email text check (email is null or length(btrim(email)) <= 254),
  tax_id text check (tax_id is null or length(btrim(tax_id)) <= 32),
  notes text check (notes is null or length(notes) <= 2000),
  is_active boolean not null default true,
  created_by uuid not null references public.app_users(id),
  updated_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suppliers_active_name_idx on public.suppliers (name) where is_active;

create table public.purchase_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  folio bigint generated always as identity unique,
  supplier_id uuid not null references public.suppliers(id),
  location_id uuid not null references public.locations(id),
  status text not null default 'ORDERED'
    check (status in ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
  expected_at date,
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid not null references public.app_users(id),
  cancelled_by uuid references public.app_users(id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'CANCELLED') = (cancelled_at is not null and cancelled_by is not null))
);
create index purchase_orders_location_created_idx on public.purchase_orders (location_id, created_at desc);
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id);
create index purchase_orders_open_idx on public.purchase_orders (location_id, created_at desc)
  where status in ('ORDERED', 'PARTIALLY_RECEIVED');

create table public.purchase_items (
  id uuid primary key default extensions.gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id),
  variant_id uuid not null references public.variants(id),
  ordered_qty integer not null check (ordered_qty > 0 and ordered_qty <= 999999999),
  received_qty integer not null default 0 check (received_qty >= 0 and received_qty <= ordered_qty),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_order_id, variant_id)
);
create index purchase_items_variant_idx on public.purchase_items (variant_id);

create table public.receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  folio bigint generated always as identity unique,
  purchase_order_id uuid not null references public.purchase_orders(id),
  location_id uuid not null references public.locations(id),
  idempotency_key uuid not null unique,
  notes text check (notes is null or length(notes) <= 2000),
  received_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now()
);
create index receipts_order_created_idx on public.receipts (purchase_order_id, created_at desc);
create index receipts_location_created_idx on public.receipts (location_id, created_at desc);

create table public.receipt_items (
  id uuid primary key default extensions.gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id),
  purchase_item_id uuid not null references public.purchase_items(id),
  variant_id uuid not null references public.variants(id),
  received_qty integer not null check (received_qty > 0 and received_qty <= 999999999),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  inventory_movement_id bigint not null unique references public.inventory_movements(id),
  created_at timestamptz not null default now(),
  unique (receipt_id, purchase_item_id)
);
create index receipt_items_variant_idx on public.receipt_items (variant_id);
create index receipt_items_purchase_item_idx on public.receipt_items (purchase_item_id);

create trigger suppliers_touch_updated_at before update on public.suppliers
for each row execute function app.touch_updated_at();
create trigger purchase_orders_touch_updated_at before update on public.purchase_orders
for each row execute function app.touch_updated_at();

alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_items enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;

create policy suppliers_select on public.suppliers for select to authenticated
using ((select app.has_perm('purchases.manage')) or (select app.has_perm('purchases.receive')));
create policy purchase_orders_select on public.purchase_orders for select to authenticated
using (
  ((select app.has_perm('purchases.manage')) or (select app.has_perm('purchases.receive')))
  and (select app.can_access_location(location_id))
);
create policy purchase_items_select on public.purchase_items for select to authenticated
using (exists (
  select 1 from public.purchase_orders po
  where po.id = purchase_order_id
    and ((select app.has_perm('purchases.manage')) or (select app.has_perm('purchases.receive')))
    and (select app.can_access_location(po.location_id))
));
create policy receipts_select on public.receipts for select to authenticated
using (
  ((select app.has_perm('purchases.manage')) or (select app.has_perm('purchases.receive')))
  and (select app.can_access_location(location_id))
);
create policy receipt_items_select on public.receipt_items for select to authenticated
using (exists (
  select 1 from public.receipts r
  where r.id = receipt_id
    and ((select app.has_perm('purchases.manage')) or (select app.has_perm('purchases.receive')))
    and (select app.can_access_location(r.location_id))
));

revoke all on public.suppliers, public.purchase_orders, public.purchase_items,
  public.receipts, public.receipt_items from anon, authenticated;
grant select on public.suppliers, public.purchase_orders, public.purchase_items,
  public.receipts, public.receipt_items to authenticated;
grant select, insert, update on public.suppliers, public.purchase_orders,
  public.purchase_items, public.receipts, public.receipt_items to service_role;
grant usage, select on sequence public.purchase_orders_folio_seq,
  public.receipts_folio_seq to service_role;

create or replace function app.guard_purchase_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('app.purchase_write', true) <> 'on' then
    raise exception 'PURCHASE_HISTORY_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger purchase_orders_guard before insert or update or delete on public.purchase_orders
for each row execute function app.guard_purchase_history();
create trigger purchase_items_guard before insert or update or delete on public.purchase_items
for each row execute function app.guard_purchase_history();
create trigger receipts_guard before insert or update or delete on public.receipts
for each row execute function app.guard_purchase_history();
create trigger receipt_items_guard before insert or update or delete on public.receipt_items
for each row execute function app.guard_purchase_history();

create or replace function public.upsert_supplier(
  p_id uuid, p_code text, p_name text, p_contact_name text default null,
  p_phone text default null, p_email text default null, p_tax_id text default null,
  p_notes text default null, p_is_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select app.current_user_id()); v_id uuid;
begin
  if v_user is null or not (select app.has_perm('purchases.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_code, '')), '') is null
     or nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'INVALID_SUPPLIER' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.suppliers(code, name, contact_name, phone, email, tax_id, notes,
      is_active, created_by, updated_by)
    values (upper(btrim(p_code)), btrim(p_name), nullif(btrim(p_contact_name), ''),
      nullif(btrim(p_phone), ''), nullif(lower(btrim(p_email)), ''), nullif(upper(btrim(p_tax_id)), ''),
      nullif(btrim(p_notes), ''), coalesce(p_is_active, true), v_user, v_user)
    returning id into v_id;
  else
    update public.suppliers set code = upper(btrim(p_code)), name = btrim(p_name),
      contact_name = nullif(btrim(p_contact_name), ''), phone = nullif(btrim(p_phone), ''),
      email = nullif(lower(btrim(p_email)), ''), tax_id = nullif(upper(btrim(p_tax_id)), ''),
      notes = nullif(btrim(p_notes), ''), is_active = coalesce(p_is_active, true), updated_by = v_user
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, after_data)
  values (v_user, case when p_id is null then 'SUPPLIER_CREATED' else 'SUPPLIER_UPDATED' end,
    'supplier', v_id::text, jsonb_build_object('code', upper(btrim(p_code)), 'name', btrim(p_name), 'is_active', p_is_active));
  return v_id;
end;
$$;

create or replace function public.create_purchase_order(
  p_supplier_id uuid, p_location_id uuid, p_items jsonb,
  p_expected_at date default null, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select app.current_user_id()); v_order uuid; v_folio bigint;
  v_item jsonb; v_count integer := 0;
begin
  if v_user is null or not (select app.has_perm('purchases.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists(select 1 from public.suppliers where id = p_supplier_id and is_active) then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 500 then
    raise exception 'INVALID_PURCHASE_ITEMS' using errcode = '22023';
  end if;
  perform set_config('app.purchase_write', 'on', true);
  insert into public.purchase_orders(supplier_id, location_id, expected_at, notes, created_by)
  values (p_supplier_id, p_location_id, p_expected_at, nullif(btrim(p_notes), ''), v_user)
  returning id, folio into v_order, v_folio;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'variant_id', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_item->>'qty', '') !~ '^[1-9][0-9]*$'
       or coalesce(v_item->>'unit_cost_cents', '') !~ '^[0-9]+$'
       or (v_item->>'qty')::numeric > 999999999
       or (v_item->>'unit_cost_cents')::numeric > 9223372036854775807 then
      raise exception 'INVALID_PURCHASE_ITEMS' using errcode = '22023';
    end if;
    insert into public.purchase_items(purchase_order_id, variant_id, ordered_qty, unit_cost_cents)
    select v_order, v.id, (v_item->>'qty')::integer, (v_item->>'unit_cost_cents')::bigint
    from public.variants v join public.products p on p.id = v.product_id
    where v.id = (v_item->>'variant_id')::uuid and v.is_active and p.is_active;
    if not found then raise exception 'VARIANT_NOT_FOUND' using errcode = '22023'; end if;
    v_count := v_count + 1;
  end loop;
  perform set_config('app.purchase_write', 'off', true);
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, after_data)
  values (v_user, 'PURCHASE_ORDER_CREATED', 'purchase_order', v_order::text, p_location_id,
    jsonb_build_object('folio', v_folio, 'supplier_id', p_supplier_id, 'items', v_count));
  return jsonb_build_object('id', v_order, 'folio', v_folio, 'status', 'ORDERED');
exception when unique_violation then
  raise exception 'DUPLICATE_PURCHASE_VARIANT' using errcode = '23505';
end;
$$;

create or replace function public.cancel_purchase_order(p_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select app.current_user_id()); v_order public.purchase_orders%rowtype;
begin
  if v_user is null or not (select app.has_perm('purchases.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if not found or not (select app.can_access_location(v_order.location_id)) then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status <> 'ORDERED' then
    raise exception 'PURCHASE_NOT_CANCELLABLE' using errcode = 'P0001';
  end if;
  perform set_config('app.purchase_write', 'on', true);
  update public.purchase_orders set status='CANCELLED', cancelled_by=v_user, cancelled_at=now()
  where id=p_order_id;
  perform set_config('app.purchase_write', 'off', true);
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, before_data, after_data, metadata)
  values (v_user, 'PURCHASE_ORDER_CANCELLED', 'purchase_order', p_order_id::text, v_order.location_id,
    jsonb_build_object('status', v_order.status), jsonb_build_object('status', 'CANCELLED'),
    jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('id', p_order_id, 'status', 'CANCELLED');
end;
$$;

create or replace function public.receive_purchase_order(
  p_order_id uuid, p_items jsonb, p_idempotency_key uuid, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select app.current_user_id()); v_order public.purchase_orders%rowtype;
  v_receipt uuid; v_folio bigint; v_item jsonb; v_line public.purchase_items%rowtype;
  v_qty integer; v_movement bigint; v_lines integer := 0; v_status text;
begin
  if v_user is null or not (select app.has_perm('purchases.receive')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_REQUIRED' using errcode = '22023'; end if;
  select r.id, r.folio into v_receipt, v_folio from public.receipts r
  where r.idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('id', v_receipt, 'folio', v_folio, 'replayed', true); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 500 then
    raise exception 'INVALID_RECEIPT_ITEMS' using errcode = '22023';
  end if;
  select * into v_order from public.purchase_orders where id=p_order_id for update;
  if not found or not (select app.can_access_location(v_order.location_id)) then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.status not in ('ORDERED','PARTIALLY_RECEIVED') then
    raise exception 'PURCHASE_NOT_RECEIVABLE' using errcode = 'P0001';
  end if;
  perform set_config('app.purchase_write', 'on', true);
  insert into public.receipts(purchase_order_id, location_id, idempotency_key, notes, received_by)
  values(p_order_id, v_order.location_id, p_idempotency_key, nullif(btrim(p_notes), ''), v_user)
  returning id, folio into v_receipt, v_folio;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'purchase_item_id', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_item->>'qty', '') !~ '^[1-9][0-9]*$' then
      raise exception 'INVALID_RECEIPT_ITEMS' using errcode = '22023';
    end if;
    v_qty := (v_item->>'qty')::integer;
    select * into v_line from public.purchase_items
    where id=(v_item->>'purchase_item_id')::uuid and purchase_order_id=p_order_id for update;
    if not found then raise exception 'PURCHASE_ITEM_NOT_FOUND' using errcode = '22023'; end if;
    if v_line.received_qty + v_qty > v_line.ordered_qty then
      raise exception 'RECEIPT_EXCEEDS_ORDER' using errcode = 'P0001';
    end if;
    v_movement := app.apply_movement(v_line.variant_id, v_order.location_id, 'PURCHASE', v_qty,
      'PURCHASE_RECEIPT', v_receipt::text,
      jsonb_build_object('purchase_order_id', p_order_id, 'purchase_item_id', v_line.id,
        'unit_cost_cents', v_line.unit_cost_cents));
    update public.purchase_items set received_qty=received_qty+v_qty where id=v_line.id;
    insert into public.receipt_items(receipt_id,purchase_item_id,variant_id,received_qty,
      unit_cost_cents,inventory_movement_id)
    values(v_receipt,v_line.id,v_line.variant_id,v_qty,v_line.unit_cost_cents,v_movement);
    v_lines := v_lines + 1;
  end loop;
  select case when bool_and(received_qty=ordered_qty) then 'RECEIVED' else 'PARTIALLY_RECEIVED' end
  into v_status from public.purchase_items where purchase_order_id=p_order_id;
  update public.purchase_orders set status=v_status where id=p_order_id;
  perform set_config('app.purchase_write', 'off', true);
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, after_data)
  values(v_user,'PURCHASE_RECEIPT_CREATED','receipt',v_receipt::text,v_order.location_id,
    jsonb_build_object('folio',v_folio,'purchase_order_id',p_order_id,'lines',v_lines,'order_status',v_status));
  return jsonb_build_object('id',v_receipt,'folio',v_folio,'order_status',v_status,'replayed',false);
exception when unique_violation then
  select r.id,r.folio into v_receipt,v_folio from public.receipts r where r.idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('id',v_receipt,'folio',v_folio,'replayed',true); end if;
  raise;
end;
$$;

create or replace function public.list_purchase_orders(p_location_id uuid, p_limit integer default 100)
returns table(order_id uuid, folio bigint, status text, supplier_id uuid, supplier_name text,
  expected_at date, notes text, created_at timestamptz, ordered_qty bigint, received_qty bigint,
  total_cents numeric, items jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select app.current_user_id()) is null
     or not ((select app.has_perm('purchases.manage')) or (select app.has_perm('purchases.receive')))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  return query select po.id,po.folio,po.status,s.id,s.name,po.expected_at,po.notes,po.created_at,
    sum(pi.ordered_qty)::bigint,sum(pi.received_qty)::bigint,
    sum(pi.ordered_qty::numeric*pi.unit_cost_cents)::numeric,
    jsonb_agg(jsonb_build_object('id',pi.id,'variant_id',v.id,'sku',v.sku,'product_name',p.name,
      'ordered_qty',pi.ordered_qty,'received_qty',pi.received_qty,'remaining_qty',pi.ordered_qty-pi.received_qty,
      'unit_cost_cents',pi.unit_cost_cents) order by p.name,v.sku)
  from public.purchase_orders po join public.suppliers s on s.id=po.supplier_id
  join public.purchase_items pi on pi.purchase_order_id=po.id
  join public.variants v on v.id=pi.variant_id join public.products p on p.id=v.product_id
  where po.location_id=p_location_id group by po.id,s.id,s.name order by po.created_at desc limit p_limit;
end;
$$;

create or replace function public.list_purchase_receipts(p_location_id uuid, p_limit integer default 50)
returns table(receipt_id uuid, folio bigint, order_id uuid, order_folio bigint,
  supplier_name text, received_by_name text, created_at timestamptz, items jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select app.current_user_id()) is null
     or not ((select app.has_perm('purchases.manage')) or (select app.has_perm('purchases.receive')))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  return query select r.id,r.folio,po.id,po.folio,s.name,u.full_name,r.created_at,
    jsonb_agg(jsonb_build_object('variant_id',ri.variant_id,'sku',v.sku,'product_name',p.name,
      'qty',ri.received_qty,'unit_cost_cents',ri.unit_cost_cents) order by p.name,v.sku)
  from public.receipts r join public.purchase_orders po on po.id=r.purchase_order_id
  join public.suppliers s on s.id=po.supplier_id join public.app_users u on u.id=r.received_by
  join public.receipt_items ri on ri.receipt_id=r.id join public.variants v on v.id=ri.variant_id
  join public.products p on p.id=v.product_id where r.location_id=p_location_id
  group by r.id,po.id,po.folio,s.name,u.full_name order by r.created_at desc limit least(greatest(p_limit,1),100);
end;
$$;

revoke all on function public.upsert_supplier(uuid,text,text,text,text,text,text,text,boolean) from public, anon;
revoke all on function public.create_purchase_order(uuid,uuid,jsonb,date,text) from public, anon;
revoke all on function public.cancel_purchase_order(uuid,text) from public, anon;
revoke all on function public.receive_purchase_order(uuid,jsonb,uuid,text) from public, anon;
revoke all on function public.list_purchase_orders(uuid,integer) from public, anon;
revoke all on function public.list_purchase_receipts(uuid,integer) from public, anon;
grant execute on function public.upsert_supplier(uuid,text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.create_purchase_order(uuid,uuid,jsonb,date,text) to authenticated;
grant execute on function public.cancel_purchase_order(uuid,text) to authenticated;
grant execute on function public.receive_purchase_order(uuid,jsonb,uuid,text) to authenticated;
grant execute on function public.list_purchase_orders(uuid,integer) to authenticated;
grant execute on function public.list_purchase_receipts(uuid,integer) to authenticated;
