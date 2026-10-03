begin;
do $$
declare d text;
begin
 select pg_get_functiondef('app.m9_catalog_plan(jsonb,text)'::regprocedure) into d;
 d:=replace(d,'jsonb_agg(to_jsonb(a) order by a.id) from public.attribute_values a','jsonb_agg(to_jsonb(av_row) order by av_row.id) from public.attribute_values av_row');
 d:=replace(d,'jsonb_agg(to_jsonb(a) order by a.variant_id,a.type_code) from public.variant_attributes a','jsonb_agg(to_jsonb(va_row) order by va_row.variant_id,va_row.type_code) from public.variant_attributes va_row');
 execute d;
end;
$$;
-- An inherited barcode cannot shed its protection by changing source first.
create function app.m9_protect_source() returns trigger language plpgsql set search_path='' as $$
begin
 if old.source='SICAR' and new.source is distinct from old.source then raise exception 'SICAR_BARCODE_IMMUTABLE'; end if;
 return new;
end;
$$;
create trigger m9_barcode_protect_source before update of source on public.barcodes
for each row execute function app.m9_protect_source();
revoke all on function app.m9_protect_source() from public,anon,authenticated,service_role;
commit;
