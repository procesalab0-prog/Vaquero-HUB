begin;

-- Una devolución en efectivo sacaba dinero de la caja sin comprobar que
-- hubiera. Medido: con $100 en el cajón, una devolución de $999 pasó y dejó
-- el esperado en -$899.
--
-- En el mostrador eso no puede ocurrir: la cajera no entrega dinero que no
-- tiene. El sistema aceptaba una operación imposible y, peor, dejaba el
-- corte comparando contra un esperado negativo, donde un faltante real ya no
-- se distingue.
--
-- `record_cash_movement` ya rechaza un retiro mayor al efectivo disponible;
-- la devolución usa ahora la misma regla. Si no alcanza, el supervisor
-- decide: devolver a la tarjeta, o ingresar efectivo de la caja fuerte
-- primero. Sólo afecta a la parte en efectivo: un cambio con diferencia a
-- cobrar y una devolución a tarjeta siguen igual.

create or replace function public.create_return_exchange(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_original_sale_id uuid,
  p_items_in jsonb,
  p_items_out jsonb default '[]'::jsonb,
  p_charge_payments jsonb default '[]'::jsonb,
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
  v_session public.cash_sessions; v_sale public.sales; v_return public.returns;
  v_authorization app.supervisor_authorizations; v_existing public.idempotency_keys;
  v_hash text; v_folio bigint; v_in record; v_out record; v_payment jsonb;
  v_previous_qty numeric; v_previous_cents bigint; v_line_cents bigint;
  v_returned bigint := 0; v_delivered bigint := 0; v_difference bigint;
  v_charge_total bigint := 0; v_refund_total bigint := 0; v_cash_net bigint := 0;
  v_method public.payment_methods; v_amount bigint; v_reference text; v_type text;
  v_policy_days integer;
  v_available_cash bigint;
begin
  if v_actor is null or not (select app.has_perm('returns.create'))
     or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_cash_session_id is null or p_original_sale_id is null
     or jsonb_typeof(p_items_in) <> 'array' or jsonb_array_length(p_items_in) not between 1 and 100
     or jsonb_typeof(coalesce(p_items_out, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items_out, '[]')) > 100
     or jsonb_typeof(coalesce(p_charge_payments, '[]')) <> 'array' or jsonb_array_length(coalesce(p_charge_payments, '[]')) > 10
     or jsonb_typeof(coalesce(p_refund_references, '[]')) <> 'array' or jsonb_array_length(coalesce(p_refund_references, '[]')) > 10
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'INVALID_RETURN_REQUEST' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items_in) x group by x->>'sale_item_id' having count(*) > 1)
     or exists(select 1 from jsonb_array_elements(coalesce(p_items_out, '[]')) x group by x->>'variant_id' having count(*) > 1)
     or exists(select 1 from jsonb_array_elements(coalesce(p_charge_payments, '[]')) x group by upper(x->>'method_code') having count(*) > 1)
     or exists(select 1 from jsonb_array_elements(coalesce(p_refund_references, '[]')) x group by upper(x->>'method_code') having count(*) > 1) then
    raise exception 'DUPLICATE_RETURN_ITEM' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'session', p_cash_session_id, 'sale', p_original_sale_id, 'in', p_items_in,
    'out', coalesce(p_items_out, '[]'), 'charges', coalesce(p_charge_payments, '[]'),
    'refund_refs', coalesce(p_refund_references, '[]'), 'authorization', p_authorization_token,
    'reason', btrim(p_reason))::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('create_return:' || p_idempotency_key::text, 0));
  select * into v_existing from public.idempotency_keys where key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id <> v_actor or v_existing.request_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    if v_existing.resource_id is null then raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode = '40001'; end if;
    select * into v_return from public.returns where id = v_existing.resource_id;
    return jsonb_build_object('id', v_return.id, 'folio', v_return.folio,
      'type', v_return.type, 'difference_cents', v_return.difference_cents);
  end if;
  insert into public.idempotency_keys(key, actor_user_id, operation, request_hash)
  values (p_idempotency_key, v_actor, 'CREATE_RETURN_EXCHANGE', v_hash);

  select * into v_sale from public.sales where id = p_original_sale_id for update;
  if not found then raise exception 'SALE_NOT_FOUND' using errcode = '22023'; end if;
  if v_sale.status <> 'COMPLETED' then raise exception 'SALE_NOT_RETURNABLE' using errcode = '22023'; end if;
  select coalesce(window_days, 15) into v_policy_days
  from public.return_policies where location_id = v_sale.location_id;
  v_policy_days := coalesce(v_policy_days, 15);
  if now() > v_sale.sold_at + make_interval(days => v_policy_days) then
    raise exception 'RETURN_WINDOW_EXPIRED' using errcode = '22023';
  end if;
  select * into v_session from public.cash_sessions where id = p_cash_session_id and status = 'OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor or v_session.location_id <> v_sale.location_id
     or not (select app.can_access_location(v_session.location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_authorization from app.supervisor_authorizations
  where id = p_authorization_token and actor_user_id = v_actor
    and permission_code = 'returns.authorize' and used_at is null and expires_at > now()
  for update;
  if not found then raise exception 'RETURN_AUTHORIZATION_REQUIRED' using errcode = '42501'; end if;

  perform si.id from public.sale_items si
  join jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
    on x.sale_item_id = si.id
  where si.sale_id = v_sale.id order by si.id for update;
  if (select count(*) from jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)) <>
     (select count(*) from public.sale_items si join jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
       on x.sale_item_id = si.id where si.sale_id = v_sale.id)
     or exists(select 1 from jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
       where x.quantity is null or x.quantity <= 0 or x.quantity <> trunc(x.quantity)
          or x.condition not in ('RESELLABLE', 'DAMAGED')) then
    raise exception 'SALE_ITEM_MISMATCH' using errcode = '22023';
  end if;

  for v_in in
    select si.id, si.variant_id, si.quantity,
      si.line_total_cents - si.ticket_discount_cents original_net,
      x.quantity requested, x.condition
    from public.sale_items si
    join jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
      on x.sale_item_id = si.id where si.sale_id = v_sale.id order by si.id
  loop
    select coalesce(sum(quantity), 0), coalesce(sum(line_total_cents), 0)
    into v_previous_qty, v_previous_cents from public.return_items
    where sale_item_id = v_in.id and direction = 'IN';
    if v_previous_qty + v_in.requested > v_in.quantity then
      raise exception 'RETURN_EXCEEDS_SOLD' using errcode = '22023';
    end if;
    if v_previous_qty + v_in.requested = v_in.quantity then
      v_line_cents := v_in.original_net - v_previous_cents;
    else
      v_line_cents := floor(v_in.original_net::numeric * v_in.requested / v_in.quantity)::bigint;
    end if;
    v_returned := v_returned + v_line_cents;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('sale-stock:' || x.variant_id::text, 0))
  from jsonb_to_recordset(coalesce(p_items_out, '[]')) x(variant_id uuid, quantity numeric)
  order by x.variant_id;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_items_out, '[]')) x(variant_id uuid, quantity numeric)
    left join public.variants v on v.id = x.variant_id left join public.products p on p.id = v.product_id
    where x.quantity is null or x.quantity <= 0 or x.quantity <> trunc(x.quantity)
       or v.id is null or p.id is null or not v.is_active or not p.is_active) then
    raise exception 'VARIANT_NOT_SELLABLE' using errcode = '22023';
  end if;
  select coalesce(sum(v.price_cents * x.quantity)::bigint, 0) into v_delivered
  from jsonb_to_recordset(coalesce(p_items_out, '[]')) x(variant_id uuid, quantity numeric)
  join public.variants v on v.id = x.variant_id;
  v_difference := v_delivered - v_returned;
  v_type := case when jsonb_array_length(coalesce(p_items_out, '[]')) = 0 then 'RETURN' else 'EXCHANGE' end;

  if v_difference > 0 then
    for v_payment in select value from jsonb_array_elements(coalesce(p_charge_payments, '[]')) loop
      begin v_amount := (v_payment->>'amount_cents')::bigint; exception when others then raise exception 'INVALID_PAYMENT' using errcode = '22023'; end;
      select * into v_method from public.payment_methods
      where code = upper(v_payment->>'method_code') and is_active;
      v_reference := nullif(btrim(v_payment->>'reference'), '');
      if not found or v_amount is null or v_amount <= 0
         or (v_method.requires_reference and length(coalesce(v_reference, '')) < 3) then
        raise exception 'INVALID_PAYMENT' using errcode = '22023';
      end if;
      v_charge_total := v_charge_total + v_amount;
    end loop;
    if v_charge_total <> v_difference then raise exception 'RETURN_PAYMENT_TOTAL_MISMATCH' using errcode = '23514'; end if;
  elsif jsonb_array_length(coalesce(p_charge_payments, '[]')) > 0 then
    raise exception 'UNEXPECTED_CHARGE_PAYMENT' using errcode = '22023';
  end if;

  if v_difference < 0 then
    v_refund_total := -v_difference;
    if (select coalesce(sum(sp.amount_cents), 0) - coalesce((select sum(rp.amount_cents)
          from public.return_payments rp join public.returns r on r.id = rp.return_id
          where r.original_sale_id = v_sale.id and rp.direction = 'REFUND'), 0)
        from public.sale_payments sp where sp.sale_id = v_sale.id) < v_refund_total then
      raise exception 'REFUND_EXCEEDS_ORIGINAL_PAYMENT' using errcode = '22023';
    end if;
    if exists (
      with available as (
        select sp.method_code, pm.requires_reference,
          sp.amount_cents - coalesce((select sum(rp.amount_cents)
            from public.return_payments rp join public.returns r on r.id = rp.return_id
            where r.original_sale_id = v_sale.id and rp.direction = 'REFUND'
              and rp.method_code = sp.method_code), 0) available_cents
        from public.sale_payments sp join public.payment_methods pm on pm.code = sp.method_code
        where sp.sale_id = v_sale.id
      )
      select 1 from available a where a.available_cents > 0 and a.requires_reference
        and length(coalesce((select nullif(btrim(x.reference), '')
          from jsonb_to_recordset(coalesce(p_refund_references, '[]')) x(method_code text, reference text)
          where upper(x.method_code) = a.method_code), '')) < 3
    ) then raise exception 'REFUND_REFERENCE_REQUIRED' using errcode = '22023'; end if;
  elsif jsonb_array_length(coalesce(p_refund_references, '[]')) > 0 then
    raise exception 'UNEXPECTED_REFUND_REFERENCE' using errcode = '22023';
  end if;

  insert into public.folios(location_id, document_type, next_number)
  values (v_session.location_id, 'RETURN', 2)
  on conflict(location_id, document_type) do update set next_number = public.folios.next_number + 1
  returning next_number - 1 into v_folio;
  perform set_config('app.returns_write', 'on', true);
  insert into public.returns(location_id, cash_session_id, original_sale_id, customer_id,
    folio_number, folio, type, returned_cents, delivered_cents, difference_cents,
    reason, authorized_by, created_by)
  values (v_session.location_id, v_session.id, v_sale.id, v_sale.customer_id, v_folio,
    (select code from public.locations where id = v_session.location_id) || '-D-' || lpad(v_folio::text, 6, '0'),
    v_type, v_returned, v_delivered, v_difference, btrim(p_reason),
    v_authorization.supervisor_user_id, v_actor) returning * into v_return;

  for v_in in
    select si.id, si.variant_id, si.quantity,
      si.line_total_cents - si.ticket_discount_cents original_net,
      x.quantity requested, x.condition
    from public.sale_items si
    join jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
      on x.sale_item_id = si.id where si.sale_id = v_sale.id order by si.id
  loop
    select coalesce(sum(quantity), 0), coalesce(sum(line_total_cents), 0)
    into v_previous_qty, v_previous_cents from public.return_items
    where sale_item_id = v_in.id and direction = 'IN';
    if v_previous_qty + v_in.requested = v_in.quantity then
      v_line_cents := v_in.original_net - v_previous_cents;
    else
      v_line_cents := floor(v_in.original_net::numeric * v_in.requested / v_in.quantity)::bigint;
    end if;
    insert into public.return_items(return_id, direction, sale_item_id, variant_id,
      quantity, unit_price_cents, line_total_cents, condition)
    values (v_return.id, 'IN', v_in.id, v_in.variant_id, v_in.requested,
      round(v_line_cents::numeric / v_in.requested)::bigint, v_line_cents, v_in.condition);
    perform app.apply_movement(v_in.variant_id, v_session.location_id, 'RETURN', v_in.requested,
      'RETURN', v_return.id::text, jsonb_build_object('folio', v_return.folio, 'original_sale_id', v_sale.id));
    if v_in.condition = 'DAMAGED' then
      perform app.apply_movement(v_in.variant_id, v_session.location_id, 'ADJUSTMENT', -v_in.requested,
        'DAMAGED_RETURN', v_return.id::text, jsonb_build_object('folio', v_return.folio, 'reason', btrim(p_reason)));
    end if;
  end loop;
  for v_out in
    select x.variant_id, x.quantity, v.price_cents
    from jsonb_to_recordset(coalesce(p_items_out, '[]')) x(variant_id uuid, quantity numeric)
    join public.variants v on v.id = x.variant_id order by x.variant_id
  loop
    v_line_cents := (v_out.price_cents * v_out.quantity)::bigint;
    insert into public.return_items(return_id, direction, variant_id, quantity, unit_price_cents, line_total_cents)
    values (v_return.id, 'OUT', v_out.variant_id, v_out.quantity, v_out.price_cents, v_line_cents);
    perform app.apply_movement(v_out.variant_id, v_session.location_id, 'SALE', -v_out.quantity,
      'EXCHANGE', v_return.id::text, jsonb_build_object('folio', v_return.folio, 'original_sale_id', v_sale.id));
  end loop;

  for v_payment in select value from jsonb_array_elements(coalesce(p_charge_payments, '[]')) loop
    v_amount := (v_payment->>'amount_cents')::bigint;
    v_reference := nullif(btrim(v_payment->>'reference'), '');
    insert into public.return_payments(return_id, direction, method_code, amount_cents, reference)
    values (v_return.id, 'CHARGE', upper(v_payment->>'method_code'), v_amount, v_reference);
  end loop;

  if v_refund_total > 0 then
    with available as (
      select sp.method_code, pm.sort_order,
        sp.amount_cents - coalesce((select sum(rp.amount_cents)
          from public.return_payments rp join public.returns r on r.id = rp.return_id
          where r.original_sale_id = v_sale.id and rp.direction = 'REFUND'
            and rp.method_code = sp.method_code), 0) available_cents
      from public.sale_payments sp join public.payment_methods pm on pm.code = sp.method_code
      where sp.sale_id = v_sale.id
    ), shares as (
      select *, floor(available_cents::numeric * v_refund_total / sum(available_cents) over())::bigint base,
        (available_cents::numeric * v_refund_total / sum(available_cents) over())
          - floor(available_cents::numeric * v_refund_total / sum(available_cents) over()) fraction
      from available where available_cents > 0
    ), ranked as (
      select *, row_number() over(order by fraction desc, sort_order, method_code) rn,
        v_refund_total - sum(base) over() remainder from shares
    )
    insert into public.return_payments(return_id, direction, method_code, amount_cents, reference)
    select v_return.id, 'REFUND', r.method_code,
      r.base + case when r.rn <= r.remainder then 1 else 0 end,
      (select nullif(btrim(x.reference), '')
        from jsonb_to_recordset(coalesce(p_refund_references, '[]')) x(method_code text, reference text)
        where upper(x.method_code) = r.method_code)
    from ranked r where r.base + case when r.rn <= r.remainder then 1 else 0 end > 0;
  end if;
  perform set_config('app.returns_write', 'off', true);

  select coalesce(sum(case when rp.direction = 'CHARGE' then rp.amount_cents else -rp.amount_cents end), 0)
  into v_cash_net from public.return_payments rp join public.payment_methods pm on pm.code = rp.method_code
  where rp.return_id = v_return.id and pm.kind = 'CASH';
  if v_cash_net < 0 then
    select coalesce(sum(amount_cents), 0) into v_available_cash
    from public.cash_movements where session_id = v_session.id;
    if v_available_cash + v_cash_net < 0 then
      raise exception 'INSUFFICIENT_CASH' using errcode = 'P0001';
    end if;
  end if;
  if v_cash_net <> 0 then
    perform set_config('app.cash_write', 'on', true);
    insert into public.cash_movements(session_id, location_id, movement_type, amount_cents,
      reason, reference_type, reference_id, user_id, metadata)
    values (v_session.id, v_session.location_id, 'RETURN', v_cash_net, btrim(p_reason),
      'RETURN', v_return.id::text, v_actor,
      jsonb_build_object('folio', v_return.folio, 'original_sale_id', v_sale.id));
    perform set_config('app.cash_write', 'off', true);
  end if;
  update app.supervisor_authorizations set used_at = now(), resource_id = v_return.id
  where id = v_authorization.id;
  update public.idempotency_keys set resource_id = v_return.id where key = p_idempotency_key;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, after_data, metadata)
  values (v_actor, case when v_type = 'RETURN' then 'return.created' else 'exchange.created' end,
    'returns', v_return.id::text, v_return.location_id, to_jsonb(v_return),
    jsonb_build_object('original_sale_id', v_sale.id, 'authorization_id', v_authorization.id,
      'refund_same_method', v_refund_total > 0, 'items_in', jsonb_array_length(p_items_in),
      'items_out', jsonb_array_length(coalesce(p_items_out, '[]'))));
  return jsonb_build_object('id', v_return.id, 'folio', v_return.folio, 'type', v_return.type,
    'returned_cents', v_return.returned_cents, 'delivered_cents', v_return.delivered_cents,
    'difference_cents', v_return.difference_cents,
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('direction', rp.direction,
      'method_code', rp.method_code, 'amount_cents', rp.amount_cents, 'reference', rp.reference)), '[]'::jsonb)
      from public.return_payments rp where rp.return_id = v_return.id));
end;
$$;

commit;
