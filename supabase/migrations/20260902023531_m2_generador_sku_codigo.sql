begin;

-- M2.2 — Identidad interna automática para cada variante.
-- La secuencia vive en el esquema privado `app`; el frontend nunca puede
-- reservar ni elegir identidades. Los huecos tras una transacción fallida
-- son intencionales y evitan reutilizar números físicos.
create sequence app.variant_serial_seq
  as bigint
  start with 1000000
  minvalue 1000000
  maxvalue 999999999
  no cycle;

create or replace function app.luhn_check_digit(p_payload text)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_sum integer := 0;
  v_digit integer;
  v_position integer;
begin
  if p_payload !~ '^[0-9]{1,18}$' then
    return null;
  end if;

  for v_position in reverse length(p_payload)..1 loop
    v_digit := substr(p_payload, v_position, 1)::integer *
      case when (length(p_payload) - v_position) % 2 = 0 then 2 else 1 end;
    if v_digit > 9 then
      v_digit := v_digit - 9;
    end if;
    v_sum := v_sum + v_digit;
  end loop;

  return (10 - (v_sum % 10)) % 10;
end;
$$;

-- M1B conserva su API, pero comparte la misma implementación de Luhn.
create or replace function app.member_check_digit(p_payload text)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when p_payload ~ '^[0-9]{7}$' then app.luhn_check_digit(p_payload)
    else null
  end
$$;

create or replace function app.ean13_check_digit(p_payload text)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_sum integer := 0;
  v_position integer;
begin
  if p_payload !~ '^[0-9]{12}$' then
    return null;
  end if;

  for v_position in 1..12 loop
    v_sum := v_sum + substr(p_payload, v_position, 1)::integer *
      case when v_position % 2 = 0 then 3 else 1 end;
  end loop;
  return (10 - (v_sum % 10)) % 10;
end;
$$;

create or replace function app.protect_variant_sku()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sku is distinct from old.sku then
    raise exception 'VARIANT_SKU_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger variants_protect_sku
before update on public.variants
for each row execute function app.protect_variant_sku();

create or replace function app.protect_sicar_barcode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source in ('SICAR', 'GENERATED') and (
    tg_op = 'DELETE'
    or new.code is distinct from old.code
    or new.variant_id is distinct from old.variant_id
  ) then
    if old.source = 'SICAR' then
      raise exception 'SICAR_BARCODE_IMMUTABLE' using errcode = '42501';
    end if;
    raise exception 'GENERATED_BARCODE_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

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
  v_serial bigint;
  v_sku text;
  v_barcode_payload text;
  v_barcode text;
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
    -- Estos campos sólo pertenecen al generador o a M9. Rechazarlos hace
    -- visible cualquier cliente desactualizado en vez de ignorarlo.
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
       or coalesce((v_variant ->> 'price_cents')::bigint, -1) < 0 then
      raise exception 'INVALID_VARIANT' using errcode = '22023';
    end if;

    v_serial := nextval('app.variant_serial_seq');
    v_sku := v_serial::text || '-' || app.luhn_check_digit(v_serial::text)::text;
    v_barcode_payload := '20' || lpad(v_serial::text, 10, '0');
    v_barcode := v_barcode_payload || app.ean13_check_digit(v_barcode_payload)::text;

    insert into public.variants (
      product_id, sku, cost_cents, price_cents, created_by, updated_by
    ) values (
      v_product_id, v_sku,
      (v_variant ->> 'cost_cents')::bigint,
      (v_variant ->> 'price_cents')::bigint,
      v_actor, v_actor
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
    values (v_variant_id, v_barcode, 'EAN13', 'GENERATED', true);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('product_id', v_product_id, 'variant_count', v_count);
exception
  when unique_violation then
    raise exception 'CATALOG_DUPLICATE_VALUE' using errcode = '23505';
end;
$$;

revoke all on sequence app.variant_serial_seq from public, anon, authenticated;
revoke execute on function app.luhn_check_digit(text) from public, anon, authenticated;
revoke execute on function app.ean13_check_digit(text) from public, anon, authenticated;
revoke execute on function app.protect_variant_sku() from public, anon, authenticated;

commit;
