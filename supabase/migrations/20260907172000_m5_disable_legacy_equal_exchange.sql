begin;

-- El flujo anterior no recibía una autorización de supervisor. Mantenerlo
-- ejecutable permitiría saltarse la regla obligatoria de M5 llamando el RPC
-- directamente, aunque la interfaz nueva ya no lo use.
revoke execute on function public.create_equal_exchange(
  uuid, uuid, uuid, jsonb, jsonb, text
) from public, anon, authenticated;

-- La clave de servidor conserva acceso sólo para recuperación administrativa;
-- nunca se expone al navegador.
grant execute on function public.create_equal_exchange(
  uuid, uuid, uuid, jsonb, jsonb, text
) to service_role;

commit;
