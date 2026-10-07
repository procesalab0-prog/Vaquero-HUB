begin;
-- Enrich the already-authorized catalog result, without exposing costs or
-- accepting client unit metadata as authority.
do $$declare s text; old text; begin
 s:=pg_get_functiondef('public.get_pos_variants(uuid,uuid[])'::regprocedure);
 old:=$s$'id', v.id, 'productId', p.id, 'productName', p.name, 'sku', v.sku,$s$;
 if position(old in s)=0 then raise exception 'MEASURE_POS_SOURCE_CHANGED'; end if;
 execute replace(s,old,$s$'id', v.id, 'productId', p.id, 'productName', p.name, 'sku', v.sku,
    'measureUnit', (select jsonb_build_object('code',u.code,'name',u.name,'decimal_places',u.decimal_places) from public.measure_units u where u.code=p.measure_unit_code),$s$);
 s:=pg_get_functiondef('public.resolve_pos_scan(uuid,text)'::regprocedure);
 old:=$s$or (v_variant->>'stock')::numeric < 1$s$;
 if position(old in s)=0 then raise exception 'MEASURE_SCAN_SOURCE_CHANGED'; end if;
 execute replace(s,old,$s$or (v_variant->>'stock')::numeric <= 0$s$);
end;$$;
revoke all on function public.get_pos_variants(uuid,uuid[]),public.resolve_pos_scan(uuid,text) from public,anon,service_role;
grant execute on function public.get_pos_variants(uuid,uuid[]),public.resolve_pos_scan(uuid,text) to authenticated;
commit;
