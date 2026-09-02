begin;

-- La primera ejecución en staging encontró que este alias del arreglo JSON se
-- referenciaba como si fuera una columna física. Conservamos la migración ya
-- aplicada y corregimos su definición de forma explícita y verificable.
do $migration$
declare
  v_definition text;
  v_before constant text := 'select product_key, count(*) as variant_count';
  v_after constant text := 'select r ->> ''product_key'' as product_key, count(*) as variant_count';
begin
  select pg_catalog.pg_get_functiondef(
    'app.catalog_import_report(jsonb)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, v_before) = 0 then
    raise exception 'EXPECTED_IMPORT_VALIDATOR_DEFINITION_NOT_FOUND';
  end if;

  execute pg_catalog.replace(v_definition, v_before, v_after);
end;
$migration$;

commit;
