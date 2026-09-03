begin;

create table public.inventory_by_location (
  variant_id uuid not null references public.variants(id),
  location_id uuid not null references public.locations(id),
  qty numeric(12,3) not null default 0,
  reserved_qty numeric(12,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (variant_id, location_id),
  constraint inventory_qty_nonnegative check (qty >= 0),
  constraint inventory_reserved_nonnegative check (reserved_qty >= 0),
  constraint inventory_reserved_not_over_qty check (reserved_qty <= qty)
);

create index inventory_by_location_location_idx
  on public.inventory_by_location (location_id, variant_id);

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  variant_id uuid not null references public.variants(id),
  location_id uuid not null references public.locations(id),
  movement_type text not null check (movement_type in (
    'INITIAL_IMPORT', 'SALE', 'RETURN', 'PURCHASE', 'TRANSFER_OUT',
    'TRANSFER_IN', 'ADJUSTMENT', 'CANCELLATION', 'COUNT'
  )),
  quantity numeric(12,3) not null check (quantity <> 0),
  previous_qty numeric(12,3) not null,
  new_qty numeric(12,3) not null,
  reference_type text not null check (btrim(reference_type) <> ''),
  reference_id text not null check (btrim(reference_id) <> ''),
  user_id uuid not null references public.app_users(id),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  constraint inventory_movement_balances
    check (new_qty = previous_qty + quantity),
  constraint inventory_movement_nonnegative
    check (previous_qty >= 0 and new_qty >= 0)
);

create index inventory_movements_variant_location_id_idx
  on public.inventory_movements (variant_id, location_id, id);
create index inventory_movements_location_occurred_idx
  on public.inventory_movements (location_id, occurred_at desc, id desc);
create index inventory_movements_reference_idx
  on public.inventory_movements (reference_type, reference_id);
create index inventory_movements_user_idx
  on public.inventory_movements (user_id, occurred_at desc);
create unique index inventory_movements_idempotency_idx
  on public.inventory_movements (
    movement_type, reference_type, reference_id, variant_id, location_id
  );

-- Las filas en cero no inventan inventario y conservan la invariante del libro.
insert into public.inventory_by_location (variant_id, location_id)
select v.id, l.id
from public.variants v
cross join public.locations l
where l.is_active
on conflict do nothing;

create or replace function app.guard_inventory_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.inventory_write', true) is distinct from 'on' then
    raise exception 'INVENTORY_LEDGER_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger inventory_balance_guard
before insert or update or delete on public.inventory_by_location
for each row execute function app.guard_inventory_write();

create trigger inventory_movements_guard
before insert or update or delete on public.inventory_movements
for each row execute function app.guard_inventory_write();

create or replace function app.apply_movement(
  p_variant_id uuid,
  p_location_id uuid,
  p_type text,
  p_qty numeric,
  p_reference_type text,
  p_reference_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev numeric(12,3);
  v_new numeric(12,3);
  v_id bigint;
  v_user uuid := (select app.current_user_id());
  v_permission text;
  v_location_type text;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_variant_id is null or p_location_id is null or p_qty is null
     or p_qty = 0 or abs(p_qty) > 999999999.999
     or p_type not in (
       'INITIAL_IMPORT', 'SALE', 'RETURN', 'PURCHASE', 'TRANSFER_OUT',
       'TRANSFER_IN', 'ADJUSTMENT', 'CANCELLATION', 'COUNT'
     )
     or nullif(btrim(coalesce(p_reference_type, '')), '') is null
     or length(btrim(p_reference_type)) > 80
     or nullif(btrim(coalesce(p_reference_id, '')), '') is null
     or length(btrim(p_reference_id)) > 160
     or p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
     or pg_column_size(p_metadata) > 8192 then
    raise exception 'INVALID_MOVEMENT' using errcode = '22023';
  end if;

  if (p_type in ('SALE', 'TRANSFER_OUT') and p_qty > 0)
     or (p_type in ('RETURN', 'PURCHASE', 'TRANSFER_IN', 'CANCELLATION') and p_qty < 0) then
    raise exception 'INVALID_MOVEMENT_SIGN' using errcode = '22023';
  end if;

  select type into v_location_type
  from public.locations
  where id = p_location_id and is_active;
  if not found then
    raise exception 'LOCATION_NOT_FOUND' using errcode = '22023';
  end if;

  if v_location_type = 'TRANSIT' then
    if p_type not in ('TRANSFER_OUT', 'TRANSFER_IN') then
      raise exception 'TRANSIT_LOCATION_FORBIDDEN' using errcode = '42501';
    end if;
  elsif not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;

  v_permission := case p_type
    when 'SALE' then 'pos.sell'
    when 'RETURN' then 'returns.create'
    when 'CANCELLATION' then 'sales.cancel'
    when 'PURCHASE' then 'purchases.receive'
    when 'TRANSFER_OUT' then 'transfers.create'
    when 'TRANSFER_IN' then 'transfers.receive'
    when 'COUNT' then 'inventory.count'
    when 'ADJUSTMENT' then 'inventory.adjust'
    when 'INITIAL_IMPORT' then 'inventory.adjust'
  end;
  if not (select app.has_perm(v_permission)) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  perform set_config('app.inventory_write', 'on', true);
  insert into public.inventory_by_location (variant_id, location_id)
  values (p_variant_id, p_location_id)
  on conflict do nothing;

  update public.inventory_by_location
  set qty = qty + p_qty,
      updated_at = now()
  where variant_id = p_variant_id
    and location_id = p_location_id
    and qty + p_qty >= reserved_qty
  returning qty - p_qty, qty into v_prev, v_new;

  if not found then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  insert into public.inventory_movements (
    variant_id, location_id, movement_type, quantity, previous_qty, new_qty,
    reference_type, reference_id, user_id, metadata
  ) values (
    p_variant_id, p_location_id, p_type, p_qty, v_prev, v_new,
    btrim(p_reference_type), btrim(p_reference_id), v_user, p_metadata
  ) returning id into v_id;
  perform set_config('app.inventory_write', 'off', true);

  return v_id;
end;
$$;

create or replace function public.apply_inventory_adjustment(
  p_variant_id uuid,
  p_location_id uuid,
  p_expected_qty numeric,
  p_counted_qty numeric,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_current numeric(12,3);
  v_difference numeric(12,3);
  v_movement_id bigint;
  v_reference_id text := extensions.gen_random_uuid()::text;
begin
  if v_actor is null or not (select app.has_perm('inventory.adjust')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_expected_qty is null or p_expected_qty < 0
     or p_counted_qty is null or p_counted_qty < 0
     or p_counted_qty > 999999999.999
     or p_reason not in (
       'MERMA', 'ROBO', 'DAÑO', 'ERROR_CAPTURA', 'CONTEO_FISICO',
       'MUESTRA', 'DEVOLUCION_PROVEEDOR'
     )
     or length(coalesce(p_note, '')) > 500 then
    raise exception 'INVALID_ADJUSTMENT' using errcode = '22023';
  end if;

  perform set_config('app.inventory_write', 'on', true);
  insert into public.inventory_by_location (variant_id, location_id)
  values (p_variant_id, p_location_id)
  on conflict do nothing;
  perform set_config('app.inventory_write', 'off', true);

  select qty into v_current
  from public.inventory_by_location
  where variant_id = p_variant_id and location_id = p_location_id
  for update;

  if v_current is distinct from p_expected_qty then
    raise exception 'STALE_INVENTORY' using errcode = '40001';
  end if;
  v_difference := p_counted_qty - v_current;
  if v_difference = 0 then
    return jsonb_build_object(
      'status', 'NO_CHANGE', 'previous_qty', v_current, 'new_qty', v_current
    );
  end if;

  v_movement_id := app.apply_movement(
    p_variant_id, p_location_id, 'ADJUSTMENT', v_difference,
    'INVENTORY_ADJUSTMENT', v_reference_id,
    jsonb_strip_nulls(jsonb_build_object(
      'reason', p_reason,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    ))
  );

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'inventory.adjustment', 'inventory_by_location',
    concat(p_variant_id, ':', p_location_id), p_location_id,
    jsonb_build_object('qty', v_current),
    jsonb_build_object('qty', p_counted_qty),
    jsonb_strip_nulls(jsonb_build_object(
      'reason', p_reason, 'note', nullif(btrim(coalesce(p_note, '')), ''),
      'movement_id', v_movement_id
    ))
  );

  return jsonb_build_object(
    'status', 'UPDATED', 'movement_id', v_movement_id,
    'previous_qty', v_current, 'new_qty', p_counted_qty,
    'difference', v_difference
  );
end;
$$;

create or replace function public.get_inventory_snapshot(
  p_location_id uuid,
  p_query text default '',
  p_limit integer default 300
)
returns table (
  variant_id uuid,
  product_id uuid,
  product_name text,
  brand_name text,
  sku text,
  primary_barcode text,
  attributes jsonb,
  qty numeric,
  reserved_qty numeric,
  available_qty numeric,
  is_active boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(translate(btrim(coalesce(p_query, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
begin
  if (select app.current_user_id()) is null
     or not (select app.has_perm('inventory.read')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;

  return query
  select
    v.id, p.id, p.name, coalesce(b.name, 'Sin marca'), v.sku,
    coalesce(primary_code.code, v.legacy_sicar_code),
    coalesce(attrs.values, '{}'::jsonb),
    coalesce(i.qty, 0), coalesce(i.reserved_qty, 0),
    coalesce(i.qty - i.reserved_qty, 0),
    p.is_active and v.is_active,
    coalesce(i.updated_at, v.updated_at)
  from public.variants v
  join public.products p on p.id = v.product_id
  left join public.brands b on b.id = p.brand_id
  left join public.inventory_by_location i
    on i.variant_id = v.id and i.location_id = p_location_id
  left join lateral (
    select bc.code from public.barcodes bc
    where bc.variant_id = v.id and bc.is_primary
    order by bc.created_at, bc.id limit 1
  ) primary_code on true
  left join lateral (
    select jsonb_object_agg(va.type_code, av.value order by va.type_code) as values
    from public.variant_attributes va
    join public.attribute_values av on av.id = va.value_id
    where va.variant_id = v.id
  ) attrs on true
  where v_query = ''
     or p.search_name like '%' || replace(replace(v_query, '%', '\\%'), '_', '\\_') || '%' escape '\\'
     or lower(v.sku) like '%' || replace(replace(v_query, '%', '\\%'), '_', '\\_') || '%' escape '\\'
     or exists (
       select 1 from public.barcodes search_code
       where search_code.variant_id = v.id
         and lower(search_code.code) like '%' || replace(replace(v_query, '%', '\\%'), '_', '\\_') || '%' escape '\\'
     )
  order by p.name, v.sku
  limit p_limit;
end;
$$;

create or replace function public.list_inventory_movements(
  p_location_id uuid,
  p_limit integer default 100
)
returns table (
  id bigint,
  occurred_at timestamptz,
  variant_id uuid,
  product_name text,
  sku text,
  movement_type text,
  quantity numeric,
  previous_qty numeric,
  new_qty numeric,
  reference_type text,
  reference_id text,
  user_name text,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select app.current_user_id()) is null
     or not (select app.has_perm('inventory.read')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;

  return query
  select m.id, m.occurred_at, m.variant_id, p.name, v.sku,
    m.movement_type, m.quantity, m.previous_qty, m.new_qty,
    m.reference_type, m.reference_id, u.full_name, m.metadata
  from public.inventory_movements m
  join public.variants v on v.id = m.variant_id
  join public.products p on p.id = v.product_id
  join public.app_users u on u.id = m.user_id
  where m.location_id = p_location_id
  order by m.occurred_at desc, m.id desc
  limit p_limit;
end;
$$;

create or replace function public.check_inventory_invariant()
returns table (
  variant_id uuid,
  location_id uuid,
  ledger_qty numeric,
  balance_qty numeric,
  difference numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select app.current_user_id()) is null
     or not (
       (select app.has_perm('reports.inventory'))
       or (select app.has_perm('audit.read'))
     ) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  with ledger as (
    select m.variant_id, m.location_id, sum(m.quantity) as qty
    from public.inventory_movements m
    group by m.variant_id, m.location_id
  )
  select coalesce(l.variant_id, i.variant_id),
    coalesce(l.location_id, i.location_id), coalesce(l.qty, 0),
    coalesce(i.qty, 0), coalesce(l.qty, 0) - coalesce(i.qty, 0)
  from ledger l
  full join public.inventory_by_location i
    on i.variant_id = l.variant_id and i.location_id = l.location_id
  where coalesce(l.qty, 0) <> coalesce(i.qty, 0);
end;
$$;

alter table public.inventory_by_location enable row level security;
alter table public.inventory_movements enable row level security;

create policy inventory_balance_select on public.inventory_by_location
for select to authenticated
using (
  (select app.has_perm('inventory.read'))
  and (
    (select app.can_access_location(location_id))
    or (select app.has_perm('locations.manage'))
  )
);

create policy inventory_movements_select on public.inventory_movements
for select to authenticated
using (
  (select app.has_perm('inventory.read'))
  and (
    (select app.can_access_location(location_id))
    or (select app.has_perm('locations.manage'))
  )
);

revoke all on public.inventory_by_location from public, anon, authenticated;
revoke all on public.inventory_movements from public, anon, authenticated;
revoke all on sequence public.inventory_movements_id_seq from public, anon, authenticated;
grant select on public.inventory_by_location, public.inventory_movements to authenticated;

grant select on public.inventory_by_location, public.inventory_movements to service_role;
revoke insert, update, delete on public.inventory_by_location from service_role;
revoke insert, update, delete on public.inventory_movements from service_role;
revoke all on sequence public.inventory_movements_id_seq from service_role;

revoke execute on function app.guard_inventory_write() from public, anon, authenticated, service_role;
revoke execute on function app.apply_movement(uuid, uuid, text, numeric, text, text, jsonb)
  from public, anon, authenticated, service_role;

revoke execute on function public.apply_inventory_adjustment(uuid, uuid, numeric, numeric, text, text)
  from public, anon;
revoke execute on function public.get_inventory_snapshot(uuid, text, integer)
  from public, anon;
revoke execute on function public.list_inventory_movements(uuid, integer)
  from public, anon;
revoke execute on function public.check_inventory_invariant()
  from public, anon;

grant execute on function public.apply_inventory_adjustment(uuid, uuid, numeric, numeric, text, text)
  to authenticated;
grant execute on function public.get_inventory_snapshot(uuid, text, integer)
  to authenticated;
grant execute on function public.list_inventory_movements(uuid, integer)
  to authenticated;
grant execute on function public.check_inventory_invariant()
  to authenticated;

comment on table public.inventory_movements is
  'Libro inmutable: toda corrección se registra con un movimiento compensatorio.';
comment on function app.apply_movement(uuid, uuid, text, numeric, text, text, jsonb) is
  'Único camino de escritura para saldo y libro, ambos dentro de la misma transacción.';
comment on function public.apply_inventory_adjustment(uuid, uuid, numeric, numeric, text, text) is
  'Ajusta a la existencia física sólo si el saldo observado sigue vigente.';
comment on function public.check_inventory_invariant() is
  'Devuelve exclusivamente descuadres entre suma del libro y saldo materializado.';

commit;
