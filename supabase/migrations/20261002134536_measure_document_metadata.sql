begin;
create function app.measure_unit_metadata(p_variant_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('code',u.code,'name',u.name,'decimal_places',u.decimal_places)
 from public.variants v join public.products p on p.id=v.product_id join public.measure_units u on u.code=p.measure_unit_code where v.id=p_variant_id),
 jsonb_build_object('code','PIECE','name','Pieza','decimal_places',0));
$$;
revoke all on function app.measure_unit_metadata(uuid) from public,anon,authenticated,service_role;
do $$declare f regprocedure; name text; alias text; s text; old text; begin
 for f,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('get_returnable_sale','get_sale_receipt','list_quotes','get_layaway_item') loop
  alias:=case name when 'get_returnable_sale' then 'si' when 'get_layaway_item' then 'li' else 'i' end;
  s:=pg_get_functiondef(f);
  old:=case when name='get_sale_receipt' then $s$'quantity',i.quantity$s$ else format($s$'quantity', %s.quantity$s$,alias) end;
  if position(old in s)=0 then raise exception 'MEASURE_DOCUMENT_SOURCE_CHANGED: %',f; end if;
  execute replace(s,old,old||format($s$, 'measureUnit', app.measure_unit_metadata(%s.variant_id)$s$,alias));
 end loop;
end;$$;
create function public.search_exchange_variants_v2(p_query text default '',p_exclude_variant_id uuid default null,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('measureUnit',app.measure_unit_metadata(r.variant_id))),'[]'::jsonb)
 from public.search_exchange_variants(p_query,p_exclude_variant_id,p_limit) r;
$$;
-- The wrapped RPC retains the mandatory permission/owned-session checks.
revoke all on function public.search_exchange_variants_v2(text,uuid,integer) from public,anon,service_role;
grant execute on function public.search_exchange_variants_v2(text,uuid,integer) to authenticated;
commit;
