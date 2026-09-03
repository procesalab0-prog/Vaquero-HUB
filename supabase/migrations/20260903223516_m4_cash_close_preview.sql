begin;

-- El primer conteo es ciego: el esperado sólo se revela después de que el
-- cajero ya envió la cantidad física contada.
create or replace function public.preview_cash_close(
  p_session_id uuid,
  p_counted_amount_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_session public.cash_sessions;
  v_expected bigint;
begin
  if v_actor is null or not (select app.has_perm('cash.close')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_counted_amount_cents is null or p_counted_amount_cents < 0
     or p_counted_amount_cents > 100000000 then
    raise exception 'INVALID_COUNTED_AMOUNT' using errcode = '22023';
  end if;
  select * into v_session
  from public.cash_sessions
  where id = p_session_id and status = 'OPEN';
  if not found or v_session.cashier_user_id <> v_actor
     or not (select app.can_access_location(v_session.location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;
  select coalesce(sum(amount_cents), 0) into v_expected
  from public.cash_movements where session_id = p_session_id;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, metadata)
  values(v_actor, 'cash_session.count_previewed', 'cash_sessions', p_session_id::text,
    v_session.location_id, jsonb_build_object('counted_amount_cents', p_counted_amount_cents));
  return jsonb_build_object(
    'expected_amount_cents', v_expected,
    'counted_amount_cents', p_counted_amount_cents,
    'difference_cents', p_counted_amount_cents - v_expected
  );
end;
$$;

revoke execute on function public.preview_cash_close(uuid,bigint) from public, anon;
grant execute on function public.preview_cash_close(uuid,bigint) to authenticated, service_role;

commit;
