begin;
-- A provisional has exactly one variant, so its parent department is known
-- literally. Keep the existing per-variant M9 classification as the evidence.
create function app.m9_provisional_parent_department() returns trigger
language plpgsql security invoker set search_path='' as $$
declare pid uuid;source_department text;parent_department text;
begin
 if current_user<>'postgres' then raise exception 'M9_OPERATOR_ONLY';end if;
 perform app.assert_sicar_staging_enabled();
 select v.product_id,d.department,p.department_name into strict pid,source_department,parent_department
 from public.variants v join public.m9_variant_details d on d.variant_id=v.id join public.products p on p.id=v.product_id where v.id=new.variant_id;
 if pid<>new.original_product_id or (select count(*) from public.variants where product_id=pid)<>1
  or new.source_evidence#>>'{fields,departamento}' is distinct from source_department then raise exception 'M9_PROVISIONAL_PARENT_CHANGED';end if;
 if parent_department is not null and parent_department<>source_department then raise exception 'M9_PROVISIONAL_DEPARTMENT_CONFLICT';end if;
 update public.products set department_name=source_department where id=pid and department_name is null;
 return new;
end $$;
create trigger m9_provisional_parent_department after insert on app.m9_provisional_variants for each row execute function app.m9_provisional_parent_department();
revoke all on function app.m9_provisional_parent_department() from public,anon,authenticated,service_role;

do $patch$
declare s text;needle text:=$needle$insert into public.products(name,category_id,measure_unit_code) values(p_name,(st#>>'{product,category_id}')::uuid,st#>>'{product,measure_unit_code}') returning id into pid;$needle$;
 replacement text:=$replacement$insert into public.products(name,category_id,measure_unit_code,department_name) values(p_name,(st#>>'{product,category_id}')::uuid,st#>>'{product,measure_unit_code}',st#>>'{current,department}') returning id into pid;$replacement$;
begin
 s:=pg_get_functiondef('app.m9_group_provisionals(uuid,text,jsonb,text,text,text,text)'::regprocedure);
 if length(s)-length(replace(s,needle,''))<>length(needle) then raise exception 'M9_GROUP_DEFINITION_CHANGED';end if;
 execute replace(s,needle,replacement);
 if exists(select 1 from app.m9_provisional_variants) then
  perform app.assert_sicar_staging_enabled();
  if exists(select 1 from app.m9_provisional_variants pv join public.variants v on v.id=pv.variant_id
   join public.products p on p.id=v.product_id join public.m9_variant_details d on d.variant_id=v.id
   where pv.grouping_status='PROVISIONAL' and (v.product_id<>pv.original_product_id or p.department_name is not null and p.department_name<>d.department)) then raise exception 'M9_PROVISIONAL_PARENT_REVIEW';end if;
  update public.products p set department_name=d.department
   from app.m9_provisional_variants pv join public.variants v on v.id=pv.variant_id join public.m9_variant_details d on d.variant_id=v.id
   where p.id=v.product_id and p.department_name is null and pv.grouping_status='PROVISIONAL';
 end if;
end $patch$;
commit;
