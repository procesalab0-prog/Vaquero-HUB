begin;

-- M7.3 · Primer bloque operativo de apartados.
-- Crear un apartado reserva existencia, pero no registra venta ni dinero.

insert into public.folio_document_types (code, description)
values ('LAYAWAY', 'Apartado')
on conflict (code) do nothing;

create table public.layaways (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  created_cash_session_id uuid not null references public.cash_sessions(id),
  customer_id uuid not null references public.customers(id),
  folio_number bigint not null check (folio_number > 0),
  folio text not null unique check (btrim(folio) <> ''),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'PARTIALLY_PAID', 'PAID', 'COMPLETED', 'CANCELLED')),
  due_date date not null,
  subtotal_cents bigint not null check (subtotal_cents > 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null check (total_cents > 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  balance_cents bigint not null check (balance_cents >= 0),
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.app_users(id),
  cancellation_reason text,
  unique (location_id, folio_number),
  constraint layaway_totals_balance check (
    total_cents = subtotal_cents - discount_cents
    and balance_cents = total_cents - paid_cents
    and paid_cents <= total_cents
  ),
  constraint layaway_terminal_state check (
    (status = 'COMPLETED' and completed_at is not null and cancelled_at is null)
    or (status = 'CANCELLED' and cancelled_at is not null and cancelled_by is not null
        and length(btrim(cancellation_reason)) between 3 and 500 and completed_at is null)
    or (status in ('OPEN', 'PARTIALLY_PAID', 'PAID') and completed_at is null
        and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
  )
);

create index layaways_location_due_idx
  on public.layaways (location_id, due_date, created_at desc);
create index layaways_customer_created_idx
  on public.layaways (customer_id, created_at desc);
create index layaways_open_due_idx
  on public.layaways (location_id, due_date)
  where status in ('OPEN', 'PARTIALLY_PAID', 'PAID');

create table public.layaway_items (
  id uuid primary key default extensions.gen_random_uuid(),
  layaway_id uuid not null references public.layaways(id),
  line_number integer not null check (line_number > 0),
  variant_id uuid not null references public.variants(id),
  product_name text not null check (btrim(product_name) <> ''),
  sku text not null check (btrim(sku) <> ''),
  variant_description text not null default '',
  quantity numeric(12,3) not null check (quantity > 0 and quantity = trunc(quantity)),
  unit_price_cents bigint not null check (unit_price_cents > 0),
  line_total_cents bigint not null check (line_total_cents > 0),
  created_at timestamptz not null default now(),
  unique (layaway_id, line_number),
  unique (layaway_id, variant_id),
  constraint layaway_item_total_balance
    check (line_total_cents = round(quantity * unit_price_cents)::bigint)
);
create index layaway_items_variant_idx
  on public.layaway_items (variant_id, layaway_id);

-- El saldo reservado cambia sin alterar la existencia física. Por eso tiene
-- su propio libro inmutable: no se finge una salida de mercancía.
create table public.inventory_reservation_movements (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  variant_id uuid not null references public.variants(id),
  location_id uuid not null references public.locations(id),
  movement_type text not null check (movement_type in ('RESERVE', 'RELEASE', 'FULFILL')),
  quantity numeric(12,3) not null check (quantity <> 0 and quantity = trunc(quantity)),
  previous_reserved_qty numeric(12,3) not null check (previous_reserved_qty >= 0),
  new_reserved_qty numeric(12,3) not null check (new_reserved_qty >= 0),
  reference_type text not null check (btrim(reference_type) <> ''),
  reference_id text not null check (btrim(reference_id) <> ''),
  operation_key uuid not null,
  user_id uuid not null references public.app_users(id),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  constraint reservation_movement_balances
    check (new_reserved_qty = previous_reserved_qty + quantity),
  unique (operation_key, variant_id, location_id)
);
create index reservation_movements_location_occurred_idx
  on public.inventory_reservation_movements (location_id, occurred_at desc, id desc);
create index reservation_movements_reference_idx
  on public.inventory_reservation_movements (reference_type, reference_id);

create table public.layaway_creation_requests (
  key uuid primary key,
  actor_user_id uuid not null references public.app_users(id),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  layaway_id uuid references public.layaways(id),
  created_at timestamptz not null default now()
);

create or replace function app.guard_layaway_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.layaway_write', true) is distinct from 'on' then
    raise exception 'LAYAWAY_LEDGER_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger layaways_guard
before insert or update or delete on public.layaways
for each row execute function app.guard_layaway_write();
create trigger layaway_items_guard
before insert or update or delete on public.layaway_items
for each row execute function app.guard_layaway_write();
create trigger reservation_movements_guard
before insert or update or delete on public.inventory_reservation_movements
for each row execute function app.guard_layaway_write();
create trigger layaway_creation_requests_guard
before insert or update or delete on public.layaway_creation_requests
for each row execute function app.guard_layaway_write();

create function public.create_layaway(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_due_date date,
  p_items jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_session public.cash_sessions;
  v_existing public.layaway_creation_requests;
  v_layaway public.layaways;
  v_hash text;
  v_folio bigint;
  v_line integer := 0;
  v_subtotal bigint := 0;
  v_item jsonb;
  v_variant public.variants;
  v_product public.products;
  v_qty numeric(12,3);
  v_previous_reserved numeric(12,3);
  v_new_reserved numeric(12,3);
  v_updated integer;
begin
  if v_actor is null or not (select app.has_perm('layaways.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_cash_session_id is null or p_customer_id is null
     or p_due_date is null or p_due_date < current_date
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 100
     or length(coalesce(p_notes, '')) > 500 then
    raise exception 'INVALID_LAYAWAY' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    group by item->>'variant_id' having count(*) > 1
  ) then
    raise exception 'DUPLICATE_LAYAWAY_ITEM' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'session', p_cash_session_id, 'customer', p_customer_id,
    'due_date', p_due_date, 'items', p_items,
    'notes', nullif(btrim(coalesce(p_notes, '')), '')
  )::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('create_layaway:' || p_idempotency_key::text, 0));
  select * into v_existing from public.layaway_creation_requests
  where key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id <> v_actor or v_existing.request_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    if v_existing.layaway_id is null then
      raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode = '40001';
    end if;
    select * into v_layaway from public.layaways where id = v_existing.layaway_id;
    return to_jsonb(v_layaway);
  end if;

  select * into v_session from public.cash_sessions
  where id = p_cash_session_id and status = 'OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor
     or not (select app.can_access_location(v_session.location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.customers
    where id = p_customer_id and not is_anonymized
  ) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('layaway-stock:' || (item->>'variant_id'), 0))
  from jsonb_array_elements(p_items) item order by item->>'variant_id';

  perform set_config('app.layaway_write', 'on', true);
  insert into public.layaway_creation_requests(key, actor_user_id, request_hash)
  values (p_idempotency_key, v_actor, v_hash);

  insert into public.folios(location_id, document_type, next_number)
  values (v_session.location_id, 'LAYAWAY', 2)
  on conflict(location_id, document_type)
  do update set next_number = public.folios.next_number + 1
  returning next_number - 1 into v_folio;

  insert into public.layaways(
    location_id, created_cash_session_id, customer_id, folio_number, folio,
    due_date, subtotal_cents, total_cents, balance_cents, notes, created_by
  ) values (
    v_session.location_id, v_session.id, p_customer_id, v_folio,
    (select code from public.locations where id = v_session.location_id)
      || '-A-' || lpad(v_folio::text, 6, '0'),
    p_due_date, 1, 1, 1, nullif(btrim(coalesce(p_notes, '')), ''), v_actor
  ) returning * into v_layaway;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'variant_id'
  loop
    v_line := v_line + 1;
    begin
      v_qty := (v_item->>'quantity')::numeric;
    exception when others then
      raise exception 'INVALID_LAYAWAY_ITEM' using errcode = '22023';
    end;
    if v_qty is null or v_qty <= 0 or v_qty > 999999999
       or v_qty <> trunc(v_qty) then
      raise exception 'INVALID_LAYAWAY_ITEM' using errcode = '22023';
    end if;
    begin
      select v.* into v_variant from public.variants v
      join public.products p on p.id = v.product_id
      where v.id = (v_item->>'variant_id')::uuid and v.is_active and p.is_active
      for update of v;
    exception when invalid_text_representation then
      raise exception 'INVALID_LAYAWAY_ITEM' using errcode = '22023';
    end;
    if not found or v_variant.price_cents <= 0 then
      raise exception 'VARIANT_NOT_SELLABLE' using errcode = '22023';
    end if;
    select * into v_product from public.products where id = v_variant.product_id;

    -- El mismo candado de fila que protege la venta hace atómica la última pieza.
    perform set_config('app.inventory_write', 'on', true);
    insert into public.inventory_by_location(variant_id, location_id)
    values (v_variant.id, v_session.location_id) on conflict do nothing;
    update public.inventory_by_location
    set reserved_qty = reserved_qty + v_qty, updated_at = now()
    where variant_id = v_variant.id and location_id = v_session.location_id
      and qty - reserved_qty >= v_qty
    returning reserved_qty - v_qty, reserved_qty
    into v_previous_reserved, v_new_reserved;
    get diagnostics v_updated = row_count;
    perform set_config('app.inventory_write', 'off', true);
    if v_updated = 0 then
      raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;

    insert into public.layaway_items(
      layaway_id, line_number, variant_id, product_name, sku,
      variant_description, quantity, unit_price_cents, line_total_cents
    ) values (
      v_layaway.id, v_line, v_variant.id, v_product.name, v_variant.sku,
      coalesce((select string_agg(av.value, ' · ' order by va.type_code)
        from public.variant_attributes va
        join public.attribute_values av on av.id = va.value_id
        where va.variant_id = v_variant.id), ''),
      v_qty, v_variant.price_cents, round(v_qty * v_variant.price_cents)::bigint
    );
    insert into public.inventory_reservation_movements(
      variant_id, location_id, movement_type, quantity,
      previous_reserved_qty, new_reserved_qty, reference_type,
      reference_id, operation_key, user_id, metadata
    ) values (
      v_variant.id, v_session.location_id, 'RESERVE', v_qty,
      v_previous_reserved, v_new_reserved, 'LAYAWAY', v_layaway.id::text,
      p_idempotency_key, v_actor, jsonb_build_object('folio', v_layaway.folio)
    );
    v_subtotal := v_subtotal + round(v_qty * v_variant.price_cents)::bigint;
  end loop;

  update public.layaways set subtotal_cents = v_subtotal,
    total_cents = v_subtotal, balance_cents = v_subtotal, updated_at = now()
  where id = v_layaway.id returning * into v_layaway;
  update public.layaway_creation_requests set layaway_id = v_layaway.id
  where key = p_idempotency_key;

  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    after_data, metadata
  ) values (
    v_actor, 'layaway.created', 'layaways', v_layaway.id::text,
    v_layaway.location_id,
    jsonb_build_object('status', v_layaway.status, 'total_cents', v_layaway.total_cents,
      'balance_cents', v_layaway.balance_cents, 'due_date', v_layaway.due_date),
    jsonb_build_object('folio', v_layaway.folio, 'item_count', v_line,
      'initial_payment_cents', 0)
  );
  perform set_config('app.layaway_write', 'off', true);
  return to_jsonb(v_layaway);
end;
$$;

create function public.list_layaways(
  p_location_id uuid,
  p_query text default '',
  p_status text default null,
  p_limit integer default 100
)
returns table (
  id uuid, folio text, status text, due_date date,
  total_cents bigint, paid_cents bigint, balance_cents bigint,
  customer_id uuid, customer_name text, member_number text,
  item_count bigint, unit_count numeric, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(translate(btrim(coalesce(p_query, '')),
    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
begin
  if (select app.current_user_id()) is null
     or not (select app.has_perm('layaways.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 200
     or length(v_query) > 100
     or (p_status is not null and p_status not in
       ('OPEN', 'PARTIALLY_PAID', 'PAID', 'COMPLETED', 'CANCELLED')) then
    raise exception 'INVALID_LAYAWAY_FILTER' using errcode = '22023';
  end if;
  return query
  select l.id, l.folio, l.status, l.due_date, l.total_cents, l.paid_cents,
    l.balance_cents, c.id, c.full_name, c.member_number,
    count(li.id), coalesce(sum(li.quantity), 0), l.created_at
  from public.layaways l
  join public.customers c on c.id = l.customer_id
  join public.layaway_items li on li.layaway_id = l.id
  where l.location_id = p_location_id
    and (p_status is null or l.status = p_status)
    and (v_query = '' or lower(l.folio) like '%' || v_query || '%'
      or c.search_name like '%' || replace(replace(replace(v_query, '!', '!!'), '%', '!%'), '_', '!_') || '%' escape '!'
      or c.member_number like '%' || replace(replace(replace(v_query, '!', '!!'), '%', '!%'), '_', '!_') || '%' escape '!')
  group by l.id, c.id
  order by case when l.status in ('OPEN', 'PARTIALLY_PAID', 'PAID') then 0 else 1 end,
    l.due_date, l.created_at desc
  limit p_limit;
end;
$$;

alter table public.layaways enable row level security;
alter table public.layaway_items enable row level security;
alter table public.inventory_reservation_movements enable row level security;
alter table public.layaway_creation_requests enable row level security;

create policy layaways_rpc_only on public.layaways
for all to authenticated using (false) with check (false);
create policy layaway_items_rpc_only on public.layaway_items
for all to authenticated using (false) with check (false);
create policy reservation_movements_rpc_only on public.inventory_reservation_movements
for all to authenticated using (false) with check (false);
create policy layaway_creation_requests_rpc_only on public.layaway_creation_requests
for all to authenticated using (false) with check (false);

revoke all on public.layaways, public.layaway_items,
  public.inventory_reservation_movements, public.layaway_creation_requests
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.layaways, public.layaway_items,
  public.inventory_reservation_movements, public.layaway_creation_requests
  to service_role;
grant usage, select on sequence public.inventory_reservation_movements_id_seq
  to service_role;

revoke execute on function app.guard_layaway_write()
  from public, anon, authenticated, service_role;
revoke execute on function public.create_layaway(uuid, uuid, uuid, date, jsonb, text)
  from public, anon;
revoke execute on function public.list_layaways(uuid, text, text, integer)
  from public, anon;
grant execute on function public.create_layaway(uuid, uuid, uuid, date, jsonb, text),
  public.list_layaways(uuid, text, text, integer)
  to authenticated, service_role;

comment on table public.inventory_reservation_movements is
  'Libro inmutable del saldo reservado. Reservar no altera la existencia física y no debe fingirse como inventory_movement.';
comment on function public.create_layaway(uuid, uuid, uuid, date, jsonb, text) is
  'Crea un apartado sin enganche, reserva existencias atómicamente y no mueve caja ni registra una venta.';

commit;
