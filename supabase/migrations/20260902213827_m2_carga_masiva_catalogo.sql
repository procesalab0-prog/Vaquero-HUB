begin;

-- M2.4 — Un solo núcleo de validación para la corrida en seco y la escritura.
-- M9 podrá reutilizar esta forma de reporte, pero este importador deliberadamente
-- no acepta ni escribe campos reservados de SICAR o WooCommerce.
create or replace function app.catalog_import_report(p_rows jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_errors jsonb := '[]'::jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_row jsonb;
  v_normalized_row jsonb;
  v_row_number integer;
  v_product text;
  v_category text;
  v_brand text;
  v_description text;
  v_color text;
  v_size text;
  v_cost text;
  v_price text;
  v_barcode text;
  v_category_id uuid;
  v_brand_id uuid;
  v_color_id uuid;
  v_size_id uuid;
  v_size_scale text;
  v_cost_cents bigint;
  v_price_cents bigint;
  v_symbology text;
  v_item record;
  v_total integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_IMPORT_PAYLOAD' using errcode = '22023';
  end if;

  v_total := jsonb_array_length(p_rows);
  if v_total < 1 or v_total > 1000 then
    raise exception 'INVALID_IMPORT_ROW_COUNT' using errcode = '22023';
  end if;

  for v_row, v_row_number in
    select value, ordinality::integer + 1
    from jsonb_array_elements(p_rows) with ordinality
  loop
    if jsonb_typeof(v_row) <> 'object' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'fila', 'code', 'FILA_INVALIDA',
        'message', 'La fila no tiene el formato esperado.'
      ));
      continue;
    end if;

    v_product := coalesce(v_row ->> 'product_name', '');
    v_category := coalesce(v_row ->> 'category', '');
    v_brand := coalesce(v_row ->> 'brand', '');
    v_description := coalesce(v_row ->> 'description', '');
    v_color := coalesce(v_row ->> 'color', '');
    v_size := coalesce(v_row ->> 'size', '');
    v_cost := coalesce(v_row ->> 'cost', '');
    v_price := coalesce(v_row ->> 'price', '');
    v_barcode := coalesce(v_row ->> 'barcode', '');
    v_category_id := null;
    v_brand_id := null;
    v_color_id := null;
    v_size_id := null;
    v_size_scale := null;
    v_cost_cents := null;
    v_price_cents := null;
    v_symbology := null;

    for v_item in
      select * from (values
        ('producto', v_product), ('categoria', v_category),
        ('marca', v_brand), ('descripcion', v_description),
        ('color', v_color), ('talla', v_size),
        ('costo', v_cost), ('precio', v_price), ('codigo', v_barcode)
      ) as fields(field_name, field_value)
      where field_value <> btrim(field_value)
    loop
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', v_item.field_name,
        'code', 'ESPACIOS_ACCIDENTALES',
        'message', 'Quita los espacios al inicio o al final.'
      ));
    end loop;

    if nullif(btrim(v_product), '') is null or length(btrim(v_product)) > 160 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'producto', 'code', 'PRODUCTO_INVALIDO',
        'message', 'Escribe un producto de hasta 160 caracteres.'
      ));
    end if;

    select c.id, c.default_size_scale_code
      into v_category_id, v_size_scale
    from public.categories c
    where lower(btrim(c.name)) = lower(btrim(v_category)) and c.is_active;
    if v_category_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'categoria', 'code', 'CATEGORIA_INEXISTENTE',
        'message', 'La categoría no existe o está desactivada.'
      ));
    end if;

    if nullif(btrim(v_brand), '') is not null then
      select b.id into v_brand_id
      from public.brands b
      where lower(btrim(b.name)) = lower(btrim(v_brand)) and b.is_active;
      if v_brand_id is null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row_number, 'field', 'marca', 'code', 'MARCA_INEXISTENTE',
          'message', 'La marca no existe o está desactivada; créala primero.'
        ));
      end if;
    end if;

    select av.id into v_color_id
    from public.attribute_values av
    where av.type_code = 'COLOR'
      and lower(btrim(av.value)) = lower(btrim(v_color));
    if v_color_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'color', 'code', 'COLOR_INEXISTENTE',
        'message', 'El color no existe en el catálogo.'
      ));
    end if;

    if v_size_scale is not null then
      select av.id into v_size_id
      from public.attribute_values av
      where av.type_code = 'TALLA'
        and av.scale_code = v_size_scale
        and lower(btrim(av.value)) = lower(btrim(v_size));
    end if;
    if v_size_id is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'talla', 'code', 'TALLA_FUERA_DE_ESCALA',
        'message', 'La talla no pertenece a la escala de la categoría.'
      ));
    end if;

    if btrim(v_cost) ~ '^[0-9]+([.][0-9]{1,2})?$' then
      v_cost_cents := round(btrim(v_cost)::numeric * 100)::bigint;
    else
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'costo', 'code', 'COSTO_NO_NUMERICO',
        'message', 'Usa sólo números y hasta dos decimales.'
      ));
    end if;
    if btrim(v_price) ~ '^[0-9]+([.][0-9]{1,2})?$' then
      v_price_cents := round(btrim(v_price)::numeric * 100)::bigint;
    else
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'precio', 'code', 'PRECIO_NO_NUMERICO',
        'message', 'Usa sólo números y hasta dos decimales.'
      ));
    end if;

    if nullif(btrim(v_barcode), '') is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'codigo', 'code', 'CODIGO_VACIO',
        'message', 'Cada variante necesita su código físico de proveedor.'
      ));
    elsif coalesce((v_row ->> 'barcode_was_numeric')::boolean, false) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'codigo', 'code', 'CODIGO_CONVERTIDO_A_NUMERO',
        'message', 'La hoja guardó el código como número. Cámbialo a texto para no perder ceros.'
      ));
    elsif v_barcode ~ '^[0-9]{12}$' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'codigo', 'code', 'POSIBLE_CERO_INICIAL_PERDIDO',
        'message', 'El código tiene 12 dígitos; verifica si perdió un cero inicial.'
      ));
    elsif v_barcode ~ '^[0-9]{13}$' then
      v_symbology := 'EAN13';
      if right(v_barcode, 1) is distinct from app.ean13_check_digit(left(v_barcode, 12))::text then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row_number, 'field', 'codigo', 'code', 'EAN13_INVALIDO',
          'message', 'El dígito verificador EAN-13 no coincide.'
        ));
      end if;
      if left(v_barcode, 2)::integer between 20 and 29 then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row', v_row_number, 'field', 'codigo', 'code', 'PREFIJO_INTERNO_RESERVADO',
          'message', 'Los prefijos 20–29 están reservados para Mi Tienda SM.'
        ));
      end if;
    elsif length(v_barcode) <= 80 and v_barcode ~ '^[ -~]+$' then
      v_symbology := 'CODE128';
    else
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'codigo', 'code', 'CODIGO_INVALIDO',
        'message', 'Usa un EAN-13 válido o texto CODE 128 de hasta 80 caracteres.'
      ));
    end if;

    if nullif(v_barcode, '') is not null
       and exists (select 1 from public.barcodes b where b.code = v_barcode) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'codigo', 'code', 'CODIGO_YA_EXISTE',
        'message', 'El código ya pertenece a una variante del sistema.'
      ));
    end if;

    if nullif(btrim(v_product), '') is not null and exists (
      select 1 from public.products p
      where p.search_name = lower(translate(btrim(v_product),
        'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_row_number, 'field', 'producto', 'code', 'PRODUCTO_YA_EXISTE',
        'message', 'El producto ya existe; agrega sus variantes desde el flujo individual.'
      ));
    end if;

    v_normalized_row := jsonb_build_object(
      'row_number', v_row_number,
      'product_key', lower(translate(btrim(v_product),
        'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
      'product_name', btrim(v_product),
      'category_id', v_category_id,
      'brand_id', v_brand_id,
      'description', nullif(btrim(v_description), ''),
      'color_id', v_color_id,
      'size_id', v_size_id,
      'cost_cents', v_cost_cents,
      'price_cents', v_price_cents,
      'barcode', v_barcode,
      'symbology', v_symbology
    );
    v_normalized := v_normalized || jsonb_build_array(v_normalized_row);
  end loop;

  -- Reglas entre filas. Se calculan sobre el arreglo normalizado para que la
  -- corrida en seco y el commit compartan exactamente el mismo resultado.
  for v_item in
    select (r ->> 'row_number')::integer as row_number
    from jsonb_array_elements(v_normalized) r
    where nullif(r ->> 'barcode', '') is not null
      and (select count(*) from jsonb_array_elements(v_normalized) x
           where x ->> 'barcode' = r ->> 'barcode') > 1
  loop
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'row', v_item.row_number, 'field', 'codigo', 'code', 'CODIGO_DUPLICADO_ARCHIVO',
      'message', 'El mismo código aparece más de una vez en el archivo.'
    ));
  end loop;

  for v_item in
    select (r ->> 'row_number')::integer as row_number
    from jsonb_array_elements(v_normalized) r
    where (select count(*) from jsonb_array_elements(v_normalized) x
           where x ->> 'product_key' = r ->> 'product_key'
             and x ->> 'color_id' = r ->> 'color_id'
             and x ->> 'size_id' = r ->> 'size_id') > 1
  loop
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'row', v_item.row_number, 'field', 'variante', 'code', 'VARIANTE_DUPLICADA_ARCHIVO',
      'message', 'La misma talla y color se repiten para este producto.'
    ));
  end loop;

  for v_item in
    select (r ->> 'row_number')::integer as row_number
    from jsonb_array_elements(v_normalized) r
    where (select count(distinct concat_ws('|', x ->> 'category_id', x ->> 'brand_id', x ->> 'description'))
           from jsonb_array_elements(v_normalized) x
           where x ->> 'product_key' = r ->> 'product_key') > 1
  loop
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'row', v_item.row_number, 'field', 'producto', 'code', 'PRODUCTO_INCONSISTENTE',
      'message', 'Las filas del mismo producto deben usar la misma categoría, marca y descripción.'
    ));
  end loop;

  for v_item in
    select product_key, count(*) as variant_count, min((r ->> 'row_number')::integer) as row_number
    from jsonb_array_elements(v_normalized) r
    group by product_key
    having count(*) > 200
  loop
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'row', v_item.row_number, 'field', 'producto', 'code', 'DEMASIADAS_VARIANTES',
      'message', 'Un producto no puede importar más de 200 variantes a la vez.'
    ));
  end loop;

  return jsonb_build_object(
    'total_rows', v_total,
    'valid_rows', case when jsonb_array_length(v_errors) = 0 then v_total else 0 end,
    'error_count', jsonb_array_length(v_errors),
    'errors', v_errors,
    'normalized_rows', v_normalized
  );
end;
$$;

create or replace function public.validate_catalog_import(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select app.current_user_id()) is null
     or not (select app.has_perm('products.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return app.catalog_import_report(p_rows);
end;
$$;

create or replace function public.commit_catalog_import(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_report jsonb;
  v_rows jsonb;
  v_product record;
  v_row jsonb;
  v_variants jsonb;
  v_created jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_product_count integer := 0;
  v_variant_count integer := 0;
begin
  if v_actor is null or not (select app.has_perm('products.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Evita dos importaciones simultáneas del mismo catálogo. El candado se
  -- toma antes de volver a validar para cerrar la ventana entre preview y commit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalog-import', 0)
  );
  v_report := app.catalog_import_report(p_rows);
  if (v_report ->> 'error_count')::integer > 0 then
    raise exception 'IMPORT_VALIDATION_FAILED'
      using errcode = '22023', detail = v_report::text;
  end if;
  v_rows := v_report -> 'normalized_rows';

  for v_product in
    select
      r ->> 'product_key' as product_key,
      min(r ->> 'product_name') as product_name,
      min(r ->> 'category_id')::uuid as category_id,
      nullif(min(coalesce(r ->> 'brand_id', '')), '')::uuid as brand_id,
      nullif(min(coalesce(r ->> 'description', '')), '') as description
    from jsonb_array_elements(v_rows) r
    group by r ->> 'product_key'
    order by min((r ->> 'row_number')::integer)
  loop
    select jsonb_agg(jsonb_build_object(
      'cost_cents', (r ->> 'cost_cents')::bigint,
      'price_cents', (r ->> 'price_cents')::bigint,
      'attributes', jsonb_build_object(
        'COLOR', r ->> 'color_id', 'TALLA', r ->> 'size_id'
      )
    ) order by (r ->> 'row_number')::integer)
    into v_variants
    from jsonb_array_elements(v_rows) r
    where r ->> 'product_key' = v_product.product_key;

    v_created := public.create_catalog_product(
      v_product.product_name, v_product.category_id, v_variants,
      v_product.brand_id, v_product.description, null
    );
    v_product_id := (v_created ->> 'product_id')::uuid;
    v_product_count := v_product_count + 1;

    for v_row in
      select r from jsonb_array_elements(v_rows) r
      where r ->> 'product_key' = v_product.product_key
      order by (r ->> 'row_number')::integer
    loop
      select v.id into strict v_variant_id
      from public.variants v
      where v.product_id = v_product_id
        and exists (
          select 1 from public.variant_attributes va
          where va.variant_id = v.id and va.type_code = 'COLOR'
            and va.value_id = (v_row ->> 'color_id')::uuid
        )
        and exists (
          select 1 from public.variant_attributes va
          where va.variant_id = v.id and va.type_code = 'TALLA'
            and va.value_id = (v_row ->> 'size_id')::uuid
        );

      update public.barcodes
      set is_primary = false
      where variant_id = v_variant_id and is_primary;
      insert into public.barcodes (
        variant_id, code, symbology, source, is_primary
      ) values (
        v_variant_id, v_row ->> 'barcode', v_row ->> 'symbology',
        'SUPPLIER', true
      );
      v_variant_count := v_variant_count + 1;
    end loop;
  end loop;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    v_actor, 'catalog.import', 'catalog_import', null,
    jsonb_build_object(
      'source', 'database_function',
      'product_count', v_product_count,
      'variant_count', v_variant_count
    )
  );

  return jsonb_build_object(
    'product_count', v_product_count,
    'variant_count', v_variant_count
  );
exception
  when unique_violation then
    raise exception 'IMPORT_CONFLICT' using errcode = '23505';
end;
$$;

comment on function public.validate_catalog_import(jsonb) is
  'Corrida en seco de una plantilla propia; no escribe ningún dato.';
comment on function public.commit_catalog_import(jsonb) is
  'Revalida y crea el catálogo propio de forma atómica; no acepta campos SICAR/WooCommerce.';

revoke execute on function app.catalog_import_report(jsonb)
  from public, anon, authenticated;
revoke execute on function public.validate_catalog_import(jsonb)
  from public, anon;
revoke execute on function public.commit_catalog_import(jsonb)
  from public, anon;
grant execute on function public.validate_catalog_import(jsonb)
  to authenticated;
grant execute on function public.commit_catalog_import(jsonb)
  to authenticated;

commit;
