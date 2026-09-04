begin;

-- La pantalla de inventario no debe atravesar directamente desde traspasos
-- hacia las tablas protegidas de catálogo. Esta RPC expone sólo los campos
-- necesarios después de validar permiso y alcance de sucursal.
create or replace function public.list_inventory_transfers(
  p_location_id uuid,
  p_limit integer default 30
)
returns table (
  transfer_id uuid,
  folio bigint,
  from_location_id uuid,
  from_location_name text,
  to_location_id uuid,
  to_location_name text,
  status text,
  note text,
  requested_at timestamptz,
  variant_id uuid,
  product_name text,
  sku text,
  qty_requested numeric,
  qty_sent numeric,
  qty_received numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select app.current_user_id()) is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not (select app.has_perm('inventory.read')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_location_id is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'INVALID_TRANSFER_QUERY' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.locations l
    where l.id = p_location_id and l.is_active and l.type <> 'TRANSIT'
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = '22023';
  end if;
  if not (
    (select app.can_access_location(p_location_id))
    or (select app.has_perm('locations.manage'))
  ) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  with selected_transfers as materialized (
    select t.id, t.folio, t.from_location_id, t.to_location_id,
           t.status, t.note, t.requested_at
    from public.transfers t
    where t.from_location_id = p_location_id or t.to_location_id = p_location_id
    order by t.requested_at desc, t.id desc
    limit p_limit
  )
  select st.id,
         st.folio,
         st.from_location_id,
         source.name,
         st.to_location_id,
         destination.name,
         st.status,
         st.note,
         st.requested_at,
         ti.variant_id,
         product.name,
         variant.sku,
         ti.qty_requested,
         ti.qty_sent,
         ti.qty_received
  from selected_transfers st
  join public.locations source on source.id = st.from_location_id
  join public.locations destination on destination.id = st.to_location_id
  join public.transfer_items ti on ti.transfer_id = st.id
  join public.variants variant on variant.id = ti.variant_id
  join public.products product on product.id = variant.product_id
  order by st.requested_at desc, st.id desc, variant.sku;
end;
$$;

revoke execute on function public.list_inventory_transfers(uuid, integer)
  from public, anon;
grant execute on function public.list_inventory_transfers(uuid, integer)
  to authenticated, service_role;

comment on function public.list_inventory_transfers(uuid, integer) is
  'Lista traspasos visibles con identidad mínima de producto sin abrir acceso directo al catálogo.';

commit;
