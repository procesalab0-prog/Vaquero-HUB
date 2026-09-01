begin;

-- El esquema app no se publica en PostgREST. USAGE sólo permite que el
-- rol autenticado resuelva las funciones privadas que las políticas RLS
-- ya autorizan de forma explícita; no concede acceso a tablas ni RPC.
grant usage on schema app to authenticated;

commit;
