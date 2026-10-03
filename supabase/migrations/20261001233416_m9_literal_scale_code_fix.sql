begin;
do $$
declare d text;
begin
 select pg_get_functiondef('app.m9_catalog_apply(jsonb,text,text)'::regprocedure) into d;
 if position('md5(r->>''section'')' in d)=0 then raise exception 'M9_EXPECTED_SCALE_DEFINITION'; end if;
 execute replace(d,'md5(r->>''section'')','upper(md5(r->>''section''))');
end;
$$;
commit;
