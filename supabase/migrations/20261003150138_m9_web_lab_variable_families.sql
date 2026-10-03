begin;
-- Only explicitly reviewed complete families. A new source/catalog cut must be
-- reviewed again; do not silently follow a moving store or overwrite human edits.
create table app.web_lab_family_evidence (
 product_id uuid primary key references public.products(id),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{32}$'),
 catalog_fingerprint text not null check(catalog_fingerprint ~ '^[0-9a-f]{32}$'),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 reviewed_at timestamptz not null default now()
);
alter table app.web_lab_family_evidence enable row level security;
revoke all on app.web_lab_family_evidence from public,anon,authenticated,service_role;
create or replace function app.web_lab_simple_packet(pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d app.web_product_drafts; s app.web_content_sources; e app.web_lab_enabled_products; c jsonb; b jsonb; prior app.web_lab_jobs; result jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into e from app.web_lab_enabled_products where product_id=pid and enabled;
 if not found then raise exception 'LAB_NOT_ENABLED'; end if;
 select * into s from app.web_content_sources where product_id=pid;
 if s.product_id is null or s.snapshot->>'type' is distinct from 'simple' or md5(s.snapshot::text)<>e.source_fingerprint then raise exception 'LAB_SOURCE_CHANGED'; end if;
 select * into d from app.web_product_drafts where product_id=pid;
 if d.product_id is null then raise exception 'LAB_SAVE_REQUIRED'; end if;
 perform app.validate_web_content(d.content);
 b:=app.web_category_binding_state(pid);
 if coalesce((b->>'valid')::boolean,false)=false then raise exception 'LAB_CATEGORY_REVIEW'; end if;
 c:=app.web_catalog_snapshot(pid);
 if c->>'active'<>'true' or jsonb_array_length(c->'variants')<>1
   or c#>>'{variants,0,active}'<>'true' or c#>'{variants,0,attributes}'<>'{}'::jsonb
   or coalesce(jsonb_array_length(s.snapshot->'unselected_woo_variation_ids'),0)<>0
   or nullif(c#>>'{variants,0,barcode}','') is null or nullif(c#>>'{variants,0,sku}','') is null
   or (c#>>'{variants,0,price_cents}')::bigint<=0
   then raise exception 'LAB_SIMPLE_PRODUCT_ONLY'; end if;
 if length(btrim(d.content->>'description'))=0 or length(btrim(d.content->>'base_code'))=0
   or d.content->>'short_description'<>d.content->>'base_code'
   or jsonb_array_length(d.content->'images')=0 then raise exception 'LAB_INCOMPLETE_CONTENT'; end if;
 select * into prior from app.web_lab_jobs where product_id=pid and state='SUCCEEDED' order by revision desc limit 1;
 if prior.id is not null and d.revision<=prior.revision then raise exception 'LAB_REVISION_ALREADY_SENT'; end if;
 result:=jsonb_build_object('version',1,'store',jsonb_build_object('id',e.store_id,'base_url','http://127.0.0.1:9417','environment','LOCAL_WOO_TEST'),
 'product_id',pid,'revision',d.revision,'mode','create','type','simple','content',d.content,
 'catalog',c,'fingerprint',md5(c::text),'category_evidence',b,'source_fingerprint',e.source_fingerprint);
 if prior.id is not null then
  result:=result||jsonb_build_object('version',2,'mode','update','previous',jsonb_build_object('job_id',prior.id,'revision',prior.revision,'receipt',prior.receipt));
 end if;
 return result;
end $$;
revoke all on function app.web_lab_simple_packet(uuid) from public,anon,authenticated,service_role;

create or replace function app.finish_web_lab_simple(p_job_id uuid,p_claim_id uuid,p_receipt jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j app.web_lab_jobs; success boolean;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict j from app.web_lab_jobs where id=p_job_id for update;
 if p_claim_id is null or p_claim_id is distinct from j.claim_id then raise exception 'LAB_CLAIM_MISMATCH'; end if;
 if j.receipt is not null then
  if j.receipt is distinct from p_receipt then raise exception 'LAB_RECEIPT_CHANGED'; end if;
  return jsonb_build_object('id',j.id,'state',j.state);
 end if;
 if j.state<>'RUNNING' then raise exception 'LAB_NOT_RUNNING'; end if;
 if p_receipt is null or jsonb_typeof(p_receipt)<>'object' then raise exception 'INVALID_LAB_RECEIPT'; end if;
 if (select count(*) from jsonb_object_keys(p_receipt))<>5
   or not(p_receipt ?& array['state','store_id','local_product_id','variant_id','evidence_sha256'])
   or p_receipt->>'state' not in ('SUCCEEDED','REVIEW_REQUIRED')
   or p_receipt->>'store_id' is distinct from j.packet#>>'{store,id}'
   or p_receipt->>'variant_id' is distinct from j.packet#>>'{catalog,variants,0,id}'
   or coalesce(p_receipt->>'evidence_sha256','') !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_LAB_RECEIPT'; end if;
 success:=p_receipt->>'state'='SUCCEEDED';
 if success and (jsonb_typeof(p_receipt->'local_product_id') is distinct from 'number'
   or coalesce(p_receipt->>'local_product_id','') !~ '^[1-9][0-9]{0,9}$') then raise exception 'INVALID_LAB_RECEIPT'; end if;
 if success and j.packet->>'mode'='update' and p_receipt->'local_product_id' is distinct from j.packet#>'{previous,receipt,local_product_id}' then raise exception 'LAB_TARGET_CHANGED'; end if;
 update app.web_lab_jobs set state=p_receipt->>'state',receipt=p_receipt,updated_at=now() where id=j.id;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.web_lab.result','product',j.product_id,
  jsonb_build_object('job_id',j.id,'revision',j.revision,'receipt',p_receipt,'production_written',false));
 return jsonb_build_object('id',j.id,'state',p_receipt->>'state');
end $$;
revoke all on function app.finish_web_lab_simple(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function app.web_lab_packet(pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s app.web_content_sources; e app.web_lab_enabled_products; f app.web_lab_family_evidence;
 d app.web_product_drafts; prior app.web_lab_jobs; c jsonb; b jsonb; v jsonb; expected jsonb; actual jsonb; result jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into s from app.web_content_sources where product_id=pid;
 if s.snapshot->>'type'='simple' then return app.web_lab_simple_packet(pid); end if;
 select * into e from app.web_lab_enabled_products where product_id=pid and enabled;
 if not found then raise exception 'LAB_NOT_ENABLED'; end if;
 if s.product_id is null or s.snapshot->>'type' is distinct from 'variable' or md5(s.snapshot::text)<>e.source_fingerprint then raise exception 'LAB_SOURCE_CHANGED'; end if;
 c:=app.web_catalog_snapshot(pid);
 select * into f from app.web_lab_family_evidence where product_id=pid;
 if not found or f.source_sha256<>s.source_sha256 or f.source_fingerprint<>md5(s.snapshot::text)
   or f.catalog_fingerprint<>md5(c::text) then raise exception 'LAB_FAMILY_REVIEW_REQUIRED'; end if;
 if c->>'active' is distinct from 'true' or jsonb_array_length(c->'variants') not between 2 and 100 then raise exception 'LAB_INCOMPLETE_FAMILY'; end if;
 select jsonb_agg(id order by id) into expected from (
  select (value->>'woo_variation_id')::bigint id from jsonb_array_elements(s.snapshot->'variants')
  union all select value::bigint from jsonb_array_elements_text(s.snapshot->'unselected_woo_variation_ids')
 ) q;
 select jsonb_agg((value->>'woo_variation_id')::bigint order by (value->>'woo_variation_id')::bigint) into actual from jsonb_array_elements(c->'variants');
 if expected is null or actual is distinct from expected then raise exception 'LAB_INCOMPLETE_FAMILY'; end if;
 for v in select value from jsonb_array_elements(c->'variants') loop
  if v->>'active' is distinct from 'true' or (v->>'woo_product_id')::bigint is distinct from (s.snapshot->>'woo_product_id')::bigint
    or nullif(v->>'barcode','') is null or nullif(v->>'sku','') is null
    or coalesce((v->>'price_cents')::bigint,0)<=0 or v->'attributes'='{}'::jsonb then raise exception 'LAB_INCOMPLETE_FAMILY'; end if;
  if not exists(select 1 from app.m9_rows r where r.variant_id=(v->>'id')::uuid and r.barcode=v->>'barcode'
    and r.source_row=app.m9_current_row(r.variant_id)) then raise exception 'LAB_SICAR_REVIEW_REQUIRED'; end if;
 end loop;
 select * into d from app.web_product_drafts where product_id=pid;
 if d.product_id is null then raise exception 'LAB_SAVE_REQUIRED'; end if;
 perform app.validate_web_content(d.content);
 b:=app.web_category_binding_state(pid);
 if coalesce((b->>'valid')::boolean,false)=false then raise exception 'LAB_CATEGORY_REVIEW'; end if;
 if length(btrim(d.content->>'description'))=0 or length(btrim(d.content->>'base_code'))=0
   or d.content->>'short_description'<>d.content->>'base_code' or jsonb_array_length(d.content->'images')=0 then raise exception 'LAB_INCOMPLETE_CONTENT'; end if;
 select * into prior from app.web_lab_jobs where product_id=pid and state='SUCCEEDED' order by revision desc limit 1;
 if prior.id is not null and d.revision<=prior.revision then raise exception 'LAB_REVISION_ALREADY_SENT'; end if;
 result:=jsonb_build_object('version',3,'store',jsonb_build_object('id',e.store_id,'base_url','http://127.0.0.1:9417','environment','LOCAL_WOO_TEST'),
 'product_id',pid,'revision',d.revision,'mode','create','type','variable','content',d.content,
 'catalog',c,'fingerprint',md5(c::text),'category_evidence',b,'source_fingerprint',e.source_fingerprint,
 'family_evidence',to_jsonb(f),'parent_attributes',coalesce(s.snapshot->'parent_attributes_source','[]'::jsonb));
 if prior.id is not null then
  if prior.packet->>'type'<>'variable' then raise exception 'LAB_TARGET_CHANGED'; end if;
  result:=result||jsonb_build_object('version',4,'mode','update','previous',jsonb_build_object('job_id',prior.id,'revision',prior.revision,'receipt',prior.receipt));
 end if;
 return result;
end $$;
revoke all on function app.web_lab_packet(uuid) from public,anon,authenticated,service_role;

create or replace function app.finish_web_lab(p_job_id uuid,p_claim_id uuid,p_receipt jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j app.web_lab_jobs; ids jsonb; mapped jsonb; v jsonb; success boolean;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict j from app.web_lab_jobs where id=p_job_id for update;
 if j.packet->>'type'='simple' then return app.finish_web_lab_simple(p_job_id,p_claim_id,p_receipt); end if;
 if p_claim_id is null or p_claim_id is distinct from j.claim_id then raise exception 'LAB_CLAIM_MISMATCH'; end if;
 if j.receipt is not null then
  if j.receipt is distinct from p_receipt then raise exception 'LAB_RECEIPT_CHANGED'; end if;
  return jsonb_build_object('id',j.id,'state',j.state);
 end if;
 if j.state<>'RUNNING' then raise exception 'LAB_NOT_RUNNING'; end if;
 if p_receipt is null or jsonb_typeof(p_receipt)<>'object' then raise exception 'INVALID_LAB_RECEIPT'; end if;
 if (select count(*) from jsonb_object_keys(p_receipt))<>5
   or not(p_receipt ?& array['state','store_id','local_product_id','variants','evidence_sha256'])
   or coalesce(p_receipt->>'state','') not in ('SUCCEEDED','REVIEW_REQUIRED')
   or p_receipt->>'store_id' is distinct from j.packet#>>'{store,id}'
   or coalesce(p_receipt->>'evidence_sha256','') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_receipt->'variants') is distinct from 'array' then raise exception 'INVALID_LAB_RECEIPT'; end if;
 success:=p_receipt->>'state'='SUCCEEDED';
 if success then
  if jsonb_typeof(p_receipt->'local_product_id') is distinct from 'number'
    or coalesce(p_receipt->>'local_product_id','') !~ '^[1-9][0-9]{0,9}$' then raise exception 'INVALID_LAB_RECEIPT'; end if;
  select jsonb_agg(value->>'id' order by value->>'id') into ids from jsonb_array_elements(j.packet#>'{catalog,variants}');
  select jsonb_agg(value->>'variant_id' order by value->>'variant_id') into mapped from jsonb_array_elements(p_receipt->'variants');
  if ids is distinct from mapped or (select count(distinct value->>'local_variation_id') from jsonb_array_elements(p_receipt->'variants'))<>jsonb_array_length(p_receipt->'variants') then raise exception 'INVALID_LAB_VARIANT_RECEIPT'; end if;
  for v in select value from jsonb_array_elements(p_receipt->'variants') loop
   if jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>2 or not(v ?& array['variant_id','local_variation_id'])
    or jsonb_typeof(v->'local_variation_id') is distinct from 'number'
    or coalesce(v->>'local_variation_id','') !~ '^[1-9][0-9]{0,9}$'
    or v->'local_variation_id'=p_receipt->'local_product_id' then raise exception 'INVALID_LAB_VARIANT_RECEIPT'; end if;
  end loop;
  if j.packet->>'mode'='update' and (p_receipt->'local_product_id' is distinct from j.packet#>'{previous,receipt,local_product_id}'
    or (select jsonb_agg(value order by value->>'variant_id') from jsonb_array_elements(p_receipt->'variants')) is distinct from
       (select jsonb_agg(value order by value->>'variant_id') from jsonb_array_elements(j.packet#>'{previous,receipt,variants}'))) then raise exception 'LAB_TARGET_CHANGED'; end if;
 end if;
 update app.web_lab_jobs set state=p_receipt->>'state',receipt=p_receipt,updated_at=now() where id=j.id;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.web_lab.result','product',j.product_id,
  jsonb_build_object('job_id',j.id,'revision',j.revision,'receipt',p_receipt,'production_written',false));
 return jsonb_build_object('id',j.id,'state',p_receipt->>'state');
end $$;
revoke all on function app.finish_web_lab(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function app.read_web_lab(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d jsonb; j app.web_lab_jobs; enabled boolean; verified app.web_lab_jobs;
begin
 d:=app.read_web_draft(p_product_id,null); -- authenticated permission and staging checks
 select coalesce(e.enabled,false) into enabled from app.web_lab_enabled_products e where product_id=p_product_id;
 select * into j from app.web_lab_jobs where product_id=p_product_id order by created_at desc,id desc limit 1;
 select * into verified from app.web_lab_jobs where product_id=p_product_id and state='SUCCEEDED' order by revision desc limit 1;
 return jsonb_build_object('last_verified_variants',coalesce(verified.receipt->'variants','[]'::jsonb),'last_verified_revision',verified.revision,'local_product_id',verified.receipt->'local_product_id','enabled',coalesce(enabled,false),'supervised',true,'production_enabled',false,
 'job',case when j.id is null then null else jsonb_build_object('id',j.id,'state',j.state,'revision',j.revision,'mode',j.packet->>'mode',
 'created_at',j.created_at,'updated_at',j.updated_at,'local_product_id',j.receipt->'local_product_id') end);
end $$;
revoke all on function app.read_web_lab(uuid) from public,anon,service_role;
grant execute on function app.read_web_lab(uuid) to authenticated;
create or replace function public.read_web_lab(p_product_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select app.read_web_lab(p_product_id) $$;
revoke all on function public.read_web_lab(uuid) from public,anon,service_role;
grant execute on function public.read_web_lab(uuid) to authenticated;


commit;
