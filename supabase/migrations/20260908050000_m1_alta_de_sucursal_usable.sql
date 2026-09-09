begin;

-- Dar de alta una sucursal eran tres pasos sueltos y sólo se hacía el primero:
-- se insertaba la fila y quedaba una sucursal que nadie podía usar. Sin fila en
-- `user_locations` nadie puede recibir mercancía ahí (`can_access_location`), y
-- sin caja nadie puede abrir turno ni cobrar. Se ve en la lista de traspasos y
-- no sirve para nada, que es la peor forma de fallar.
--
-- Los tres pasos pasan a ser uno solo y transaccional. El código de la sucursal
-- no se puede cambiar después: viaja dentro del folio de cada venta
-- (`SUC1-V-000001`), así que cambiarlo dejaría el historial ilegible.
create or replace function public.upsert_location(
  p_id uuid,
  p_code text,
  p_name text,
  p_type text default 'STORE',
  p_address text default null,
  p_phone text default null,
  p_legal_name text default null,
  p_tax_id text default null,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_row public.locations;
  v_existing public.locations;
  v_created boolean := false;
  v_register_id uuid;
begin
  if v_actor is null or not (select app.has_perm('locations.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or length(p_name) > 80
     or p_type not in ('STORE', 'WAREHOUSE')
     or length(coalesce(p_address, '')) > 300
     or length(coalesce(p_phone, '')) > 40
     or length(coalesce(p_legal_name, '')) > 160
     or length(coalesce(p_tax_id, '')) > 20 then
    raise exception 'INVALID_LOCATION' using errcode = '22023';
  end if;

  if p_id is null then
    if coalesce(btrim(p_code), '') !~ '^[A-Za-z0-9]{2,10}$' then
      raise exception 'INVALID_LOCATION_CODE' using errcode = '22023';
    end if;
    if exists (select 1 from public.locations where code = upper(btrim(p_code))) then
      raise exception 'LOCATION_CODE_TAKEN' using errcode = '23505';
    end if;
    insert into public.locations(code, name, type, address, phone, legal_name, tax_id, is_active)
    values (upper(btrim(p_code)), btrim(p_name), p_type,
      nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_legal_name, '')), ''), nullif(btrim(coalesce(p_tax_id, '')), ''),
      coalesce(p_is_active, true))
    returning * into v_row;
    v_created := true;

    -- Quien la crea queda con acceso: si no, ni siquiera puede recibir la
    -- primera mercancía en la sucursal que acaba de abrir.
    insert into public.user_locations(user_id, location_id)
    values (v_actor, v_row.id)
    on conflict do nothing;

    -- Y nace con su primera caja, igual que las sucursales que ya existían.
    if v_row.type = 'STORE' then
      insert into public.cash_registers(location_id, code, name, created_by)
      values (v_row.id, 'CAJA01', 'Caja 01', v_actor)
      on conflict (location_id, code) do nothing
      returning id into v_register_id;
    end if;
  else
    select * into v_existing from public.locations where id = p_id for update;
    if not found then raise exception 'LOCATION_NOT_FOUND' using errcode = '22023'; end if;
    if v_existing.type = 'TRANSIT' then
      raise exception 'TRANSIT_LOCATION_IS_NOT_EDITABLE' using errcode = '42501';
    end if;
    -- El código viaja en el folio de cada venta; cambiarlo rompe el historial.
    if p_code is not null and upper(btrim(p_code)) <> v_existing.code then
      raise exception 'LOCATION_CODE_IMMUTABLE' using errcode = '42501';
    end if;
    update public.locations set
      name = btrim(p_name),
      type = p_type,
      address = nullif(btrim(coalesce(p_address, '')), ''),
      phone = nullif(btrim(coalesce(p_phone, '')), ''),
      legal_name = nullif(btrim(coalesce(p_legal_name, '')), ''),
      tax_id = nullif(btrim(coalesce(p_tax_id, '')), ''),
      is_active = coalesce(p_is_active, true),
      updated_at = now()
    where id = p_id
    returning * into v_row;
  end if;

  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, after_data)
  values (v_actor, case when v_created then 'location.created' else 'location.updated' end,
    'locations', v_row.id::text, v_row.id, to_jsonb(v_row));

  return jsonb_build_object(
    'id', v_row.id, 'code', v_row.code, 'name', v_row.name, 'type', v_row.type,
    'is_active', v_row.is_active, 'created', v_created,
    'register_created', v_register_id is not null
  );
end;
$$;

revoke execute on function public.upsert_location(uuid, text, text, text, text, text, text, text, boolean)
  from public, anon;
grant execute on function public.upsert_location(uuid, text, text, text, text, text, text, text, boolean)
  to authenticated, service_role;

-- La escritura directa deja de estar disponible: una sucursal a medias es peor
-- que ninguna, y la función es ahora el único camino que la deja usable.
revoke insert, update on public.locations from authenticated;

commit;
