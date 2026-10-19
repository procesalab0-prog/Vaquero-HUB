begin;

-- Read-only, location-scoped catalogue query. No cost, write or release grant.
-- Summary always covers the whole catalogue in this location; result count
-- covers the filters. Variants without balance rows contribute zero stock.
create function app.inventory_catalog(
 p_location_id uuid,p_query text default '',p_filter text default 'all',
 p_page integer default 1,p_page_size integer default 50,p_exact boolean default false
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare raw_query text:=btrim(coalesce(p_query,'')); q text;
begin
 if app.current_user_id() is null or not app.has_perm('inventory.read') then
  raise exception 'NOT_AUTHORIZED' using errcode='42501';
 end if;
 if p_location_id is null or not app.can_access_location(p_location_id)
  or not exists(select 1 from public.locations where id=p_location_id and is_active and type<>'TRANSIT') then
  raise exception 'LOCATION_FORBIDDEN' using errcode='42501';
 end if;
 if length(raw_query)>120 or p_filter is null or p_filter not in ('all','available','last','out')
  or p_page is null or p_page not between 1 and 1000000
  or p_page_size is null or p_page_size not between 1 and 100
  or p_exact is null or (p_exact and raw_query='') then
  raise exception 'INVALID_INVENTORY_QUERY' using errcode='22023';
 end if;
 q:=lower(translate(raw_query,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'));
 return (
 with base as materialized (
  select v.id variant_id,p.id product_id,p.name product_name,coalesce(b.name,'Sin marca') brand_name,
   v.sku,v.legacy_sicar_code,coalesce(i.qty,0) qty,coalesce(i.reserved_qty,0) reserved_qty,
   coalesce(i.qty-i.reserved_qty,0) available_qty,p.is_active and v.is_active is_active,
   coalesce(i.updated_at,v.updated_at) updated_at,u.code unit_code,u.name unit_name,u.decimal_places
  from public.variants v join public.products p on p.id=v.product_id
  join public.measure_units u on u.code=p.measure_unit_code
  left join public.brands b on b.id=p.brand_id
  left join public.inventory_by_location i on i.variant_id=v.id and i.location_id=p_location_id
 ), exact_codes as materialized (
  select bc.variant_id from public.barcodes bc where bc.code=raw_query and raw_query<>''
  union select v.id from public.variants v where raw_query<>'' and (v.sku=raw_query or v.legacy_sicar_code=raw_query)
 ), matched as materialized (
  select b.*,case when e.variant_id is not null then 0 else 1 end exact_rank
  from base b left join exact_codes e on e.variant_id=b.variant_id
  where (p_filter='all' or (p_filter='available' and b.available_qty>0)
   or (p_filter='last' and b.available_qty>0 and b.available_qty<=1)
   or (p_filter='out' and b.available_qty<=0))
  and (case when p_exact then e.variant_id is not null else
   q='' or e.variant_id is not null
   or position(q in lower(translate(concat_ws(' ',b.product_name,b.brand_name,b.sku,b.legacy_sicar_code),
     'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))>0
   or exists(select 1 from public.barcodes bc where bc.variant_id=b.variant_id
     and position(q in lower(translate(bc.code,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))>0)
   or exists(select 1 from public.variant_attributes va join public.attribute_values av on av.id=va.value_id
     where va.variant_id=b.variant_id and position(q in lower(translate(av.value,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')))>0)
   end)
 ), total as (select count(*) n from matched), paging as (
  select n,least(p_page,greatest(1,ceil(n::numeric/p_page_size)::integer)) page from total
 ), selected as (
  select m.* from matched m order by exact_rank,product_name,sku,variant_id
  limit p_page_size offset (select (page-1)*p_page_size from paging)
 ), unit_totals as (
  select unit_code,unit_name,decimal_places,sum(qty) quantity,sum(reserved_qty) reserved_quantity,
   sum(available_qty) available_quantity from base group by unit_code,unit_name,decimal_places
 )
 select jsonb_build_object('query',raw_query,'filter',p_filter,'exact',p_exact,
  'page',(select page from paging),'page_size',p_page_size,'total_count',(select n from paging),
  'summary',jsonb_build_object('variant_count',(select count(*) from base),
   'out_count',(select count(*) from base where available_qty<=0),
   'low_count',(select count(*) from base where available_qty>0 and available_qty<=2),
   'units',(select coalesce(jsonb_agg(jsonb_build_object('unit',jsonb_build_object('code',unit_code,'name',unit_name,'decimal_places',decimal_places),
      'quantity',quantity,'reserved_quantity',reserved_quantity,'available_quantity',available_quantity) order by unit_code),'[]'::jsonb) from unit_totals)),
  'items',(select coalesce(jsonb_agg(jsonb_build_object('variant_id',s.variant_id,'product_id',s.product_id,
   'product_name',s.product_name,'brand_name',s.brand_name,'sku',s.sku,
   'primary_barcode',coalesce(bc.code,s.legacy_sicar_code,s.sku),'attributes',coalesce(attrs.values,'{}'::jsonb),
   'qty',s.qty,'reserved_qty',s.reserved_qty,'available_qty',s.available_qty,'is_active',s.is_active,'updated_at',s.updated_at,
   'measure_unit',jsonb_build_object('code',s.unit_code,'name',s.unit_name,'decimal_places',s.decimal_places))
   order by s.exact_rank,s.product_name,s.sku,s.variant_id),'[]'::jsonb)
   from selected s left join lateral (
    select code from public.barcodes where variant_id=s.variant_id
    order by (source='SICAR') desc,is_primary desc,created_at,id limit 1
   ) bc on true left join lateral (
    select jsonb_object_agg(va.type_code,av.value order by va.type_code) values
    from public.variant_attributes va join public.attribute_values av on av.id=va.value_id where va.variant_id=s.variant_id
   ) attrs on true))
 );
end $$;
revoke all on function app.inventory_catalog(uuid,text,text,integer,integer,boolean) from public,anon,service_role;
grant execute on function app.inventory_catalog(uuid,text,text,integer,integer,boolean) to authenticated;

create function public.get_inventory_catalog(
 p_location_id uuid,p_query text default '',p_filter text default 'all',
 p_page integer default 1,p_page_size integer default 50,p_exact boolean default false
) returns jsonb language sql stable security invoker set search_path='' as $$
 select app.inventory_catalog(p_location_id,p_query,p_filter,p_page,p_page_size,p_exact);
$$;
revoke all on function public.get_inventory_catalog(uuid,text,text,integer,integer,boolean) from public,anon,service_role;
grant execute on function public.get_inventory_catalog(uuid,text,text,integer,integer,boolean) to authenticated;
commit;
