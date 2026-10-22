begin;
select app.assert_sicar_staging_enabled();
do $patch$
declare s text;old text:='(select count(distinct variant_id) from app.sicar_catalog_links)';replacement text:='(select count(distinct b.code) from public.barcodes b join public.variants v on v.id=b.variant_id where b.source=''SICAR'')';
begin
 s:=pg_get_functiondef('app.m9_general_migration_read(jsonb)'::regprocedure);
 if position(old in s)=0 then raise exception 'CENSUS_CATALOG_PATCH_NOT_FOUND';end if;
 execute replace(s,old,replacement);
end $patch$;
commit;
