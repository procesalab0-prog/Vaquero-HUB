begin;

-- Limita entradas hostiles antes de convertirlas y evita que un booleano
-- manipulado haga abortar la corrida en seco sin reporte comprensible.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_catalog.pg_get_functiondef(
    'app.catalog_import_report(jsonb)'::regprocedure
  ) into v_definition;

  if pg_catalog.strpos(v_definition, 'if btrim(v_cost) ~ ''^[0-9]+([.][0-9]{1,2})?$'' then') = 0
     or pg_catalog.strpos(v_definition, 'if btrim(v_price) ~ ''^[0-9]+([.][0-9]{1,2})?$'' then') = 0
     or pg_catalog.strpos(v_definition, 'elsif coalesce((v_row ->> ''barcode_was_numeric'')::boolean, false) then') = 0
     or pg_catalog.strpos(v_definition, '    select c.id, c.default_size_scale_code') = 0 then
    raise exception 'EXPECTED_IMPORT_HARDENING_TARGETS_NOT_FOUND';
  end if;

  v_updated := pg_catalog.replace(
    v_definition,
    'if btrim(v_cost) ~ ''^[0-9]+([.][0-9]{1,2})?$'' then',
    E'if btrim(v_cost) ~ ''^[0-9]+([.][0-9]{1,2})?$''\n       and length(split_part(btrim(v_cost), ''.'', 1)) <= 12 then'
  );
  v_updated := pg_catalog.replace(
    v_updated,
    'if btrim(v_price) ~ ''^[0-9]+([.][0-9]{1,2})?$'' then',
    E'if btrim(v_price) ~ ''^[0-9]+([.][0-9]{1,2})?$''\n       and length(split_part(btrim(v_price), ''.'', 1)) <= 12 then'
  );
  v_updated := pg_catalog.replace(
    v_updated,
    'elsif coalesce((v_row ->> ''barcode_was_numeric'')::boolean, false) then',
    'elsif coalesce(v_row ->> ''barcode_was_numeric'', ''false'') = ''true'' then'
  );
  v_updated := pg_catalog.replace(
    v_updated,
    '    select c.id, c.default_size_scale_code',
    E'    if length(v_description) > 2000 then\n      v_errors := v_errors || jsonb_build_array(jsonb_build_object(\n        ''row'', v_row_number, ''field'', ''descripcion'', ''code'', ''DESCRIPCION_DEMASIADO_LARGA'',\n        ''message'', ''La descripción no puede exceder 2,000 caracteres.''\n      ));\n    end if;\n\n    select c.id, c.default_size_scale_code'
  );

  execute v_updated;
end;
$migration$;

commit;
