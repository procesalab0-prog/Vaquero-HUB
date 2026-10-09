-- Prepend BEGIN and pg_temp.category_review_context(data jsonb) with one
-- TECHNICAL_REVIEW_READY case plus evidence_sha256. Always end with ROLLBACK.
create function pg_temp.expect_category_rejection(args jsonb, wanted text) returns void
language plpgsql as $$
begin
 begin
  perform app.verify_saved_draft_categories((args->>'product_id')::uuid,(args->>'woo_product_id')::bigint,
   args->'expected',args->>'evidence_sha256',(args->>'captured_at')::timestamptz,args->'mapping');
 exception when others then
  if sqlerrm=wanted then return; end if;
  raise exception 'EXPECTED_%,_GOT_%',wanted,sqlerrm;
 end;
 raise exception 'REJECTION_NOT_RAISED_%',wanted;
end $$;
do $test$
declare a jsonb; e jsonb; pid uuid; k text; result jsonb; before_source jsonb; before_draft jsonb;
 before_catalog jsonb; audit_count bigint; tests integer:=0;
begin
 select data into strict a from pg_temp.category_review_context;
 e:=a->'expected'; pid:=(a->>'product_id')::uuid;
 select to_jsonb(s) into before_source from app.web_content_sources s where product_id=pid;
 select to_jsonb(d) into before_draft from app.web_product_drafts d where product_id=pid;
 before_catalog:=app.web_catalog_snapshot(pid);
 if exists(select 1 from app.web_category_bindings where product_id=pid) then raise exception 'TEST_REQUIRES_UNBOUND_DRAFT'; end if;
 foreach k in array array['source_sha256','source_fingerprint','catalog_fingerprint','draft_fingerprint'] loop
  perform pg_temp.expect_category_rejection(jsonb_set(a,array['expected',k],to_jsonb(repeat('0',case when k='source_sha256' then 64 else 32 end))),
   case when k='catalog_fingerprint' then 'WEB_CATALOG_CHANGED' when k='draft_fingerprint' then 'WEB_DRAFT_CHANGED' else 'WEB_SOURCE_CHANGED' end);
  tests:=tests+1;
 end loop;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{expected,draft_revision}',to_jsonb((e->>'draft_revision')::integer+1)),'WEB_DRAFT_CHANGED'); tests:=tests+1;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{expected,draft_fingerprint}','null'),'INVALID_CATEGORY_EXPECTATION'); tests:=tests+1;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{expected,draft_categories}','["Edited"]'),'WEB_DRAFT_CHANGED'); tests:=tests+1;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{woo_product_id}',to_jsonb((a->>'woo_product_id')::bigint+100000000)),'WOO_LINK_CHANGED'); tests:=tests+1;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{captured_at}',to_jsonb(clock_timestamp()-interval '25 hours')),'STALE_CATEGORY_CAPTURE'); tests:=tests+1;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{captured_at}',to_jsonb(clock_timestamp()+interval '1 hour')),'STALE_CATEGORY_CAPTURE'); tests:=tests+1;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{mapping}','[{"id":1,"path":"A"},{"id":1,"path":"B"}]'),'DUPLICATE_CATEGORY_MAPPING'); tests:=tests+1;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{mapping}','[{"id":1,"path":null}]'),'INVALID_CATEGORY_MAPPING'); tests:=tests+1;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{mapping}','{}'),'INVALID_CATEGORY_MAPPING'); tests:=tests+1;
 perform pg_temp.expect_category_rejection(jsonb_set(a,'{evidence_sha256}','null'),'INVALID_CATEGORY_EVIDENCE'); tests:=tests+1;
 begin
  update app.web_product_drafts set content=jsonb_set(content,'{categories}','["Human edit"]') where product_id=pid;
  select a||jsonb_build_object('expected',e||jsonb_build_object('draft_fingerprint',md5(content::text),'draft_categories',content->'categories')) into result from app.web_product_drafts where product_id=pid;
  perform pg_temp.expect_category_rejection(result,'HUMAN_CATEGORIES_REVIEW_REQUIRED'); tests:=tests+1;
  raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  delete from app.web_product_drafts where product_id=pid;
  perform pg_temp.expect_category_rejection(a,'SAVED_DRAFT_REQUIRED'); tests:=tests+1;
  raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  perform app.prepare_web_category_binding(pid,e->>'source_sha256',a->>'evidence_sha256',a->'mapping',before_source->'suggested_content');
  raise exception 'ORIGINAL_GUARD_BYPASSED';
 exception when raise_exception then if sqlerrm<>'HUMAN_DRAFT_REVIEW_REQUIRED' then raise; end if; end;
 tests:=tests+1;
 result:=app.verify_saved_draft_categories(pid,(a->>'woo_product_id')::bigint,e,a->>'evidence_sha256',(a->>'captured_at')::timestamptz,a->'mapping');
 if result->>'result'<>'VERIFIED' or result->>'send_allowed'<>'false' or not (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_VERIFY_RESULT'; end if; tests:=tests+1;
 select count(*) into audit_count from public.audit_log;
 result:=app.verify_saved_draft_categories(pid,(a->>'woo_product_id')::bigint,e,a->>'evidence_sha256',(a->>'captured_at')::timestamptz,a->'mapping');
 if result->>'result'<>'UNCHANGED' or (select count(*) from public.audit_log)<>audit_count then raise exception 'TEST_IDEMPOTENCE'; end if; tests:=tests+1;
 if before_source is distinct from (select to_jsonb(s) from app.web_content_sources s where product_id=pid)
  or before_draft is distinct from (select to_jsonb(d) from app.web_product_drafts d where product_id=pid)
  or before_catalog is distinct from app.web_catalog_snapshot(pid) then raise exception 'TEST_DRAFT_OR_SOURCE_MODIFIED'; end if; tests:=tests+1;
 begin
  update app.web_product_drafts set content=jsonb_set(content,'{categories}','["Changed"]') where product_id=pid;
  update app.web_product_drafts set content=before_draft->'content' where product_id=pid;
  perform pg_temp.expect_category_rejection(a,'CATEGORY_BINDING_REVIEW_REQUIRED'); tests:=tests+1;
  raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update app.sicar_sync_control set catalog_writes_enabled=false;
  begin
   perform app.verify_saved_draft_categories(pid,(a->>'woo_product_id')::bigint,e,a->>'evidence_sha256',(a->>'captured_at')::timestamptz,a->'mapping');
   raise exception 'TEST_DISABLED_STAGE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  tests:=tests+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 if exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(role_name)
  where has_function_privilege(role_name,'app.verify_saved_draft_categories(uuid,bigint,jsonb,text,timestamptz,jsonb)','EXECUTE'))
  then raise exception 'TEST_CLIENT_PERMISSIONS'; end if; tests:=tests+1;
 if (select prosecdef from pg_proc where oid='app.verify_saved_draft_categories(uuid,bigint,jsonb,text,timestamptz,jsonb)'::regprocedure)
  then raise exception 'TEST_SECURITY_DEFINER'; end if; tests:=tests+1;
 if (select count(*) from public.inventory_by_location)<>0 or (select count(*) from public.inventory_movements)<>0 then raise exception 'TEST_INVENTORY'; end if; tests:=tests+1;
 insert into pg_temp.category_review_test_result values(tests);
end $test$;
select checks_passed,'ROLLBACK_REQUIRED' as mode from pg_temp.category_review_test_result;
