begin;

-- An indexed literal barcode lookup must precede any fuzzy search or row limit.
-- Catalog review needs no cash session, stock, or permission to sell.
create function app.lookup_catalog_barcode(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('products.read')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_code is null or char_length(p_code) not between 1 and 100
    or p_code <> btrim(p_code) then
    raise exception 'INVALID_BARCODE' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'variant_id', v.id, 'product_id', p.id, 'product_name', p.name,
    'sku', v.sku, 'primary_barcode', coalesce(primary_code.code, matched.code),
    'matched_barcode', matched.code, 'legacy_sicar_code', v.legacy_sicar_code,
    'brand_name', coalesce(b.name, 'Sin marca'), 'category_id', p.category_id,
    'department_name', p.department_name, 'measure_unit_code', p.measure_unit_code,
    'description', coalesce(p.description, ''), 'product_active', p.is_active,
    'is_active', v.is_active, 'image_path', p.image_path,
    'price_cents', v.price_cents,
    'cost_cents', case when (select app.has_perm('reports.inventory'))
      or (select app.has_perm('purchases.manage')) then v.cost_cents else null end,
    'attributes', coalesce(attrs.values, '{}'::jsonb)
  ) into v_result
  from public.barcodes matched
  join public.variants v on v.id = matched.variant_id
  join public.products p on p.id = v.product_id
  left join public.brands b on b.id = p.brand_id
  left join public.barcodes primary_code
    on primary_code.variant_id = v.id and primary_code.is_primary
  left join lateral (
    select jsonb_object_agg(va.type_code, av.value) as values
    from public.variant_attributes va
    join public.attribute_values av on av.id = va.value_id
    where va.variant_id = v.id
  ) attrs on true
  where matched.code = p_code;
  return v_result;
end;
$$;

create function public.lookup_catalog_barcode(p_code text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.lookup_catalog_barcode(p_code);
$$;
revoke execute on function app.lookup_catalog_barcode(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.lookup_catalog_barcode(text)
  from public, anon, authenticated, service_role;
grant execute on function app.lookup_catalog_barcode(text) to authenticated;
grant execute on function public.lookup_catalog_barcode(text) to authenticated;

commit;
