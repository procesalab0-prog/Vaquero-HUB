begin;

-- La primera versión calculaba el id en DECLARE con un CASE que mencionaba
-- columnas de dos tablas distintas. PostgreSQL valida ambas referencias y al
-- dispararse sobre `sales` intentaba resolver `new.sale_id`, que no existe.
-- Se corrige hacia delante porque la migración original ya corrió en staging.
create or replace function app.check_credit_sale_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id uuid;
  v_sale public.sales;
  v_credit bigint;
  v_charge public.customer_credit_ledger;
begin
  if tg_table_name = 'sales' then
    v_sale_id := coalesce(new.id, old.id);
  else
    v_sale_id := coalesce(new.sale_id, old.sale_id);
  end if;

  select * into v_sale from public.sales where id = v_sale_id;
  if not found then return coalesce(new, old); end if;
  select coalesce(sum(amount_cents), 0)::bigint into v_credit
  from public.sale_payments where sale_id = v_sale_id and method_code = 'CREDIT';
  select * into v_charge
  from public.customer_credit_ledger
  where entry_type = 'CHARGE' and reference_type = 'SALE' and reference_id = v_sale_id::text;

  if v_credit <> v_sale.credit_amount_cents
     or (v_credit > 0 and (
       v_sale.customer_id is null
       or v_sale.credit_due_date is null
       or v_charge.id is null
       or v_charge.customer_id <> v_sale.customer_id
       or v_charge.amount_cents <> v_credit
       or v_charge.due_date <> v_sale.credit_due_date
     ))
     or (v_credit = 0 and (v_sale.credit_due_date is not null or v_charge.id is not null)) then
    raise exception 'CREDIT_SALE_LEDGER_MISMATCH' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function app.check_credit_sale_integrity()
  from public, anon, authenticated, service_role;

commit;
