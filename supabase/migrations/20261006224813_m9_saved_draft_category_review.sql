begin;
-- Technical evidence only: preserve the entire saved draft and suggestion.
-- Does not approve publication, reactivate invalidated bindings, or enqueue jobs.
create function app.verify_saved_draft_categories(
 pid uuid, expected_woo bigint, expected jsonb, evidence_hash text,
 captured_at timestamptz, mapping jsonb
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s app.web_content_sources; d app.web_product_drafts;
 b app.web_category_bindings; item jsonb; linked_woo bigint; k text;
begin
 perform app.assert_sicar_staging_enabled();
 if expected_woo is null or expected_woo<=0 or evidence_hash is null
  or evidence_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_CATEGORY_EVIDENCE'; end if;
 if captured_at is null or captured_at>clock_timestamp()+interval '5 minutes'
  or captured_at<clock_timestamp()-interval '24 hours' then raise exception 'STALE_CATEGORY_CAPTURE'; end if;
 if expected is null or jsonb_typeof(expected)<>'object' then raise exception 'INVALID_CATEGORY_EXPECTATION'; end if;
 if (select count(*) from jsonb_object_keys(expected))<>6
  or not(expected ?& array['source_sha256','source_fingerprint','catalog_fingerprint','draft_revision','draft_fingerprint','draft_categories'])
  or jsonb_typeof(expected->'source_sha256')<>'string'
  or expected->>'source_sha256' !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(expected->'draft_revision')<>'number'
  or expected->>'draft_revision' !~ '^[1-9][0-9]{0,8}$'
  or jsonb_typeof(expected->'draft_categories')<>'array'
 then raise exception 'INVALID_CATEGORY_EXPECTATION'; end if;
 foreach k in array array['source_fingerprint','catalog_fingerprint','draft_fingerprint'] loop
  item:=expected->k;
  if jsonb_typeof(item) is distinct from 'string' or (item#>>'{}') !~ '^[0-9a-f]{32}$'
   then raise exception 'INVALID_CATEGORY_EXPECTATION'; end if;
 end loop;
 if mapping is null or jsonb_typeof(mapping)<>'array' then raise exception 'INVALID_CATEGORY_MAPPING'; end if;
 if jsonb_array_length(mapping) not between 1 and 20 then raise exception 'INVALID_CATEGORY_MAPPING'; end if;
 for item in select value from jsonb_array_elements(mapping) loop
  if jsonb_typeof(item)<>'object' then raise exception 'INVALID_CATEGORY_MAPPING'; end if;
  if (select count(*) from jsonb_object_keys(item))<>2 or not(item ?& array['id','path'])
   or jsonb_typeof(item->'id') is distinct from 'number' or (item->>'id') !~ '^[1-9][0-9]{0,14}$'
   or jsonb_typeof(item->'path') is distinct from 'string'
   or length(btrim(item->>'path')) not between 1 and 240 then raise exception 'INVALID_CATEGORY_MAPPING'; end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(mapping))<>jsonb_array_length(mapping)
  or (select count(distinct value->>'path') from jsonb_array_elements(mapping))<>jsonb_array_length(mapping)
  then raise exception 'DUPLICATE_CATEGORY_MAPPING'; end if;
 perform 1 from public.products where id=pid for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 select * into strict s from app.web_content_sources where product_id=pid for update;
 select * into d from app.web_product_drafts where product_id=pid for update;
 if not found then raise exception 'SAVED_DRAFT_REQUIRED'; end if;
 select woo_id into linked_woo from app.m9_products where product_id=pid for update;
 if linked_woo is distinct from expected_woo or s.snapshot->>'woo_product_id' is distinct from expected_woo::text
  then raise exception 'WOO_LINK_CHANGED'; end if;
 if s.source_sha256 is distinct from expected->>'source_sha256'
  or md5(s.snapshot::text) is distinct from expected->>'source_fingerprint' then raise exception 'WEB_SOURCE_CHANGED'; end if;
 if d.revision is distinct from (expected->>'draft_revision')::integer
  or md5(d.content::text) is distinct from expected->>'draft_fingerprint'
  or d.content->'categories' is distinct from expected->'draft_categories' then raise exception 'WEB_DRAFT_CHANGED'; end if;
 if d.content->'categories' is distinct from s.suggested_content->'categories'
  then raise exception 'HUMAN_CATEGORIES_REVIEW_REQUIRED'; end if;
 if md5(app.web_catalog_snapshot(pid)::text) is distinct from expected->>'catalog_fingerprint'
  then raise exception 'WEB_CATALOG_CHANGED'; end if;
 perform app.validate_web_content(d.content);
 select * into b from app.web_category_bindings where product_id=pid for update;
 if found then
  if b.evidence_sha256=evidence_hash and b.mappings=mapping
   and coalesce((app.web_category_binding_state(pid)->>'valid')::boolean,false)
   then return jsonb_build_object('product_id',pid,'result','UNCHANGED','send_allowed',false); end if;
  raise exception 'CATEGORY_BINDING_REVIEW_REQUIRED';
 end if;
 -- category_paths is the literal editor representation. Mappings retain the
 -- separate full paths/IDs; CSV text in a saved draft is never rewritten.
 insert into app.web_category_bindings(product_id,woo_product_id,source_sha256,source_fingerprint,evidence_sha256,mappings,category_paths,verified_at)
 values(pid,expected_woo,s.source_sha256,md5(s.snapshot::text),evidence_hash,mapping,d.content->'categories',captured_at);
 insert into public.audit_log(action,entity_type,entity_id,metadata)
 values('m9.web_categories.verify_saved_draft','product',pid,jsonb_build_object(
  'evidence_sha256',evidence_hash,'capture_at',captured_at,'expected',expected,'mappings',mapping,
  'review_kind','TECHNICAL_CAPTURE_COMPARISON','draft_modified',false,'commercial_approval',false,'woo_written',false));
 return jsonb_build_object('product_id',pid,'result','VERIFIED','send_allowed',false);
end $$;
revoke all on function app.verify_saved_draft_categories(uuid,bigint,jsonb,text,timestamptz,jsonb) from public,anon,authenticated,service_role;
commit;
