begin;

-- Una devolución dañada necesita dejar dos movimientos (entrada y merma),
-- pero no debe conceder inventory.adjust al cajero. Sólo la transacción M5,
-- mientras mantiene abierto su candado interno, puede usar esta excepción.
create or replace function app.apply_movement(
  p_variant_id uuid,
  p_location_id uuid,
  p_type text,
  p_qty numeric,
  p_reference_type text,
  p_reference_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev numeric(12,3); v_new numeric(12,3); v_id bigint;
  v_user uuid := (select app.current_user_id());
  v_permission text; v_location_type text;
begin
  if v_user is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if p_variant_id is null or p_location_id is null or p_qty is null or p_qty = 0
     or abs(p_qty) > 999999999.999
     or p_type not in ('INITIAL_IMPORT','SALE','RETURN','PURCHASE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT','CANCELLATION','COUNT')
     or nullif(btrim(coalesce(p_reference_type, '')), '') is null or length(btrim(p_reference_type)) > 80
     or nullif(btrim(coalesce(p_reference_id, '')), '') is null or length(btrim(p_reference_id)) > 160
     or p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or pg_column_size(p_metadata) > 8192 then
    raise exception 'INVALID_MOVEMENT' using errcode = '22023';
  end if;
  if (p_type in ('SALE','TRANSFER_OUT') and p_qty > 0)
     or (p_type in ('RETURN','PURCHASE','TRANSFER_IN','CANCELLATION') and p_qty < 0) then
    raise exception 'INVALID_MOVEMENT_SIGN' using errcode = '22023';
  end if;
  select type into v_location_type from public.locations where id = p_location_id and is_active;
  if not found then raise exception 'LOCATION_NOT_FOUND' using errcode = '22023'; end if;
  if v_location_type = 'TRANSIT' then
    if p_type not in ('TRANSFER_OUT','TRANSFER_IN') then raise exception 'TRANSIT_LOCATION_FORBIDDEN' using errcode = '42501'; end if;
  elsif not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  v_permission := case p_type
    when 'SALE' then 'pos.sell' when 'RETURN' then 'returns.create'
    when 'CANCELLATION' then 'sales.cancel' when 'PURCHASE' then 'purchases.receive'
    when 'COUNT' then 'inventory.count' when 'ADJUSTMENT' then 'inventory.adjust'
    when 'INITIAL_IMPORT' then 'inventory.adjust' end;
  if p_type in ('TRANSFER_OUT','TRANSFER_IN') then
    if not ((select app.has_perm('transfers.create')) or (select app.has_perm('transfers.receive'))) then
      raise exception 'PERMISSION_DENIED' using errcode = '42501';
    end if;
  elsif p_type = 'ADJUSTMENT' and p_reference_type = 'DAMAGED_RETURN'
        and current_setting('app.returns_write', true) = 'on' then
    if not (select app.has_perm('returns.create')) then
      raise exception 'PERMISSION_DENIED' using errcode = '42501';
    end if;
  elsif v_permission is null or not (select app.has_perm(v_permission)) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  perform set_config('app.inventory_write', 'on', true);
  insert into public.inventory_by_location(variant_id, location_id)
  values (p_variant_id, p_location_id) on conflict do nothing;
  update public.inventory_by_location set qty = qty + p_qty, updated_at = now()
  where variant_id = p_variant_id and location_id = p_location_id and qty + p_qty >= reserved_qty
  returning qty - p_qty, qty into v_prev, v_new;
  if not found then raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001'; end if;
  insert into public.inventory_movements(variant_id, location_id, movement_type, quantity,
    previous_qty, new_qty, reference_type, reference_id, user_id, metadata)
  values (p_variant_id, p_location_id, p_type, p_qty, v_prev, v_new,
    btrim(p_reference_type), btrim(p_reference_id), v_user, p_metadata)
  returning id into v_id;
  perform set_config('app.inventory_write', 'off', true);
  return v_id;
end;
$$;

revoke execute on function app.apply_movement(uuid, uuid, text, numeric, text, text, jsonb)
from public, anon, authenticated, service_role;

commit;
