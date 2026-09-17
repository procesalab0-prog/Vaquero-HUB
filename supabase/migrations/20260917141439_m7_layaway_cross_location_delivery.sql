begin;

-- M7.3 · Entrega en otra sucursal. Un apartado sólo cambia de tienda por un
-- traspaso real: solicitud, aprobación, preparación, tránsito y recepción.
create table public.layaway_delivery_transfers (
  id uuid primary key default extensions.gen_random_uuid(),
  layaway_id uuid not null references public.layaways(id),
  transfer_id uuid not null unique references public.transfers(id),
  from_location_id uuid not null references public.locations(id),
  to_location_id uuid not null references public.locations(id),
  requested_by uuid not null references public.app_users(id),
  requested_at timestamptz not null default now(),
  check (from_location_id <> to_location_id)
);

create index layaway_delivery_transfers_layaway_idx
  on public.layaway_delivery_transfers(layaway_id, requested_at desc);
create index layaway_delivery_transfers_destination_idx
  on public.layaway_delivery_transfers(to_location_id, requested_at desc);
create index layaway_delivery_transfers_origin_idx
  on public.layaway_delivery_transfers(from_location_id, requested_at desc);
create index layaway_delivery_transfers_requester_idx
  on public.layaway_delivery_transfers(requested_by, requested_at desc);

create trigger layaway_delivery_transfers_guard
before insert or update or delete on public.layaway_delivery_transfers
for each row execute function app.guard_layaway_write();

-- Mientras exista un traspaso operativo, ninguna función puede cancelar,
-- sustituir, cobrar o entregar el apartado desde la ubicación anterior.
create function app.guard_layaway_active_transfer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.layaway_transfer_write', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if exists (
    select 1
    from public.layaway_delivery_transfers ldt
    join public.transfers t on t.id = ldt.transfer_id
    where ldt.layaway_id = old.id
      and t.status in ('REQUESTED', 'APPROVED', 'PREPARED', 'IN_TRANSIT')
  ) then
    raise exception 'LAYAWAY_TRANSFER_ACTIVE' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger layaways_active_transfer_guard
before update or delete on public.layaways
for each row execute function app.guard_layaway_active_transfer();

-- Mueve únicamente la reserva. El movimiento físico se registra por las RPC
-- de traspasos existentes; ambos libros confirman o revierten juntos.
create function app.adjust_layaway_transfer_reservation(
  p_variant_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_transfer_id uuid,
  p_layaway_id uuid,
  p_actor uuid,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous numeric(12,3);
  v_new numeric(12,3);
begin
  if p_variant_id is null or p_location_id is null or p_transfer_id is null
     or p_layaway_id is null or p_actor is null or p_quantity = 0
     or p_quantity <> trunc(p_quantity)
     or p_stage not in ('DISPATCH_RELEASE', 'DISPATCH_RESERVE',
                        'RECEIPT_RELEASE', 'RECEIPT_RESERVE') then
    raise exception 'INVALID_LAYAWAY_TRANSFER_RESERVATION'
      using errcode = '22023';
  end if;

  perform set_config('app.inventory_write', 'on', true);
  update public.inventory_by_location
  set reserved_qty = reserved_qty + p_quantity,
      updated_at = now()
  where variant_id = p_variant_id
    and location_id = p_location_id
    and reserved_qty + p_quantity >= 0
    and reserved_qty + p_quantity <= qty
  returning reserved_qty - p_quantity, reserved_qty
  into v_previous, v_new;
  perform set_config('app.inventory_write', 'off', true);
  if not found then
    raise exception 'RESERVATION_BALANCE_MISMATCH' using errcode = '23514';
  end if;

  perform set_config('app.layaway_write', 'on', true);
  insert into public.inventory_reservation_movements(
    variant_id, location_id, movement_type, quantity,
    previous_reserved_qty, new_reserved_qty, reference_type,
    reference_id, operation_key, user_id, metadata
  ) values (
    p_variant_id, p_location_id,
    case when p_quantity > 0 then 'RESERVE' else 'RELEASE' end,
    p_quantity, v_previous, v_new, 'LAYAWAY_TRANSFER',
    p_transfer_id::text, extensions.gen_random_uuid(), p_actor,
    jsonb_build_object('layaway_id', p_layaway_id, 'stage', p_stage)
  );
  perform set_config('app.layaway_write', 'off', true);
end;
$$;

create function public.request_layaway_delivery_transfer(
  p_layaway_id uuid,
  p_to_location_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_layaway public.layaways;
  v_transfer public.transfers;
begin
  if v_actor is null or not (select app.has_perm('layaways.deliver'))
     or not (select app.has_perm('transfers.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_layaway_id is null or p_to_location_id is null
     or length(coalesce(p_note, '')) > 500 then
    raise exception 'INVALID_LAYAWAY_TRANSFER' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('layaway:' || p_layaway_id::text, 0)
  );
  select * into v_layaway
  from public.layaways
  where id = p_layaway_id
  for update;
  if not found or not (select app.can_access_location(v_layaway.location_id)) then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_layaway.status <> 'PAID' or v_layaway.balance_cents <> 0 then
    raise exception 'LAYAWAY_NOT_READY' using errcode = '23514';
  end if;
  if v_layaway.location_id = p_to_location_id then
    raise exception 'LAYAWAY_ALREADY_AT_LOCATION' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.locations
    where id = p_to_location_id and is_active and type <> 'TRANSIT'
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.layaway_delivery_transfers ldt
    join public.transfers t on t.id = ldt.transfer_id
    where ldt.layaway_id = v_layaway.id and t.status <> 'CANCELLED'
  ) then
    raise exception 'LAYAWAY_TRANSFER_ALREADY_EXISTS' using errcode = '23505';
  end if;

  perform set_config('app.inventory_document_write', 'on', true);
  insert into public.transfers(
    from_location_id, to_location_id, note, requested_by
  ) values (
    v_layaway.location_id, p_to_location_id,
    left(
      'Apartado ' || v_layaway.folio ||
      case when nullif(btrim(coalesce(p_note, '')), '') is null then ''
           else ' · ' || btrim(p_note) end,
      500
    ),
    v_actor
  ) returning * into v_transfer;
  insert into public.transfer_items(transfer_id, variant_id, qty_requested)
  select v_transfer.id, li.variant_id, li.quantity
  from public.layaway_items li
  where li.layaway_id = v_layaway.id
  order by li.variant_id;
  perform set_config('app.inventory_document_write', 'off', true);

  perform set_config('app.layaway_write', 'on', true);
  insert into public.layaway_delivery_transfers(
    layaway_id, transfer_id, from_location_id, to_location_id, requested_by
  ) values (
    v_layaway.id, v_transfer.id, v_layaway.location_id,
    p_to_location_id, v_actor
  );
  perform set_config('app.layaway_write', 'off', true);

  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'layaway.delivery_transfer_requested', 'layaways',
    v_layaway.id::text, v_layaway.location_id,
    jsonb_build_object('location_id', v_layaway.location_id),
    jsonb_build_object('delivery_location_id', p_to_location_id,
      'transfer_id', v_transfer.id, 'transfer_folio', v_transfer.folio),
    jsonb_build_object('layaway_folio', v_layaway.folio)
  );
  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id, after_data
  ) values (
    v_actor, 'transfer.requested', 'transfer', v_transfer.id::text,
    v_layaway.location_id,
    jsonb_build_object('folio', v_transfer.folio,
      'to_location_id', p_to_location_id,
      'layaway_id', v_layaway.id,
      'item_count', (select count(*) from public.layaway_items
        where layaway_id = v_layaway.id))
  );

  return jsonb_build_object('id', v_transfer.id, 'folio', v_transfer.folio,
    'status', v_transfer.status, 'layaway_id', v_layaway.id);
end;
$$;

create function public.list_layaway_delivery_transfers(p_layaway_ids uuid[])
returns table(
  layaway_id uuid,
  transfer_id uuid,
  transfer_folio bigint,
  transfer_status text,
  from_location_id uuid,
  from_location_name text,
  to_location_id uuid,
  to_location_name text,
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select app.current_user_id()) is null
     or not (select app.has_perm('layaways.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_layaway_ids is null or cardinality(p_layaway_ids) > 100 then
    raise exception 'INVALID_LAYAWAY_TRANSFER_FILTER' using errcode = '22023';
  end if;
  return query
  select distinct on (ldt.layaway_id)
    ldt.layaway_id, t.id, t.folio, t.status,
    ldt.from_location_id, fl.name, ldt.to_location_id, tl.name,
    ldt.requested_at
  from public.layaway_delivery_transfers ldt
  join public.transfers t on t.id = ldt.transfer_id
  join public.locations fl on fl.id = ldt.from_location_id
  join public.locations tl on tl.id = ldt.to_location_id
  join public.layaways l on l.id = ldt.layaway_id
  where ldt.layaway_id = any(p_layaway_ids)
    and (select app.can_access_location(l.location_id))
  order by ldt.layaway_id, ldt.requested_at desc;
end;
$$;

-- Conservamos la implementación general y ponemos delante una envoltura que
-- aplica las invariantes adicionales sólo a los traspasos de apartados.
alter function public.prepare_transfer(uuid, jsonb)
  rename to prepare_transfer_standard;
alter function public.dispatch_transfer(uuid)
  rename to dispatch_transfer_standard;
alter function public.receive_transfer(uuid, jsonb)
  rename to receive_transfer_standard;
alter function public.fulfill_layaway(uuid, uuid, uuid)
  rename to fulfill_layaway_standard;

revoke execute on function public.prepare_transfer_standard(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.dispatch_transfer_standard(uuid)
  from public, anon, authenticated;
revoke execute on function public.receive_transfer_standard(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.fulfill_layaway_standard(uuid, uuid, uuid)
  from public, anon, authenticated;

create function public.fulfill_layaway(
  p_operation_key uuid,
  p_cash_session_id uuid,
  p_layaway_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.layaway_delivery_transfers ldt
    join public.transfers t on t.id = ldt.transfer_id
    where ldt.layaway_id = p_layaway_id
      and t.status in ('REQUESTED', 'APPROVED', 'PREPARED', 'IN_TRANSIT')
  ) then
    raise exception 'LAYAWAY_TRANSFER_ACTIVE' using errcode = '55000';
  end if;
  return public.fulfill_layaway_standard(
    p_operation_key, p_cash_session_id, p_layaway_id
  );
end;
$$;

create function public.prepare_transfer(p_transfer_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.layaway_delivery_transfers
    where transfer_id = p_transfer_id
  ) and (
    p_items is null or jsonb_typeof(p_items) <> 'array'
    or (select count(*) from jsonb_to_recordset(p_items)
          as x(variant_id uuid, qty numeric)) <>
       (select count(*) from public.transfer_items
          where transfer_id = p_transfer_id)
    or exists (
      select 1
      from public.transfer_items ti
      left join jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)
        on x.variant_id = ti.variant_id
      where ti.transfer_id = p_transfer_id
        and (x.variant_id is null or x.qty <> ti.qty_requested)
    )
  ) then
    raise exception 'LAYAWAY_TRANSFER_REQUIRES_FULL_QUANTITY'
      using errcode = '23514';
  end if;
  return public.prepare_transfer_standard(p_transfer_id, p_items);
end;
$$;

create function public.dispatch_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_transfer public.transfers;
  v_link public.layaway_delivery_transfers;
  v_layaway public.layaways;
  v_transit_id uuid;
  v_item record;
begin
  select * into v_link
  from public.layaway_delivery_transfers
  where transfer_id = p_transfer_id;
  if not found then
    return public.dispatch_transfer_standard(p_transfer_id);
  end if;
  if v_actor is null or not (select app.has_perm('transfers.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into v_transfer from public.transfers
  where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = '22023'; end if;
  if v_transfer.status <> 'PREPARED' then
    raise exception 'INVALID_TRANSFER_STATE' using errcode = '22023';
  end if;
  if not (select app.can_access_location(v_transfer.from_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('layaway:' || v_link.layaway_id::text, 0)
  );
  select * into v_layaway from public.layaways
  where id = v_link.layaway_id for update;
  if not found or v_layaway.status <> 'PAID'
     or v_layaway.location_id <> v_transfer.from_location_id then
    raise exception 'LAYAWAY_NOT_READY' using errcode = '23514';
  end if;
  if (select count(*) from public.transfer_items
        where transfer_id = p_transfer_id) <>
     (select count(*) from public.layaway_items
        where layaway_id = v_layaway.id)
     or exists (
       select 1 from public.layaway_items li
       left join public.transfer_items ti
         on ti.transfer_id = p_transfer_id
        and ti.variant_id = li.variant_id
       where li.layaway_id = v_layaway.id
         and (ti.variant_id is null or ti.qty_sent <> li.quantity)
     ) then
    raise exception 'LAYAWAY_TRANSFER_ITEMS_MISMATCH' using errcode = '23514';
  end if;

  select id into v_transit_id from public.locations
  where type = 'TRANSIT' and is_active order by created_at limit 1;
  if v_transit_id is null then
    raise exception 'TRANSIT_LOCATION_NOT_FOUND' using errcode = '22023';
  end if;

  for v_item in
    select ti.variant_id, ti.qty_sent
    from public.transfer_items ti
    where ti.transfer_id = p_transfer_id
    order by ti.variant_id
  loop
    perform app.lock_transfer_variant(v_item.variant_id,
      v_transfer.from_location_id, v_transfer.to_location_id);
    perform app.adjust_layaway_transfer_reservation(
      v_item.variant_id, v_transfer.from_location_id, -v_item.qty_sent,
      v_transfer.id, v_layaway.id, v_actor, 'DISPATCH_RELEASE'
    );
    perform app.apply_movement(v_item.variant_id,
      v_transfer.from_location_id, 'TRANSFER_OUT', -v_item.qty_sent,
      'LAYAWAY_TRANSFER', p_transfer_id::text,
      jsonb_build_object('stage', 'DISPATCH', 'layaway_id', v_layaway.id));
    perform app.apply_movement(v_item.variant_id,
      v_transit_id, 'TRANSFER_IN', v_item.qty_sent,
      'LAYAWAY_TRANSFER', p_transfer_id::text,
      jsonb_build_object('stage', 'DISPATCH', 'layaway_id', v_layaway.id,
        'from_location_id', v_transfer.from_location_id,
        'to_location_id', v_transfer.to_location_id));
    perform app.adjust_layaway_transfer_reservation(
      v_item.variant_id, v_transit_id, v_item.qty_sent,
      v_transfer.id, v_layaway.id, v_actor, 'DISPATCH_RESERVE'
    );
  end loop;

  perform set_config('app.inventory_document_write', 'on', true);
  update public.transfers
  set status = 'IN_TRANSIT', sent_by = v_actor, sent_at = now(), updated_at = now()
  where id = p_transfer_id;
  perform set_config('app.inventory_document_write', 'off', true);
  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'transfer.dispatched', 'transfer', p_transfer_id::text,
    v_transfer.from_location_id,
    jsonb_build_object('status', 'PREPARED'),
    jsonb_build_object('status', 'IN_TRANSIT',
      'transit_location_id', v_transit_id),
    jsonb_build_object('layaway_id', v_layaway.id,
      'reservation_in_transit', true)
  );
  return jsonb_build_object('status', 'IN_TRANSIT',
    'layaway_id', v_layaway.id);
end;
$$;

create function public.receive_transfer(p_transfer_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_transfer public.transfers;
  v_link public.layaway_delivery_transfers;
  v_layaway public.layaways;
  v_transit_id uuid;
  v_item record;
begin
  select * into v_link
  from public.layaway_delivery_transfers
  where transfer_id = p_transfer_id;
  if not found then
    return public.receive_transfer_standard(p_transfer_id, p_items);
  end if;
  if v_actor is null or not (select app.has_perm('transfers.receive')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_TRANSFER_ITEMS' using errcode = '22023';
  end if;

  select * into v_transfer from public.transfers
  where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = '22023'; end if;
  if v_transfer.status <> 'IN_TRANSIT' then
    raise exception 'INVALID_TRANSFER_STATE' using errcode = '22023';
  end if;
  if v_transfer.approved_by = v_actor or v_transfer.sent_by = v_actor then
    raise exception 'SEPARATION_OF_DUTIES' using errcode = '42501';
  end if;
  if not (select app.can_access_location(v_transfer.to_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if (select count(*) from jsonb_to_recordset(p_items)
        as x(variant_id uuid, qty numeric)) <>
     (select count(*) from public.transfer_items where transfer_id = p_transfer_id)
     or exists (
       select 1 from public.transfer_items ti
       left join jsonb_to_recordset(p_items) as x(variant_id uuid, qty numeric)
         on x.variant_id = ti.variant_id
       where ti.transfer_id = p_transfer_id
         and (x.variant_id is null or x.qty <> ti.qty_sent)
     ) then
    raise exception 'LAYAWAY_TRANSFER_REQUIRES_FULL_RECEIPT'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('layaway:' || v_link.layaway_id::text, 0)
  );
  select * into v_layaway from public.layaways
  where id = v_link.layaway_id for update;
  if not found or v_layaway.status <> 'PAID'
     or v_layaway.location_id <> v_transfer.from_location_id then
    raise exception 'LAYAWAY_NOT_READY' using errcode = '23514';
  end if;
  select id into v_transit_id from public.locations
  where type = 'TRANSIT' and is_active order by created_at limit 1;
  if v_transit_id is null then
    raise exception 'TRANSIT_LOCATION_NOT_FOUND' using errcode = '22023';
  end if;

  for v_item in
    select ti.variant_id, ti.qty_sent
    from public.transfer_items ti
    where ti.transfer_id = p_transfer_id
    order by ti.variant_id
  loop
    perform app.lock_transfer_variant(v_item.variant_id,
      v_transfer.from_location_id, v_transfer.to_location_id);
    perform app.adjust_layaway_transfer_reservation(
      v_item.variant_id, v_transit_id, -v_item.qty_sent,
      v_transfer.id, v_layaway.id, v_actor, 'RECEIPT_RELEASE'
    );
    perform app.apply_movement(v_item.variant_id,
      v_transit_id, 'TRANSFER_OUT', -v_item.qty_sent,
      'LAYAWAY_TRANSFER_RECEIPT', p_transfer_id::text,
      jsonb_build_object('stage', 'RECEIPT', 'layaway_id', v_layaway.id));
    perform app.apply_movement(v_item.variant_id,
      v_transfer.to_location_id, 'TRANSFER_IN', v_item.qty_sent,
      'LAYAWAY_TRANSFER_RECEIPT', p_transfer_id::text,
      jsonb_build_object('stage', 'RECEIPT', 'layaway_id', v_layaway.id));
    perform app.adjust_layaway_transfer_reservation(
      v_item.variant_id, v_transfer.to_location_id, v_item.qty_sent,
      v_transfer.id, v_layaway.id, v_actor, 'RECEIPT_RESERVE'
    );
  end loop;

  perform set_config('app.inventory_document_write', 'on', true);
  update public.transfer_items ti
  set qty_received = ti.qty_sent
  where ti.transfer_id = p_transfer_id;
  update public.transfers
  set status = 'RECEIVED', received_by = v_actor,
      received_at = now(), updated_at = now()
  where id = p_transfer_id;
  perform set_config('app.inventory_document_write', 'off', true);

  perform set_config('app.layaway_write', 'on', true);
  perform set_config('app.layaway_transfer_write', 'on', true);
  update public.layaways
  set location_id = v_transfer.to_location_id, updated_at = now()
  where id = v_layaway.id;
  perform set_config('app.layaway_transfer_write', 'off', true);
  perform set_config('app.layaway_write', 'off', true);

  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'transfer.received', 'transfer', p_transfer_id::text,
    v_transfer.to_location_id,
    jsonb_build_object('status', 'IN_TRANSIT'),
    jsonb_build_object('status', 'RECEIVED', 'remaining_in_transit', 0),
    jsonb_build_object('layaway_id', v_layaway.id,
      'reservation_received', true)
  );
  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'layaway.delivery_location_received', 'layaways',
    v_layaway.id::text, v_transfer.to_location_id,
    jsonb_build_object('location_id', v_transfer.from_location_id),
    jsonb_build_object('location_id', v_transfer.to_location_id,
      'transfer_id', v_transfer.id, 'transfer_folio', v_transfer.folio),
    jsonb_build_object('layaway_folio', v_layaway.folio)
  );
  return jsonb_build_object('status', 'RECEIVED',
    'remaining_in_transit', 0, 'layaway_id', v_layaway.id,
    'delivery_location_id', v_transfer.to_location_id);
end;
$$;

alter table public.layaway_delivery_transfers enable row level security;
create policy layaway_delivery_transfers_rpc_only
on public.layaway_delivery_transfers
for all to authenticated using (false) with check (false);

revoke all on public.layaway_delivery_transfers
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.layaway_delivery_transfers
  to service_role;

revoke execute on function app.guard_layaway_active_transfer()
  from public, anon, authenticated, service_role;
revoke execute on function app.adjust_layaway_transfer_reservation(
  uuid, uuid, numeric, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke execute on function public.request_layaway_delivery_transfer(
  uuid, uuid, text
) from public, anon;
revoke execute on function public.list_layaway_delivery_transfers(uuid[])
  from public, anon;
revoke execute on function public.prepare_transfer(uuid, jsonb)
  from public, anon;
revoke execute on function public.dispatch_transfer(uuid)
  from public, anon;
revoke execute on function public.receive_transfer(uuid, jsonb)
  from public, anon;
revoke execute on function public.fulfill_layaway(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.request_layaway_delivery_transfer(
  uuid, uuid, text
) to authenticated, service_role;
grant execute on function public.list_layaway_delivery_transfers(uuid[])
  to authenticated, service_role;
grant execute on function public.prepare_transfer(uuid, jsonb),
  public.dispatch_transfer(uuid), public.receive_transfer(uuid, jsonb),
  public.fulfill_layaway(uuid, uuid, uuid)
  to authenticated, service_role;

comment on table public.layaway_delivery_transfers is
  'Liga un apartado liquidado con el traspaso físico que lleva su reserva a la sucursal de entrega.';
comment on function public.request_layaway_delivery_transfer(uuid,uuid,text) is
  'Solicita el traspaso completo de un apartado pagado; no mueve existencias antes del despacho.';
comment on function public.receive_transfer(uuid,jsonb) is
  'Para apartados exige recepción completa, mueve existencia y reserva juntas y sólo entonces cambia la sucursal de entrega.';

commit;
