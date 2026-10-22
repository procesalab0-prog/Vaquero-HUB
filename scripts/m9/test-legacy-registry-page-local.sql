-- SYNTHETIC LOCAL QA ONLY. No remote customer records or financial posting.
begin;
set local statement_timeout='30s';
do $$declare actor uuid; batch text; ck text; payload jsonb; p jsonb; p2 jsonb; p3 jsonb; seen integer; i integer; rejected integer:=0;
begin
 if current_database()<>'qa_m9_woo_race_20261022' or not exists(select 1 from app.sicar_sync_control where configured_by='SYNTHETIC LOCAL QA ONLY')then raise exception 'OWN_LOCAL_QA_REQUIRED';end if;
 select u.id into strict actor from public.app_users u join public.roles r on r.id=u.role_id where u.is_active and r.code='ADMIN' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 batch:=encode(extensions.digest('SYNTHETIC LOCAL QA REGISTRY PAGE','sha256'),'hex');
 insert into app.m9_customer_batches values(batch,repeat('a',64),'APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS',now(),actor,'{}',now());
 for i in 1..45 loop
  ck:=encode(extensions.digest('SYNTHETIC LOCAL QA PAGE '||i,'sha256'),'hex');
  payload:=jsonb_build_object('source_display_name','QA_REGISTRY_PAGE_'||lpad(i::text,2,'0'),'phone_candidate',null,'synthetic_local_only',true);
  insert into app.m9_customer_sources(customer_key,source_ref,batch_sha256,payload,used_cents)values(ck,'QA_PAGE_REF_'||i,batch,payload,100);
  insert into app.m9_legacy_registry(customer_key,batch_sha256,source_hash,created_by)values(ck,batch,encode(extensions.digest(payload::text,'sha256'),'hex'),actor);
 end loop;
 execute 'set local role authenticated';
 p:=public.m9_legacy_registry_read('{"q":"QA_REGISTRY_PAGE_","page":1}');
 p2:=public.m9_legacy_registry_read('{"q":"QA_REGISTRY_PAGE_","page":2}');
 p3:=public.m9_legacy_registry_read('{"q":"QA_REGISTRY_PAGE_","page":99}');
 if p->>'protocol'<>'m9-legacy-registry-page-1' or p->'read_only'<>'true'::jsonb or p->'operational_import_allowed'<>'false'::jsonb
  or (p->>'total')::integer<>45 or jsonb_array_length(p->'customers')<>20
  or jsonb_array_length(p2->'customers')<>20 or jsonb_array_length(p3->'customers')<>5
  or (p3->>'page')::integer<>3 then raise exception 'PAGING_INCOMPLETE';end if;
 select count(distinct x->>'id')into seen from jsonb_array_elements((p->'customers')||(p2->'customers')||(p3->'customers'))x;
 if seen<>45 then raise exception 'PAGES_OVERLAP';end if;
 p:=public.m9_legacy_registry_read('{"q":"QA_PAGE_REF_17"}');
 if p->>'total'<>'1' or p#>>'{customers,0,source_ref}'<>'QA_PAGE_REF_17'then raise exception 'SOURCE_REFERENCE_SEARCH_FAILED';end if;
 for i in 1..5 loop
  begin
   perform public.m9_legacy_registry_read(case i when 1 then '[]' when 2 then '{"q":null}' when 3 then '{"page":0}' when 4 then '{"page":"9999999"}' when 5 then '{"action":"SAVE_STOCK_DRAFT"}'end::jsonb);
   raise exception 'INVALID_INPUT_ACCEPTED';
  exception when others then if sqlerrm<>'M9_REGISTRY_READ_INPUT_INVALID'then raise;end if;rejected:=rejected+1;end;
 end loop;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
 begin perform public.m9_legacy_registry_read('{}');raise exception 'UNKNOWN_ACTOR_ACCEPTED';exception when insufficient_privilege then rejected:=rejected+1;end;
 execute 'reset role';
 if has_function_privilege('anon','public.m9_legacy_registry_read(jsonb)','execute') or has_function_privilege('service_role','public.m9_legacy_registry_read(jsonb)','execute') or has_function_privilege('anon','app.m9_legacy_registry_read(jsonb)','execute') or has_function_privilege('service_role','app.m9_legacy_registry_read(jsonb)','execute')then raise exception 'UNSAFE_RPC_ACL';end if;
 if rejected<>6 then raise exception 'REJECTIONS_INCOMPLETE';end if;
 raise notice 'PASS: 45synthetic records/3pages/exactref,5invalid inputs,unknown actor,4ACL;all ROLLBACK';
end $$;
rollback;
