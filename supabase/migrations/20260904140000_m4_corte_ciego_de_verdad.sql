begin;

-- El corte a ciegas dejaba de serlo: la cajera obtenía el esperado exacto
-- de dos maneras, y una de ellas estaba impresa en su propia pantalla.
--
--   1. `get_my_cash_session` devolvía el desglose de pagos con importes.
--      Fondo inicial + efectivo cobrado + entradas - retiros == esperado.
--   2. La política de `cash_movements` abría la tabla a quien tuviera
--      `cash.close`, y `cash.close` es justamente el permiso de la cajera:
--      un `select sum(amount_cents)` devolvía el esperado sin más.
--
-- Un conteo que se puede comparar antes de declararlo no detecta faltantes:
-- el número contado se parece al esperado y el corte queda de adorno.
-- Mientras la sesión está abierta se devuelven conteos, no importes.

create or replace function public.get_my_cash_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_result jsonb;
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  select jsonb_build_object(
    'id', s.id, 'register_id', r.id, 'register_code', r.code, 'register_name', r.name,
    'location_id', s.location_id, 'status', s.status,
    'opening_amount_cents', s.opening_amount_cents,
    'opened_at', s.opened_at,
    'blind_count', true,
    'sales_count', (
      select count(*) from public.sales x
      where x.cash_session_id = s.id and x.status = 'COMPLETED'
    ),
    -- Sin importe de ventas mientras la sesión sigue abierta.
    'payments', (
      select coalesce(
        jsonb_agg(jsonb_build_object('method_code', q.method_code, 'count', q.qty)),
        '[]'::jsonb)
      from (
        select p.method_code, count(*) qty
        from public.sale_payments p
        join public.sales x on x.id = p.sale_id
        where x.cash_session_id = s.id and x.status = 'COMPLETED'
        group by p.method_code
      ) q
    ),
    -- Los movimientos manuales los capturó la propia cajera: ocultarlos no
    -- protege nada y sí le estorba para revisar lo que registró.
    'manual_movements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'type', m.movement_type, 'amount_cents', m.amount_cents,
        'reason', m.reason, 'occurred_at', m.occurred_at
      ) order by m.occurred_at desc), '[]'::jsonb)
      from public.cash_movements m
      where m.session_id = s.id and m.movement_type in ('DEPOSIT', 'WITHDRAWAL')
    )
  ) into v_result
  from public.cash_sessions s
  join public.cash_registers r on r.id = s.register_id
  where s.cashier_user_id = v_actor and s.status = 'OPEN';
  return v_result;
end;
$$;

revoke execute on function public.get_my_cash_session() from public, anon;
grant execute on function public.get_my_cash_session() to authenticated, service_role;

-- La lectura supervisora del libro de caja pasa a `reports.sales`, que la
-- cajera no tiene. Su propia sesión la puede revisar completa una vez
-- cerrada, cuando el esperado ya quedó asentado y comparar ya no sirve
-- para acomodar el conteo.
drop policy if exists cash_movements_read on public.cash_movements;
create policy cash_movements_read on public.cash_movements
for select to authenticated
using (
  (select app.can_access_location(location_id))
  and (
    (select app.has_perm('reports.sales'))
    or (
      user_id = (select app.current_user_id())
      and exists (
        select 1 from public.cash_sessions s
        where s.id = cash_movements.session_id and s.status = 'CLOSED'
      )
    )
  )
);

drop policy if exists cash_sessions_read on public.cash_sessions;
create policy cash_sessions_read on public.cash_sessions
for select to authenticated
using (
  (select app.can_access_location(location_id))
  and (
    (select app.has_perm('reports.sales'))
    or cashier_user_id = (select app.current_user_id())
  )
);

-- La bitácora es lo que protege contra el fraude interno, así que no puede
-- depender de que nadie tenga la contraseña de la base. El libro de
-- inventario y el de ventas ya rechazan al superusuario; éste no.
-- Sólo se bloquean UPDATE y DELETE: las inserciones siguen igual y ninguna
-- función necesita cambiar.
create or replace function app.guard_audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AUDIT_LOG_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger audit_log_append_only
before update or delete on public.audit_log
for each row execute function app.guard_audit_log_append_only();

commit;
