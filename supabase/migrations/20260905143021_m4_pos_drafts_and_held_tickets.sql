begin;

-- El catalogo actual se vende por PIEZA. Hasta que exista una unidad de
-- medida fraccionaria explicita, la base tambien rechaza cantidades .001
-- aunque alguien intente saltarse la interfaz.
alter table public.inventory_by_location
  add constraint inventory_piece_quantities_integer check (
    qty = trunc(qty) and reserved_qty = trunc(reserved_qty)
  );
alter table public.inventory_movements
  add constraint inventory_movement_piece_quantities_integer check (
    quantity = trunc(quantity)
    and previous_qty = trunc(previous_qty)
    and new_qty = trunc(new_qty)
  ) not valid;
alter table public.inventory_count_items
  add constraint inventory_count_piece_quantities_integer check (
    counted_qty = trunc(counted_qty)
    and (system_qty is null or system_qty = trunc(system_qty))
    and (difference is null or difference = trunc(difference))
  );
alter table public.transfer_items
  add constraint transfer_piece_quantities_integer check (
    qty_requested = trunc(qty_requested)
    and (qty_sent is null or qty_sent = trunc(qty_sent))
    and (qty_received is null or qty_received = trunc(qty_received))
  );

-- Un carrito no cobrado es estado operativo, no una venta. Se conserva por
-- usuario, caja y sesion abierta sin tocar inventario ni caja.
create table public.pos_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions(id),
  register_id uuid not null references public.cash_registers(id),
  location_id uuid not null references public.locations(id),
  cashier_user_id uuid not null references public.app_users(id),
  status text not null check (status in ('CURRENT', 'HELD')),
  label text check (label is null or length(btrim(label)) between 1 and 80),
  customer_id uuid references public.customers(id),
  items jsonb not null check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 100
    and pg_column_size(items) <= 65536
  ),
  discount_percent numeric(5,2) not null default 0
    check (discount_percent between 0 and 100),
  held_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_drafts_status_complete check (
    (status = 'CURRENT' and label is null and held_at is null)
    or
    (status = 'HELD' and label is not null and held_at is not null)
  )
);

create unique index pos_drafts_one_current_per_session_idx
  on public.pos_drafts (cash_session_id, cashier_user_id)
  where status = 'CURRENT';
create index pos_drafts_cashier_session_updated_idx
  on public.pos_drafts (cashier_user_id, cash_session_id, updated_at desc);
create index pos_drafts_customer_idx
  on public.pos_drafts (customer_id) where customer_id is not null;
create index pos_drafts_location_idx
  on public.pos_drafts (location_id);
create index pos_drafts_register_idx
  on public.pos_drafts (register_id);

alter table public.pos_drafts enable row level security;
revoke all on public.pos_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.pos_drafts to service_role;

create or replace function app.assert_pos_draft_items(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_variant_id uuid;
  v_quantity numeric;
begin
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 100
     or pg_column_size(p_items) > 65536 then
    raise exception 'INVALID_DRAFT_ITEMS' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by item->>'variant_id'
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_DRAFT_VARIANT' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_variant_id := (v_item->>'variant_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
    exception when others then
      raise exception 'INVALID_DRAFT_ITEM' using errcode = '22023';
    end;

    if jsonb_typeof(v_item) <> 'object'
       or v_quantity <> trunc(v_quantity)
       or v_quantity not between 1 and 999
       or jsonb_typeof(v_item->'gift_receipt') <> 'boolean'
       or not exists (
         select 1
         from public.variants v
         join public.products p on p.id = v.product_id
         where v.id = v_variant_id and v.is_active and p.is_active
       ) then
      raise exception 'INVALID_DRAFT_ITEM' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function app.assert_owned_open_cash_session(
  p_cash_session_id uuid,
  p_actor uuid
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.cash_sessions;
begin
  select * into v_session
  from public.cash_sessions
  where id = p_cash_session_id
    and cashier_user_id = p_actor
    and status = 'OPEN'
  for update;

  if not found or not (select app.can_access_location(v_session.location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;
  return v_session;
end;
$$;

create or replace function public.save_pos_current_draft(
  p_cash_session_id uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_discount_percent numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_session public.cash_sessions;
  v_id uuid;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_session := app.assert_owned_open_cash_session(p_cash_session_id, v_actor);

  if p_items is null or p_items = '[]'::jsonb then
    delete from public.pos_drafts
    where cash_session_id = v_session.id
      and cashier_user_id = v_actor
      and status = 'CURRENT';
    return null;
  end if;

  perform app.assert_pos_draft_items(p_items);
  if coalesce(p_discount_percent, 0) not between 0 and 100 then
    raise exception 'INVALID_DRAFT_DISCOUNT' using errcode = '22023';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers
    where id = p_customer_id and not is_anonymized
  ) then
    raise exception 'INVALID_DRAFT_CUSTOMER' using errcode = '22023';
  end if;

  insert into public.pos_drafts (
    cash_session_id, register_id, location_id, cashier_user_id, status,
    customer_id, items, discount_percent
  ) values (
    v_session.id, v_session.register_id, v_session.location_id, v_actor,
    'CURRENT', p_customer_id, p_items, coalesce(p_discount_percent, 0)
  )
  on conflict (cash_session_id, cashier_user_id) where status = 'CURRENT'
  do update set
    customer_id = excluded.customer_id,
    items = excluded.items,
    discount_percent = excluded.discount_percent,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.hold_pos_draft(
  p_cash_session_id uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_discount_percent numeric default 0,
  p_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_session public.cash_sessions;
  v_id uuid;
  v_label text := coalesce(nullif(btrim(coalesce(p_label, '')), ''), 'Ticket en espera');
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(v_label) > 80 then
    raise exception 'INVALID_DRAFT_LABEL' using errcode = '22023';
  end if;
  v_session := app.assert_owned_open_cash_session(p_cash_session_id, v_actor);
  perform app.assert_pos_draft_items(p_items);
  if coalesce(p_discount_percent, 0) not between 0 and 100 then
    raise exception 'INVALID_DRAFT_DISCOUNT' using errcode = '22023';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers
    where id = p_customer_id and not is_anonymized
  ) then
    raise exception 'INVALID_DRAFT_CUSTOMER' using errcode = '22023';
  end if;

  insert into public.pos_drafts (
    cash_session_id, register_id, location_id, cashier_user_id, status,
    label, customer_id, items, discount_percent, held_at
  ) values (
    v_session.id, v_session.register_id, v_session.location_id, v_actor,
    'HELD', v_label, p_customer_id, p_items, coalesce(p_discount_percent, 0), now()
  ) returning id into v_id;

  delete from public.pos_drafts
  where cash_session_id = v_session.id
    and cashier_user_id = v_actor
    and status = 'CURRENT';

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    v_actor, 'pos_draft.held', 'pos_drafts', v_id::text, v_session.location_id,
    jsonb_build_object('item_count', jsonb_array_length(p_items), 'label', v_label)
  );
  return v_id;
end;
$$;

create or replace function public.list_my_pos_drafts(p_cash_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_session public.cash_sessions;
  v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_session := app.assert_owned_open_cash_session(p_cash_session_id, v_actor);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'status', d.status,
    'label', d.label,
    'items', d.items,
    'discount_percent', d.discount_percent,
    'held_at', d.held_at,
    'updated_at', d.updated_at,
    'customer', case when c.id is null then null else jsonb_build_object(
      'id', c.id,
      'member_number', c.member_number,
      'full_name', c.full_name,
      'phone_e164', c.phone_e164,
      'email', c.email
    ) end
  ) order by case when d.status = 'CURRENT' then 0 else 1 end, d.updated_at desc), '[]'::jsonb)
  into v_result
  from public.pos_drafts d
  left join public.customers c on c.id = d.customer_id and not c.is_anonymized
  where d.cash_session_id = v_session.id
    and d.cashier_user_id = v_actor;
  return v_result;
end;
$$;

create or replace function public.resume_pos_draft(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_draft public.pos_drafts;
  v_session public.cash_sessions;
  v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_draft from public.pos_drafts
  where id = p_draft_id and cashier_user_id = v_actor and status = 'HELD'
  for update;
  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_session := app.assert_owned_open_cash_session(v_draft.cash_session_id, v_actor);

  if exists (
    select 1
    from jsonb_array_elements(v_draft.items) item
    left join public.variants v on v.id = (item->>'variant_id')::uuid
    left join public.products p on p.id = v.product_id
    where v.id is null or not v.is_active or p.id is null or not p.is_active
  ) then
    raise exception 'DRAFT_ITEMS_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.pos_drafts
    where cash_session_id = v_session.id
      and cashier_user_id = v_actor
      and status = 'CURRENT'
  ) then
    raise exception 'CURRENT_DRAFT_NOT_EMPTY' using errcode = '23505';
  end if;

  update public.pos_drafts
  set status = 'CURRENT', label = null, held_at = null, updated_at = now()
  where id = v_draft.id;

  select jsonb_build_object(
    'id', d.id,
    'status', d.status,
    'items', d.items,
    'discount_percent', d.discount_percent,
    'customer', case when c.id is null then null else jsonb_build_object(
      'id', c.id,
      'member_number', c.member_number,
      'full_name', c.full_name,
      'phone_e164', c.phone_e164,
      'email', c.email
    ) end
  ) into v_result
  from public.pos_drafts d
  left join public.customers c on c.id = d.customer_id and not c.is_anonymized
  where d.id = v_draft.id;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    v_actor, 'pos_draft.resumed', 'pos_drafts', v_draft.id::text,
    v_session.location_id,
    jsonb_build_object('item_count', jsonb_array_length(v_draft.items))
  );
  return v_result;
end;
$$;

create or replace function public.discard_pos_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_draft public.pos_drafts;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_draft from public.pos_drafts
  where id = p_draft_id and cashier_user_id = v_actor
  for update;
  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform app.assert_owned_open_cash_session(v_draft.cash_session_id, v_actor);
  delete from public.pos_drafts where id = v_draft.id;
  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    v_actor, 'pos_draft.discarded', 'pos_drafts', v_draft.id::text,
    v_draft.location_id,
    jsonb_build_object('status', v_draft.status, 'item_count', jsonb_array_length(v_draft.items))
  );
end;
$$;

create or replace function app.consume_current_pos_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.pos_drafts
  where cash_session_id = new.cash_session_id
    and cashier_user_id = new.cashier_user_id
    and status = 'CURRENT';
  return new;
end;
$$;

create trigger sales_consume_current_pos_draft
after insert on public.sales
for each row execute function app.consume_current_pos_draft();

create or replace function app.clear_closed_session_pos_drafts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'OPEN' and new.status = 'CLOSED' then
    delete from public.pos_drafts where cash_session_id = new.id;
  end if;
  return new;
end;
$$;

create trigger cash_session_clear_pos_drafts
after update of status on public.cash_sessions
for each row execute function app.clear_closed_session_pos_drafts();

revoke execute on function app.assert_pos_draft_items(jsonb) from public, anon, authenticated;
revoke execute on function app.assert_owned_open_cash_session(uuid, uuid) from public, anon, authenticated;
revoke execute on function app.consume_current_pos_draft() from public, anon, authenticated;
revoke execute on function app.clear_closed_session_pos_drafts() from public, anon, authenticated;

revoke execute on function public.save_pos_current_draft(uuid, jsonb, uuid, numeric) from public, anon;
revoke execute on function public.hold_pos_draft(uuid, jsonb, uuid, numeric, text) from public, anon;
revoke execute on function public.list_my_pos_drafts(uuid) from public, anon;
revoke execute on function public.resume_pos_draft(uuid) from public, anon;
revoke execute on function public.discard_pos_draft(uuid) from public, anon;
grant execute on function public.save_pos_current_draft(uuid, jsonb, uuid, numeric) to authenticated, service_role;
grant execute on function public.hold_pos_draft(uuid, jsonb, uuid, numeric, text) to authenticated, service_role;
grant execute on function public.list_my_pos_drafts(uuid) to authenticated, service_role;
grant execute on function public.resume_pos_draft(uuid) to authenticated, service_role;
grant execute on function public.discard_pos_draft(uuid) to authenticated, service_role;

commit;
