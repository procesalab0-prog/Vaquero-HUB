begin;

-- =====================================================================
-- M1B — Hallazgos de revisión (issue #8)
--
-- M1B-1: el esquema soportaba el borrado de datos personales pero no
--        existía ninguna función que lo ejecutara.
-- M1B-2: documentar por qué la bitácora de clientes no guarda valores.
-- M1B-3: el límite de peticiones de acceso era sólo por cliente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- M1B-1 — Anonimización de clientes
--
-- Resuelve el choque entre dos reglas del proyecto: un cliente puede
-- pedir que borren sus datos, y el historial nunca se borra. Se cumplen
-- las dos anonimizando: se vacían los datos personales del cliente y las
-- ventas quedan intactas apuntando al mismo registro, ya anónimo.
--
-- Una venta es un registro contable; el nombre del comprador es un dato
-- personal. Se pueden separar.
-- ---------------------------------------------------------------------

insert into public.permissions (code, category, description)
values ('customers.anonymize', 'Clientes',
        'Anonimizar los datos personales de un cliente a petición suya');

insert into public.role_permissions (role_id, permission_code)
select id, 'customers.anonymize' from public.roles where code = 'ADMIN';

create or replace function public.anonymize_customer(
  p_customer_id uuid,
  p_reason      text
)
returns uuid   -- el auth_user_id que quedó huérfano, para borrarlo en Auth
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := (select app.current_user_id());
  v_auth_user_id uuid;
  v_member       text;
begin
  if v_actor is null or not (select app.has_perm('customers.anonymize')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  select auth_user_id, member_number
    into v_auth_user_id, v_member
    from public.customers
   where id = p_customer_id and not is_anonymized
     for update;

  if not found then
    raise exception 'CUSTOMER_NOT_FOUND_OR_ALREADY_ANONYMIZED' using errcode = 'P0002';
  end if;

  -- El número de socio se conserva a propósito: no es un dato personal,
  -- y es lo que mantiene unidas las ventas históricas del registro.
  update public.customers
     set full_name            = 'Cliente anonimizado',
         phone_e164           = null,
         email                = null,
         birthdate            = null,
         auth_user_id         = null,
         marketing_consent    = false,
         marketing_consent_at = null,
         is_anonymized        = true,
         updated_by           = v_actor
   where id = p_customer_id;

  -- El motivo va aquí y no en el disparador, porque el disparador de
  -- clientes registra sólo nombres de campos (ver comentario más abajo).
  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    v_actor, 'customers.anonymized', 'customers', p_customer_id::text,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'member_number', v_member,
      'had_auth_user', v_auth_user_id is not null
    )
  );

  return v_auth_user_id;
end;
$$;

revoke execute on function public.anonymize_customer(uuid, text) from public, anon;
grant execute on function public.anonymize_customer(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- M1B-2 — Por qué la bitácora de clientes no guarda valores
--
-- Se deja escrito en la propia función para que nadie la "arregle"
-- después creyendo que es una omisión.
-- ---------------------------------------------------------------------
comment on function app.audit_customer_change() is
'Registra SOLO los nombres de los campos que cambiaron, nunca sus valores, '
'a diferencia de app.audit_row_change(). Es deliberado: si la bitácora '
'guardara el teléfono, el correo o el nombre anteriores, anonimizar a un '
'cliente (public.anonymize_customer) no anonimizaría nada, porque sus datos '
'personales seguirían en una tabla que por diseño nunca se borra. '
'No cambiar a audit_row_change sin resolver antes ese conflicto.';

-- ---------------------------------------------------------------------
-- M1B-3 — Límite de peticiones de acceso por origen
--
-- El límite existente es por cliente: una petición por minuto para cada
-- uno. Eso no frena a quien recorre muchos identificadores distintos.
-- La respuesta genérica del endpoint impide averiguar cuáles existen,
-- pero no hay techo al volumen.
--
-- No se guarda la dirección IP: el servidor manda un HMAC de ella, así
-- que aquí nunca entra un dato personal. La ventana se limpia sola.
-- ---------------------------------------------------------------------
create table app.auth_request_throttle (
  source_hash       text primary key,
  window_started_at timestamptz not null default now(),
  attempts          int not null default 1 check (attempts > 0)
);

create index auth_request_throttle_window_idx
  on app.auth_request_throttle (window_started_at);

alter table app.auth_request_throttle enable row level security;

create policy auth_request_throttle_deny_all
  on app.auth_request_throttle for all to public
  using (false) with check (false);

revoke all on app.auth_request_throttle from public, anon, authenticated;
grant select, insert, update, delete on app.auth_request_throttle to service_role;

create or replace function public.reserve_auth_request_by_source(
  p_source_hash     text,
  p_max_attempts    integer default 10,
  p_window_seconds  integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_SOURCE_HASH' using errcode = '22023';
  end if;
  if p_max_attempts < 1 or p_window_seconds < 30 or p_window_seconds > 3600 then
    raise exception 'INVALID_RATE_LIMIT' using errcode = '22023';
  end if;

  -- Limpieza oportunista: la tabla no crece sin control con el tiempo.
  if random() < 0.02 then
    delete from app.auth_request_throttle
     where window_started_at < now() - interval '1 day';
  end if;

  insert into app.auth_request_throttle (source_hash)
  values (p_source_hash)
  on conflict (source_hash) do update
    set attempts = case
          when app.auth_request_throttle.window_started_at
               <= now() - make_interval(secs => p_window_seconds) then 1
          else app.auth_request_throttle.attempts + 1
        end,
        window_started_at = case
          when app.auth_request_throttle.window_started_at
               <= now() - make_interval(secs => p_window_seconds) then now()
          else app.auth_request_throttle.window_started_at
        end
  returning attempts into v_attempts;

  return v_attempts <= p_max_attempts;
end;
$$;

revoke execute on function public.reserve_auth_request_by_source(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_auth_request_by_source(text, integer, integer)
  to service_role;

commit;
