begin;
-- Forward-only metadata. Existing authorized RPCs remain the source of scope,
-- permissions and financial fields; unit definitions are immutable.
do $$
declare d text; before_text text; after_text text;
begin
 d:=pg_get_functiondef('public.list_purchase_orders_v2(uuid,integer)'::regprocedure);
 before_text:=$s$'measure_unit_code',p.measure_unit_code)$s$;
 after_text:=$s$'measure_unit_code',p.measure_unit_code,'measure_unit',
   (select jsonb_build_object('code',u.code,'name',u.name,'decimal_places',u.decimal_places)
    from public.measure_units u where u.code=p.measure_unit_code))$s$;
 if position(before_text in d)=0 then raise exception 'PURCHASE_METADATA_UPSTREAM_CHANGED'; end if;
 execute replace(d,before_text,after_text);

 d:=pg_get_functiondef('public.list_purchase_receipts(uuid,integer)'::regprocedure);
 d:=replace(d,'public.list_purchase_receipts(','public.list_purchase_receipts_v2(');
 before_text:=$s$'qty',ri.received_qty,'unit_cost_cents',ri.unit_cost_cents)$s$;
 after_text:=$s$'qty',ri.received_qty,'unit_cost_cents',ri.unit_cost_cents,'measure_unit',
   (select jsonb_build_object('code',u.code,'name',u.name,'decimal_places',u.decimal_places)
    from public.measure_units u where u.code=p.measure_unit_code))$s$;
 if position(before_text in d)=0 then raise exception 'RECEIPT_METADATA_UPSTREAM_CHANGED'; end if;
 execute replace(d,before_text,after_text);
end;
$$;
revoke all on function public.list_purchase_orders_v2(uuid,integer),public.list_purchase_receipts_v2(uuid,integer)
 from public,anon,service_role;
grant execute on function public.list_purchase_orders_v2(uuid,integer),public.list_purchase_receipts_v2(uuid,integer)
 to authenticated;
commit;
