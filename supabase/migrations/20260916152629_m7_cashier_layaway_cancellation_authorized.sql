begin;

-- La persona dueña de la caja ejecuta el reembolso. La autorización sigue
-- perteneciendo a gerencia y viaja como una capacidad breve, ligada al actor
-- y consumible una sola vez.
alter table public.layaway_cancellations
  add column authorized_by uuid references public.app_users(id),
  add column authorization_id uuid unique
    references app.supervisor_authorizations(id);

create function app.has_layaway_cancel_authority()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_token_text text := current_setting(
    'app.layaway_cancel_authorization_token', true
  );
  v_token uuid;
begin
  if v_actor is null then
    return false;
  end if;
  if (select app.has_perm('layaways.cancel_exception')) then
    return true;
  end if;
  begin
    v_token := nullif(v_token_text, '')::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1
    from app.supervisor_authorizations a
    where a.id = v_token
      and a.actor_user_id = v_actor
      and a.permission_code = 'layaways.cancel_exception'
      and a.used_at is null
      and a.expires_at > now()
  );
end;
$$;

-- Corrección hacia delante: la operación atómica existente conserva todas sus
-- invariantes, pero reconoce una capacidad de gerencia validada por el wrapper.
do $migration$
declare
  v_original text;
  v_updated text;
  v_search text :=
    'or not (select app.has_perm(''layaways.cancel_exception'')) then';
  v_replacement text :=
    'or not (select app.has_layaway_cancel_authority()) then';
begin
  select pg_get_functiondef(
    'public.cancel_active_layaway(uuid,uuid,uuid,bigint,jsonb,text)'::regprocedure
  ) into v_original;
  if position(v_replacement in v_original) = 0 then
    v_updated := replace(v_original, v_search, v_replacement);
    if v_updated = v_original then
      raise exception 'CANCEL_ACTIVE_LAYAWAY_DEFINITION_CHANGED';
    end if;
    execute v_updated;
  end if;
end;
$migration$;

create function public.cancel_active_layaway_authorized(
  p_operation_key uuid,
  p_cash_session_id uuid,
  p_layaway_id uuid,
  p_refund_cents bigint,
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
  v_actor uuid := (select app.current_user_id());
  v_authorization app.supervisor_authorizations;
  v_existing public.layaway_cancellations;
  v_result jsonb;
  v_hash text;
begin
  if v_actor is null or not (select app.has_perm('layaways.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_operation_key is null or p_cash_session_id is null
     or p_layaway_id is null or p_refund_cents is null
     or p_authorization_token is null then
    raise exception 'INVALID_LAYAWAY_CANCELLATION' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'session', p_cash_session_id,
    'layaway', p_layaway_id,
    'refund_cents', p_refund_cents,
    'refund_references', coalesce(p_refund_references, '[]'::jsonb),
    'reason', btrim(p_reason)
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended('cancel-active-layaway:' || p_operation_key::text, 0)
  );
  select * into v_existing
  from public.layaway_cancellations
  where operation_key = p_operation_key;
  if found then
    if v_existing.actor_user_id <> v_actor
       or v_existing.request_hash <> v_hash
       or v_existing.authorization_id <> p_authorization_token then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'layaway_id', v_existing.layaway_id,
      'folio', (
        select l.folio from public.layaways l
        where l.id = v_existing.layaway_id
      ),
      'refund_cents', v_existing.refund_cents,
      'penalty_cents', v_existing.penalty_cents,
      'released_balance_cents', v_existing.cancelled_balance_cents,
      'refunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'method_code', r.method_code,
          'amount_cents', r.amount_cents,
          'reference', r.reference
        ) order by pm.sort_order, r.id)
        from public.layaway_cancellation_refunds r
        join public.payment_methods pm on pm.code = r.method_code
        where r.cancellation_id = v_existing.id
      ), '[]'::jsonb)
    );
  end if;

  select * into v_authorization
  from app.supervisor_authorizations a
  where a.id = p_authorization_token
    and a.actor_user_id = v_actor
    and a.permission_code = 'layaways.cancel_exception'
    and a.used_at is null
    and a.expires_at > now()
  for update;
  if not found then
    raise exception 'LAYAWAY_AUTHORIZATION_REQUIRED' using errcode = '42501';
  end if;

  perform set_config(
    'app.layaway_cancel_authorization_token',
    p_authorization_token::text,
    true
  );
  v_result := public.cancel_active_layaway(
    p_operation_key,
    p_cash_session_id,
    p_layaway_id,
    p_refund_cents,
    coalesce(p_refund_references, '[]'::jsonb),
    p_reason
  );

  perform set_config('app.layaway_write', 'on', true);
  update public.layaway_cancellations
  set authorized_by = v_authorization.supervisor_user_id,
      authorization_id = v_authorization.id
  where id = (v_result->>'id')::uuid
    and actor_user_id = v_actor
    and authorization_id is null;
  perform set_config('app.layaway_write', 'off', true);

  update app.supervisor_authorizations
  set used_at = now(), resource_id = (v_result->>'id')::uuid
  where id = v_authorization.id and used_at is null;
  if not found then
    raise exception 'LAYAWAY_AUTHORIZATION_REQUIRED' using errcode = '42501';
  end if;

  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  )
  select
    v_actor,
    'layaway.cancellation_authorized',
    'layaway_cancellations',
    c.id::text,
    c.location_id,
    jsonb_build_object(
      'layaway_id', c.layaway_id,
      'executor_user_id', v_actor,
      'authorized_by', v_authorization.supervisor_user_id,
      'authorization_id', v_authorization.id,
      'cash_session_id', c.cash_session_id
    )
  from public.layaway_cancellations c
  where c.id = (v_result->>'id')::uuid;

  return v_result || jsonb_build_object(
    'authorized_by', v_authorization.supervisor_user_id
  );
end;
$$;

revoke all on function app.has_layaway_cancel_authority()
from public, anon, authenticated, service_role;

revoke execute on function public.cancel_active_layaway_authorized(
  uuid, uuid, uuid, bigint, jsonb, uuid, text
) from public, anon;
grant execute on function public.cancel_active_layaway_authorized(
  uuid, uuid, uuid, bigint, jsonb, uuid, text
) to authenticated, service_role;

comment on function public.cancel_active_layaway_authorized(
  uuid, uuid, uuid, bigint, jsonb, uuid, text
) is
  'La persona dueña de la caja ejecuta la cancelación anticipada y gerencia la autoriza con una capacidad de cinco minutos y un solo uso.';

commit;
