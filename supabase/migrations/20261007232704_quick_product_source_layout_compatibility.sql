begin;
-- Run before pos_quick_product only on legacy hosted databases. Fresh rebuilds
-- already use the canonical layout and reach this migration after quick lines.
-- A line comment in the older patch requires the original multiline layout.
-- This changes formatting only; authorization, prices and stock checks stay equal.
do $compat$
declare s text;
begin
 if exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='sale_items' and column_name='quick_line_id') then return; end if;
 s:=pg_get_functiondef('public.search_equal_exchange_variants(bigint,uuid,text,integer)'::regprocedure);
 if md5(s)<>'86652b6fb53e25045b550d4a4982bf40' then
   if strpos(s,'or p_exclude_variant_id is null or p_limit')>0 then
     raise exception 'EXCHANGE_SOURCE_LAYOUT_NOT_RECOGNIZED';
   end if;
   return;
 end if;
 execute $canonical$
create or replace function public.search_equal_exchange_variants(
  p_price_cents bigint,
  p_exclude_variant_id uuid,
  p_query text default '',
  p_limit integer default 50
)
returns table (
  variant_id uuid,
  product_name text,
  brand_name text,
  sku text,
  price_cents bigint,
  attributes jsonb,
  available_qty numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_location_id uuid;
  v_query text := lower(translate(btrim(coalesce(p_query, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
begin
  if v_actor is null
     or not (select app.has_perm('returns.create'))
     or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_price_cents is null or p_price_cents < 0
     or p_exclude_variant_id is null
     or p_limit is null or p_limit < 1 or p_limit > 100
     or length(v_query) > 120 then
    raise exception 'INVALID_EXCHANGE_SEARCH' using errcode = '22023';
  end if;

  select s.location_id into v_location_id
  from public.cash_sessions s
  where s.cashier_user_id = v_actor and s.status = 'OPEN';
  if v_location_id is null or not (select app.can_access_location(v_location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select
    v.id,
    p.name,
    coalesce(b.name, 'Sin marca'),
    v.sku,
    v.price_cents,
    coalesce(attrs.values, '{}'::jsonb),
    i.qty - i.reserved_qty
  from public.variants v
  join public.products p on p.id = v.product_id
  left join public.brands b on b.id = p.brand_id
  join public.inventory_by_location i
    on i.variant_id = v.id and i.location_id = v_location_id
  left join lateral (
    select jsonb_object_agg(va.type_code, av.value order by va.type_code) as values
    from public.variant_attributes va
    join public.attribute_values av on av.id = va.value_id
    where va.variant_id = v.id
  ) attrs on true
  where p.is_active
    and v.is_active
    and v.id <> p_exclude_variant_id
    and v.price_cents = p_price_cents
    and i.qty - i.reserved_qty >= 1
    and (
      v_query = ''
      or strpos(p.search_name, v_query) > 0
      or strpos(lower(v.sku), v_query) > 0
      or strpos(lower(coalesce(v.legacy_sicar_code, '')), v_query) > 0
      or exists (
        select 1 from public.barcodes bc
        where bc.variant_id = v.id
          and strpos(lower(bc.code), v_query) > 0
      )
    )
  order by p.name, v.sku
  limit p_limit;
end;
$$;
$canonical$;
end; $compat$;
commit;
