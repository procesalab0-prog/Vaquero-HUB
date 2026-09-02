begin;

-- =====================================================================
-- M2 — Proteger los campos reservados a la migración de SICAR
--
-- Hallazgo de revisión. El alta manual de catálogo permitía escribir
-- `legacy_sicar_code`, los identificadores de WooCommerce y un código de
-- barras con `source = 'SICAR'`. Los tres son inmutables por diseño una
-- vez escritos, así que un valor puesto por error quedaba permanente.
--
-- La cadena completa, comprobada: cualquier usuario con `products.create`
-- —incluido un almacenista— podía reservar un código de SICAR meses antes
-- del corte; el disparador impedía corregirlo; y al correr la migración
-- real esa fila la tumbaba con violación de unicidad, sin forma de
-- arreglarla. El evento más delicado del proyecto quedaba a merced de un
-- dato que alguien tecleó sin saber.
--
-- Regla que queda establecida: **los campos de aterrizaje de la migración
-- sólo los escribe el importador (M9), nunca el alta manual.**
-- =====================================================================

create or replace function public.create_catalog_product(
  p_name text,
  p_category_id uuid,
  p_variants jsonb,
  p_brand_id uuid default null,
  p_description text default null,
  p_brand_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_product_id uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_brand_id uuid := p_brand_id;
  v_attribute record;
  v_source text;
  v_count integer := 0;
begin
  if v_actor is null or not (select app.has_perm('products.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null
     or p_category_id is null
     or jsonb_typeof(p_variants) <> 'array'
     or jsonb_array_length(p_variants) < 1
     or jsonb_array_length(p_variants) > 200 then
    raise exception 'INVALID_CATALOG_PRODUCT' using errcode = '22023';
  end if;
  if not exists (select 1 from public.categories where id = p_category_id and is_active) then
    raise exception 'INVALID_CATEGORY' using errcode = '22023';
  end if;
  if v_brand_id is not null and not exists (select 1 from public.brands where id = v_brand_id and is_active) then
    raise exception 'INVALID_BRAND' using errcode = '22023';
  end if;

  if v_brand_id is null and nullif(btrim(p_brand_name), '') is not null then
    insert into public.brands (name)
    values (btrim(p_brand_name))
    on conflict ((lower(btrim(name)))) do update set is_active = true
    returning id into v_brand_id;
  end if;

  insert into public.products (name, brand_id, category_id, description, created_by, updated_by)
  values (btrim(p_name), v_brand_id, p_category_id, nullif(btrim(p_description), ''), v_actor, v_actor)
  returning id into v_product_id;

  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    -- Se rechaza en lugar de ignorar en silencio: si quien llama manda uno
    -- de estos campos, tiene un error que conviene que vea.
    if v_variant ? 'legacy_sicar_code'
       or v_variant ? 'woocommerce_product_id'
       or v_variant ? 'woocommerce_variation_id' then
      raise exception 'LEGACY_FIELDS_NOT_ALLOWED' using errcode = '42501';
    end if;

    if nullif(btrim(v_variant ->> 'sku'), '') is null
       or nullif(btrim(v_variant ->> 'barcode'), '') is null
       or coalesce((v_variant ->> 'cost_cents')::bigint, -1) < 0
       or coalesce((v_variant ->> 'price_cents')::bigint, -1) < 0 then
      raise exception 'INVALID_VARIANT' using errcode = '22023';
    end if;

    -- 'SICAR' marca un código de barras como inmutable e imborrable. Sólo
    -- el importador puede usarlo; desde el alta manual sería una trampa
    -- permanente creada sin querer.
    v_source := coalesce(nullif(v_variant ->> 'barcode_source', ''), 'MANUAL');
    if v_source not in ('GENERATED', 'MANUAL', 'SUPPLIER') then
      raise exception 'INVALID_BARCODE_SOURCE' using errcode = '42501';
    end if;

    insert into public.variants (
      product_id, sku, cost_cents, price_cents, created_by, updated_by
    ) values (
      v_product_id,
      upper(btrim(v_variant ->> 'sku')),
      (v_variant ->> 'cost_cents')::bigint,
      (v_variant ->> 'price_cents')::bigint,
      v_actor,
      v_actor
    ) returning id into v_variant_id;

    for v_attribute in
      select key as type_code, value as value_id
      from jsonb_each_text(coalesce(v_variant -> 'attributes', '{}'::jsonb))
    loop
      if not exists (
        select 1 from public.attribute_values av
        where av.id = v_attribute.value_id::uuid and av.type_code = v_attribute.type_code
      ) then
        raise exception 'INVALID_VARIANT_ATTRIBUTE' using errcode = '22023';
      end if;
      insert into public.variant_attributes (variant_id, type_code, value_id)
      values (v_variant_id, v_attribute.type_code, v_attribute.value_id::uuid);
    end loop;

    insert into public.barcodes (variant_id, code, symbology, source, is_primary)
    values (
      v_variant_id,
      btrim(v_variant ->> 'barcode'),
      coalesce(nullif(v_variant ->> 'barcode_symbology', ''), 'CODE128'),
      v_source,
      true
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('product_id', v_product_id, 'variant_count', v_count);
exception
  when unique_violation then
    raise exception 'CATALOG_DUPLICATE_VALUE' using errcode = '23505';
end;
$$;

-- ---------------------------------------------------------------------
-- Búsqueda: acentos y comodines
--
-- Dos defectos del mismo tamaño:
--
-- 1. `products.search_name` se guarda sin acentos, pero la consulta no se
--    normalizaba igual, así que "botín" devolvía cero y "botin" sí
--    encontraba. Fallaba justo con las palabras acentuadas, que en una
--    tienda de botines y texanas son muchas.
-- 2. `%` y `_` viajaban sin escapar hasta el LIKE, de modo que buscar
--    "50%" devolvía el catálogo completo. La búsqueda de clientes de M1B
--    ya escapaba bien; ésta se quedó atrás.
-- ---------------------------------------------------------------------
create or replace function public.search_catalog(
  p_query text default '',
  p_limit integer default 100
)
returns table (
  variant_id uuid,
  product_id uuid,
  product_name text,
  brand_name text,
  category_name text,
  sku text,
  legacy_sicar_code text,
  primary_barcode text,
  price_cents bigint,
  cost_cents bigint,
  attributes jsonb,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(
    translate(btrim(coalesce(p_query, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')
  );
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_can_see_cost boolean := (select app.has_perm('reports.inventory'))
    or (select app.has_perm('purchases.manage'));
begin
  if (select app.current_user_id()) is null or not (select app.has_perm('products.read')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  v_like := '%' || replace(replace(replace(v_query, '!', '!!'), '%', '!%'), '_', '!_') || '%';

  return query
  select
    v.id, p.id, p.name, coalesce(b.name, 'Sin marca'), c.name, v.sku,
    v.legacy_sicar_code, bc.code, v.price_cents,
    case when v_can_see_cost then v.cost_cents else null end,
    coalesce(attrs.values, '{}'::jsonb), v.is_active
  from public.variants v
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  left join public.brands b on b.id = p.brand_id
  left join lateral (
    -- La tabla va con alias y las columnas calificadas: sin eso,
    -- `variant_id` choca con el parámetro de salida de la función.
    select barcode.code from public.barcodes barcode
    where barcode.variant_id = v.id and barcode.is_primary
    limit 1
  ) bc on true
  left join lateral (
    select jsonb_object_agg(va.type_code, av.value order by at.display_order) as values
    from public.variant_attributes va
    join public.attribute_values av on av.id = va.value_id
    join public.attribute_types at on at.code = va.type_code
    where va.variant_id = v.id
  ) attrs on true
  where (
    v_query = ''
    or p.search_name like v_like escape '!'
    or lower(v.sku) like v_like escape '!'
    or lower(coalesce(v.legacy_sicar_code, '')) like v_like escape '!'
    or lower(translate(coalesce(b.name, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
       like v_like escape '!'
    or exists (
      select 1 from public.barcodes bx
      where bx.variant_id = v.id and lower(bx.code) like v_like escape '!'
    )
  )
  order by p.name, v.sku
  limit v_limit;
end;
$$;

commit;
