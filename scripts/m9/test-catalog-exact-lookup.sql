-- Synthetic fixtures in an isolated local QA database only; never run on hosted data.
begin;
do $test$
declare
  actor uuid; category uuid; pid uuid; vid uuid; target uuid;
  reader uuid := gen_random_uuid(); v_role_id uuid; result jsonb; i integer;
begin
  select u.id into actor from public.app_users u join public.roles r on r.id=u.role_id
    where r.code='ADMIN' and u.is_active limit 1;
  if actor is null then raise exception 'LOCAL_QA_ADMIN_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  select id into category from public.categories where is_active limit 1;
  for i in 1..202 loop
    pid := (public.create_catalog_product(
      case when i=202 then 'Z exact lookup target' else 'A fuzzy distraction' end,
      category, '[{"price_cents":74000,"cost_cents":32000}]'
    )->>'product_id')::uuid;
    select id into vid from public.variants where product_id=pid;
    insert into public.barcodes(variant_id,code,symbology,source)
      values(vid,case when i=202 then 'QAEXACT' else 'QAEXACT'||i::text end,'CODE128','SUPPLIER');
    if i=202 then target:=vid; end if;
  end loop;
  if exists(select 1 from public.search_catalog('QAEXACT',200) where variant_id=target) then
    raise exception 'FIXTURE_MUST_EXCEED_FUZZY_LIMIT'; end if;
  result:=public.lookup_catalog_barcode('QAEXACT');
  if result->>'variant_id'<>target::text or result->>'matched_barcode'<>'QAEXACT'
    or (result->>'price_cents')::bigint<>74000 or (result->>'cost_cents')::bigint<>32000 then
    raise exception 'EXACT_LOOKUP_FAILED'; end if;
  insert into public.barcodes(variant_id,code,symbology,source) values(target,'0000007','CODE128','SUPPLIER');
  if public.lookup_catalog_barcode('0000007')->>'variant_id'<>target::text
    or public.lookup_catalog_barcode('000007') is not null
    or public.lookup_catalog_barcode('QAEXAC') is not null
    or public.lookup_catalog_barcode('qaexact') is not null then
    raise exception 'LITERAL_CODE_CHANGED'; end if;
  update public.variants set is_active=false where id=target;
  if (public.lookup_catalog_barcode('QAEXACT')->>'is_active')::boolean then
    raise exception 'INACTIVE_VARIANT_LOST'; end if;
  update public.products set is_active=false,department_name='QA CABALLERO',description='QA description'
    where id=pid;
  result:=public.lookup_catalog_barcode('QAEXACT');
  if (result->>'product_active')::boolean or result->>'department_name'<>'QA CABALLERO'
    or result->>'description'<>'QA description' or result->>'measure_unit_code'<>'PIECE'
    or result->>'category_id'<>category::text then raise exception 'METADATA_LOST'; end if;
  insert into public.roles(code,name) values('QA_LOOKUP_READ_ONLY','QA lookup') returning id into v_role_id;
  insert into public.role_permissions values(v_role_id,'products.read');
  insert into auth.users(id,email,email_confirmed_at) values(reader,reader::text||'@qa.test',now());
  insert into public.app_users(id,employee_code,full_name,role_id)
    values(reader,'QA'||upper(replace(reader::text,'-','')),'QA reader',v_role_id);
  perform set_config('request.jwt.claim.sub',reader::text,true);
  if public.lookup_catalog_barcode('QAEXACT')->'cost_cents'<>'null'::jsonb then
    raise exception 'COST_LEAKED'; end if;
  delete from public.role_permissions where role_permissions.role_id=v_role_id;
  begin perform public.lookup_catalog_barcode('QAEXACT'); raise exception 'EXPECTED_DENIED';
    exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  begin perform public.lookup_catalog_barcode(' QAEXACT'); raise exception 'EXPECTED_INVALID';
    exception when invalid_parameter_value then null; end;
  begin perform public.lookup_catalog_barcode(repeat('a',101)); raise exception 'EXPECTED_INVALID';
    exception when invalid_parameter_value then null; end;
  begin perform public.lookup_catalog_barcode(null); raise exception 'EXPECTED_INVALID';
    exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.lookup_catalog_barcode('QAEXACT'); raise exception 'EXPECTED_NO_AUTH';
    exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.lookup_catalog_barcode(text)','EXECUTE')
    or has_function_privilege('service_role','app.lookup_catalog_barcode(text)','EXECUTE')
    or has_table_privilege('authenticated','public.barcodes','SELECT') then
    raise exception 'PRIVILEGES_EXPANDED'; end if;
end $test$;
select jsonb_build_object('synthetic_variants',202,'rollback',true,'checks',15) as data;
rollback;
