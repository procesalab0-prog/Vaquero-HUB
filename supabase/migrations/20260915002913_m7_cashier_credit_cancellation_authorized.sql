begin;

-- Corrección hacia delante de 0.39.0. En una sucursal con una sola caja, la
-- persona que tiene abierto el turno debe poder ejecutar la cancelación; la
-- autoridad sigue siendo el gerente que entrega el token returns.authorize.
create or replace function public.cancel_credit_sale(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_sale_id uuid,
  p_refund_references jsonb default '[]'::jsonb,
  p_authorization_token uuid default null,
  p_reason text default null
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
  v_items jsonb;
  v_result jsonb;
  v_settlement public.customer_credit_return_settlements;
  v_authorized_by uuid;
  v_updated integer;
begin
  if v_actor is null or not (select app.has_perm('pos.sell'))
     or not (select app.has_perm('returns.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_cash_session_id is null or p_sale_id is null
     or jsonb_typeof(coalesce(p_refund_references, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_refund_references, '[]'::jsonb)) > 10
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'INVALID_CREDIT_CANCELLATION' using errcode = '22023';
  end if;

  select s.* into v_sale
  from public.sales s where s.id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND' using errcode = '22023';
  end if;
  if not (select app.can_access_location(v_sale.location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.customer_credit_ledger l
    where l.entry_type = 'CHARGE' and l.reference_type = 'SALE'
      and l.reference_id = v_sale.id::text
  ) then
    raise exception 'SALE_IS_NOT_CREDIT' using errcode = '22023';
  end if;

  if v_sale.status = 'CANCELLED' then
    select jsonb_build_object(
      'id', r.id, 'folio', r.folio, 'type', r.type,
      'returned_cents', r.returned_cents,
      'delivered_cents', r.delivered_cents,
      'difference_cents', r.difference_cents
    )
    into v_result
    from public.idempotency_keys k
    join public.returns r on r.id = k.resource_id
    where k.key = p_idempotency_key and k.actor_user_id = v_actor
      and k.operation = 'CREATE_RETURN_EXCHANGE'
      and r.original_sale_id = v_sale.id;
    if v_result is null then
      raise exception 'SALE_NOT_CANCELLABLE' using errcode = '22023';
    end if;
    select s.* into v_settlement
    from public.customer_credit_return_settlements s
    where s.return_id = (v_result->>'id')::uuid;
    return v_result || jsonb_build_object(
      'sale_id', v_sale.id, 'sale_folio', v_sale.folio,
      'status', v_sale.status,
      'credit_settlement', jsonb_build_object(
        'debt_reduction_cents', v_settlement.debt_reduction_cents,
        'paid_refund_cents', v_settlement.paid_refund_cents
      )
    );
  end if;
  if v_sale.status <> 'COMPLETED' then
    raise exception 'SALE_NOT_CANCELLABLE' using errcode = '22023';
  end if;

  select s.* into v_session from public.cash_sessions s
  where s.id = p_cash_session_id and s.status = 'OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor
     or v_session.location_id <> v_sale.location_id then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;

  select jsonb_agg(jsonb_build_object(
    'sale_item_id', remaining.id,
    'quantity', remaining.quantity,
    'condition', 'RESELLABLE'
  ) order by remaining.id)
  into v_items
  from (
    select si.id,
      si.quantity - coalesce(sum(ri.quantity) filter (where ri.direction = 'IN'), 0) quantity
    from public.sale_items si
    left join public.return_items ri on ri.sale_item_id = si.id
    where si.sale_id = v_sale.id
    group by si.id, si.quantity
    having si.quantity - coalesce(sum(ri.quantity) filter (where ri.direction = 'IN'), 0) > 0
  ) remaining;
  if coalesce(jsonb_array_length(v_items), 0) = 0 then
    raise exception 'SALE_ALREADY_FULLY_RETURNED' using errcode = '22023';
  end if;

  v_result := public.create_return_exchange(
    p_idempotency_key, p_cash_session_id, p_sale_id, v_items,
    '[]'::jsonb, '[]'::jsonb, coalesce(p_refund_references, '[]'::jsonb),
    p_authorization_token, btrim(p_reason)
  );
  select a.supervisor_user_id into v_authorized_by
  from app.supervisor_authorizations a
  where a.id = p_authorization_token and a.actor_user_id = v_actor
    and a.permission_code = 'returns.authorize' and a.used_at is not null;
  if v_authorized_by is null then
    raise exception 'RETURN_AUTHORIZATION_INVALID' using errcode = '42501';
  end if;

  perform set_config('app.sales_write', 'on', true);
  update public.sales set status = 'CANCELLED', cancelled_at = now(),
    cancelled_by = v_actor, cancellation_reason = btrim(p_reason)
  where id = v_sale.id and status = 'COMPLETED'
  returning * into v_sale;
  get diagnostics v_updated = row_count;
  perform set_config('app.sales_write', 'off', true);
  if v_updated = 0 then
    raise exception 'SALE_NOT_CANCELLABLE' using errcode = '40001';
  end if;

  select s.* into v_settlement
  from public.customer_credit_return_settlements s
  where s.return_id = (v_result->>'id')::uuid;
  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    v_actor, 'sale.credit_cancelled', 'sales', v_sale.id::text,
    v_sale.location_id, jsonb_build_object('status', 'COMPLETED'),
    jsonb_build_object('status', 'CANCELLED'),
    jsonb_build_object(
      'folio', v_sale.folio, 'reason', btrim(p_reason),
      'authorized_by', v_authorized_by,
      'compensating_return_id', v_result->>'id',
      'compensating_return_folio', v_result->>'folio',
      'debt_reduction_cents', v_settlement.debt_reduction_cents,
      'paid_refund_cents', v_settlement.paid_refund_cents
    )
  );

  return v_result || jsonb_build_object(
    'sale_id', v_sale.id, 'sale_folio', v_sale.folio,
    'status', v_sale.status,
    'credit_settlement', jsonb_build_object(
      'debt_reduction_cents', v_settlement.debt_reduction_cents,
      'paid_refund_cents', v_settlement.paid_refund_cents
    )
  );
end;
$$;

comment on function public.cancel_credit_sale(uuid, uuid, uuid, jsonb, uuid, text)
is 'La persona dueña de la caja ejecuta la cancelación y un gerente la autoriza con un token returns.authorize de un solo uso.';

commit;
