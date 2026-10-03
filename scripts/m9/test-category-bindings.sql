-- Execute after the seven-family seed within the same transaction, then ROLLBACK.
do $test$
declare pid uuid; b app.web_category_bindings; content jsonb; actor uuid; result jsonb; audit_count bigint; other app.web_content_sources; tests integer:=0;
begin
 select * into strict b from app.web_category_bindings where woo_product_id=5630;
 pid:=b.product_id;
 select suggested_content into content from app.web_content_sources where product_id=pid;
 select updated_by into strict actor from app.web_product_drafts limit 1;
 if (select count(*) from app.web_category_bindings)<>7 then raise exception 'TEST_SEED_COUNT'; end if;
 if exists(select 1 from app.web_category_bindings x where not (app.web_category_binding_state(x.product_id)->>'valid')::boolean) then raise exception 'TEST_VALID_SEED'; end if;
 tests:=tests+1;
 if exists(select 1 from (values('anon'),('authenticated'),('service_role')) roles(r) where
   has_table_privilege(r,'app.web_category_bindings','SELECT') or has_table_privilege(r,'app.web_category_bindings','INSERT') or
   has_function_privilege(r,'app.prepare_web_category_binding(uuid,text,text,jsonb,jsonb)','EXECUTE') or
   has_function_privilege(r,'app.web_category_binding_state(uuid)','EXECUTE')) then raise exception 'TEST_PERMISSIONS'; end if;
 tests:=tests+1;
 select count(*) into audit_count from public.audit_log;
 result:=app.prepare_web_category_binding(pid,b.source_sha256,b.evidence_sha256,b.mappings,content);
 if result->>'result'<>'UNCHANGED' or (select count(*) from public.audit_log)<>audit_count then raise exception 'TEST_IDEMPOTENCE'; end if;
 tests:=tests+1;
 begin
  perform app.prepare_web_category_binding(pid,b.source_sha256,b.evidence_sha256,'[{"id":1,"path":"A"},{"id":1,"path":"B"}]',content);
  raise exception 'TEST_DUPLICATE_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'DUPLICATE_CATEGORY_MAPPING' then raise; end if; end;
 tests:=tests+1;
 begin
  perform app.prepare_web_category_binding(pid,repeat('0',64),b.evidence_sha256,b.mappings,content);
  raise exception 'TEST_CHANGED_HASH_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'WEB_SOURCE_CHANGED' then raise; end if; end;
 tests:=tests+1;
 begin
  insert into app.web_product_drafts(product_id,content,revision,updated_by) values(pid,content,1,actor);
  if not (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_IDENTICAL_FIRST_SAVE'; end if;
  update app.web_product_drafts d set content=jsonb_set(d.content,'{name}','"Edited title"'),revision=2 where product_id=pid;
  if not (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_TITLE_INVALIDATES_CATEGORY'; end if;
  update app.web_product_drafts d set content=jsonb_set(d.content,'{categories}','["Changed"]'),revision=3 where product_id=pid;
  if (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_CHANGED_CATEGORIES_STILL_VALID'; end if;
  update app.web_product_drafts d set content=jsonb_set(d.content,'{categories}',b.category_paths),revision=4 where product_id=pid;
  if (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_RESTORE_REACTIVATED'; end if;
  begin
   perform app.prepare_web_category_binding(pid,b.source_sha256,b.evidence_sha256,b.mappings,content);
   raise exception 'TEST_INVALIDATED_REUSED';
  exception when raise_exception then if sqlerrm<>'CATEGORY_BINDING_REVIEW_REQUIRED' then raise; end if; end;
  tests:=tests+5;
  raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  insert into app.web_product_drafts(product_id,content,revision,updated_by) values(pid,jsonb_set(content,'{categories}','["Different first save"]'),1,actor);
  if (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_FIRST_SAVE_NOT_INVALIDATED'; end if;
  tests:=tests+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  insert into app.web_product_drafts(product_id,content,revision,updated_by) values(pid,content,1,actor);
  delete from app.web_product_drafts where product_id=pid;
  if (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_DELETE_NOT_INVALIDATED'; end if;
  tests:=tests+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update app.web_content_sources set source_sha256=repeat('0',64) where product_id=pid;
  if (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_SOURCE_HASH_NOT_INVALIDATED'; end if;
  tests:=tests+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update app.web_content_sources set snapshot=snapshot||'{"test":true}' where product_id=pid;
  if (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_SNAPSHOT_NOT_INVALIDATED'; end if;
  tests:=tests+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update app.web_content_sources set suggested_content=jsonb_set(suggested_content,'{categories}','["Different"]') where product_id=pid;
  if (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_SUGGESTION_NOT_INVALIDATED'; end if;
  tests:=tests+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update app.m9_products set woo_id=999999999 where product_id=pid;
  if (app.web_category_binding_state(pid)->>'valid')::boolean then raise exception 'TEST_WOO_LINK_NOT_INVALIDATED'; end if;
  tests:=tests+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update app.sicar_sync_control set catalog_writes_enabled=false;
  begin
   perform app.prepare_web_category_binding(pid,b.source_sha256,b.evidence_sha256,b.mappings,content);
   raise exception 'TEST_DISABLED_STAGE_ACCEPTED';
  exception when insufficient_privilege then null; end;
  tests:=tests+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 select * into strict other from app.web_content_sources where (snapshot->>'woo_product_id')::bigint=13560;
 begin
  insert into app.web_product_drafts(product_id,content,revision,updated_by) values(other.product_id,other.suggested_content,1,actor);
  begin
   perform app.prepare_web_category_binding(other.product_id,other.source_sha256,b.evidence_sha256,b.mappings,other.suggested_content);
   raise exception 'TEST_HUMAN_DRAFT_OVERWRITTEN';
  exception when raise_exception then if sqlerrm<>'HUMAN_DRAFT_REVIEW_REQUIRED' then raise; end if; end;
  tests:=tests+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  perform app.prepare_web_category_binding(other.product_id,other.source_sha256,b.evidence_sha256,b.mappings,'{}');
  raise exception 'TEST_STALE_CONTENT_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'WEB_SUGGESTION_CHANGED' then raise; end if; end;
 tests:=tests+1;
 if tests<>19 then raise exception 'TEST_COUNT_%',tests; end if;
end $test$;
select 19 as checks_passed, 'ROLLBACK_REQUIRED' as mode;
