begin;

-- La tabla es configuración interna. RLS ya cerraba filas, pero mínimo
-- privilegio exige quitar también los permisos de tabla concedidos por las
-- reglas por omisión del esquema público.
revoke all on public.cash_movement_types from public, anon, authenticated;
revoke all on public.cash_movement_types from service_role;
grant select on public.cash_movement_types to service_role;

commit;
