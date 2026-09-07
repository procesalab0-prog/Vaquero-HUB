begin;

-- La cancelación devuelve el efectivo dentro de la misma sesión abierta.
alter table public.cash_movements
  drop constraint cash_movements_movement_type_check;

alter table public.cash_movements
  add constraint cash_movements_movement_type_check
  check (movement_type in (
    'OPENING', 'SALE', 'DEPOSIT', 'WITHDRAWAL', 'CLOSING', 'CANCELLATION'
  ));

-- En un traspaso entre tiendas quien despachó no puede confirmar su propia
-- recepción. La restricción estructural también protege escrituras privilegiadas.
alter table public.transfers
  add constraint transfer_sender_receiver_differ
  check (received_by is null or sent_by is null or received_by <> sent_by);

create or replace function app.enforce_transfer_separation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.received_by is not null and new.received_by = new.sent_by then
    raise exception 'SEPARATION_OF_DUTIES' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger transfers_sender_receiver_separation_guard
before insert or update of sent_by, received_by on public.transfers
for each row execute function app.enforce_transfer_separation();

create or replace function public.cancel_sale(
  p_sale_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_sale public.sales;
  v_session public.cash_sessions;
  v_item record;
  v_cash_cents bigint := 0;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not (select app.has_perm('sales.cancel')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_sale_id is null
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'CANCELLATION_REASON_REQUIRED' using errcode = '22023';
  end if;

  select *
    into v_sale
    from public.sales
   where id = p_sale_id
   for update;

  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = '22023';
  end if;
  if not (select app.can_access_location(v_sale.location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if v_sale.status <> 'COMPLETED' then
    raise exception 'SALE_NOT_CANCELLABLE' using errcode = '22023';
  end if;

  select *
    into v_session
    from public.cash_sessions
   where id = v_sale.cash_session_id
   for update;

  if v_session.status <> 'OPEN' then
    raise exception 'SALE_SESSION_CLOSED' using errcode = '22023';
  end if;

  -- El mismo orden que create_sale evita interbloqueos al devolver varias
  -- variantes mientras otra caja intenta venderlas.
  perform pg_advisory_xact_lock(
    hashtextextended('sale-stock:' || i.variant_id::text, 0)
  )
  from public.sale_items i
  where i.sale_id = v_sale.id
  order by i.variant_id;

  for v_item in
    select i.variant_id, i.quantity
      from public.sale_items i
     where i.sale_id = v_sale.id
     order by i.variant_id
  loop
    perform app.apply_movement(
      v_item.variant_id,
      v_sale.location_id,
      'CANCELLATION',
      v_item.quantity,
      'SALE_CANCELLATION',
      v_sale.id::text,
      jsonb_build_object('folio', v_sale.folio)
    );
  end loop;

  select coalesce(sum(p.amount_cents), 0)
    into v_cash_cents
    from public.sale_payments p
    join public.payment_methods m on m.code = p.method_code
   where p.sale_id = v_sale.id
     and m.kind = 'CASH';

  if v_cash_cents > 0 then
    perform set_config('app.cash_write', 'on', true);
    insert into public.cash_movements (
      session_id, location_id, movement_type, amount_cents,
      reason, reference_type, reference_id, user_id, metadata
    ) values (
      v_session.id, v_sale.location_id, 'CANCELLATION', -v_cash_cents,
      btrim(p_reason), 'SALE_CANCELLATION', v_sale.id::text, v_actor,
      jsonb_build_object('folio', v_sale.folio)
    );
    perform set_config('app.cash_write', 'off', true);
  end if;

  perform set_config('app.sales_write', 'on', true);
  update public.sales
     set status = 'CANCELLED',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancellation_reason = btrim(p_reason)
   where id = v_sale.id
  returning * into v_sale;
  perform set_config('app.sales_write', 'off', true);

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'sale.cancelled', 'sales', v_sale.id::text, v_sale.location_id,
    jsonb_build_object('status', 'COMPLETED'),
    jsonb_build_object('status', 'CANCELLED'),
    jsonb_build_object(
      'folio', v_sale.folio,
      'reason', btrim(p_reason),
      'cash_reversed_cents', v_cash_cents
    )
  );

  return jsonb_build_object(
    'id', v_sale.id,
    'folio', v_sale.folio,
    'status', v_sale.status,
    'cancelled_at', v_sale.cancelled_at,
    'cash_reversed_cents', v_cash_cents
  );
end;
$$;

revoke execute on function public.cancel_sale(uuid, text)
  from public, anon;
grant execute on function public.cancel_sale(uuid, text)
  to authenticated, service_role;

commit;
