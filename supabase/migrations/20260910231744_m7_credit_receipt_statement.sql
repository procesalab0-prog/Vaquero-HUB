begin;

-- Un abono ya se registraba de forma inmutable, pero faltaba un comprobante
-- recuperable después del redirect y listo para imprimir o compartir.
create or replace function public.get_customer_credit_payment_receipt(
  p_payment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_result jsonb;
  v_location_id uuid;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not ((select app.has_perm('credit.collect'))
      or (select app.has_perm('customers.credit'))
      or (select app.has_perm('reports.sales'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select p.location_id into v_location_id
  from public.customer_credit_payments p
  where p.id = p_payment_id;
  if v_location_id is null then
    raise exception 'CREDIT_PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (select app.can_access_location(v_location_id)) then
    raise exception 'LOCATION_NOT_ALLOWED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'folio', p.folio,
    'received_at', p.received_at,
    'total_cents', p.total_cents,
    'note', p.note,
    'customer_id', c.id,
    'customer_name', c.full_name,
    'member_number', c.member_number,
    'location_name', l.name,
    'location_address', l.address,
    'location_phone', l.phone,
    'cashier_name', u.full_name,
    'register_name', r.name,
    'balance_cents', (select app.credit_balance(c.id)),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'method_code', pp.method_code,
        'method_name', pm.name,
        'amount_cents', pp.amount_cents,
        'reference', pp.reference
      ) order by pm.sort_order, pp.id)
      from public.customer_credit_payment_parts pp
      join public.payment_methods pm on pm.code = pp.method_code
      where pp.credit_payment_id = p.id
    ), '[]'::jsonb)
  ) into v_result
  from public.customer_credit_payments p
  join public.customers c on c.id = p.customer_id
  join public.locations l on l.id = p.location_id
  join public.app_users u on u.id = p.actor_user_id
  join public.cash_sessions s on s.id = p.cash_session_id
  join public.cash_registers r on r.id = s.register_id
  where p.id = p_payment_id and not c.is_anonymized;

  if v_result is null then
    raise exception 'CREDIT_PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

revoke execute on function public.get_customer_credit_payment_receipt(uuid)
  from public, anon;
grant execute on function public.get_customer_credit_payment_receipt(uuid)
  to authenticated, service_role;

commit;
begin;

create or replace function public.get_customer_credit_payment_receipt(
  p_payment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_result jsonb;
  v_location_id uuid;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not ((select app.has_perm('credit.collect'))
      or (select app.has_perm('customers.credit'))
      or (select app.has_perm('reports.sales'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select p.location_id into v_location_id
  from public.customer_credit_payments p where p.id = p_payment_id;
  if v_location_id is null then
    raise exception 'CREDIT_PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (select app.can_access_location(v_location_id)) then
    raise exception 'LOCATION_NOT_ALLOWED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', p.id, 'folio', p.folio, 'received_at', p.received_at,
    'total_cents', p.total_cents, 'note', p.note,
    'customer_name', c.full_name, 'member_number', c.member_number,
    'location_name', l.name, 'cashier_name', u.full_name,
    'register_name', r.name,
    'balance_cents', (select app.credit_balance(c.id)),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'method_code', pp.method_code, 'method_name', pm.name,
        'amount_cents', pp.amount_cents, 'reference', pp.reference
      ) order by pm.sort_order, pp.id)
      from public.customer_credit_payment_parts pp
      join public.payment_methods pm on pm.code = pp.method_code
      where pp.credit_payment_id = p.id
    ), '[]'::jsonb)
  ) into v_result
  from public.customer_credit_payments p
  join public.customers c on c.id = p.customer_id
  join public.locations l on l.id = p.location_id
  join public.app_users u on u.id = p.actor_user_id
  join public.cash_sessions s on s.id = p.cash_session_id
  join public.cash_registers r on r.id = s.register_id
  where p.id = p_payment_id and not c.is_anonymized;

  if v_result is null then
    raise exception 'CREDIT_PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

revoke execute on function public.get_customer_credit_payment_receipt(uuid)
  from public, anon;
grant execute on function public.get_customer_credit_payment_receipt(uuid)
  to authenticated, service_role;

commit;
