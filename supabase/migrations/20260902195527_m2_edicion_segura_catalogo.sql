begin;

-- La edición se divide por privilegio para que un cliente no pueda ampliar
-- accidentalmente una operación. Las identidades de catálogo no aparecen en
-- ninguna firma: SKU, códigos, SICAR y WooCommerce siguen bajo sus procesos
-- protegidos y sus triggers de inmutabilidad.
create or replace function public.update_catalog_product(
  p_product_id uuid,
  p_name text,
  p_category_id uuid,
  p_brand_name text default null,
  p_description text default null,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_brand_id uuid;
  v_brand_name text := nullif(btrim(coalesce(p_brand_name, '')), '');
begin
  if v_actor is null or not (select app.has_perm('products.update')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_product_id is null
     or nullif(btrim(coalesce(p_name, '')), '') is null
     or p_category_id is null
     or p_is_active is null
     or length(btrim(p_name)) > 180
     or length(coalesce(p_description, '')) > 4000
     or length(coalesce(v_brand_name, '')) > 120 then
    raise exception 'INVALID_PRODUCT' using errcode = '22023';
  end if;

  perform 1 from public.products where id = p_product_id for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.categories
    where id = p_category_id and is_active
  ) then
    raise exception 'INVALID_CATEGORY' using errcode = '22023';
  end if;

  if v_brand_name is not null then
    insert into public.brands (name)
    values (v_brand_name)
    on conflict do nothing;

    select id into v_brand_id
    from public.brands
    where lower(btrim(name)) = lower(v_brand_name);

    update public.brands
    set is_active = true, updated_at = now()
    where id = v_brand_id and not is_active;
  end if;

  update public.products
  set name = btrim(p_name),
      category_id = p_category_id,
      brand_id = v_brand_id,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      is_active = p_is_active,
      updated_by = v_actor
  where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'is_active', p_is_active
  );
end;
$$;

create or replace function public.update_catalog_variant(
  p_variant_id uuid,
  p_cost_cents bigint,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
begin
  if v_actor is null
     or not (select app.has_perm('products.update'))
     or not (
       (select app.has_perm('reports.inventory'))
       or (select app.has_perm('purchases.manage'))
     ) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_variant_id is null or p_cost_cents is null or p_cost_cents < 0
     or p_is_active is null then
    raise exception 'INVALID_VARIANT' using errcode = '22023';
  end if;

  update public.variants
  set cost_cents = p_cost_cents,
      is_active = p_is_active,
      updated_by = v_actor
  where id = p_variant_id;
  if not found then
    raise exception 'VARIANT_NOT_FOUND' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'variant_id', p_variant_id,
    'is_active', p_is_active
  );
end;
$$;

create or replace function public.update_catalog_variant_price(
  p_variant_id uuid,
  p_price_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
begin
  if v_actor is null or not (select app.has_perm('products.price_update')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_variant_id is null or p_price_cents is null or p_price_cents < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;

  update public.variants
  set price_cents = p_price_cents,
      updated_by = v_actor
  where id = p_variant_id;
  if not found then
    raise exception 'VARIANT_NOT_FOUND' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'variant_id', p_variant_id,
    'price_cents', p_price_cents
  );
end;
$$;

comment on function public.update_catalog_product(uuid, text, uuid, text, text, boolean) is
  'Edita sólo datos generales del producto con products.update; deja identidades fuera de la firma.';
comment on function public.update_catalog_variant(uuid, bigint, boolean) is
  'Edita costo y estado con products.update y permiso para ver costos; no acepta SKU ni códigos.';
comment on function public.update_catalog_variant_price(uuid, bigint) is
  'Cambia únicamente el precio con products.price_update y deja auditoría por trigger.';

revoke execute on function public.update_catalog_product(uuid, text, uuid, text, text, boolean)
  from public, anon;
revoke execute on function public.update_catalog_variant(uuid, bigint, boolean)
  from public, anon;
revoke execute on function public.update_catalog_variant_price(uuid, bigint)
  from public, anon;

grant execute on function public.update_catalog_product(uuid, text, uuid, text, text, boolean)
  to authenticated;
grant execute on function public.update_catalog_variant(uuid, bigint, boolean)
  to authenticated;
grant execute on function public.update_catalog_variant_price(uuid, bigint)
  to authenticated;

commit;
