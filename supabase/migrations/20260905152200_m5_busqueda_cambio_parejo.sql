begin;

-- El catalogo actual se opera por PIEZA. Ambos entornos fueron comprobados
-- sin renglones fraccionarios antes de validar esta regla.
alter table public.return_items
  add constraint return_item_piece_quantity_integer
  check (quantity = trunc(quantity));

-- Buscar el articulo de salida en una sola consulta evita recortar primero
-- un catalogo grande y luego intentar cruzarlo en el navegador. La funcion
-- resuelve sucursal, permiso, precio y existencia del lado servidor.
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

revoke execute on function public.search_equal_exchange_variants(bigint, uuid, text, integer)
  from public, anon;
grant execute on function public.search_equal_exchange_variants(bigint, uuid, text, integer)
  to authenticated, service_role;

comment on function public.search_equal_exchange_variants(bigint, uuid, text, integer) is
  'Opciones con existencia y precio identico para cambio parejo en la caja abierta del actor.';

commit;
