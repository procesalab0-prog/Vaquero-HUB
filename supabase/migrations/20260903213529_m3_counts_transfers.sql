begin;

create table public.inventory_counts (
  id uuid primary key default extensions.gen_random_uuid(),
  folio bigint generated always as identity unique,
  location_id uuid not null references public.locations(id),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'COUNTING', 'CLOSED', 'CANCELLED')),
  scope jsonb not null default '{"type":"SELECTED"}'::jsonb
    check (jsonb_typeof(scope) = 'object' and pg_column_size(scope) <= 8192),
  created_by uuid not null references public.app_users(id),
  closed_by uuid references public.app_users(id),
  cancelled_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint inventory_counts_terminal_state check (
    (status = 'CLOSED' and closed_by is not null and closed_at is not null and cancelled_by is null and cancelled_at is null)
    or (status = 'CANCELLED' and cancelled_by is not null and cancelled_at is not null and closed_by is null and closed_at is null)
    or (status in ('OPEN', 'COUNTING') and closed_by is null and closed_at is null and cancelled_by is null and cancelled_at is null)
  )
);

create index inventory_counts_location_created_idx
  on public.inventory_counts (location_id, created_at desc);
create index inventory_counts_status_idx
  on public.inventory_counts (status, updated_at desc);

create table public.inventory_count_items (
  count_id uuid not null references public.inventory_counts(id),
  variant_id uuid not null references public.variants(id),
  counted_qty numeric(12,3) not null check (counted_qty >= 0),
  counted_at timestamptz not null default now(),
  counted_by uuid not null references public.app_users(id),
  system_qty numeric(12,3) check (system_qty >= 0),
  difference numeric(12,3),
  had_movement_after_count boolean not null default false,
  movement_id bigint references public.inventory_movements(id),
  primary key (count_id, variant_id),
  constraint count_item_closed_values check (
    (system_qty is null and difference is null and movement_id is null)
    or (system_qty is not null and difference = counted_qty - system_qty)
  )
);

create index inventory_count_items_variant_idx
  on public.inventory_count_items (variant_id, count_id);

create table public.transfers (
  id uuid primary key default extensions.gen_random_uuid(),
  folio bigint generated always as identity unique,
  from_location_id uuid not null references public.locations(id),
  to_location_id uuid not null references public.locations(id),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'APPROVED', 'PREPARED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED')),
  note text check (length(note) <= 500),
  requested_by uuid not null references public.app_users(id),
  approved_by uuid references public.app_users(id),
  prepared_by uuid references public.app_users(id),
  sent_by uuid references public.app_users(id),
  received_by uuid references public.app_users(id),
  cancelled_by uuid references public.app_users(id),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  prepared_at timestamptz,
  sent_at timestamptz,
  received_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint transfer_locations_differ check (from_location_id <> to_location_id),
  constraint transfer_state_fields check (
    (status = 'REQUESTED' and approved_by is null and prepared_by is null and sent_by is null and received_by is null and cancelled_by is null)
    or (status = 'APPROVED' and approved_by is not null and approved_at is not null and prepared_by is null and sent_by is null and received_by is null and cancelled_by is null)
    or (status = 'PREPARED' and approved_by is not null and prepared_by is not null and prepared_at is not null and sent_by is null and received_by is null and cancelled_by is null)
    or (status = 'IN_TRANSIT' and approved_by is not null and prepared_by is not null and sent_by is not null and sent_at is not null and received_by is null and cancelled_by is null)
    or (status = 'RECEIVED' and approved_by is not null and prepared_by is not null and sent_by is not null and received_by is not null and received_at is not null and cancelled_by is null)
    or (status = 'CANCELLED' and cancelled_by is not null and cancelled_at is not null and sent_by is null and received_by is null)
  )
);

create index transfers_from_status_idx
  on public.transfers (from_location_id, status, updated_at desc);
create index transfers_to_status_idx
  on public.transfers (to_location_id, status, updated_at desc);

create table public.transfer_items (
  transfer_id uuid not null references public.transfers(id),
  variant_id uuid not null references public.variants(id),
  qty_requested numeric(12,3) not null check (qty_requested > 0),
  qty_sent numeric(12,3) check (qty_sent > 0 and qty_sent <= qty_requested),
  qty_received numeric(12,3) check (qty_received >= 0 and qty_received <= qty_sent),
  primary key (transfer_id, variant_id)
);

create index transfer_items_variant_idx
  on public.transfer_items (variant_id, transfer_id);

create or replace function app.guard_inventory_document_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.inventory_document_write', true) is distinct from 'on' then
    raise exception 'INVENTORY_DOCUMENT_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger inventory_counts_guard
before insert or update or delete on public.inventory_counts
for each row execute function app.guard_inventory_document_write();
create trigger inventory_count_items_guard
before insert or update or delete on public.inventory_count_items
for each row execute function app.guard_inventory_document_write();
create trigger transfers_guard
before insert or update or delete on public.transfers
for each row execute function app.guard_inventory_document_write();
create trigger transfer_items_guard
before insert or update or delete on public.transfer_items
for each row execute function app.guard_inventory_document_write();

create or replace function app.lock_transfer_variant(
  p_variant_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid
)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(
    'inventory-transfer:' || p_variant_id::text || ':' ||
    least(p_from_location_id::text, p_to_location_id::text) || ':' ||
    greatest(p_from_location_id::text, p_to_location_id::text),
    0
  ));
$$;

create or replace function public.create_inventory_count(
  p_location_id uuid,
  p_scope jsonb default '{"type":"SELECTED"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_count public.inventory_counts;
begin
  if v_actor is null or not (select app.has_perm('inventory.count')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_scope is null or jsonb_typeof(p_scope) <> 'object' or pg_column_size(p_scope) > 8192 then
    raise exception 'INVALID_COUNT_SCOPE' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations
    where id = p_location_id and is_active and type <> 'TRANSIT'
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = '22023';
  end if;

  perform set_config('app.inventory_document_write', 'on', true);
  insert into public.inventory_counts (location_id, scope, created_by)
  values (p_location_id, p_scope, v_actor)
  returning * into v_count;
  perform set_config('app.inventory_document_write', 'off', true);

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, after_data
  ) values (
    v_actor, 'inventory.count.created', 'inventory_count', v_count.id::text,
    p_location_id, jsonb_build_object('folio', v_count.folio, 'scope', p_scope)
  );

  return jsonb_build_object('id', v_count.id, 'folio', v_count.folio, 'status', v_count.status);
end;
$$;

create or replace function public.record_inventory_count_item(
  p_count_id uuid,
  p_variant_id uuid,
  p_counted_qty numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_location_id uuid;
  v_status text;
begin
  if v_actor is null or not (select app.has_perm('inventory.count')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_counted_qty is null or p_counted_qty < 0 or p_counted_qty > 999999999.999 then
    raise exception 'INVALID_COUNT_QUANTITY' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory-count:' || p_count_id::text, 0));
  select location_id, status into v_location_id, v_status
  from public.inventory_counts where id = p_count_id for update;
  if not found then raise exception 'COUNT_NOT_FOUND' using errcode = '22023'; end if;
  if v_status not in ('OPEN', 'COUNTING') then
    raise exception 'COUNT_NOT_EDITABLE' using errcode = '22023';
  end if;
  if not (select app.can_access_location(v_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.variants v join public.products p on p.id = v.product_id
    where v.id = p_variant_id and v.is_active and p.is_active
  ) then
    raise exception 'VARIANT_NOT_FOUND' using errcode = '22023';
  end if;

  perform set_config('app.inventory_document_write', 'on', true);
  insert into public.inventory_count_items (
    count_id, variant_id, counted_qty, counted_at, counted_by
  ) values (p_count_id, p_variant_id, p_counted_qty, now(), v_actor)
  on conflict (count_id, variant_id) do update set
    counted_qty = excluded.counted_qty,
    counted_at = excluded.counted_at,
    counted_by = excluded.counted_by,
    system_qty = null,
    difference = null,
    had_movement_after_count = false,
    movement_id = null;
  update public.inventory_counts set
    status = 'COUNTING', started_at = coalesce(started_at, now()), updated_at = now()
  where id = p_count_id;
  perform set_config('app.inventory_document_write', 'off', true);

  return jsonb_build_object('status', 'RECORDED', 'count_id', p_count_id, 'variant_id', p_variant_id);
end;
$$;

create or replace function public.close_inventory_count(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_location_id uuid;
  v_status text;
  v_item record;
  v_system_qty numeric(12,3);
  v_difference numeric(12,3);
  v_movement_id bigint;
  v_warning boolean;
  v_adjusted integer := 0;
  v_warnings integer := 0;
begin
  if v_actor is null or not (select app.has_perm('inventory.count')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory-count:' || p_count_id::text, 0));
  select location_id, status into v_location_id, v_status
  from public.inventory_counts where id = p_count_id for update;
  if not found then raise exception 'COUNT_NOT_FOUND' using errcode = '22023'; end if;
  if v_status not in ('OPEN', 'COUNTING') then
    raise exception 'COUNT_NOT_CLOSABLE' using errcode = '22023';
  end if;
  if not (select app.can_access_location(v_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.inventory_count_items where count_id = p_count_id) then
    raise exception 'COUNT_EMPTY' using errcode = '22023';
  end if;

  for v_item in
    select * from public.inventory_count_items
    where count_id = p_count_id order by variant_id
  loop
    perform set_config('app.inventory_write', 'on', true);
    insert into public.inventory_by_location (variant_id, location_id)
    values (v_item.variant_id, v_location_id) on conflict do nothing;
    perform set_config('app.inventory_write', 'off', true);

    select qty into v_system_qty
    from public.inventory_by_location
    where variant_id = v_item.variant_id and location_id = v_location_id
    for update;
    v_warning := exists (
      select 1 from public.inventory_movements
      where variant_id = v_item.variant_id and location_id = v_location_id
        and occurred_at > v_item.counted_at
    );
    v_difference := v_item.counted_qty - v_system_qty;
    v_movement_id := null;
    if v_difference <> 0 then
      v_movement_id := app.apply_movement(
        v_item.variant_id, v_location_id, 'COUNT', v_difference,
        'INVENTORY_COUNT', p_count_id::text,
        jsonb_build_object('had_movement_after_count', v_warning)
      );
      v_adjusted := v_adjusted + 1;
    end if;
    if v_warning then v_warnings := v_warnings + 1; end if;

    perform set_config('app.inventory_document_write', 'on', true);
    update public.inventory_count_items set
      system_qty = v_system_qty,
      difference = v_difference,
      had_movement_after_count = v_warning,
      movement_id = v_movement_id
    where count_id = p_count_id and variant_id = v_item.variant_id;
    perform set_config('app.inventory_document_write', 'off', true);
  end loop;

  perform set_config('app.inventory_document_write', 'on', true);
  update public.inventory_counts set
    status = 'CLOSED', closed_by = v_actor, closed_at = now(), updated_at = now()
  where id = p_count_id;
  perform set_config('app.inventory_document_write', 'off', true);

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, after_data
  ) values (
    v_actor, 'inventory.count.closed', 'inventory_count', p_count_id::text,
    v_location_id, jsonb_build_object('adjusted_items', v_adjusted, 'warnings', v_warnings)
  );
  return jsonb_build_object(
    'status', 'CLOSED', 'adjusted_items', v_adjusted, 'warnings', v_warnings
  );
end;
$$;

create or replace function public.cancel_inventory_count(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_location_id uuid;
  v_status text;
begin
  if v_actor is null or not (select app.has_perm('inventory.count')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-count:' || p_count_id::text, 0));
  select location_id, status into v_location_id, v_status
  from public.inventory_counts where id = p_count_id for update;
  if not found then raise exception 'COUNT_NOT_FOUND' using errcode = '22023'; end if;
  if v_status not in ('OPEN', 'COUNTING') then raise exception 'COUNT_NOT_CANCELLABLE' using errcode = '22023'; end if;
  if not (select app.can_access_location(v_location_id)) then raise exception 'LOCATION_FORBIDDEN' using errcode = '42501'; end if;
  perform set_config('app.inventory_document_write', 'on', true);
  update public.inventory_counts set status = 'CANCELLED', cancelled_by = v_actor,
    cancelled_at = now(), updated_at = now() where id = p_count_id;
  perform set_config('app.inventory_document_write', 'off', true);
  return jsonb_build_object('status', 'CANCELLED');
end;
$$;

create or replace function public.create_transfer(
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_items jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_transfer public.transfers;
begin
  if v_actor is null or not (select app.has_perm('transfers.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_from_location_id is null or p_to_location_id is null
     or p_from_location_id = p_to_location_id
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 500
     or length(coalesce(p_note, '')) > 500 then
    raise exception 'INVALID_TRANSFER' using errcode = '22023';
  end if;
  if not (select app.can_access_location(p_from_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if (select count(*) from public.locations
      where id in (p_from_location_id, p_to_location_id)
        and is_active and type <> 'TRANSIT') <> 2 then
    raise exception 'LOCATION_NOT_FOUND' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)
    where x.variant_id is null or x.qty is null or x.qty <= 0 or x.qty > 999999999.999
  ) or (select count(*) from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)) <>
       (select count(distinct x.variant_id) from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric))
     or exists (
       select 1 from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)
       left join public.variants v on v.id = x.variant_id
       left join public.products p on p.id = v.product_id
       where v.id is null or not v.is_active or not p.is_active
     ) then
    raise exception 'INVALID_TRANSFER_ITEMS' using errcode = '22023';
  end if;

  perform set_config('app.inventory_document_write', 'on', true);
  insert into public.transfers (
    from_location_id, to_location_id, note, requested_by
  ) values (
    p_from_location_id, p_to_location_id,
    nullif(btrim(coalesce(p_note, '')), ''), v_actor
  ) returning * into v_transfer;
  insert into public.transfer_items (transfer_id, variant_id, qty_requested)
  select v_transfer.id, x.variant_id, x.qty
  from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric);
  perform set_config('app.inventory_document_write', 'off', true);

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, after_data
  ) values (
    v_actor, 'transfer.requested', 'transfer', v_transfer.id::text,
    p_from_location_id, jsonb_build_object(
      'folio', v_transfer.folio, 'to_location_id', p_to_location_id,
      'item_count', jsonb_array_length(p_items)
    )
  );
  return jsonb_build_object('id', v_transfer.id, 'folio', v_transfer.folio, 'status', v_transfer.status);
end;
$$;

create or replace function public.approve_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_transfer public.transfers;
begin
  if v_actor is null or not (select app.has_perm('transfers.approve')) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = '22023'; end if;
  if v_transfer.status <> 'REQUESTED' then raise exception 'INVALID_TRANSFER_STATE' using errcode = '22023'; end if;
  if not ((select app.can_access_location(v_transfer.from_location_id)) or (select app.can_access_location(v_transfer.to_location_id)) or (select app.has_perm('locations.manage'))) then raise exception 'LOCATION_FORBIDDEN' using errcode = '42501'; end if;
  perform set_config('app.inventory_document_write', 'on', true);
  update public.transfers set status = 'APPROVED', approved_by = v_actor,
    approved_at = now(), updated_at = now() where id = p_transfer_id;
  perform set_config('app.inventory_document_write', 'off', true);
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, before_data, after_data)
  values (v_actor, 'transfer.approved', 'transfer', p_transfer_id::text, v_transfer.from_location_id,
    jsonb_build_object('status', 'REQUESTED'), jsonb_build_object('status', 'APPROVED'));
  return jsonb_build_object('status', 'APPROVED');
end;
$$;

create or replace function public.prepare_transfer(p_transfer_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_transfer public.transfers;
begin
  if v_actor is null or not (select app.has_perm('transfers.create')) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_TRANSFER_ITEMS' using errcode = '22023'; end if;
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = '22023'; end if;
  if v_transfer.status <> 'APPROVED' then raise exception 'INVALID_TRANSFER_STATE' using errcode = '22023'; end if;
  if not (select app.can_access_location(v_transfer.from_location_id)) then raise exception 'LOCATION_FORBIDDEN' using errcode = '42501'; end if;
  if (select count(*) from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)) <>
     (select count(*) from public.transfer_items where transfer_id = p_transfer_id)
     or (select count(*) from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)) <>
        (select count(distinct x.variant_id) from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric))
     or exists (
       select 1 from public.transfer_items ti
       left join jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)
         on x.variant_id = ti.variant_id
       where ti.transfer_id = p_transfer_id
         and (x.variant_id is null or x.qty is null or x.qty <= 0 or x.qty > ti.qty_requested)
     ) then
    raise exception 'INVALID_TRANSFER_ITEMS' using errcode = '22023';
  end if;
  perform set_config('app.inventory_document_write', 'on', true);
  update public.transfer_items ti set qty_sent = x.qty
  from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)
  where ti.transfer_id = p_transfer_id and ti.variant_id = x.variant_id;
  update public.transfers set status = 'PREPARED', prepared_by = v_actor,
    prepared_at = now(), updated_at = now() where id = p_transfer_id;
  perform set_config('app.inventory_document_write', 'off', true);
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, before_data, after_data)
  values (v_actor, 'transfer.prepared', 'transfer', p_transfer_id::text, v_transfer.from_location_id,
    jsonb_build_object('status', 'APPROVED'), jsonb_build_object('status', 'PREPARED', 'items', p_items));
  return jsonb_build_object('status', 'PREPARED');
end;
$$;

create or replace function public.dispatch_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_transfer public.transfers;
  v_transit_id uuid;
  v_item record;
begin
  if v_actor is null or not (select app.has_perm('transfers.create')) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = '22023'; end if;
  if v_transfer.status <> 'PREPARED' then raise exception 'INVALID_TRANSFER_STATE' using errcode = '22023'; end if;
  if not (select app.can_access_location(v_transfer.from_location_id)) then raise exception 'LOCATION_FORBIDDEN' using errcode = '42501'; end if;
  select id into v_transit_id from public.locations where type = 'TRANSIT' and is_active order by created_at limit 1;
  if v_transit_id is null then raise exception 'TRANSIT_LOCATION_NOT_FOUND' using errcode = '22023'; end if;

  for v_item in select * from public.transfer_items where transfer_id = p_transfer_id order by variant_id loop
    perform app.lock_transfer_variant(v_item.variant_id, v_transfer.from_location_id, v_transfer.to_location_id);
    perform app.apply_movement(v_item.variant_id, v_transfer.from_location_id, 'TRANSFER_OUT', -v_item.qty_sent, 'TRANSFER', p_transfer_id::text, jsonb_build_object('stage', 'DISPATCH'));
    perform app.apply_movement(v_item.variant_id, v_transit_id, 'TRANSFER_IN', v_item.qty_sent, 'TRANSFER', p_transfer_id::text, jsonb_build_object('stage', 'DISPATCH', 'from_location_id', v_transfer.from_location_id, 'to_location_id', v_transfer.to_location_id));
  end loop;
  perform set_config('app.inventory_document_write', 'on', true);
  update public.transfers set status = 'IN_TRANSIT', sent_by = v_actor,
    sent_at = now(), updated_at = now() where id = p_transfer_id;
  perform set_config('app.inventory_document_write', 'off', true);
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, before_data, after_data)
  values (v_actor, 'transfer.dispatched', 'transfer', p_transfer_id::text, v_transfer.from_location_id,
    jsonb_build_object('status', 'PREPARED'), jsonb_build_object('status', 'IN_TRANSIT', 'transit_location_id', v_transit_id));
  return jsonb_build_object('status', 'IN_TRANSIT');
end;
$$;

create or replace function public.receive_transfer(p_transfer_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_transfer public.transfers;
  v_transit_id uuid;
  v_item record;
  v_remaining numeric(12,3) := 0;
begin
  if v_actor is null or not (select app.has_perm('transfers.receive')) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_TRANSFER_ITEMS' using errcode = '22023'; end if;
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = '22023'; end if;
  if v_transfer.status <> 'IN_TRANSIT' then raise exception 'INVALID_TRANSFER_STATE' using errcode = '22023'; end if;
  if v_transfer.approved_by = v_actor then raise exception 'SEPARATION_OF_DUTIES' using errcode = '42501'; end if;
  if not (select app.can_access_location(v_transfer.to_location_id)) then raise exception 'LOCATION_FORBIDDEN' using errcode = '42501'; end if;
  if (select count(*) from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)) <>
     (select count(*) from public.transfer_items where transfer_id = p_transfer_id)
     or (select count(*) from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)) <>
        (select count(distinct x.variant_id) from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric))
     or exists (
       select 1 from public.transfer_items ti
       left join jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)
         on x.variant_id = ti.variant_id
       where ti.transfer_id = p_transfer_id
         and (x.variant_id is null or x.qty is null or x.qty < 0 or x.qty > ti.qty_sent)
     ) then raise exception 'INVALID_TRANSFER_ITEMS' using errcode = '22023'; end if;
  select id into v_transit_id from public.locations where type = 'TRANSIT' and is_active order by created_at limit 1;
  if v_transit_id is null then raise exception 'TRANSIT_LOCATION_NOT_FOUND' using errcode = '22023'; end if;

  for v_item in
    select ti.variant_id, ti.qty_sent, x.qty as qty_received
    from public.transfer_items ti
    join jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric) on x.variant_id = ti.variant_id
    where ti.transfer_id = p_transfer_id order by ti.variant_id
  loop
    perform app.lock_transfer_variant(v_item.variant_id, v_transfer.from_location_id, v_transfer.to_location_id);
    if v_item.qty_received > 0 then
      perform app.apply_movement(v_item.variant_id, v_transit_id, 'TRANSFER_OUT', -v_item.qty_received, 'TRANSFER_RECEIPT', p_transfer_id::text, jsonb_build_object('stage', 'RECEIPT'));
      perform app.apply_movement(v_item.variant_id, v_transfer.to_location_id, 'TRANSFER_IN', v_item.qty_received, 'TRANSFER_RECEIPT', p_transfer_id::text, jsonb_build_object('stage', 'RECEIPT'));
    end if;
    v_remaining := v_remaining + (v_item.qty_sent - v_item.qty_received);
  end loop;
  perform set_config('app.inventory_document_write', 'on', true);
  update public.transfer_items ti set qty_received = x.qty
  from jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)
  where ti.transfer_id = p_transfer_id and ti.variant_id = x.variant_id;
  update public.transfers set status = 'RECEIVED', received_by = v_actor,
    received_at = now(), updated_at = now() where id = p_transfer_id;
  perform set_config('app.inventory_document_write', 'off', true);
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, before_data, after_data)
  values (v_actor, 'transfer.received', 'transfer', p_transfer_id::text, v_transfer.to_location_id,
    jsonb_build_object('status', 'IN_TRANSIT'), jsonb_build_object('status', 'RECEIVED', 'items', p_items, 'remaining_in_transit', v_remaining));
  return jsonb_build_object('status', 'RECEIVED', 'remaining_in_transit', v_remaining);
end;
$$;

create or replace function public.cancel_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_transfer public.transfers;
begin
  if v_actor is null or not ((select app.has_perm('transfers.create')) or (select app.has_perm('transfers.approve'))) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = '22023'; end if;
  if v_transfer.status not in ('REQUESTED', 'APPROVED', 'PREPARED') then raise exception 'TRANSFER_NOT_CANCELLABLE' using errcode = '22023'; end if;
  if not ((select app.can_access_location(v_transfer.from_location_id)) or (select app.can_access_location(v_transfer.to_location_id))) then raise exception 'LOCATION_FORBIDDEN' using errcode = '42501'; end if;
  perform set_config('app.inventory_document_write', 'on', true);
  update public.transfers set status = 'CANCELLED', cancelled_by = v_actor,
    cancelled_at = now(), updated_at = now() where id = p_transfer_id;
  perform set_config('app.inventory_document_write', 'off', true);
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, before_data, after_data)
  values (v_actor, 'transfer.cancelled', 'transfer', p_transfer_id::text, v_transfer.from_location_id,
    jsonb_build_object('status', v_transfer.status), jsonb_build_object('status', 'CANCELLED'));
  return jsonb_build_object('status', 'CANCELLED');
end;
$$;

create or replace function public.list_transfer_locations()
returns table (id uuid, code text, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select app.current_user_id()) is null
     or not ((select app.has_perm('transfers.create')) or (select app.has_perm('transfers.receive'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return query
  select l.id, l.code, l.name from public.locations l
  where l.is_active and l.type <> 'TRANSIT'
  order by l.name, l.code;
end;
$$;

-- Las RPC de traspaso son las únicas que pueden usar tipos TRANSFER_*.
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
  if v_user is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if p_variant_id is null or p_location_id is null or p_qty is null or p_qty = 0
     or abs(p_qty) > 999999999.999 or p_type not in ('INITIAL_IMPORT','SALE','RETURN','PURCHASE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT','CANCELLATION','COUNT')
     or nullif(btrim(coalesce(p_reference_type, '')), '') is null or length(btrim(p_reference_type)) > 80
     or nullif(btrim(coalesce(p_reference_id, '')), '') is null or length(btrim(p_reference_id)) > 160
     or p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or pg_column_size(p_metadata) > 8192 then
    raise exception 'INVALID_MOVEMENT' using errcode = '22023';
  end if;
  if (p_type in ('SALE','TRANSFER_OUT') and p_qty > 0) or (p_type in ('RETURN','PURCHASE','TRANSFER_IN','CANCELLATION') and p_qty < 0) then raise exception 'INVALID_MOVEMENT_SIGN' using errcode = '22023'; end if;
  select type into v_location_type from public.locations where id = p_location_id and is_active;
  if not found then raise exception 'LOCATION_NOT_FOUND' using errcode = '22023'; end if;
  if v_location_type = 'TRANSIT' then
    if p_type not in ('TRANSFER_OUT','TRANSFER_IN') then raise exception 'TRANSIT_LOCATION_FORBIDDEN' using errcode = '42501'; end if;
  elsif not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  v_permission := case p_type when 'SALE' then 'pos.sell' when 'RETURN' then 'returns.create' when 'CANCELLATION' then 'sales.cancel' when 'PURCHASE' then 'purchases.receive' when 'COUNT' then 'inventory.count' when 'ADJUSTMENT' then 'inventory.adjust' when 'INITIAL_IMPORT' then 'inventory.adjust' end;
  if p_type in ('TRANSFER_OUT','TRANSFER_IN') then
    if not ((select app.has_perm('transfers.create')) or (select app.has_perm('transfers.receive'))) then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  elsif v_permission is null or not (select app.has_perm(v_permission)) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  perform set_config('app.inventory_write', 'on', true);
  insert into public.inventory_by_location (variant_id, location_id) values (p_variant_id, p_location_id) on conflict do nothing;
  update public.inventory_by_location set qty = qty + p_qty, updated_at = now()
  where variant_id = p_variant_id and location_id = p_location_id and qty + p_qty >= reserved_qty
  returning qty - p_qty, qty into v_prev, v_new;
  if not found then raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001'; end if;
  insert into public.inventory_movements (variant_id, location_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, metadata)
  values (p_variant_id, p_location_id, p_type, p_qty, v_prev, v_new, btrim(p_reference_type), btrim(p_reference_id), v_user, p_metadata)
  returning id into v_id;
  perform set_config('app.inventory_write', 'off', true);
  return v_id;
end;
$$;

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_items enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_items enable row level security;

create policy inventory_counts_select on public.inventory_counts for select to authenticated using (
  (select app.has_perm('inventory.read')) and ((select app.can_access_location(location_id)) or (select app.has_perm('locations.manage')))
);
create policy inventory_count_items_select on public.inventory_count_items for select to authenticated using (
  exists (select 1 from public.inventory_counts c where c.id = count_id)
);
create policy transfers_select on public.transfers for select to authenticated using (
  (select app.has_perm('inventory.read')) and (
    (select app.can_access_location(from_location_id)) or (select app.can_access_location(to_location_id)) or (select app.has_perm('locations.manage'))
  )
);
create policy transfer_items_select on public.transfer_items for select to authenticated using (
  exists (select 1 from public.transfers t where t.id = transfer_id)
);

revoke all on public.inventory_counts, public.inventory_count_items, public.transfers, public.transfer_items from public, anon, authenticated, service_role;
revoke all on sequence public.inventory_counts_folio_seq, public.transfers_folio_seq from public, anon, authenticated, service_role;
grant select on public.inventory_counts, public.inventory_count_items, public.transfers, public.transfer_items to authenticated, service_role;

revoke execute on function app.guard_inventory_document_write() from public, anon, authenticated, service_role;
revoke execute on function app.lock_transfer_variant(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.create_inventory_count(uuid, jsonb) from public, anon;
revoke execute on function public.record_inventory_count_item(uuid, uuid, numeric) from public, anon;
revoke execute on function public.close_inventory_count(uuid) from public, anon;
revoke execute on function public.cancel_inventory_count(uuid) from public, anon;
revoke execute on function public.create_transfer(uuid, uuid, jsonb, text) from public, anon;
revoke execute on function public.approve_transfer(uuid) from public, anon;
revoke execute on function public.prepare_transfer(uuid, jsonb) from public, anon;
revoke execute on function public.dispatch_transfer(uuid) from public, anon;
revoke execute on function public.receive_transfer(uuid, jsonb) from public, anon;
revoke execute on function public.cancel_transfer(uuid) from public, anon;
revoke execute on function public.list_transfer_locations() from public, anon;
grant execute on function public.create_inventory_count(uuid, jsonb), public.record_inventory_count_item(uuid, uuid, numeric), public.close_inventory_count(uuid), public.cancel_inventory_count(uuid), public.create_transfer(uuid, uuid, jsonb, text), public.approve_transfer(uuid), public.prepare_transfer(uuid, jsonb), public.dispatch_transfer(uuid), public.receive_transfer(uuid, jsonb), public.cancel_transfer(uuid), public.list_transfer_locations() to authenticated;

comment on table public.inventory_counts is 'Sesiones de conteo físico; el saldo del sistema se captura al cerrar.';
comment on table public.transfers is 'Documento auditable de traspaso entre ubicaciones con tránsito explícito.';
comment on function public.receive_transfer(uuid, jsonb) is 'Recibe sólo lo contado; cualquier diferencia permanece visible en TRANSITO.';

commit;
