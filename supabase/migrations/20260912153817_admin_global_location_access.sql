begin;

-- El rol ADMIN representa a la administración global del negocio. Sus
-- integrantes pueden operar cualquier tienda activa aunque no exista una fila
-- individual en user_locations. Los demás roles conservan el alcance mínimo
-- explícitamente asignado. La ubicación técnica de tránsito nunca se expone
-- como sucursal operable.
create or replace function app.can_access_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users u
    join public.roles r on r.id = u.role_id
    where u.id = (select auth.uid())
      and u.is_active
      and (
        exists (
          select 1
          from public.user_locations ul
          where ul.user_id = u.id
            and ul.location_id = p_location_id
        )
        or (
          r.code = 'ADMIN'
          and exists (
            select 1
            from public.locations l
            where l.id = p_location_id
              and l.is_active
              and l.type = 'STORE'
          )
        )
      )
  )
$$;

revoke execute on function app.can_access_location(uuid) from public, anon;
grant execute on function app.can_access_location(uuid) to authenticated;

comment on function app.can_access_location(uuid) is
  'Autoriza sucursales asignadas; ADMIN activo puede operar todas las tiendas activas, nunca la ubicación técnica de tránsito.';

commit;
