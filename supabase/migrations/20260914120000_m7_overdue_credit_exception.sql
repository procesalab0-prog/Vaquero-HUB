begin;

-- Ruta separada para la excepción: la venta a crédito normal permanece
-- intacta. Este RPC sólo acepta una cuenta actualmente vencida y un token
-- ADMIN de un solo uso emitido para el cajero que está cobrando.
create function public.create_overdue_credit_sale(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid,
  p_due_date date,
  p_overdue_authorization_token uuid,
  p_override_reason text,
  p_discounts jsonb default '[]'::jsonb,
  p_notes text default null
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_sale public.sales;
  v_account public.customer_credit_accounts;
  v_existing_charge public.customer_credit_ledger;
  v_authorization app.supervisor_authorizations;
  v_credit_cents bigint;
  v_balance bigint;
  v_overdue_balance bigint;
  v_oldest_due date;
  v_supervisor_role text;
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not (select app.has_perm('pos.sell')) or not (select app.has_perm('credit.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_customer_id is null or p_due_date is null or p_due_date < current_date
     or p_overdue_authorization_token is null
     or length(btrim(coalesce(p_override_reason, ''))) not between 3 and 500
     or jsonb_typeof(p_payments) <> 'array'
     or jsonb_array_length(p_payments) not between 1 and 10
     or (select count(*) from jsonb_array_elements(p_payments) p
         where upper(p->>'method_code') = 'CREDIT') <> 1 then
    raise exception 'INVALID_CREDIT_SALE' using errcode = '22023';
  end if;
  begin
    select (p->>'amount_cents')::bigint into v_credit_cents
    from jsonb_array_elements(p_payments) p
    where upper(p->>'method_code') = 'CREDIT';
  exception when others then
    raise exception 'INVALID_CREDIT_SALE' using errcode = '22023';
  end;
  if v_credit_cents is null or v_credit_cents <= 0 then
    raise exception 'INVALID_CREDIT_SALE' using errcode = '22023';
  end if;

  -- Una sola cola por cliente evita que dos cajas gasten juntas el límite o
  -- que una excepción observe un saldo distinto al que finalmente autoriza.
  perform pg_advisory_xact_lock(hashtextextended('customer-credit:' || p_customer_id::text, 0));

  perform set_config('app.credit_sale_write', 'on', true);
  v_sale := public.create_sale(
    p_idempotency_key, p_cash_session_id, p_items, p_payments,
    p_customer_id, p_discounts, p_notes
  );
  perform set_config('app.credit_sale_write', 'off', true);

  -- Un reintento idéntico recupera la venta ya confirmada aunque el token ya
  -- esté consumido. create_sale validó antes el hash de idempotencia.
  select * into v_existing_charge
  from public.customer_credit_ledger
  where entry_type = 'CHARGE' and reference_type = 'SALE' and reference_id = v_sale.id::text;
  if found then
    if v_existing_charge.customer_id <> p_customer_id
       or v_existing_charge.amount_cents <> v_credit_cents
       or v_existing_charge.due_date <> p_due_date
       or coalesce(v_existing_charge.metadata->>'override_reason', '')
          <> btrim(p_override_reason) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_sale;
  end if;

  select * into v_account from public.customer_credit_accounts
  where customer_id = p_customer_id for update;
  if not found or not v_account.is_authorized then
    raise exception 'CREDIT_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_balance := (select app.credit_balance(p_customer_id));
  v_oldest_due := (select app.credit_oldest_due(p_customer_id));
  if v_oldest_due is null or v_oldest_due >= current_date then
    raise exception 'CREDIT_OVERRIDE_NOT_REQUIRED' using errcode = '22023';
  end if;
  if v_balance + v_credit_cents > v_account.limit_cents then
    raise exception 'CREDIT_LIMIT_EXCEEDED' using errcode = '23514';
  end if;

  select sa, r.code into v_authorization, v_supervisor_role
  from app.supervisor_authorizations sa
  join public.app_users u on u.id = sa.supervisor_user_id and u.is_active
  join public.roles r on r.id = u.role_id
  where sa.id = p_overdue_authorization_token
    and sa.actor_user_id = v_actor
    and sa.permission_code = 'credit.override'
    and sa.used_at is null
    and sa.expires_at > now()
  for update of sa;
  if not found or v_supervisor_role <> 'ADMIN' then
    raise exception 'CREDIT_OVERDUE_OVERRIDE_REQUIRED' using errcode = '42501';
  end if;

  select coalesce(sum(app.credit_charge_outstanding(l.id)), 0)::bigint
    into v_overdue_balance
  from public.customer_credit_ledger l
  where l.customer_id = p_customer_id
    and l.entry_type = 'CHARGE'
    and l.due_date < current_date;

  perform set_config('app.sales_write', 'on', true);
  update public.sales set
    credit_amount_cents = v_credit_cents,
    credit_due_date = p_due_date
  where id = v_sale.id
  returning * into v_sale;
  perform set_config('app.sales_write', 'off', true);

  perform set_config('app.credit_write', 'on', true);
  insert into public.customer_credit_ledger (
    customer_id, entry_type, amount_cents, due_date, location_id,
    actor_user_id, reference_type, reference_id, metadata
  ) values (
    p_customer_id, 'CHARGE', v_credit_cents, p_due_date, v_sale.location_id,
    v_actor, 'SALE', v_sale.id::text,
    jsonb_build_object('folio', v_sale.folio, 'sale_total_cents', v_sale.total_cents,
      'overdue_exception_authorization_id', v_authorization.id,
      'override_reason', btrim(p_override_reason))
  );
  perform set_config('app.credit_write', 'off', true);

  update app.supervisor_authorizations
  set used_at = now(), resource_id = v_sale.id
  where id = v_authorization.id;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    v_actor, 'customer_credit.overdue_exception_used', 'sales', v_sale.id::text,
    v_sale.location_id,
    jsonb_build_object(
      'authorization_id', v_authorization.id,
      'authorized_by', v_authorization.supervisor_user_id,
      'customer_id', p_customer_id,
      'oldest_due_date', v_oldest_due,
      'overdue_balance_cents', v_overdue_balance,
      'credit_cents', v_credit_cents,
      'new_due_date', p_due_date,
      'reason', btrim(p_override_reason)
    )
  );
  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    v_actor, 'customer_credit.sale_created', 'sales', v_sale.id::text,
    v_sale.location_id,
    jsonb_build_object('customer_id', p_customer_id, 'credit_cents', v_credit_cents,
      'due_date', p_due_date, 'balance_before_cents', v_balance,
      'balance_after_cents', v_balance + v_credit_cents,
      'overdue_exception_authorization_id', v_authorization.id)
  );
  return v_sale;
end;
$$;

revoke execute on function public.create_overdue_credit_sale(
  uuid, uuid, jsonb, jsonb, uuid, date, uuid, text, jsonb, text
) from public, anon;
grant execute on function public.create_overdue_credit_sale(
  uuid, uuid, jsonb, jsonb, uuid, date, uuid, text, jsonb, text
) to authenticated, service_role;

comment on function public.create_overdue_credit_sale(
  uuid, uuid, jsonb, jsonb, uuid, date, uuid, text, jsonb, text
) is 'Excepción puntual para una venta a crédito vencida; exige token ADMIN de un solo uso y audita el saldo vencido sin modificarlo.';

commit;
