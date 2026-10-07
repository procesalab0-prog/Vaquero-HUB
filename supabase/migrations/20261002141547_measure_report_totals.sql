begin;
-- Never call a sum of kilos + pieces a quantity. Units come from immutable
-- product definitions, and totals are calculated before result-list limits.
create function app.patch_measure_report(p_function regprocedure,p_old text,p_new text) returns void
language plpgsql set search_path='' as $$declare s text:=pg_get_functiondef(p_function);begin
 if position(p_old in s)=0 then raise exception 'MEASURE_REPORT_SOURCE_CHANGED: %',p_function; end if;
 execute replace(s,p_old,p_new);
end;$$;
revoke all on function app.patch_measure_report(regprocedure,text,text) from public,anon,authenticated,service_role;
do $$declare f regprocedure; name text; q text; begin
 for f,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('get_sales_report_v2','get_inventory_report_v2') loop
  if name='get_sales_report_v2' then
   perform app.patch_measure_report(f,'select l.*,c.name as category_name,p.department_name,',
    $s$select l.*,c.name as category_name,p.department_name,coalesce(p.measure_unit_code,'PIECE') as unit_code,$s$);
   perform app.patch_measure_report(f,'coalesce(sum(quantity), 0) as item_count',
    'case when count(distinct unit_code)>1 then null else coalesce(sum(quantity),0) end as item_count');
   perform app.patch_measure_report(f,'sum(quantity) as item_count',
    'case when count(distinct unit_code)>1 then null else sum(quantity) end as item_count');
   perform app.patch_measure_report(f,'select product_name, sku, variant_description,','select product_name, sku, variant_description, unit_code,');
   perform app.patch_measure_report(f,'group by product_name, sku, variant_description','group by product_name, sku, variant_description, unit_code');
   perform app.patch_measure_report(f,$s$'item_count', summary.item_count,$s$,
    $s$'item_count', summary.item_count,
      'unit_quantities',(select coalesce(jsonb_agg(jsonb_build_object('code',t.unit_code,'name',u.name,'quantity',t.quantity)),'[]'::jsonb) from (select unit_code,sum(quantity) quantity from filtered group by unit_code) t join public.measure_units u on u.code=t.unit_code),$s$);
   perform app.patch_measure_report(f,'sum(net_cents) as net_cents'||E'\n    from filtered\n    group by period_key',
    $s$sum(net_cents) as net_cents,
      (select jsonb_agg(jsonb_build_object('code',t.unit_code,'name',u.name,'quantity',t.quantity)) from (select f.unit_code,sum(f.quantity) quantity from filtered f where f.period_key=filtered.period_key group by f.unit_code) t join public.measure_units u on u.code=t.unit_code) as unit_quantities
    from filtered
    group by period_key$s$);
   perform app.patch_measure_report(f,$s$'quantity', details.quantity,$s$,$s$'quantity', details.quantity, 'measureUnit',app.measure_unit_metadata(details.variant_id),$s$);
  else
   perform app.patch_measure_report(f,'select l.*,p.department_name','select l.*,p.department_name,p.measure_unit_code as unit_code');
   foreach q in array array['qty','reserved_qty','available_qty'] loop
    perform app.patch_measure_report(f,format('coalesce(sum(%s), 0) as %s',q,q),format('case when count(distinct unit_code)>1 then null else coalesce(sum(%s),0) end as %s',q,q));
   end loop;
   perform app.patch_measure_report(f,$s$'summary', to_jsonb(summary),$s$,
    $s$'summary', to_jsonb(summary)||jsonb_build_object('unit_quantities',(select coalesce(jsonb_agg(jsonb_build_object('code',t.unit_code,'name',u.name,'qty',t.qty,'reserved_qty',t.reserved_qty,'available_qty',t.available_qty)),'[]'::jsonb) from (select unit_code,sum(qty) qty,sum(reserved_qty) reserved_qty,sum(available_qty) available_qty from filtered group by unit_code) t join public.measure_units u on u.code=t.unit_code)),$s$);
   perform app.patch_measure_report(f,'sum(qty) as qty, sum(available_qty) as available_qty',
    'case when count(distinct unit_code)>1 then null else sum(qty) end as qty, case when count(distinct unit_code)>1 then null else sum(available_qty) end as available_qty');
   perform app.patch_measure_report(f,'sum(qty * cost_cents)','sum(round(qty * cost_cents)::bigint)');
   perform app.patch_measure_report(f,'sum(qty * price_cents)','sum(round(qty * price_cents)::bigint)');
   perform app.patch_measure_report(f,$s$'qty', listed.qty,$s$,$s$'qty', listed.qty, 'measureUnit',app.measure_unit_metadata(listed.variant_id),$s$);
  end if;
 end loop;
end;$$;
drop function app.patch_measure_report(regprocedure,text,text);
commit;
