begin;

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
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_can_see_cost boolean := (select app.has_perm('reports.inventory'))
    or (select app.has_perm('purchases.manage'));
begin
  if (select app.current_user_id()) is null or not (select app.has_perm('products.read')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  return query
  select
    v.id, p.id, p.name, coalesce(b.name, 'Sin marca'), c.name, v.sku,
    v.legacy_sicar_code, primary_code.code, v.price_cents,
    case when v_can_see_cost then v.cost_cents else null end,
    coalesce(attrs.values, '{}'::jsonb), v.is_active
  from public.variants v
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  left join public.brands b on b.id = p.brand_id
  left join lateral (
    select barcode.code
    from public.barcodes barcode
    where barcode.variant_id = v.id and barcode.is_primary
    limit 1
  ) primary_code on true
  left join lateral (
    select jsonb_object_agg(va.type_code, av.value order by at.display_order) as values
    from public.variant_attributes va
    join public.attribute_values av on av.id = va.value_id
    join public.attribute_types at on at.code = va.type_code
    where va.variant_id = v.id
  ) attrs on true
  where (
    v_query = ''
    or p.search_name like '%' || v_query || '%'
    or lower(v.sku) like '%' || v_query || '%'
    or lower(coalesce(v.legacy_sicar_code, '')) like '%' || v_query || '%'
    or lower(coalesce(b.name, '')) like '%' || v_query || '%'
    or exists (
      select 1 from public.barcodes bx
      where bx.variant_id = v.id and lower(bx.code) like '%' || v_query || '%'
    )
  )
  order by p.name, v.sku
  limit v_limit;
end;
$$;

revoke execute on function public.search_catalog(text, integer) from public, anon;
grant execute on function public.search_catalog(text, integer) to authenticated;

commit;
