begin;
-- Enrich only the already-authorized document payload. Do not change scope,
-- cashier/customer filtering, exact folio lookup, or expose commercial costs.
do $$declare f regprocedure; s text; old text := $s$'quantity', i.quantity$s$; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('list_sale_tickets','get_sale_ticket_by_folio','get_my_customer_tickets') loop
  s:=pg_get_functiondef(f);
  if position(old in s)=0 then raise exception 'MEASURE_TICKET_HISTORY_SOURCE_CHANGED: %',f; end if;
  execute replace(s,old,old||$s$, 'measureUnit', app.measure_unit_metadata(i.variant_id)$s$);
 end loop;
end;$$;
commit;
