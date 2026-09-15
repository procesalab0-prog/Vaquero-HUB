begin;

-- M7.3 · Liquidación y entrega. Los abonos ya entraron a caja cuando fueron
-- recibidos; entregar crea la venta fiscal/operativa sin cobrar por segunda vez.
insert into public.permissions(code, category, description)
values ('layaways.deliver', 'Punto de venta', 'Entregar apartados liquidados')
on conflict (code) do update set
  category = excluded.category,
  description = excluded.description;

insert into public.role_permissions(role_id, permission_code)
select r.id, 'layaways.deliver'
from public.roles r
where r.code in ('ADMIN', 'MANAGER', 'CASHIER')
on conflict do nothing;

create table public.layaway_fulfillments (
  id uuid primary key default extensions.gen_random_uuid(),
  layaway_id uuid not null unique references public.layaways(id),
  sale_id uuid not null unique references public.sales(id),
  cash_session_id uuid not null references public.cash_sessions(id),
  location_id uuid not null references public.locations(id),
  actor_user_id uuid not null references public.app_users(id),
  operation_key uuid not null unique,
  delivered_at timestamptz not null default now()
);
create index layaway_fulfillments_location_date_idx
  on public.layaway_fulfillments(location_id, delivered_at desc, id);

create trigger layaway_fulfillments_guard
before insert or update or delete on public.layaway_fulfillments
for each row execute function app.guard_layaway_write();

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
declare
  v_actor uuid := (select app.current_user_id());
  v_session public.cash_sessions;
  v_layaway public.layaways;
  v_existing public.layaway_fulfillments;
  v_sale public.sales;
  v_folio bigint;
  v_item public.layaway_items;
  v_previous_qty numeric(12,3);
  v_new_qty numeric(12,3);
  v_previous_reserved numeric(12,3);
  v_new_reserved numeric(12,3);
  v_stock_updated integer;
  v_payment_total bigint;
begin
  if v_actor is null or not (select app.has_perm('layaways.deliver'))
     or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_operation_key is null or p_cash_session_id is null
     or p_layaway_id is null then
    raise exception 'INVALID_LAYAWAY_FULFILLMENT' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('layaway-fulfillment:' || p_operation_key::text, 0)
  );
  select * into v_existing
  from public.layaway_fulfillments
  where operation_key = p_operation_key;
  if found then
    if v_existing.layaway_id <> p_layaway_id
       or v_existing.cash_session_id <> p_cash_session_id
       or v_existing.actor_user_id <> v_actor then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    select * into v_sale from public.sales where id = v_existing.sale_id;
    return jsonb_build_object(
      'fulfillment_id', v_existing.id, 'layaway_id', v_existing.layaway_id,
      'sale_id', v_sale.id, 'sale_folio', v_sale.folio,
      'delivered_at', v_existing.delivered_at
    );
  end if;

  select * into v_session
  from public.cash_sessions
  where id = p_cash_session_id and status = 'OPEN'
  for update;
  if not found or v_session.cashier_user_id <> v_actor
     or not (select app.can_access_location(v_session.location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
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
  if v_layaway.location_id <> v_session.location_id then
    raise exception 'LAYAWAY_WRONG_LOCATION' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.layaway_fulfillments where layaway_id = v_layaway.id
  ) then
    raise exception 'LAYAWAY_ALREADY_FULFILLED' using errcode = '23514';
  end if;
  if v_layaway.status <> 'PAID' or v_layaway.balance_cents <> 0
     or v_layaway.paid_cents <> v_layaway.total_cents then
    raise exception 'LAYAWAY_NOT_READY' using errcode = '23514';
  end if;
  if v_layaway.discount_cents <> 0 then
    raise exception 'LAYAWAY_DISCOUNT_NOT_SUPPORTED' using errcode = '23514';
  end if;

  select coalesce(sum(pp.amount_cents), 0)
  into v_payment_total
  from public.layaway_payments lp
  join public.layaway_payment_parts pp on pp.layaway_payment_id = lp.id
  where lp.layaway_id = v_layaway.id;
  if v_payment_total <> v_layaway.total_cents then
    raise exception 'LAYAWAY_PAYMENT_LEDGER_MISMATCH' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('layaway-stock:' || li.variant_id::text, 0)
  )
  from public.layaway_items li
  where li.layaway_id = v_layaway.id
  order by li.variant_id;

  insert into public.folios(location_id, document_type, next_number)
  values(v_session.location_id, 'SALE', 2)
  on conflict(location_id, document_type) do update
    set next_number = public.folios.next_number + 1
  returning next_number - 1 into v_folio;

  perform set_config('app.sales_write', 'on', true);
  insert into public.sales(
    location_id, cash_session_id, cashier_user_id, customer_id,
    folio_number, folio, subtotal_cents, item_discount_cents,
    ticket_discount_cents, total_cents, notes
  ) values (
    v_session.location_id, v_session.id, v_actor, v_layaway.customer_id,
    v_folio, (select code from public.locations where id = v_session.location_id)
      || '-V-' || lpad(v_folio::text, 6, '0'),
    v_layaway.subtotal_cents, 0, 0, v_layaway.total_cents,
    'Entrega del apartado ' || v_layaway.folio
  ) returning * into v_sale;

  insert into public.sale_items(
    sale_id, line_number, variant_id, product_name, sku,
    variant_description, quantity, unit_price_cents, unit_cost_cents,
    gross_cents, item_discount_cents, ticket_discount_cents,
    line_total_cents, gift_receipt
  )
  select v_sale.id, li.line_number, li.variant_id, li.product_name, li.sku,
    li.variant_description, li.quantity, li.unit_price_cents, v.cost_cents,
    li.line_total_cents, 0, 0, li.line_total_cents, false
  from public.layaway_items li
  join public.variants v on v.id = li.variant_id
  where li.layaway_id = v_layaway.id
  order by li.line_number;

  -- Se conserva el desglose original, pero no se crea ningún movimiento de
  -- caja: ese dinero ya entró al registrar cada abono.
  insert into public.sale_payments(
    sale_id, method_code, amount_cents, tendered_cents,
    change_cents, reference, created_at
  )
  select v_sale.id, pp.method_code, pp.amount_cents,
    case when pp.method_code = 'CASH' then pp.amount_cents else null end,
    0, pp.reference, lp.received_at
  from public.layaway_payments lp
  join public.layaway_payment_parts pp on pp.layaway_payment_id = lp.id
  where lp.layaway_id = v_layaway.id
  order by lp.received_at, pp.id;

  for v_item in
    select * from public.layaway_items
    where layaway_id = v_layaway.id
    order by variant_id
  loop
    perform set_config('app.inventory_write', 'on', true);
    update public.inventory_by_location
    set qty = qty - v_item.quantity,
        reserved_qty = reserved_qty - v_item.quantity,
        updated_at = now()
    where variant_id = v_item.variant_id
      and location_id = v_layaway.location_id
      and qty >= v_item.quantity
      and reserved_qty >= v_item.quantity
    returning qty + v_item.quantity, qty,
      reserved_qty + v_item.quantity, reserved_qty
    into v_previous_qty, v_new_qty, v_previous_reserved, v_new_reserved;
    get diagnostics v_stock_updated = row_count;
    if v_stock_updated = 0 then
      raise exception 'RESERVATION_BALANCE_MISMATCH' using errcode = '23514';
    end if;
    insert into public.inventory_movements(
      variant_id, location_id, movement_type, quantity,
      previous_qty, new_qty, reference_type, reference_id,
      user_id, metadata
    ) values (
      v_item.variant_id, v_layaway.location_id, 'SALE', -v_item.quantity,
      v_previous_qty, v_new_qty, 'SALE', v_sale.id::text, v_actor,
      jsonb_build_object('folio', v_sale.folio, 'layaway_id', v_layaway.id,
        'layaway_folio', v_layaway.folio)
    );
    perform set_config('app.inventory_write', 'off', true);

    perform set_config('app.layaway_write', 'on', true);
    insert into public.inventory_reservation_movements(
      variant_id, location_id, movement_type, quantity,
      previous_reserved_qty, new_reserved_qty, reference_type,
      reference_id, operation_key, user_id, metadata
    ) values (
      v_item.variant_id, v_layaway.location_id, 'FULFILL', -v_item.quantity,
      v_previous_reserved, v_new_reserved, 'LAYAWAY_FULFILLMENT',
      v_layaway.id::text, p_operation_key, v_actor,
      jsonb_build_object('folio', v_layaway.folio, 'sale_id', v_sale.id,
        'sale_folio', v_sale.folio)
    );
    perform set_config('app.layaway_write', 'off', true);
  end loop;

  perform set_config('app.layaway_write', 'on', true);
  update public.layaways
  set status = 'COMPLETED', completed_at = now(), updated_at = now()
  where id = v_layaway.id;
  insert into public.layaway_fulfillments(
    layaway_id, sale_id, cash_session_id, location_id,
    actor_user_id, operation_key
  ) values (
    v_layaway.id, v_sale.id, v_session.id, v_session.location_id,
    v_actor, p_operation_key
  ) returning * into v_existing;
  perform set_config('app.layaway_write', 'off', true);

  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'layaway.fulfilled', 'layaways', v_layaway.id::text,
    v_layaway.location_id,
    jsonb_build_object('status', v_layaway.status, 'reserved', true),
    jsonb_build_object('status', 'COMPLETED', 'reserved', false,
      'sale_id', v_sale.id, 'sale_folio', v_sale.folio),
    jsonb_build_object('cash_session_id', v_session.id,
      'total_cents', v_layaway.total_cents, 'cash_movement_created', false)
  );
  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    after_data, metadata
  ) values (
    v_actor, 'sale.created_from_layaway', 'sales', v_sale.id::text,
    v_sale.location_id, to_jsonb(v_sale),
    jsonb_build_object('layaway_id', v_layaway.id,
      'layaway_folio', v_layaway.folio,
      'payment_count', (select count(*) from public.sale_payments
        where sale_id = v_sale.id))
  );
  perform set_config('app.sales_write', 'off', true);

  return jsonb_build_object(
    'fulfillment_id', v_existing.id, 'layaway_id', v_layaway.id,
    'sale_id', v_sale.id, 'sale_folio', v_sale.folio,
    'delivered_at', v_existing.delivered_at
  );
end;
$$;

alter table public.layaway_fulfillments enable row level security;
create policy layaway_fulfillments_rpc_only
on public.layaway_fulfillments
for all to authenticated using (false) with check (false);

revoke all on public.layaway_fulfillments
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.layaway_fulfillments
  to service_role;

revoke execute on function public.fulfill_layaway(uuid,uuid,uuid)
  from public, anon;
grant execute on function public.fulfill_layaway(uuid,uuid,uuid)
  to authenticated, service_role;

comment on table public.layaway_fulfillments is
  'Vínculo inmutable e idempotente entre un apartado liquidado y su venta de entrega.';
comment on function public.fulfill_layaway(uuid,uuid,uuid) is
  'Entrega un apartado totalmente pagado en su sucursal de origen, crea la venta y libera la reserva sin volver a mover caja.';

commit;
