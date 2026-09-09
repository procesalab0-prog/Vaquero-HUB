begin;

-- Las vistas viven fuera del esquema expuesto. No son endpoints: concentran
-- únicamente las columnas que los reportes necesitan y las RPC aplican
-- autorización, sucursal y límites antes de consultarlas.
create or replace view app.sales_report_lines
with (security_invoker = true)
as
select
  s.id as sale_id,
  s.location_id,
  s.cashier_user_id,
  u.full_name as cashier_name,
  s.folio,
  s.status,
  s.sold_at,
  i.id as sale_item_id,
  i.line_number,
  i.variant_id,
  i.product_name,
  i.sku,
  i.variant_description,
  i.quantity,
  i.gross_cents,
  i.item_discount_cents + i.ticket_discount_cents as discount_cents,
  i.line_total_cents - i.ticket_discount_cents as net_cents
from public.sales s
join public.app_users u on u.id = s.cashier_user_id
join public.sale_items i on i.sale_id = s.id;

create or replace view app.inventory_report_lines
with (security_invoker = true)
as
select
  i.location_id,
  v.id as variant_id,
  p.id as product_id,
  p.name as product_name,
  p.search_name,
  c.name as category_name,
  coalesce(b.name, 'Sin marca') as brand_name,
  v.sku,
  coalesce(attrs.description, 'Variante única') as variant_description,
  i.qty,
  i.reserved_qty,
  i.qty - i.reserved_qty as available_qty,
  v.cost_cents,
  v.price_cents,
  i.updated_at,
  p.is_active and v.is_active as is_active
from public.inventory_by_location i
join public.variants v on v.id = i.variant_id
join public.products p on p.id = v.product_id
join public.categories c on c.id = p.category_id
left join public.brands b on b.id = p.brand_id
left join lateral (
  select string_agg(av.value, ' · ' order by at.display_order, va.type_code) as description
  from public.variant_attributes va
  join public.attribute_types at on at.code = va.type_code
  join public.attribute_values av on av.id = va.value_id
  where va.variant_id = v.id
) attrs on true;

revoke all on app.sales_report_lines, app.inventory_report_lines
  from public, anon, authenticated, service_role;

create or replace function public.get_sales_report(
  p_location_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_grouping text default 'day',
  p_query text default ''
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
     or length(coalesce(p_query, '')) > 100 then
    raise exception 'INVALID_REPORT_QUERY' using errcode = '22023';
  end if;

  with filtered as materialized (
    select l.*,
      case p_grouping
        when 'day' then to_char(timezone('America/Mexico_City', l.sold_at), 'YYYY-MM-DD')
        when 'week' then to_char(timezone('America/Mexico_City', l.sold_at), 'IYYY-"S"IW')
        when 'month' then to_char(timezone('America/Mexico_City', l.sold_at), 'YYYY-MM')
        else to_char(timezone('America/Mexico_City', l.sold_at), 'YYYY')
      end as period_key
    from app.sales_report_lines l
    where l.location_id = p_location_id
      and l.sold_at >= p_from
      and l.sold_at < p_to
      and l.status = 'COMPLETED'
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
    where v_query = ''
  ),
  cancelled as (
    select count(*) as sale_count
    from public.sales s
    where s.location_id = p_location_id
      and s.sold_at >= p_from and s.sold_at < p_to
      and s.status = 'CANCELLED'
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
    where v_query = ''
    group by pm.code, pm.name, pm.sort_order
    order by pm.sort_order
  )
  select jsonb_build_object(
    'scope', case when v_query = '' then 'SALES' else 'PRODUCT_LINES' end,
    'summary', jsonb_build_object(
      'sale_count', summary.sale_count,
      'item_count', summary.item_count,
      'gross_cents', summary.gross_cents,
      'discount_cents', summary.discount_cents,
      'net_cents', summary.net_cents,
      'payment_total_cents', case when v_query = '' then payment_total.amount_cents else null end,
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

create or replace function public.get_inventory_report(
  p_location_id uuid,
  p_query text default ''
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
  if p_location_id is null or length(coalesce(p_query, '')) > 100 then
    raise exception 'INVALID_REPORT_QUERY' using errcode = '22023';
  end if;

  with filtered as materialized (
    select *
    from app.inventory_report_lines l
    where l.location_id = p_location_id
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
      'category_name', listed.category_name,
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

revoke execute on function public.get_sales_report(uuid, timestamptz, timestamptz, text, text)
  from public, anon;
revoke execute on function public.get_inventory_report(uuid, text)
  from public, anon;
grant execute on function public.get_sales_report(uuid, timestamptz, timestamptz, text, text)
  to authenticated, service_role;
grant execute on function public.get_inventory_report(uuid, text)
  to authenticated, service_role;

commit;
