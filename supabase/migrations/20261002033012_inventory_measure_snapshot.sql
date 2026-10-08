begin;
-- Reuse the existing authorized/scope-limited read functions. Only unit
-- metadata is added, never costs or access to another location's balances.
create function public.get_inventory_snapshot_v2(p_location_id uuid,p_query text default '',p_limit integer default 500)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg((to_jsonb(s)-'ordinality')||jsonb_build_object('measure_unit',jsonb_build_object(
   'code',u.code,'name',u.name,'decimal_places',u.decimal_places)) order by s.ordinality),'[]'::jsonb)
 from public.get_inventory_snapshot(p_location_id,p_query,p_limit) with ordinality s
 join public.products p on p.id=s.product_id join public.measure_units u on u.code=p.measure_unit_code;
$$;
create function public.list_inventory_transfers_v2(p_location_id uuid,p_limit integer default 30)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg((to_jsonb(s)-'ordinality')||jsonb_build_object('measure_unit',jsonb_build_object(
   'code',u.code,'name',u.name,'decimal_places',u.decimal_places)) order by s.ordinality),'[]'::jsonb)
 from public.list_inventory_transfers(p_location_id,p_limit) with ordinality s
 join public.variants v on v.id=s.variant_id join public.products p on p.id=v.product_id
 join public.measure_units u on u.code=p.measure_unit_code;
$$;
revoke all on function public.get_inventory_snapshot_v2(uuid,text,integer),public.list_inventory_transfers_v2(uuid,integer)
 from public,anon,service_role;
grant execute on function public.get_inventory_snapshot_v2(uuid,text,integer),public.list_inventory_transfers_v2(uuid,integer) to authenticated;
commit;
