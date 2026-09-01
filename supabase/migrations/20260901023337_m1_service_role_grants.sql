grant select, insert, update on public.locations to service_role;
grant select, insert, update, delete on public.roles to service_role;
grant select, insert, update, delete on public.permissions to service_role;
grant select, insert, delete on public.role_permissions to service_role;
grant select, insert, update on public.app_users to service_role;
grant select, insert, delete on public.user_locations to service_role;

-- La bitácora sigue siendo append-only incluso para procesos privilegiados.
grant select, insert on public.audit_log to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;

grant execute on function public.verify_supervisor_pin(text, text, text)
  to service_role;
grant execute on function public.update_my_profile(text, text)
  to service_role;
