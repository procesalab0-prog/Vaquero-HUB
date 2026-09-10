begin;

-- Esta migración se agrega hacia delante: 20260910211324 ya fue ejecutada en
-- staging y no se vuelve a editar, aunque esta entrega aún no estuviera en main.

create or replace function app.check_credit_payment_parts_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid := coalesce(new.credit_payment_id, old.credit_payment_id);
  v_expected bigint;
  v_actual bigint;
begin
  select total_cents into v_expected
  from public.customer_credit_payments where id = v_payment_id;
  select coalesce(sum(amount_cents), 0)::bigint into v_actual
  from public.customer_credit_payment_parts where credit_payment_id = v_payment_id;
  if v_expected is not null and v_expected <> v_actual then
    raise exception 'CREDIT_PAYMENT_PARTS_MISMATCH' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'credit_payment_parts_balance'
      and tgrelid = 'public.customer_credit_payment_parts'::regclass
  ) then
    create constraint trigger credit_payment_parts_balance
    after insert or update or delete on public.customer_credit_payment_parts
    deferrable initially deferred for each row
    execute function app.check_credit_payment_parts_balance();
  end if;
end;
$$;

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
  from public.customer_credit_ledger where id = v_payment_id and entry_type = 'PAYMENT';
  select amount_cents into v_charge_amount
  from public.customer_credit_ledger where id = v_charge_id and entry_type = 'CHARGE';
  if v_payment_amount is null or v_charge_amount is null then
    raise exception 'INVALID_CREDIT_ALLOCATION' using errcode = '23514';
  end if;
  select coalesce(sum(amount_cents), 0)::bigint into v_allocated_payment
  from public.customer_credit_allocations where payment_ledger_id = v_payment_id;
  select coalesce(sum(amount_cents), 0)::bigint into v_allocated_charge
  from public.customer_credit_allocations where charge_ledger_id = v_charge_id;
  if v_allocated_payment <> v_payment_amount or v_allocated_charge > v_charge_amount then
    raise exception 'CREDIT_ALLOCATION_MISMATCH' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'credit_allocation_balance'
      and tgrelid = 'public.customer_credit_allocations'::regclass
  ) then
    create constraint trigger credit_allocation_balance
    after insert or update or delete on public.customer_credit_allocations
    deferrable initially deferred for each row
    execute function app.check_credit_allocation_balance();
  end if;
end;
$$;

-- M5 distribuye reembolsos entre métodos pagados. El crédito no es dinero
-- pagado y debe reducir deuda antes de reembolsar; hasta integrar esa regla
-- completa, una devolución con saldo a crédito se rechaza de forma atómica.
create or replace function app.guard_credit_return_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'REFUND' and new.method_code = 'CREDIT' then
    raise exception 'CREDIT_RETURN_REQUIRES_DEBT_SETTLEMENT' using errcode = '0A000';
  end if;
  return new;
end;
$$;
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'return_payments_credit_guard'
      and tgrelid = 'public.return_payments'::regclass
  ) then
    create trigger return_payments_credit_guard
    before insert on public.return_payments
    for each row execute function app.guard_credit_return_payment();
  end if;
end;
$$;

revoke execute on function app.check_credit_payment_parts_balance()
  from public, anon, authenticated, service_role;
revoke execute on function app.check_credit_allocation_balance()
  from public, anon, authenticated, service_role;
revoke execute on function app.guard_credit_return_payment()
  from public, anon, authenticated, service_role;

commit;
