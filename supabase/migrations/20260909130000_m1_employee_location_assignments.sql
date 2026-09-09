begin;

-- Cambiar las sucursales de un empleado es una sola operación: nunca debe
-- quedar temporalmente sin ubicación por dos llamadas independientes.
create or replace function public.set_employee_locations(
  p_user_id uuid,
  p_location_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_count integer;
begin
  if v_actor is null or not (select app.has_perm('users.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = v_actor then
    raise exception 'SELF_LOCATION_CHANGE_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_users u where u.id = p_user_id) then
    raise exception 'USER_NOT_AVAILABLE' using errcode = '22023';
  end if;
  if p_location_ids is null
     or cardinality(p_location_ids) < 1
     or cardinality(p_location_ids) > 50
     or cardinality(p_location_ids) <>
        (select count(distinct item.location_id)
         from unnest(p_location_ids) as item(location_id)) then
    raise exception 'INVALID_LOCATION_ASSIGNMENTS' using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.locations l
  where l.id = any(p_location_ids)
    and l.is_active
    and l.type <> 'TRANSIT';
  if v_count <> cardinality(p_location_ids) then
    raise exception 'INVALID_LOCATION_ASSIGNMENTS' using errcode = '22023';
  end if;

  delete from public.user_locations where user_id = p_user_id;
  insert into public.user_locations(user_id, location_id)
  select p_user_id, item.location_id
  from unnest(p_location_ids) as item(location_id);

  return jsonb_build_object(
    'user_id', p_user_id,
    'location_count', cardinality(p_location_ids)
  );
end;
$$;

revoke execute on function public.set_employee_locations(uuid, uuid[])
  from public, anon;
grant execute on function public.set_employee_locations(uuid, uuid[])
  to authenticated, service_role;

comment on function public.set_employee_locations(uuid, uuid[]) is
  'Reemplaza atómicamente las sucursales de otro empleado; exige users.manage y conserva al menos una ubicación activa.';

commit;

