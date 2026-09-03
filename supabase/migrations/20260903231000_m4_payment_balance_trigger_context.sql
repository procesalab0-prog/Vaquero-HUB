begin;

-- El constraint trigger debe leer el ledger privado al finalizar la transacción.
-- Se ejecuta como propietario y conserva el acceso directo denegado al cajero.
create or replace function app.check_sale_payment_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id uuid := coalesce(new.sale_id, old.sale_id);
  v_total bigint;
  v_paid bigint;
begin
  select total_cents
  into v_total
  from public.sales
  where id = v_sale_id;

  select coalesce(sum(amount_cents), 0)
  into v_paid
  from public.sale_payments
  where sale_id = v_sale_id;

  if v_total is not null and v_paid <> v_total then
    raise exception 'PAYMENT_TOTAL_MISMATCH' using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function app.check_sale_payment_balance()
from public, anon, authenticated, service_role;

commit;
