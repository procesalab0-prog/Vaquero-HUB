-- Execute after the proposed function inside BEGIN/ROLLBACK in staging.
create temp table pending_gallery_test_result(checks_passed integer);
do $test$
declare pid uuid; actor uuid; original jsonb; before_source jsonb; rows jsonb; n integer:=0;
begin
 select d.product_id,d.updated_by,d.content into strict pid,actor,original
 from app.web_product_drafts d join app.web_content_sources s using(product_id)
 join app.m9_products m using(product_id) limit 1;
 select to_jsonb(s) into before_source from app.web_content_sources s where product_id=pid;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform app.read_migration_galleries(); raise exception 'ANON_ACCEPTED'; exception when insufficient_privilege then null; end; n:=n+1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if not app.has_perm('products.read') or not app.has_perm('products.update') then raise exception 'TEST_ACTOR_PERMISSIONS'; end if;
 rows:=app.read_migration_galleries(pid);
 if jsonb_array_length(rows)<>1 then raise exception 'EXPLICIT_READ_CHANGED'; end if; n:=n+1;
 update app.web_product_drafts set content=jsonb_set(content,'{images}',jsonb_build_array(jsonb_build_object('url',before_source#>>'{suggested_content,images,0,url}','alt',''))) where product_id=pid;
 if not exists(select 1 from jsonb_array_elements(app.read_migration_galleries()) i where i->>'product_id'=pid::text) then raise exception 'PENDING_HIDDEN'; end if; n:=n+1;
 update app.web_product_drafts set content=jsonb_set(content,'{images}',jsonb_build_array(jsonb_build_object('url','https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/'||pid||'/test.jpg','alt',''))) where product_id=pid;
 if exists(select 1 from jsonb_array_elements(app.read_migration_galleries()) i where i->>'product_id'=pid::text) then raise exception 'COMPLETED_REPEATED'; end if; n:=n+1;
 if app.read_migration_galleries(pid)<>rows then raise exception 'EXPLICIT_SOURCE_CHANGED'; end if; n:=n+1;
 update app.web_product_drafts set content=jsonb_set(content,'{images}','[{"url":"https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/other/test.jpg","alt":""}]') where product_id=pid;
 if not exists(select 1 from jsonb_array_elements(app.read_migration_galleries()) i where i->>'product_id'=pid::text) then raise exception 'WRONG_PRODUCT_HIDDEN'; end if; n:=n+1;
 update app.web_product_drafts set content=jsonb_set(content,'{images}','null') where product_id=pid;
 if not exists(select 1 from jsonb_array_elements(app.read_migration_galleries()) i where i->>'product_id'=pid::text) then raise exception 'MALFORMED_HIDDEN'; end if; n:=n+1;
 delete from app.web_product_drafts where product_id=pid;
 if not exists(select 1 from jsonb_array_elements(app.read_migration_galleries()) i where i->>'product_id'=pid::text) then raise exception 'UNSAVED_HIDDEN'; end if; n:=n+1;
 if before_source<>(select to_jsonb(s) from app.web_content_sources s where product_id=pid) then raise exception 'SOURCE_MUTATED'; end if; n:=n+1;
 if has_function_privilege('anon','app.read_migration_galleries(uuid)','EXECUTE') or has_function_privilege('service_role','app.read_migration_galleries(uuid)','EXECUTE') then raise exception 'PRIVATE_GRANTS_CHANGED'; end if; n:=n+1;
 begin
  update app.sicar_sync_control set catalog_writes_enabled=false;
  begin perform app.read_migration_galleries(); raise exception 'DISABLED_STAGING_ACCEPTED'; exception when insufficient_privilege then null; end;
  raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end; n:=n+1;
 insert into pending_gallery_test_result values(n);
end $test$;
select * from pending_gallery_test_result;
