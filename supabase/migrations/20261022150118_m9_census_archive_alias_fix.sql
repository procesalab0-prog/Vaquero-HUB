begin;
select app.assert_sicar_staging_enabled();
do $patch$
declare s text;old text:='jsonb_array_elements(p->''accounts'') a where a->>''key''=r.customer_key';replacement text:='jsonb_array_elements(p->''accounts'') as source_row(value) where source_row.value->>''key''=r.customer_key';
begin
 s:=pg_get_functiondef('app.m9_archive_general_census(jsonb)'::regprocedure);
 if position(old in s)=0 then raise exception 'CENSUS_ALIAS_PATCH_NOT_FOUND';end if;
 execute replace(s,old,replacement);
end $patch$;
commit;
