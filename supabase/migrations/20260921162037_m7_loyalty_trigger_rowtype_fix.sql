begin;

-- Las funciones originales compartían un CASE entre tablas con formas de fila
-- distintas. PL/pgSQL valida el acceso a campos antes de elegir la rama, por lo
-- que sales no puede leer sale_id y returns no puede leer return_id.
create or replace function app.loyalty_sale_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'sales' then
    perform app.sync_sale_loyalty(coalesce(new.id, old.id));
  elsif tg_table_name = 'sale_items' then
    perform app.sync_sale_loyalty(coalesce(new.sale_id, old.sale_id));
  else
    raise exception 'UNSUPPORTED_LOYALTY_SALE_TRIGGER_TABLE: %', tg_table_name;
  end if;
  return null;
end;
$$;

create or replace function app.loyalty_return_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'returns' then
    perform app.sync_return_loyalty(coalesce(new.id, old.id));
  elsif tg_table_name = 'return_items' then
    perform app.sync_return_loyalty(coalesce(new.return_id, old.return_id));
  else
    raise exception 'UNSUPPORTED_LOYALTY_RETURN_TRIGGER_TABLE: %', tg_table_name;
  end if;
  return null;
end;
$$;

revoke execute on function app.loyalty_sale_trigger() from public;
revoke execute on function app.loyalty_return_trigger() from public;

commit;
