begin;
-- Department is independent from category. No inference from SICAR codes,
-- Woo data or category names; import reconciliation remains owned by M9.
alter table public.products add column department_name text check(department_name is null or (department_name=btrim(department_name) and length(department_name) between 1 and 100));
create index products_department_idx on public.products(department_name) where department_name is not null;

create or replace function public.update_catalog_product_v2(
 p_product_id uuid,p_name text,p_category_id uuid,p_brand_name text default null,
 p_description text default null,p_is_active boolean default true,p_department_name text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_old text; v_department text:=nullif(btrim(p_department_name),''); v_actor uuid:=app.current_user_id();
begin
 if v_actor is null or not app.has_perm('products.update') then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if length(v_department)>100 then raise exception 'INVALID_PRODUCT_DATA' using errcode='22023'; end if;
 select department_name into v_old from public.products where id=p_product_id for update;
 v_result:=public.update_catalog_product(p_product_id,p_name,p_category_id,p_brand_name,p_description,p_is_active);
 update public.products set department_name=v_department where id=p_product_id;
 if v_old is distinct from v_department then
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,before_data,after_data,metadata)
  values(v_actor,'product.department_changed','products',p_product_id::text,
   jsonb_build_object('department_name',v_old),jsonb_build_object('department_name',v_department),'{}'::jsonb);
 end if;
 return v_result;
end;
$$;
create or replace function public.get_report_classifications()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if app.current_user_id() is null or not(app.has_perm('reports.sales') or app.has_perm('reports.inventory')) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return jsonb_build_object(
  'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) from public.categories),
  'departments',(select coalesce(jsonb_agg(department_name order by department_name),'[]'::jsonb) from (select distinct department_name from public.products where department_name is not null) d));
end;
$$;
create or replace function public.get_sales_report_v2(
  p_location_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_grouping text default 'day',
  p_query text default '',
  p_category_id uuid default null,
  p_department text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(translate(btrim(coalesce(p_query, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
  v_result jsonb;
begin
  if (select app.current_user_id()) is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not (select app.has_perm('reports.sales'))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_location_id is null
     or p_from is null
     or p_to is null
     or p_from >= p_to
     or p_to - p_from > interval '366 days'
     or p_grouping not in ('day', 'week', 'month', 'year')
     or length(coalesce(p_department,''))>100
     or length(coalesce(p_query, '')) > 100 then
    raise exception 'INVALID_REPORT_QUERY' using errcode = '22023';
  end if;

  with matching as materialized (
    select l.*,c.name as category_name,p.department_name,
      case p_grouping
        when 'day' then to_char(timezone('America/Mexico_City', l.sold_at), 'YYYY-MM-DD')
        when 'week' then to_char(timezone('America/Mexico_City', l.sold_at), 'IYYY-"S"IW')
        when 'month' then to_char(timezone('America/Mexico_City', l.sold_at), 'YYYY-MM')
        else to_char(timezone('America/Mexico_City', l.sold_at), 'YYYY')
      end as period_key
    from app.sales_report_lines l
    left join public.variants v on v.id=l.variant_id
    left join public.products p on p.id=v.product_id
    left join public.categories c on c.id=p.category_id
    where l.location_id = p_location_id
      and l.sold_at >= p_from
      and l.sold_at < p_to
      and (p_category_id is null or p.category_id=p_category_id)
      and (nullif(btrim(p_department),'') is null or p.department_name=btrim(p_department))
      and (
        v_query = ''
        or lower(translate(l.product_name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
          like '%' || replace(replace(v_query, '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
        or lower(l.sku)
          like '%' || replace(replace(v_query, '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
        or lower(translate(l.variant_description, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
          like '%' || replace(replace(v_query, '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
      )
  ),
  filtered as materialized (select * from matching where status='COMPLETED'),
  sale_ids as (
    select distinct sale_id from filtered
  ),
  summary as (
    select
      count(distinct sale_id) as sale_count,
      coalesce(sum(quantity), 0) as item_count,
      coalesce(sum(gross_cents), 0) as gross_cents,
      coalesce(sum(discount_cents), 0) as discount_cents,
      coalesce(sum(net_cents), 0) as net_cents
    from filtered
  ),
  payment_total as (
    select coalesce(sum(sp.amount_cents), 0) as amount_cents
    from public.sale_payments sp
    join sale_ids ids on ids.sale_id = sp.sale_id
    where (v_query = '' and p_category_id is null and nullif(btrim(p_department),'') is null)
  ),
  cancelled as (
    select count(distinct sale_id) as sale_count from matching where status='CANCELLED'
  ),
  periods as (
    select period_key,
      count(distinct sale_id) as sale_count,
      sum(quantity) as item_count,
      sum(net_cents) as net_cents
    from filtered
    group by period_key
  ),
  products as (
    select product_name, sku, variant_description,
      sum(quantity) as quantity,
      sum(net_cents) as net_cents
    from filtered
    group by product_name, sku, variant_description
    order by sum(net_cents) desc, product_name, sku
    limit 50
  ),
  details as (
    select * from filtered
    order by sold_at desc, sale_id, line_number
    limit 300
  ),
  detail_count as (
    select count(*) as total from filtered
  ),
  payments as (
    select pm.code, pm.name, sum(sp.amount_cents) as amount_cents
    from public.sale_payments sp
    join sale_ids ids on ids.sale_id = sp.sale_id
    join public.payment_methods pm on pm.code = sp.method_code
    where (v_query = '' and p_category_id is null and nullif(btrim(p_department),'') is null)
    group by pm.code, pm.name, pm.sort_order
    order by pm.sort_order
  )
  select jsonb_build_object(
    'scope', case when (v_query = '' and p_category_id is null and nullif(btrim(p_department),'') is null) then 'SALES' else 'PRODUCT_LINES' end,
    'summary', jsonb_build_object(
      'sale_count', summary.sale_count,
      'item_count', summary.item_count,
      'gross_cents', summary.gross_cents,
      'discount_cents', summary.discount_cents,
      'net_cents', summary.net_cents,
      'payment_total_cents', case when (v_query = '' and p_category_id is null and nullif(btrim(p_department),'') is null) then payment_total.amount_cents else null end,
      'cancelled_count', cancelled.sale_count
    ),
    'periods', coalesce((select jsonb_agg(to_jsonb(periods) order by period_key) from periods), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(products)) from products), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(payments)) from payments), '[]'::jsonb),
    'details', coalesce((select jsonb_agg(jsonb_build_object(
      'sale_id', details.sale_id,
      'folio', details.folio,
      'sold_at', details.sold_at,
      'cashier_name', details.cashier_name,
      'product_name', details.product_name,
      'sku', details.sku,
      'variant_description', details.variant_description,
      'category_name',details.category_name,'department_name',details.department_name,
      'quantity', details.quantity,
      'discount_cents', details.discount_cents,
      'net_cents', details.net_cents
    ) order by details.sold_at desc, details.sale_id, details.line_number) from details), '[]'::jsonb),
    'truncated', detail_count.total > 300
  ) into v_result
  from summary, payment_total, cancelled, detail_count;

  return v_result;
end;
$$;

create or replace function public.get_inventory_report_v2(
  p_location_id uuid,
  p_query text default '',
  p_category_id uuid default null,
  p_department text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(translate(btrim(coalesce(p_query, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
  v_result jsonb;
begin
  if (select app.current_user_id()) is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not (select app.has_perm('reports.inventory'))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_location_id is null or (length(coalesce(p_query, '')) > 100 or length(coalesce(p_department,''))>100) then
    raise exception 'INVALID_REPORT_QUERY' using errcode = '22023';
  end if;

  with filtered as materialized (
    select l.*,p.department_name
    from app.inventory_report_lines l
    join public.products p on p.id=l.product_id
    where l.location_id = p_location_id
      and (p_category_id is null or p.category_id=p_category_id)
      and (nullif(btrim(p_department),'') is null or p.department_name=btrim(p_department))
      and (
        v_query = ''
        or l.search_name like '%' || replace(replace(v_query, '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
        or lower(l.sku) like '%' || replace(replace(v_query, '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
        or lower(translate(l.variant_description, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
          like '%' || replace(replace(v_query, '%', E'\\%'), '_', E'\\_') || '%' escape E'\\'
      )
  ),
  summary as (
    select
      count(*) as variant_count,
      coalesce(sum(qty), 0) as qty,
      coalesce(sum(reserved_qty), 0) as reserved_qty,
      coalesce(sum(available_qty), 0) as available_qty,
      count(*) filter (where available_qty <= 0) as out_count,
      count(*) filter (where available_qty > 0 and available_qty <= 2) as low_count,
      coalesce(sum(qty * cost_cents), 0) as cost_value_cents,
      coalesce(sum(qty * price_cents), 0) as retail_value_cents
    from filtered
  ),
  categories as (
    select category_name, count(*) as variant_count,
      sum(qty) as qty, sum(available_qty) as available_qty,
      sum(qty * cost_cents) as cost_value_cents
    from filtered
    group by category_name
    order by category_name
  ),
  listed as (
    select * from filtered
    order by product_name, sku
    limit 500
  ),
  item_count as (select count(*) as total from filtered)
  select jsonb_build_object(
    'summary', to_jsonb(summary),
    'categories', coalesce((select jsonb_agg(to_jsonb(categories)) from categories), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'variant_id', listed.variant_id,
      'product_name', listed.product_name,
      'category_name', listed.category_name,'department_name',listed.department_name,
      'brand_name', listed.brand_name,
      'sku', listed.sku,
      'variant_description', listed.variant_description,
      'qty', listed.qty,
      'reserved_qty', listed.reserved_qty,
      'available_qty', listed.available_qty,
      'cost_cents', listed.cost_cents,
      'price_cents', listed.price_cents,
      'is_active', listed.is_active,
      'updated_at', listed.updated_at
    ) order by listed.product_name, listed.sku) from listed), '[]'::jsonb),
    'truncated', item_count.total > 500
  ) into v_result
  from summary, item_count;

  return v_result;
end;
$$;


create or replace function public.get_sales_report(p_location_id uuid,p_from timestamptz,p_to timestamptz,p_grouping text default 'day',p_query text default '')
returns jsonb language sql stable security definer set search_path='' as $$
 select public.get_sales_report_v2(p_location_id,p_from,p_to,p_grouping,p_query,null,null);
$$;
create or replace function public.get_inventory_report(p_location_id uuid,p_query text default '')
returns jsonb language sql stable security definer set search_path='' as $$
 select public.get_inventory_report_v2(p_location_id,p_query,null,null);
$$;
revoke all on function public.update_catalog_product_v2(uuid,text,uuid,text,text,boolean,text),public.get_report_classifications(),
 public.get_sales_report_v2(uuid,timestamptz,timestamptz,text,text,uuid,text),public.get_inventory_report_v2(uuid,text,uuid,text) from public,anon;
grant execute on function public.update_catalog_product_v2(uuid,text,uuid,text,text,boolean,text),public.get_report_classifications(),
 public.get_sales_report_v2(uuid,timestamptz,timestamptz,text,text,uuid,text),public.get_inventory_report_v2(uuid,text,uuid,text) to authenticated;
commit;
