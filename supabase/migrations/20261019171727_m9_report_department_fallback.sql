begin;
-- Read the already reconciled literal per-variant department when its parent
-- has none. A manually assigned parent department keeps priority. No catalog,
-- inventory, source evidence, historical sale or permission is rewritten.
do $patch$
declare f regprocedure;s text;anchor text;replacement text;name text;
begin
 for f,name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('get_inventory_report_v2','get_sales_report_v2') loop
  s:=pg_get_functiondef(f);
  if name='get_inventory_report_v2' then
   anchor:='select l.*,p.department_name,p.measure_unit_code as unit_code';
   replacement:='select l.*,coalesce(p.department_name,d.department) as department_name,p.measure_unit_code as unit_code';
  else
   anchor:='select l.*,c.name as category_name,p.department_name,';
   replacement:='select l.*,c.name as category_name,coalesce(p.department_name,d.department) as department_name,';
  end if;
  if strpos(s,anchor)=0 then raise exception 'M9_REPORT_DEPARTMENT_SELECT_CHANGED: %',f;end if;
  s:=replace(s,anchor,replacement);
  anchor:=case when name='get_inventory_report_v2' then 'join public.products p on p.id=l.product_id' else 'left join public.categories c on c.id=p.category_id' end;
  if strpos(s,anchor)=0 then raise exception 'M9_REPORT_DEPARTMENT_JOIN_CHANGED: %',f;end if;
  s:=replace(s,anchor,anchor||E'\n    left join public.m9_variant_details d on d.variant_id=l.variant_id');
  anchor:='or p.department_name=btrim(p_department)';
  if strpos(s,anchor)=0 then raise exception 'M9_REPORT_DEPARTMENT_FILTER_CHANGED: %',f;end if;
  execute replace(s,anchor,'or coalesce(p.department_name,d.department)=btrim(p_department)');
 end loop;
 s:=pg_get_functiondef('public.get_report_classifications()'::regprocedure);
 anchor:='(select distinct department_name from public.products where department_name is not null) d';
 if strpos(s,anchor)=0 then raise exception 'M9_REPORT_CLASSIFICATION_SOURCE_CHANGED';end if;
 execute replace(s,anchor,$s$(select distinct coalesce(p.department_name,md.department) as department_name
 from public.products p left join public.variants v on v.product_id=p.id
 left join public.m9_variant_details md on md.variant_id=v.id
 where coalesce(p.department_name,md.department) is not null) d$s$);
end $patch$;
commit;
