begin;
-- Explicit technical re-review after a gallery-only source refresh. Never a
-- general reactivation: all prior evidence, draft and category membership stay fixed.
create function app.review_gallery_category_binding(
 pid uuid, prior_snapshot jsonb, prior_binding jsonb,
 expected_source jsonb, expected_draft jsonb, catalog_hash text,
 evidence_hash text, captured_at timestamptz, mapping jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s app.web_content_sources; d app.web_product_drafts; b app.web_category_bindings;
 linked_woo bigint; before_binding jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 if current_user<>'postgres' then raise insufficient_privilege; end if;
 if evidence_hash is null or evidence_hash !~ '^[0-9a-f]{64}$'
  or catalog_hash is null or catalog_hash !~ '^[0-9a-f]{32}$'
  then raise exception 'INVALID_GALLERY_CATEGORY_EVIDENCE'; end if;
 if captured_at is null or captured_at>clock_timestamp()+interval '5 minutes'
  or captured_at<clock_timestamp()-interval '24 hours' then raise exception 'STALE_CATEGORY_CAPTURE'; end if;
 if jsonb_typeof(prior_snapshot) is distinct from 'object'
  or jsonb_typeof(prior_binding) is distinct from 'object'
  or jsonb_typeof(expected_source) is distinct from 'object'
  or jsonb_typeof(expected_draft) is distinct from 'object'
  then raise exception 'FULL_REVIEW_EXPECTATIONS_REQUIRED'; end if;
 if prior_binding->>'product_id' is distinct from pid::text
  or prior_binding->>'invalidation_reason' is distinct from 'SOURCE_CHANGED'
  or prior_binding->>'invalidated_at' is null
  or prior_binding->>'source_fingerprint' is distinct from md5(prior_snapshot::text)
  then raise exception 'PRIOR_GALLERY_EVIDENCE_MISMATCH'; end if;
 if mapping is null or mapping is distinct from prior_binding->'mappings'
  or jsonb_typeof(mapping) is distinct from 'array'
  or jsonb_array_length(mapping) not between 1 and 20
  then raise exception 'CATEGORY_MEMBERSHIP_CHANGED'; end if;
 perform 1 from public.products where id=pid for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 select * into strict s from app.web_content_sources where product_id=pid for update;
 select * into strict d from app.web_product_drafts where product_id=pid for update;
 select woo_id into strict linked_woo from app.m9_products where product_id=pid for update;
 select * into strict b from app.web_category_bindings where product_id=pid for update;
 if to_jsonb(s) is distinct from expected_source then raise exception 'WEB_SOURCE_CHANGED'; end if;
 if to_jsonb(d) is distinct from expected_draft then raise exception 'WEB_DRAFT_CHANGED'; end if;
 if md5(app.web_catalog_snapshot(pid)::text) is distinct from catalog_hash
  then raise exception 'WEB_CATALOG_CHANGED'; end if;
 if linked_woo::text is distinct from prior_binding->>'woo_product_id'
  or s.snapshot->>'woo_product_id' is distinct from linked_woo::text
  or prior_snapshot->>'woo_product_id' is distinct from linked_woo::text
  then raise exception 'WOO_LINK_CHANGED'; end if;
 if (s.snapshot-'image_urls') is distinct from (prior_snapshot-'image_urls')
  or s.snapshot->'image_urls' is not distinct from prior_snapshot->'image_urls'
  then raise exception 'NOT_A_GALLERY_ONLY_SOURCE_REVIEW'; end if;
 if d.content->'categories' is distinct from s.suggested_content->'categories'
  or d.content->'categories' is distinct from prior_binding->'category_paths'
  or jsonb_typeof(d.content->'categories') is distinct from 'array'
  or jsonb_array_length(d.content->'categories')=0
  then raise exception 'CATEGORY_CONTENT_CHANGED'; end if;
 perform app.validate_web_content(d.content);
 if b.invalidated_at is null then
  if b.evidence_sha256=evidence_hash and b.mappings=mapping
   and coalesce((app.web_category_binding_state(pid)->>'valid')::boolean,false)
   then return jsonb_build_object('product_id',pid,'result','UNCHANGED','send_allowed',false); end if;
  raise exception 'CATEGORY_BINDING_REVIEW_REQUIRED';
 end if;
 if to_jsonb(b) is distinct from prior_binding then raise exception 'CATEGORY_BINDING_CHANGED'; end if;
 before_binding:=to_jsonb(b);
 update app.web_category_bindings set source_sha256=s.source_sha256,
  source_fingerprint=md5(s.snapshot::text),evidence_sha256=evidence_hash,
  verified_at=captured_at,invalidated_at=null,invalidation_reason=null
 where product_id=pid;
 if not coalesce((app.web_category_binding_state(pid)->>'valid')::boolean,false)
  then raise exception 'CATEGORY_REREVIEW_INVALID'; end if;
 insert into public.audit_log(action,entity_type,entity_id,metadata)
 values('m9.web_categories.review_gallery_refresh','product',pid,jsonb_build_object(
  'previous_binding',before_binding,'prior_snapshot',prior_snapshot,
  'evidence_sha256',evidence_hash,'captured_at',captured_at,'mappings',mapping,
  'source_fingerprint',md5(s.snapshot::text),'draft_fingerprint',md5(d.content::text),
  'catalog_fingerprint',catalog_hash,'review_kind','TECHNICAL_GALLERY_ONLY_COMPARISON',
  'draft_modified',false,'commercial_approval',false,'send_allowed',false));
 return jsonb_build_object('product_id',pid,'result','REVERIFIED','send_allowed',false);
end $$;
revoke all on function app.review_gallery_category_binding(uuid,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz,jsonb)
 from public,anon,authenticated,service_role;
commit;
