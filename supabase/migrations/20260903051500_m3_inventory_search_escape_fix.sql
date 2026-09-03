begin;

create or replace function public.get_inventory_snapshot(
  p_location_id uuid,
  p_query text default '',
  p_limit integer default 300
)
returns table (
  variant_id uuid,
  product_id uuid,
  product_name text,
  brand_name text,
  sku text,
  primary_barcode text,
  attributes jsonb,
  qty numeric,
  reserved_qty numeric,
  available_qty numeric,
  is_active boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(translate(btrim(coalesce(p_query, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
begin
  if (select app.current_user_id()) is null
     or not (select app.has_perm('inventory.read')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;

  return query
  select
    v.id, p.id, p.name, coalesce(b.name, 'Sin marca'), v.sku,
    coalesce(primary_code.code, v.legacy_sicar_code),
    coalesce(attrs.values, '{}'::jsonb),
    coalesce(i.qty, 0), coalesce(i.reserved_qty, 0),
    coalesce(i.qty - i.reserved_qty, 0),
    p.is_active and v.is_active,
    coalesce(i.updated_at, v.updated_at)
  from public.variants v
  join public.products p on p.id = v.product_id
  left join public.brands b on b.id = p.brand_id
  left join public.inventory_by_location i
    on i.variant_id = v.id and i.location_id = p_location_id
  left join lateral (
    select bc.code from public.barcodes bc
    where bc.variant_id = v.id and bc.is_primary
    order by bc.created_at, bc.id limit 1
  ) primary_code on true
  left join lateral (
    select jsonb_object_agg(va.type_code, av.value order by va.type_code) as values
    from public.variant_attributes va
    join public.attribute_values av on av.id = va.value_id
    where va.variant_id = v.id
  ) attrs on true
  where v_query = ''
     or p.search_name like '%' || replace(replace(v_query, '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
     or lower(v.sku) like '%' || replace(replace(v_query, '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
     or exists (
       select 1 from public.barcodes search_code
       where search_code.variant_id = v.id
         and lower(search_code.code) like '%' || replace(replace(v_query, '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
     )
  order by p.name, v.sku
  limit p_limit;
end;
$$;

revoke execute on function public.get_inventory_snapshot(uuid, text, integer)
  from public, anon;
grant execute on function public.get_inventory_snapshot(uuid, text, integer)
  to authenticated;

comment on function public.get_inventory_snapshot(uuid, text, integer) is
  'Consulta inventario por sucursal y escapa comodines de búsqueda con un solo carácter.';

commit;
