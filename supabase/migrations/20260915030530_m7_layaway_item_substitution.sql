begin;

insert into public.permissions(code, category, description)
values ('layaways.modify', 'Punto de venta', 'Sustituir productos en apartados')
on conflict (code) do update set
  category = excluded.category,
  description = excluded.description;

insert into public.role_permissions(role_id, permission_code)
select r.id, 'layaways.modify'
from public.roles r
where r.code in ('ADMIN', 'MANAGER')
on conflict do nothing;

create table public.layaway_item_substitutions (
  id uuid primary key default extensions.gen_random_uuid(),
  layaway_id uuid not null references public.layaways(id),
  layaway_item_id uuid not null references public.layaway_items(id),
  old_variant_id uuid not null references public.variants(id),
  new_variant_id uuid not null references public.variants(id),
  quantity numeric(12,3) not null
    check (quantity > 0 and quantity = trunc(quantity)),
  old_unit_price_cents bigint not null check (old_unit_price_cents > 0),
  new_unit_price_cents bigint not null check (new_unit_price_cents > 0),
  old_line_total_cents bigint not null check (old_line_total_cents > 0),
  new_line_total_cents bigint not null check (new_line_total_cents > 0),
  old_total_cents bigint not null check (old_total_cents > 0),
  new_total_cents bigint not null check (new_total_cents > 0),
  old_balance_cents bigint not null check (old_balance_cents >= 0),
  new_balance_cents bigint not null check (new_balance_cents >= 0),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  actor_user_id uuid not null references public.app_users(id),
  operation_key uuid not null unique,
  occurred_at timestamptz not null default now(),
  check (old_variant_id <> new_variant_id)
);

create index layaway_substitutions_layaway_date_idx
  on public.layaway_item_substitutions(layaway_id, occurred_at desc, id);

create trigger layaway_item_substitutions_guard
before insert or update or delete on public.layaway_item_substitutions
for each row execute function app.guard_layaway_write();

create function public.list_layaway_items(p_layaway_ids uuid[])
returns table (
  id uuid,
  layaway_id uuid,
  line_number integer,
  variant_id uuid,
  product_name text,
  sku text,
  variant_description text,
  quantity numeric,
  unit_price_cents bigint,
  line_total_cents bigint
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
    raise exception 'INVALID_LAYAWAY_ITEMS_FILTER' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.layaways l
    where l.id = any(p_layaway_ids)
      and not (select app.can_access_location(l.location_id))
  ) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  return query
  select li.id, li.layaway_id, li.line_number, li.variant_id,
    li.product_name, li.sku, li.variant_description, li.quantity,
    li.unit_price_cents, li.line_total_cents
  from public.layaway_items li
  join public.layaways l on l.id = li.layaway_id
  where l.id = any(p_layaway_ids)
  order by li.layaway_id, li.line_number;
end;
$$;

create function public.get_layaway_item(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_location uuid;
begin
  if (select app.current_user_id()) is null
     or not (select app.has_perm('layaways.modify')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select l.location_id into v_location
  from public.layaway_items li
  join public.layaways l on l.id = li.layaway_id
  where li.id = p_item_id;
  if v_location is null or not (select app.can_access_location(v_location)) then
    raise exception 'LAYAWAY_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'id', li.id, 'layaway_id', l.id, 'layaway_folio', l.folio,
    'layaway_status', l.status, 'location_id', l.location_id,
    'variant_id', li.variant_id, 'product_name', li.product_name,
    'sku', li.sku, 'variant_description', li.variant_description,
    'quantity', li.quantity, 'unit_price_cents', li.unit_price_cents,
    'line_total_cents', li.line_total_cents, 'paid_cents', l.paid_cents,
    'balance_cents', l.balance_cents, 'total_cents', l.total_cents
  ) into v_result
  from public.layaway_items li
  join public.layaways l on l.id = li.layaway_id
  where li.id = p_item_id;
  return v_result;
end;
$$;

create function public.substitute_layaway_item(
  p_operation_key uuid,
  p_layaway_id uuid,
  p_layaway_item_id uuid,
  p_expected_variant_id uuid,
  p_new_variant_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_layaway public.layaways;
  v_item public.layaway_items;
  v_variant public.variants;
  v_product public.products;
  v_existing public.layaway_item_substitutions;
  v_substitution public.layaway_item_substitutions;
  v_description text;
  v_new_line_total bigint;
  v_new_subtotal bigint;
  v_new_total bigint;
  v_new_balance bigint;
  v_previous_reserved numeric(12,3);
  v_new_reserved numeric(12,3);
  v_updated integer;
begin
  if v_actor is null or not (select app.has_perm('layaways.modify')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_operation_key is null or p_layaway_id is null
     or p_layaway_item_id is null or p_expected_variant_id is null
     or p_new_variant_id is null or p_expected_variant_id = p_new_variant_id
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'INVALID_LAYAWAY_SUBSTITUTION' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('layaway-substitution:' || p_operation_key::text, 0)
  );
  select * into v_existing
  from public.layaway_item_substitutions
  where operation_key = p_operation_key;
  if found then
    if v_existing.layaway_id <> p_layaway_id
       or v_existing.layaway_item_id <> p_layaway_item_id
       or v_existing.old_variant_id <> p_expected_variant_id
       or v_existing.new_variant_id <> p_new_variant_id then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'id', v_existing.id, 'layaway_id', v_existing.layaway_id,
      'old_variant_id', v_existing.old_variant_id,
      'new_variant_id', v_existing.new_variant_id,
      'old_total_cents', v_existing.old_total_cents,
      'new_total_cents', v_existing.new_total_cents,
      'new_balance_cents', v_existing.new_balance_cents,
      'occurred_at', v_existing.occurred_at
    );
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
  if v_layaway.status not in ('OPEN', 'PARTIALLY_PAID', 'PAID') then
    raise exception 'LAYAWAY_NOT_MODIFIABLE' using errcode = '23514';
  end if;

  select * into v_item
  from public.layaway_items
  where id = p_layaway_item_id and layaway_id = p_layaway_id
  for update;
  if not found then
    raise exception 'LAYAWAY_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_item.variant_id <> p_expected_variant_id then
    raise exception 'LAYAWAY_ITEM_CHANGED' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.layaway_items
    where layaway_id = p_layaway_id
      and variant_id = p_new_variant_id
      and id <> p_layaway_item_id
  ) then
    raise exception 'LAYAWAY_DUPLICATE_VARIANT' using errcode = '23505';
  end if;

  select * into v_variant
  from public.variants
  where id = p_new_variant_id and is_active
  for share;
  if not found then
    raise exception 'VARIANT_NOT_FOUND' using errcode = '22023';
  end if;
  select * into v_product
  from public.products
  where id = v_variant.product_id and is_active;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = '22023';
  end if;

  v_new_line_total := round(v_item.quantity * v_variant.price_cents)::bigint;
  v_new_subtotal := v_layaway.subtotal_cents - v_item.line_total_cents
    + v_new_line_total;
  v_new_total := v_new_subtotal - v_layaway.discount_cents;
  if v_new_total <= 0 then
    raise exception 'LAYAWAY_INVALID_TOTAL' using errcode = '23514';
  end if;
  if v_new_total < v_layaway.paid_cents then
    raise exception 'LAYAWAY_SUBSTITUTION_REFUND_UNDEFINED' using errcode = '23514';
  end if;
  v_new_balance := v_new_total - v_layaway.paid_cents;

  perform pg_advisory_xact_lock(
    hashtextextended('layaway-stock:' || stock.variant_id::text, 0)
  )
  from (
    select p_expected_variant_id as variant_id
    union
    select p_new_variant_id
  ) stock
  order by stock.variant_id;

  perform set_config('app.inventory_write', 'on', true);
  update public.inventory_by_location
  set reserved_qty = reserved_qty - v_item.quantity, updated_at = now()
  where variant_id = v_item.variant_id
    and location_id = v_layaway.location_id
    and reserved_qty >= v_item.quantity
  returning reserved_qty + v_item.quantity, reserved_qty
  into v_previous_reserved, v_new_reserved;
  get diagnostics v_updated = row_count;
  perform set_config('app.inventory_write', 'off', true);
  if v_updated = 0 then
    raise exception 'RESERVATION_BALANCE_MISMATCH' using errcode = '23514';
  end if;

  perform set_config('app.layaway_write', 'on', true);
  insert into public.inventory_reservation_movements(
    variant_id, location_id, movement_type, quantity,
    previous_reserved_qty, new_reserved_qty, reference_type,
    reference_id, operation_key, user_id, metadata
  ) values (
    v_item.variant_id, v_layaway.location_id, 'RELEASE', -v_item.quantity,
    v_previous_reserved, v_new_reserved, 'LAYAWAY_SUBSTITUTION',
    v_layaway.id::text, p_operation_key, v_actor,
    jsonb_build_object('folio', v_layaway.folio, 'reason', btrim(p_reason))
  );
  perform set_config('app.layaway_write', 'off', true);

  perform set_config('app.inventory_write', 'on', true);
  update public.inventory_by_location
  set reserved_qty = reserved_qty + v_item.quantity, updated_at = now()
  where variant_id = v_variant.id
    and location_id = v_layaway.location_id
    and qty - reserved_qty >= v_item.quantity
  returning reserved_qty - v_item.quantity, reserved_qty
  into v_previous_reserved, v_new_reserved;
  get diagnostics v_updated = row_count;
  perform set_config('app.inventory_write', 'off', true);
  if v_updated = 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  select coalesce(string_agg(av.value, ' · ' order by va.type_code), '')
  into v_description
  from public.variant_attributes va
  join public.attribute_values av on av.id = va.value_id
  where va.variant_id = v_variant.id;

  perform set_config('app.layaway_write', 'on', true);
  insert into public.inventory_reservation_movements(
    variant_id, location_id, movement_type, quantity,
    previous_reserved_qty, new_reserved_qty, reference_type,
    reference_id, operation_key, user_id, metadata
  ) values (
    v_variant.id, v_layaway.location_id, 'RESERVE', v_item.quantity,
    v_previous_reserved, v_new_reserved, 'LAYAWAY_SUBSTITUTION',
    v_layaway.id::text, p_operation_key, v_actor,
    jsonb_build_object('folio', v_layaway.folio, 'reason', btrim(p_reason))
  );

  insert into public.layaway_item_substitutions(
    layaway_id, layaway_item_id, old_variant_id, new_variant_id, quantity,
    old_unit_price_cents, new_unit_price_cents,
    old_line_total_cents, new_line_total_cents,
    old_total_cents, new_total_cents, old_balance_cents, new_balance_cents,
    reason, actor_user_id, operation_key
  ) values (
    v_layaway.id, v_item.id, v_item.variant_id, v_variant.id, v_item.quantity,
    v_item.unit_price_cents, v_variant.price_cents,
    v_item.line_total_cents, v_new_line_total,
    v_layaway.total_cents, v_new_total, v_layaway.balance_cents, v_new_balance,
    btrim(p_reason), v_actor, p_operation_key
  ) returning * into v_substitution;

  update public.layaway_items
  set variant_id = v_variant.id,
    product_name = v_product.name,
    sku = v_variant.sku,
    variant_description = v_description,
    unit_price_cents = v_variant.price_cents,
    line_total_cents = v_new_line_total
  where id = v_item.id;

  update public.layaways
  set subtotal_cents = v_new_subtotal,
    total_cents = v_new_total,
    balance_cents = v_new_balance,
    status = case
      when v_new_balance = 0 then 'PAID'
      when paid_cents > 0 then 'PARTIALLY_PAID'
      else 'OPEN'
    end,
    updated_at = now()
  where id = v_layaway.id;
  perform set_config('app.layaway_write', 'off', true);

  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'layaway.item_substituted', 'layaway_item_substitutions',
    v_substitution.id::text, v_layaway.location_id,
    jsonb_build_object(
      'variant_id', v_item.variant_id,
      'unit_price_cents', v_item.unit_price_cents,
      'line_total_cents', v_item.line_total_cents,
      'total_cents', v_layaway.total_cents,
      'balance_cents', v_layaway.balance_cents
    ),
    jsonb_build_object(
      'variant_id', v_variant.id,
      'unit_price_cents', v_variant.price_cents,
      'line_total_cents', v_new_line_total,
      'total_cents', v_new_total,
      'balance_cents', v_new_balance
    ),
    jsonb_build_object(
      'layaway_id', v_layaway.id, 'folio', v_layaway.folio,
      'quantity', v_item.quantity, 'reason', btrim(p_reason)
    )
  );

  return jsonb_build_object(
    'id', v_substitution.id, 'layaway_id', v_layaway.id,
    'old_variant_id', v_item.variant_id, 'new_variant_id', v_variant.id,
    'old_total_cents', v_layaway.total_cents,
    'new_total_cents', v_new_total, 'new_balance_cents', v_new_balance,
    'occurred_at', v_substitution.occurred_at
  );
end;
$$;

alter table public.layaway_item_substitutions enable row level security;
create policy layaway_item_substitutions_rpc_only
on public.layaway_item_substitutions
for all to authenticated using (false) with check (false);

revoke all on public.layaway_item_substitutions
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.layaway_item_substitutions
  to service_role;

revoke execute on function public.list_layaway_items(uuid[]),
  public.get_layaway_item(uuid),
  public.substitute_layaway_item(uuid,uuid,uuid,uuid,uuid,text)
  from public, anon;
grant execute on function public.list_layaway_items(uuid[])
  to authenticated, service_role;
grant execute on function public.get_layaway_item(uuid),
  public.substitute_layaway_item(uuid,uuid,uuid,uuid,uuid,text)
  to authenticated, service_role;

comment on table public.layaway_item_substitutions is
  'Historial inmutable de sustituciones: conserva variantes, precios, saldos, motivo y actor.';
comment on function public.substitute_layaway_item(uuid,uuid,uuid,uuid,uuid,text) is
  'Sustituye una línea completa, libera y reserva inventario atómicamente y rechaza devoluciones no definidas.';

commit;
