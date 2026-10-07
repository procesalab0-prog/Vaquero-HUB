begin;

create index barcodes_lower_code_idx on public.barcodes(lower(code));
create index variants_lower_sku_idx on public.variants(lower(sku));

-- Recupera las variantes de borradores fuera del catálogo inicial y sus saldos
-- de la caja propia, sin exponer costos ni abrir SELECT sobre el catálogo.
create function public.get_pos_variants(p_cash_session_id uuid, p_variant_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_session public.cash_sessions;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_session := app.assert_owned_open_cash_session(p_cash_session_id, v_actor);
  if not (select app.can_access_location(v_session.location_id)) then
    raise exception 'LOCATION_NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_variant_ids is null or cardinality(p_variant_ids) > 3000 then
    raise exception 'INVALID_VARIANT_IDS' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', v.id, 'productId', p.id, 'productName', p.name, 'sku', v.sku,
    'legacyCode', coalesce((select code from public.barcodes where variant_id = v.id and is_primary limit 1), v.sku),
    'brand', coalesce(b.name, ''), 'color', coalesce(attrs.values->>'COLOR', 'Sin color'),
    'size', coalesce(attrs.values->>'TALLA', 'Única'), 'price', v.price_cents::numeric / 100,
    'isActive', v.is_active and p.is_active,
    'stock', coalesce(i.qty - i.reserved_qty, 0)
  ) order by v.id)
  from public.variants v join public.products p on p.id = v.product_id
  left join public.brands b on b.id = p.brand_id
  left join lateral (
    select jsonb_object_agg(va.type_code, av.value) as values
    from public.variant_attributes va join public.attribute_values av on av.id = va.value_id
    where va.variant_id = v.id
  ) attrs on true
  left join public.inventory_by_location i on i.variant_id = v.id and i.location_id = v_session.location_id
  where v.id = any(p_variant_ids)), '[]'::jsonb);
end;
$$;

create function public.resolve_pos_scan(p_cash_session_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_ids uuid[];
  v_variants jsonb;
  v_variant jsonb;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform app.assert_owned_open_cash_session(p_cash_session_id, v_actor);
  if p_code is null or char_length(btrim(p_code)) not between 1 and 100 then
    raise exception 'INVALID_SCAN_CODE' using errcode = '22023';
  end if;
  select array_agg(id) into v_ids from (
    select variant_id as id from public.barcodes where lower(code) = lower(btrim(p_code))
    union select id from public.variants where lower(sku) = lower(btrim(p_code))
  ) matches;
  if cardinality(v_ids) is null then raise exception 'SCAN_NOT_FOUND' using errcode = 'P0002'; end if;
  if cardinality(v_ids) <> 1 then raise exception 'SCAN_AMBIGUOUS' using errcode = '22023'; end if;
  v_variants := public.get_pos_variants(p_cash_session_id, v_ids);
  v_variant := v_variants->0;
  if v_variant is null or not (v_variant->>'isActive')::boolean
    or (v_variant->>'stock')::numeric < 1 then
    raise exception 'SCAN_NOT_AVAILABLE' using errcode = '22023';
  end if;
  return v_variant;
end;
$$;
revoke execute on function public.get_pos_variants(uuid, uuid[]) from public, anon;
revoke execute on function public.resolve_pos_scan(uuid, text) from public, anon;
grant execute on function public.get_pos_variants(uuid, uuid[]) to authenticated;
grant execute on function public.resolve_pos_scan(uuid, text) to authenticated;

commit;
