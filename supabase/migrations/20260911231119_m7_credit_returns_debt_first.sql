begin;

-- M7.2 · Las devoluciones de ventas a crédito reducen primero la deuda.
-- Sólo el excedente que ya fue pagado se reembolsa por sus métodos reales.

create table public.customer_credit_return_settlements (
  return_id uuid primary key references public.returns(id),
  charge_ledger_id uuid not null references public.customer_credit_ledger(id),
  ledger_entry_id uuid unique references public.customer_credit_ledger(id),
  total_return_cents bigint not null check (total_return_cents > 0),
  debt_reduction_cents bigint not null check (debt_reduction_cents >= 0),
  paid_refund_cents bigint not null check (paid_refund_cents >= 0),
  created_at timestamptz not null default now(),
  constraint credit_return_settlement_balance check (
    total_return_cents = debt_reduction_cents + paid_refund_cents
  ),
  constraint credit_return_settlement_ledger check (
    (debt_reduction_cents = 0 and ledger_entry_id is null)
    or (debt_reduction_cents > 0 and ledger_entry_id is not null)
  )
);
create index customer_credit_return_settlements_charge_idx
  on public.customer_credit_return_settlements (charge_ledger_id, created_at);

create trigger customer_credit_return_settlements_guard
before insert or update or delete on public.customer_credit_return_settlements
for each row execute function app.guard_credit_payment_ledger();

create or replace function app.check_credit_return_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns;
  v_charge public.customer_credit_ledger;
  v_entry public.customer_credit_ledger;
begin
  select * into v_return from public.returns where id = new.return_id;
  select * into v_charge from public.customer_credit_ledger
  where id = new.charge_ledger_id and entry_type = 'CHARGE'
    and reference_type = 'SALE';
  if v_return.id is null or v_charge.id is null
     or v_charge.reference_id <> v_return.original_sale_id::text
     or new.total_return_cents <> -v_return.difference_cents then
    raise exception 'CREDIT_RETURN_SETTLEMENT_MISMATCH' using errcode = '23514';
  end if;
  if new.debt_reduction_cents > 0 then
    select * into v_entry from public.customer_credit_ledger
    where id = new.ledger_entry_id and entry_type = 'RETURN';
    if v_entry.id is null or v_entry.customer_id <> v_charge.customer_id
       or v_entry.amount_cents <> -new.debt_reduction_cents
       or v_entry.reference_type <> 'RETURN'
       or v_entry.reference_id <> new.return_id::text then
      raise exception 'CREDIT_RETURN_LEDGER_MISMATCH' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create constraint trigger credit_return_settlement_integrity
after insert or update on public.customer_credit_return_settlements
deferrable initially deferred for each row
execute function app.check_credit_return_settlement();

alter table public.customer_credit_return_settlements enable row level security;
revoke all on public.customer_credit_return_settlements
  from public, anon, authenticated, service_role;
grant select on public.customer_credit_return_settlements to service_role;

create or replace function app.credit_charge_outstanding(p_charge_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select amount_cents from public.customer_credit_ledger
      where id = p_charge_id and entry_type = 'CHARGE'), 0)
    - coalesce((select sum(amount_cents) from public.customer_credit_allocations
      where charge_ledger_id = p_charge_id), 0),
    0
  )::bigint
$$;

create or replace function app.check_return_payment_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return_id uuid;
  v_expected bigint;
  v_actual bigint;
begin
  if tg_table_name = 'returns' then
    v_return_id := coalesce(new.id, old.id);
  else
    v_return_id := coalesce(new.return_id, old.return_id);
  end if;
  select difference_cents into v_expected
  from public.returns where id = v_return_id;
  if not found then return null; end if;
  select
    coalesce((select sum(case when direction = 'CHARGE'
      then amount_cents else -amount_cents end)
      from public.return_payments where return_id = v_return_id), 0)
    - coalesce((select debt_reduction_cents
      from public.customer_credit_return_settlements
      where return_id = v_return_id), 0)
  into v_actual;
  if v_actual <> v_expected then
    raise exception 'RETURN_PAYMENT_TOTAL_MISMATCH' using errcode = '23514';
  end if;
  return null;
end;
$$;

-- La misma tabla FIFO enlaza pagos y documentos compensatorios con el cargo.
-- Así record_customer_credit_payment ve las reducciones anteriores sin tener
-- que mantener una segunda definición de "saldo pendiente".
create or replace function app.check_credit_allocation_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid := coalesce(new.payment_ledger_id, old.payment_ledger_id);
  v_charge_id uuid := coalesce(new.charge_ledger_id, old.charge_ledger_id);
  v_payment_amount bigint;
  v_charge_amount bigint;
  v_allocated_payment bigint;
  v_allocated_charge bigint;
begin
  select -amount_cents into v_payment_amount
  from public.customer_credit_ledger
  where id = v_payment_id
    and entry_type in ('PAYMENT', 'RETURN', 'CANCELLATION')
    and amount_cents < 0;
  select amount_cents into v_charge_amount
  from public.customer_credit_ledger
  where id = v_charge_id and entry_type = 'CHARGE';
  if v_payment_amount is null or v_charge_amount is null then
    raise exception 'INVALID_CREDIT_ALLOCATION' using errcode = '23514';
  end if;
  select coalesce(sum(amount_cents), 0)::bigint into v_allocated_payment
  from public.customer_credit_allocations where payment_ledger_id = v_payment_id;
  select coalesce(sum(amount_cents), 0)::bigint into v_allocated_charge
  from public.customer_credit_allocations where charge_ledger_id = v_charge_id;
  if v_allocated_payment <> v_payment_amount
     or v_allocated_charge > v_charge_amount then
    raise exception 'CREDIT_ALLOCATION_MISMATCH' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

-- Dinero real disponible para reembolsar una venta a crédito. Incluye el
-- pago inicial y los abonos FIFO que quedaron aplicados a ese cargo. Los
-- abonos mixtos se reparten en centavos exactos y de forma determinista.
create or replace function app.credit_paid_sources_for_charge(p_charge_id uuid)
returns table (
  method_code text,
  method_name text,
  requires_reference boolean,
  sort_order integer,
  available_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with charge as (
    select l.reference_id::uuid sale_id
    from public.customer_credit_ledger l
    where l.id = p_charge_id and l.entry_type = 'CHARGE'
      and l.reference_type = 'SALE'
  ), allocation_parts as (
    select a.id allocation_id, pp.method_code, pm.name method_name,
      pm.requires_reference, pm.sort_order, a.amount_cents allocation_cents,
      floor(a.amount_cents::numeric * pp.amount_cents / cp.total_cents)::bigint base,
      (a.amount_cents::numeric * pp.amount_cents / cp.total_cents)
        - floor(a.amount_cents::numeric * pp.amount_cents / cp.total_cents) fraction
    from public.customer_credit_allocations a
    join public.customer_credit_ledger pl on pl.id = a.payment_ledger_id
      and pl.entry_type = 'PAYMENT' and pl.reference_type = 'CREDIT_PAYMENT'
    join public.customer_credit_payments cp on cp.id = pl.reference_id::uuid
    join public.customer_credit_payment_parts pp on pp.credit_payment_id = cp.id
    join public.payment_methods pm on pm.code = pp.method_code
    where a.charge_ledger_id = p_charge_id
  ), allocated_ranked as (
    select ap.*,
      row_number() over (
        partition by ap.allocation_id
        order by ap.fraction desc, ap.sort_order, ap.method_code
      ) rn,
      ap.allocation_cents - sum(ap.base) over (
        partition by ap.allocation_id
      ) remainder
    from allocation_parts ap
  ), sources as (
    select sp.method_code, pm.name method_name, pm.requires_reference,
      pm.sort_order, sp.amount_cents
    from charge c
    join public.sale_payments sp on sp.sale_id = c.sale_id
      and sp.method_code <> 'CREDIT'
    join public.payment_methods pm on pm.code = sp.method_code
    union all
    select ar.method_code, ar.method_name, ar.requires_reference, ar.sort_order,
      ar.base + case when ar.rn <= ar.remainder then 1 else 0 end
    from allocated_ranked ar
  ), source_totals as (
    select s.method_code, max(s.method_name) method_name,
      bool_or(s.requires_reference) requires_reference,
      min(s.sort_order) sort_order, sum(s.amount_cents)::bigint source_cents
    from sources s group by s.method_code
  ), refunded as (
    select rp.method_code, sum(rp.amount_cents)::bigint refunded_cents
    from charge c
    join public.returns r on r.original_sale_id = c.sale_id
    join public.return_payments rp on rp.return_id = r.id
      and rp.direction = 'REFUND'
    group by rp.method_code
  )
  select st.method_code, st.method_name, st.requires_reference, st.sort_order,
    greatest(st.source_cents - coalesce(r.refunded_cents, 0), 0)::bigint
  from source_totals st
  left join refunded r on r.method_code = st.method_code
  where st.source_cents - coalesce(r.refunded_cents, 0) > 0
$$;

create or replace function app.settle_credit_return_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns;
  v_sale public.sales;
  v_charge public.customer_credit_ledger;
  v_existing public.customer_credit_return_settlements;
  v_total bigint;
  v_outstanding bigint;
  v_debt bigint;
  v_paid bigint;
  v_available bigint;
  v_ledger_id uuid;
  v_refs jsonb := coalesce(nullif(current_setting('app.credit_refund_references', true), '')::jsonb, '[]'::jsonb);
  v_source record;
  v_reference text;
begin
  if new.direction <> 'REFUND'
     or coalesce(current_setting('app.credit_refund_write', true), 'off') = 'on' then
    return new;
  end if;

  select r.* into v_return from public.returns r where r.id = new.return_id;
  if not found or v_return.difference_cents >= 0 then return new; end if;
  select s.* into v_sale from public.sales s where s.id = v_return.original_sale_id;
  select l.* into v_charge from public.customer_credit_ledger l
  where l.entry_type = 'CHARGE' and l.reference_type = 'SALE'
    and l.reference_id = v_sale.id::text;
  if not found then return new; end if;

  select s.* into v_existing
  from public.customer_credit_return_settlements s
  where s.return_id = v_return.id;
  if found then return null; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('customer-credit:' || v_charge.customer_id::text, 0)
  );
  v_total := -v_return.difference_cents;
  v_outstanding := app.credit_charge_outstanding(v_charge.id);
  v_debt := least(v_total, v_outstanding);
  v_paid := v_total - v_debt;
  select coalesce(sum(s.available_cents), 0)::bigint into v_available
  from app.credit_paid_sources_for_charge(v_charge.id) s;
  if v_available < v_paid then
    raise exception 'CREDIT_REFUND_EXCEEDS_PAID' using errcode = '23514';
  end if;

  perform set_config('app.credit_write', 'on', true);
  if v_debt > 0 then
    insert into public.customer_credit_ledger (
      customer_id, entry_type, amount_cents, location_id, actor_user_id,
      reference_type, reference_id, reason, metadata
    ) values (
      v_charge.customer_id, 'RETURN', -v_debt, v_return.location_id,
      v_return.created_by, 'RETURN', v_return.id::text, v_return.reason,
      jsonb_build_object('folio', v_return.folio,
        'original_sale_id', v_sale.id, 'charge_ledger_id', v_charge.id)
    ) returning id into v_ledger_id;
    insert into public.customer_credit_allocations (
      payment_ledger_id, charge_ledger_id, amount_cents
    ) values (v_ledger_id, v_charge.id, v_debt);
  end if;
  insert into public.customer_credit_return_settlements (
    return_id, charge_ledger_id, ledger_entry_id, total_return_cents,
    debt_reduction_cents, paid_refund_cents
  ) values (
    v_return.id, v_charge.id, v_ledger_id, v_total, v_debt, v_paid
  );

  if v_paid > 0 then
    perform set_config('app.credit_refund_write', 'on', true);
    for v_source in
      with available as (
        select s.*,
          floor(s.available_cents::numeric * v_paid
            / sum(s.available_cents) over())::bigint base,
          (s.available_cents::numeric * v_paid / sum(s.available_cents) over())
            - floor(s.available_cents::numeric * v_paid
              / sum(s.available_cents) over()) fraction
        from app.credit_paid_sources_for_charge(v_charge.id) s
      ), ranked as (
        select a.*,
          row_number() over (order by a.fraction desc, a.sort_order, a.method_code) rn,
          v_paid - sum(a.base) over() remainder
        from available a
      )
      select r.*, r.base + case when r.rn <= r.remainder then 1 else 0 end refund_cents
      from ranked r
      where r.base + case when r.rn <= r.remainder then 1 else 0 end > 0
      order by r.sort_order, r.method_code
    loop
      select nullif(btrim(x.reference), '') into v_reference
      from jsonb_to_recordset(v_refs) x(method_code text, reference text)
      where upper(x.method_code) = v_source.method_code;
      if v_source.requires_reference and length(coalesce(v_reference, '')) < 3 then
        raise exception 'REFUND_REFERENCE_REQUIRED' using errcode = '22023';
      end if;
      insert into public.return_payments (
        return_id, direction, method_code, amount_cents, reference
      ) values (
        v_return.id, 'REFUND', v_source.method_code,
        v_source.refund_cents, v_reference
      );
    end loop;
    perform set_config('app.credit_refund_write', 'off', true);
  end if;
  perform set_config('app.credit_write', 'off', true);

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    v_return.created_by, 'customer_credit.return_settled', 'returns',
    v_return.id::text, v_return.location_id,
    jsonb_build_object('customer_id', v_charge.customer_id,
      'charge_ledger_id', v_charge.id, 'total_return_cents', v_total,
      'debt_reduction_cents', v_debt, 'paid_refund_cents', v_paid,
      'balance_after_cents', app.credit_balance(v_charge.customer_id))
  );
  return null;
end;
$$;

create trigger credit_return_settlement
before insert on public.return_payments
for each row execute function app.settle_credit_return_payment();

-- La función M5 sigue intacta y queda detrás de un envoltorio. Así esta
-- migración avanza sin reescribir un archivo ya aplicado.
alter function public.create_return_exchange(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid, text
) set schema app;
alter function app.create_return_exchange(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid, text
) rename to create_return_exchange_base;

create function public.create_return_exchange(
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
  v_result jsonb;
  v_base_refs jsonb := coalesce(p_refund_references, '[]'::jsonb);
  v_settlement public.customer_credit_return_settlements;
begin
  if exists (
    select 1 from public.customer_credit_ledger l
    where l.entry_type = 'CHARGE' and l.reference_type = 'SALE'
      and l.reference_id = p_original_sale_id::text
  ) then
    perform set_config('app.credit_refund_references',
      coalesce(p_refund_references, '[]'::jsonb)::text, true);
    -- M5 exigía referencias para todo método original antes de saber cuánto
    -- correspondía a deuda. Estos valores internos sólo atraviesan esa
    -- validación; el disparador exige y guarda las referencias reales.
    select coalesce(jsonb_agg(jsonb_build_object(
      'method_code', methods.method_code,
      'reference', coalesce(refs.reference, 'NO_APLICA_DEUDA')
    )), '[]'::jsonb) into v_base_refs
    from (
      select pm.code method_code
      from public.sale_payments sp
      join public.payment_methods pm on pm.code = sp.method_code
      where sp.sale_id = p_original_sale_id and pm.requires_reference
    ) methods
    left join lateral (
      select x.reference
      from jsonb_to_recordset(coalesce(p_refund_references, '[]'::jsonb))
        x(method_code text, reference text)
      where upper(x.method_code) = methods.method_code
    ) refs on true;
  end if;

  v_result := app.create_return_exchange_base(
    p_idempotency_key, p_cash_session_id, p_original_sale_id, p_items_in,
    p_items_out, p_charge_payments, v_base_refs,
    p_authorization_token, p_reason
  );
  select s.* into v_settlement
  from public.customer_credit_return_settlements s
  where s.return_id = (v_result->>'id')::uuid;
  if found then
    v_result := v_result || jsonb_build_object('credit_settlement',
      jsonb_build_object('debt_reduction_cents', v_settlement.debt_reduction_cents,
        'paid_refund_cents', v_settlement.paid_refund_cents));
  end if;
  return v_result;
end;
$$;

-- La cancelación M4 no conoce abonos ni referencias de reembolso. Hasta que
-- la compensación completa use el mismo motor anterior, una venta a crédito
-- se rechaza antes de mover inventario, caja o estado: nunca queda cancelada
-- con la deuda todavía abierta.
alter function public.cancel_sale(uuid, text) set schema app;
alter function app.cancel_sale(uuid, text) rename to cancel_sale_base;

create function public.cancel_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.customer_credit_ledger l
    where l.entry_type = 'CHARGE' and l.reference_type = 'SALE'
      and l.reference_id = p_sale_id::text
  ) then
    raise exception 'CREDIT_CANCELLATION_REQUIRES_RETURN'
      using errcode = '0A000';
  end if;
  return app.cancel_sale_base(p_sale_id, p_reason);
end;
$$;

-- La preparación ya no presenta CREDIT como dinero. Muestra únicamente los
-- métodos reales disponibles, incluyendo abonos aplicados al cargo.
create or replace function public.get_returnable_sale(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_result jsonb;
  v_charge_id uuid;
begin
  if v_actor is null or not (select app.has_perm('returns.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select l.id into v_charge_id from public.customer_credit_ledger l
  where l.entry_type = 'CHARGE' and l.reference_type = 'SALE'
    and l.reference_id = p_sale_id::text;
  select jsonb_build_object(
    'id', s.id, 'folio', s.folio, 'status', s.status, 'sold_at', s.sold_at,
    'total_cents', s.total_cents, 'location_id', s.location_id,
    'customer_id', s.customer_id,
    'window_days', coalesce(rp.window_days, 15),
    'return_deadline', s.sold_at + make_interval(days => coalesce(rp.window_days, 15)),
    'within_window', now() <= s.sold_at + make_interval(days => coalesce(rp.window_days, 15)),
    'credit_outstanding_cents', case when v_charge_id is null then 0
      else app.credit_charge_outstanding(v_charge_id) end,
    'payments', case when v_charge_id is not null then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'method_code', ps.method_code, 'method_name', ps.method_name,
        'amount_cents', ps.available_cents,
        'requires_reference', ps.requires_reference
      ) order by ps.sort_order), '[]'::jsonb)
      from app.credit_paid_sources_for_charge(v_charge_id) ps
    ) else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'method_code', sp.method_code, 'method_name', pm.name,
        'amount_cents', sp.amount_cents, 'requires_reference', pm.requires_reference
      ) order by pm.sort_order), '[]'::jsonb)
      from public.sale_payments sp
      join public.payment_methods pm on pm.code = sp.method_code
      where sp.sale_id = s.id
    ) end,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'sale_item_id', si.id, 'variant_id', si.variant_id,
      'product_name', si.product_name, 'variant_description', si.variant_description,
      'sku', si.sku, 'quantity', si.quantity,
      'remaining_quantity', si.quantity - coalesce(pr.returned_qty, 0),
      'paid_line_cents', si.line_total_cents - si.ticket_discount_cents,
      'already_returned_cents', coalesce(pr.returned_cents, 0)
    ) order by si.line_number), '[]'::jsonb)
      from public.sale_items si
      left join lateral (
        select sum(ri.quantity) returned_qty, sum(ri.line_total_cents) returned_cents
        from public.return_items ri
        where ri.sale_item_id = si.id and ri.direction = 'IN'
      ) pr on true where si.sale_id = s.id)
  ) into v_result
  from public.sales s
  left join public.return_policies rp on rp.location_id = s.location_id
  where s.id = p_sale_id and (select app.can_access_location(s.location_id));
  if v_result is null then raise exception 'SALE_NOT_FOUND' using errcode = '22023'; end if;
  return v_result;
end;
$$;

revoke execute on function app.credit_paid_sources_for_charge(uuid)
  from public, anon, authenticated;
revoke execute on function app.settle_credit_return_payment()
  from public, anon, authenticated, service_role;
revoke execute on function app.check_credit_return_settlement()
  from public, anon, authenticated, service_role;
revoke execute on function app.create_return_exchange_base(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid, text
) from public, anon, authenticated, service_role;
revoke execute on function app.cancel_sale_base(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_return_exchange(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid, text
) from public, anon;
grant execute on function public.create_return_exchange(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid, text
) to authenticated, service_role;
revoke execute on function public.cancel_sale(uuid, text) from public, anon;
grant execute on function public.cancel_sale(uuid, text)
  to authenticated, service_role;

comment on table public.customer_credit_return_settlements is
  'Conciliación inmutable: cuánto de una devolución redujo deuda y cuánto fue dinero realmente reembolsado.';
comment on table public.customer_credit_allocations is
  'Aplicación FIFO de pagos y documentos compensatorios a cargos; permite conocer cada vencimiento abierto sin sobrescribir saldos.';

commit;
