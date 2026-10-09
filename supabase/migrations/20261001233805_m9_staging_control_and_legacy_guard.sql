begin;
-- Hosted staging has an earlier flat SICAR importer, absent from this worktree.
-- Reuse its staging gate/lock and prevent it from overwriting grouped M9 rows.
do $$
declare d text; marker text;
begin
 select pg_get_functiondef('app.m9_catalog_apply(jsonb,text,text)'::regprocedure) into d;
 marker := 'if current_user <> ''postgres'' then raise exception ''M9_OPERATOR_ONLY''; end if;';
 if position(marker in d)=0 then raise exception 'M9_EXPECTED_OPERATOR_GUARD'; end if;
 d:=replace(d,marker,marker||E'\n if to_regprocedure(''app.assert_sicar_staging_enabled()'') is null then raise exception ''M9_STAGING_CONTROL_REQUIRED''; end if;\n perform app.assert_sicar_staging_enabled();\n perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''sicar-catalog-sync'',0));');
 execute d;
 if to_regprocedure('public.apply_sicar_catalog_run(uuid)') is not null then
   select pg_get_functiondef('public.apply_sicar_catalog_run(uuid)'::regprocedure) into d;
   marker := 'select * into v_run from app.sicar_import_runs where id = p_run_id for update;';
   if position(marker in d)=0 then raise exception 'M9_EXPECTED_LEGACY_IMPORTER'; end if;
   d:=replace(d,marker,E'if exists(select 1 from app.sicar_import_rows r join app.m9_rows m on m.barcode=r.legacy_key where r.run_id=p_run_id) then raise exception ''M9_GROUPED_CATALOG_REQUIRES_M9_IMPORTER''; end if;\n  '||marker);
   execute d;
 end if;
end;
$$;
commit;
