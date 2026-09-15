begin;

alter table public.layaways
  add column cancellation_penalty_cents bigint
    check (cancellation_penalty_cents is null or cancellation_penalty_cents >= 0),
  add column cancelled_balance_cents bigint
    check (cancelled_balance_cents is null or cancelled_balance_cents >= 0),
  add column cancellation_operation_key uuid unique;

create function public.cancel_overdue_layaway(
  p_idempotency_key uuid,
  p_layaway_id uuid,
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
  v_existing public.layaways;
  v_item record;
  v_previous_reserved numeric(12,3);
  v_new_reserved numeric(12,3);
  v_updated integer;
  v_previous_status text;
  v_previous_paid bigint;
  v_previous_balance bigint;
begin
  if v_actor is null or not (select app.has_perm('layaways.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_layaway_id is null
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'INVALID_LAYAWAY_CANCELLATION' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cancel-layaway:' || p_idempotency_key::text, 0));
  select * into v_existing from public.layaways
  where cancellation_operation_key = p_idempotency_key;
  if found then
    if v_existing.id <> p_layaway_id then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'id', v_existing.id, 'folio', v_existing.folio, 'status', v_existing.status,
      'penalty_cents', v_existing.cancellation_penalty_cents,
      'released_balance_cents', v_existing.cancelled_balance_cents,
      'cancelled_at', v_existing.cancelled_at
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('layaway:' || p_layaway_id::text, 0));
  select * into v_layaway from public.layaways where id = p_layaway_id for update;
  if not found or not (select app.can_access_location(v_layaway.location_id)) then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_layaway.status not in ('OPEN', 'PARTIALLY_PAID', 'PAID') then
    raise exception 'LAYAWAY_NOT_CANCELLABLE' using errcode = '23514';
  end if;
  -- El negocio sólo definió la penalización para vencidos. Cancelar antes del
  -- vencimiento sigue bloqueado hasta definir si y cómo se devuelven abonos.
  if v_layaway.due_date >= current_date then
    raise exception 'LAYAWAY_CANCELLATION_POLICY_UNDEFINED' using errcode = '23514';
  end if;
  v_previous_status := v_layaway.status;
  v_previous_paid := v_layaway.paid_cents;
  v_previous_balance := v_layaway.balance_cents;

  perform pg_advisory_xact_lock(hashtextextended('layaway-stock:' || li.variant_id::text, 0))
  from public.layaway_items li where li.layaway_id = v_layaway.id
  order by li.variant_id;

  for v_item in
    select li.variant_id, li.quantity from public.layaway_items li
    where li.layaway_id = v_layaway.id order by li.variant_id
  loop
    perform set_config('app.inventory_write', 'on', true);
    update public.inventory_by_location
    set reserved_qty = reserved_qty - v_item.quantity, updated_at = now()
    where variant_id = v_item.variant_id and location_id = v_layaway.location_id
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
      v_previous_reserved, v_new_reserved, 'LAYAWAY_CANCELLATION',
      v_layaway.id::text, p_idempotency_key, v_actor,
      jsonb_build_object('folio', v_layaway.folio, 'reason', btrim(p_reason))
    );
    perform set_config('app.layaway_write', 'off', true);
  end loop;

  perform set_config('app.layaway_write', 'on', true);
  update public.layaways set
    status = 'CANCELLED', cancelled_at = now(), cancelled_by = v_actor,
    cancellation_reason = btrim(p_reason),
    cancellation_penalty_cents = paid_cents,
    cancelled_balance_cents = balance_cents,
    cancellation_operation_key = p_idempotency_key,
    updated_at = now()
  where id = v_layaway.id returning * into v_layaway;
  perform set_config('app.layaway_write', 'off', true);

  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'layaway.cancelled_overdue', 'layaways', v_layaway.id::text,
    v_layaway.location_id,
    jsonb_build_object('status', v_previous_status,
      'paid_cents', v_previous_paid, 'balance_cents', v_previous_balance),
    jsonb_build_object('status', 'CANCELLED',
      'penalty_cents', v_layaway.cancellation_penalty_cents,
      'released_balance_cents', v_layaway.cancelled_balance_cents),
    jsonb_build_object('folio', v_layaway.folio, 'reason', btrim(p_reason))
  );

  return jsonb_build_object(
    'id', v_layaway.id, 'folio', v_layaway.folio, 'status', v_layaway.status,
    'penalty_cents', v_layaway.cancellation_penalty_cents,
    'released_balance_cents', v_layaway.cancelled_balance_cents,
    'cancelled_at', v_layaway.cancelled_at
  );
end;
$$;

revoke execute on function public.cancel_overdue_layaway(uuid,uuid,text)
  from public, anon;
grant execute on function public.cancel_overdue_layaway(uuid,uuid,text)
  to authenticated, service_role;

comment on function public.cancel_overdue_layaway(uuid,uuid,text) is
  'Cancela únicamente apartados vencidos, retiene abonos como penalización y libera una sola vez la reserva. No mueve caja.';

commit;
