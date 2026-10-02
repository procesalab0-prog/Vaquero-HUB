begin;

-- Private definer avoids exposing raw costs. Both entry points check the real
-- employee permission; this query never grants direct catalog writes.
create function app.m9_review_catalog(
  p_query text default '', p_exact boolean default false,
  p_department text default '', p_section text default '', p_page integer default 1
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; see_cost boolean;
begin
  if auth.uid() is null or not app.has_perm('products.read') then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform app.assert_sicar_staging_enabled();
  if p_query is null or length(p_query)>160 or p_exact is null
    or p_department is null or length(p_department)>160
    or p_section is null or length(p_section)>160
    or p_page is null or p_page<1 or p_page>100000 then
    raise exception 'INVALID_REVIEW_FILTER';
  end if;
  see_cost := app.has_perm('reports.inventory') or app.has_perm('purchases.manage');
  with catalog as materialized (
    select v.id, p.name, v.sku, b.code as barcode,
      d.department, d.section, d.source_description,
      v.price_cents, case when see_cost then v.cost_cents end as cost_cents,
      d.wholesale_cents, d.medium_wholesale_cents,
      v.woocommerce_product_id as woo_product_id,
      v.woocommerce_variation_id as woo_variation_id,
      v.is_active and p.is_active as is_active,
      coalesce((select jsonb_object_agg(a.type_code,a.value order by a.type_code)
        from public.variant_attributes va join public.attribute_values a on a.id=va.value_id
        where va.variant_id=v.id),'{}'::jsonb) as attributes
    from public.m9_variant_details d
    join public.variants v on v.id=d.variant_id
    join public.products p on p.id=v.product_id
    join public.barcodes b on b.variant_id=v.id and b.source='SICAR' and b.is_primary
  ), filtered as materialized (
    select * from catalog c where
      (p_department='' or c.department=p_department) and
      (p_section='' or c.section=p_section) and
      (case when p_exact then c.barcode=p_query else
        p_query='' or strpos(lower(concat_ws(' ',c.name,c.sku,c.barcode,
          c.source_description,c.department,c.section,c.attributes::text)),lower(p_query))>0 end)
  ), page as (
    select * from filtered order by barcode,id limit 20 offset ((p_page-1)*20)
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.barcode,x.id) from page x),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'page_size',20,
    'can_view_cost',see_cost,
    'departments',(select coalesce(jsonb_agg(x.department order by x.department),'[]'::jsonb)
      from (select distinct department from catalog) x),
    'sections',(select coalesce(jsonb_agg(x.section order by x.section),'[]'::jsonb)
      from (select distinct section from catalog where p_department='' or department=p_department) x)
  ) into result;
  return result;
end $$;
revoke all on function app.m9_review_catalog(text,boolean,text,text,integer) from public,anon,service_role;
grant execute on function app.m9_review_catalog(text,boolean,text,text,integer) to authenticated;

create function public.m9_review_catalog(
  p_query text default '', p_exact boolean default false,
  p_department text default '', p_section text default '', p_page integer default 1
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select app.m9_review_catalog(p_query,p_exact,p_department,p_section,p_page)
$$;
revoke all on function public.m9_review_catalog(text,boolean,text,text,integer) from public,anon,service_role;
grant execute on function public.m9_review_catalog(text,boolean,text,text,integer) to authenticated;
commit;
