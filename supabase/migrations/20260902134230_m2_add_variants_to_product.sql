begin;

-- Agrega variantes a un producto existente sin recrear ni modificar las que
-- ya tienen identidad e historial. La funcion comparte el generador interno
-- del alta inicial y mantiene toda la operacion dentro de una transaccion.
create or replace function public.add_variants_to_product(
  p_product_id uuid,
  p_variants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_variant jsonb;
  v_variant_id uuid;
  v_attribute record;
  v_serial bigint;
  v_sku text;
  v_barcode_payload text;
  v_barcode text;
  v_count integer := 0;
  v_variant_ids jsonb := '[]'::jsonb;
begin
  if v_actor is null or not (select app.has_perm('products.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_product_id is null
     or jsonb_typeof(p_variants) <> 'array'
     or jsonb_array_length(p_variants) < 1
     or jsonb_array_length(p_variants) > 200 then
    raise exception 'INVALID_VARIANTS' using errcode = '22023';
  end if;

  -- El mismo candado que usa la restriccion diferida evita que dos altas
  -- simultaneas agreguen la misma talla/color al producto.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('variant-combination:' || p_product_id::text, 0)
  );

  perform 1
  from public.products
  where id = p_product_id and is_active
  for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = '22023';
  end if;

  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    if jsonb_typeof(v_variant) <> 'object' then
      raise exception 'INVALID_VARIANT' using errcode = '22023';
    end if;
    if v_variant ? 'sku'
       or v_variant ? 'barcode'
       or v_variant ? 'barcode_source'
       or v_variant ? 'barcode_symbology'
       or v_variant ? 'legacy_sicar_code'
       or v_variant ? 'woocommerce_product_id'
       or v_variant ? 'woocommerce_variation_id' then
      raise exception 'IDENTITY_FIELDS_NOT_ALLOWED' using errcode = '42501';
    end if;
    if coalesce((v_variant ->> 'cost_cents')::bigint, -1) < 0
       or coalesce((v_variant ->> 'price_cents')::bigint, -1) < 0
       or (
         v_variant ? 'attributes'
         and jsonb_typeof(v_variant -> 'attributes') <> 'object'
       ) then
      raise exception 'INVALID_VARIANT' using errcode = '22023';
    end if;

    v_serial := nextval('app.variant_serial_seq');
    v_sku := v_serial::text || '-' || app.luhn_check_digit(v_serial::text)::text;
    v_barcode_payload := '20' || lpad(v_serial::text, 10, '0');
    v_barcode := v_barcode_payload || app.ean13_check_digit(v_barcode_payload)::text;

    insert into public.variants (
      product_id, sku, cost_cents, price_cents, created_by, updated_by
    ) values (
      p_product_id, v_sku,
      (v_variant ->> 'cost_cents')::bigint,
      (v_variant ->> 'price_cents')::bigint,
      v_actor, v_actor
    ) returning id into v_variant_id;

    for v_attribute in
      select key as type_code, value as value_id
      from jsonb_each_text(coalesce(v_variant -> 'attributes', '{}'::jsonb))
    loop
      if not exists (
        select 1
        from public.attribute_values av
        where av.id = v_attribute.value_id::uuid
          and av.type_code = v_attribute.type_code
      ) then
        raise exception 'INVALID_VARIANT_ATTRIBUTE' using errcode = '22023';
      end if;
      insert into public.variant_attributes (variant_id, type_code, value_id)
      values (v_variant_id, v_attribute.type_code, v_attribute.value_id::uuid);
    end loop;

    insert into public.barcodes (variant_id, code, symbology, source, is_primary)
    values (v_variant_id, v_barcode, 'EAN13', 'GENERATED', true);

    v_variant_ids := v_variant_ids || jsonb_build_array(v_variant_id);
    v_count := v_count + 1;
  end loop;

  update public.products
  set updated_by = v_actor, updated_at = now()
  where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'variant_count', v_count,
    'variant_ids', v_variant_ids
  );
exception
  when unique_violation then
    if sqlerrm like '%DUPLICATE_VARIANT_ATTRIBUTES%' then
      raise;
    end if;
    raise exception 'CATALOG_DUPLICATE_VALUE' using errcode = '23505';
end;
$$;

comment on function public.add_variants_to_product(uuid, jsonb) is
  'Agrega variantes con SKU y EAN-13 generados, sin alterar identidades existentes.';

revoke execute on function public.add_variants_to_product(uuid, jsonb)
  from public, anon;
grant execute on function public.add_variants_to_product(uuid, jsonb)
  to authenticated;

commit;
