begin;

-- Ninguna devolución en efectivo puede comprometer dinero que no está en el
-- cajón. El candado de la sesión serializa ventas, retiros y devoluciones para
-- que dos operaciones paralelas no aprueben el mismo saldo.
create or replace function app.guard_return_cash_floor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_available bigint;
begin
  if new.movement_type <> 'RETURN' or new.amount_cents >= 0 then
    return new;
  end if;

  perform 1
  from public.cash_sessions
  where id = new.session_id
  for update;

  select coalesce(sum(amount_cents), 0)
  into v_available
  from public.cash_movements
  where session_id = new.session_id;

  if -new.amount_cents > v_available then
    raise exception 'INSUFFICIENT_CASH' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists cash_return_floor on public.cash_movements;
create trigger cash_return_floor
before insert on public.cash_movements
for each row execute function app.guard_return_cash_floor();

commit;
