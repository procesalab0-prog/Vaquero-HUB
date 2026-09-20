begin;

-- El código operativo de una ubicación (por ejemplo LAP) ya forma parte de
-- folios históricos y por eso es inmutable. Las etiquetas necesitan una clave
-- corta, visible y administrable sin alterar esos folios.
alter table public.locations
  add column label_code text;

with ordered_locations as (
  select id, row_number() over (order by created_at, id) as sequence
  from public.locations
  where type <> 'TRANSIT'
)
update public.locations as location
set label_code = case
  when ordered_locations.sequence <= 9
    then 'VSM' || ordered_locations.sequence::text
  else 'V' || lpad(ordered_locations.sequence::text, 3, '0')
end
from ordered_locations
where location.id = ordered_locations.id;

alter table public.locations
  add constraint locations_label_code_format_check
  check (
    (type = 'TRANSIT' and label_code is null)
    or
    (type <> 'TRANSIT' and label_code is not null
      and label_code = upper(btrim(label_code))
      and label_code ~ '^[A-Z0-9]{1,4}$')
  );

create unique index locations_label_code_unique
  on public.locations(label_code)
  where label_code is not null;

create or replace function app.assign_location_label_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sequence integer;
  v_candidate text;
begin
  if new.type = 'TRANSIT' then
    new.label_code := null;
    return new;
  end if;

  if nullif(btrim(coalesce(new.label_code, '')), '') is not null then
    new.label_code := upper(btrim(new.label_code));
    if new.label_code !~ '^[A-Z0-9]{1,4}$' then
      raise exception 'INVALID_LABEL_CODE' using errcode = '22023';
    end if;
    return new;
  end if;

  -- Evita que dos altas simultáneas reciban el mismo código automático.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('locations.label_code.auto')
  );
  for v_sequence in 1..999 loop
    v_candidate := case
      when v_sequence <= 9 then 'VSM' || v_sequence::text
      else 'V' || lpad(v_sequence::text, 3, '0')
    end;
    if not exists (
      select 1 from public.locations where label_code = v_candidate
    ) then
      new.label_code := v_candidate;
      return new;
    end if;
  end loop;

  raise exception 'LABEL_CODE_CAPACITY_REACHED' using errcode = '54000';
end;
$$;

create trigger locations_assign_label_code
before insert or update of label_code, type on public.locations
for each row execute function app.assign_location_label_code();

-- Versión nueva del alta/edición que permite personalizar la clave impresa.
-- La función anterior se conserva para clientes ya desplegados; su INSERT
-- recibe un código automático mediante el trigger de arriba.
create or replace function public.upsert_location_v2(
  p_id uuid,
  p_code text,
  p_label_code text,
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
     or length(coalesce(p_tax_id, '')) > 20
     or (
       nullif(btrim(coalesce(p_label_code, '')), '') is not null
       and upper(btrim(p_label_code)) !~ '^[A-Z0-9]{1,4}$'
     ) then
    raise exception 'INVALID_LOCATION' using errcode = '22023';
  end if;

  if p_id is null then
    if coalesce(btrim(p_code), '') !~ '^[A-Za-z0-9]{2,10}$' then
      raise exception 'INVALID_LOCATION_CODE' using errcode = '22023';
    end if;
    if exists (select 1 from public.locations where code = upper(btrim(p_code))) then
      raise exception 'LOCATION_CODE_TAKEN' using errcode = '23505';
    end if;
    insert into public.locations(
      code, label_code, name, type, address, phone, legal_name, tax_id, is_active
    ) values (
      upper(btrim(p_code)), nullif(upper(btrim(coalesce(p_label_code, ''))), ''),
      btrim(p_name), p_type,
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_legal_name, '')), ''),
      nullif(btrim(coalesce(p_tax_id, '')), ''),
      coalesce(p_is_active, true)
    ) returning * into v_row;
    v_created := true;

    insert into public.user_locations(user_id, location_id)
    values (v_actor, v_row.id)
    on conflict do nothing;

    if v_row.type = 'STORE' then
      insert into public.cash_registers(location_id, code, name, created_by)
      values (v_row.id, 'CAJA01', 'Caja 01', v_actor)
      on conflict (location_id, code) do nothing
      returning id into v_register_id;
    end if;
  else
    select * into v_existing from public.locations where id = p_id for update;
    if not found then
      raise exception 'LOCATION_NOT_FOUND' using errcode = '22023';
    end if;
    if v_existing.type = 'TRANSIT' then
      raise exception 'TRANSIT_LOCATION_IS_NOT_EDITABLE' using errcode = '42501';
    end if;
    if p_code is not null and upper(btrim(p_code)) <> v_existing.code then
      raise exception 'LOCATION_CODE_IMMUTABLE' using errcode = '42501';
    end if;
    update public.locations set
      label_code = coalesce(
        nullif(upper(btrim(coalesce(p_label_code, ''))), ''),
        v_existing.label_code
      ),
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

  insert into public.audit_log(
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data
  ) values (
    v_actor,
    case when v_created then 'location.created' else 'location.updated' end,
    'locations', v_row.id::text, v_row.id,
    case when v_created then null else to_jsonb(v_existing) end,
    to_jsonb(v_row)
  );

  return jsonb_build_object(
    'id', v_row.id,
    'code', v_row.code,
    'label_code', v_row.label_code,
    'name', v_row.name,
    'type', v_row.type,
    'is_active', v_row.is_active,
    'created', v_created,
    'register_created', v_register_id is not null
  );
end;
$$;

revoke execute on function public.upsert_location_v2(
  uuid, text, text, text, text, text, text, text, text, boolean
) from public, anon;
grant execute on function public.upsert_location_v2(
  uuid, text, text, text, text, text, text, text, text, boolean
) to authenticated, service_role;

commit;
