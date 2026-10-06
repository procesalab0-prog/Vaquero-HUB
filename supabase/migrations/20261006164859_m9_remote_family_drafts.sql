begin;
-- Explicit reviewed family rollout, separate from production IDs and stock.
create table app.web_remote_family_approvals (
 product_id uuid primary key references public.products(id),
 catalog_fingerprint text not null,
 source_fingerprint text not null,
 source_sha256 text not null,
 approved_at timestamptz not null default now()
);
alter table app.web_remote_family_approvals enable row level security;
revoke all on app.web_remote_family_approvals from public,anon,authenticated,service_role;
alter table app.web_remote_jobs add column gallery_sha256 jsonb;
alter function app.remote_web_packet(uuid) rename to remote_web_simple_packet;
create function app.remote_web_packet(pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a app.web_remote_family_approvals; d app.web_product_drafts; s app.web_content_sources;
 c jsonb; b jsonb; f app.web_lab_family_evidence; v jsonb; expected jsonb; actual jsonb; children jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into a from app.web_remote_family_approvals where product_id=pid;
 if not found then return app.remote_web_simple_packet(pid); end if;
 select * into strict d from app.web_product_drafts where product_id=pid;
 select * into strict s from app.web_content_sources where product_id=pid;
 select * into strict f from app.web_lab_family_evidence where product_id=pid;
 c:=app.web_catalog_snapshot(pid);b:=app.web_category_binding_state(pid);
 if md5(c::text)<>a.catalog_fingerprint or md5(s.snapshot::text)<>a.source_fingerprint or s.source_sha256<>a.source_sha256
  or f.catalog_fingerprint<>a.catalog_fingerprint or f.source_fingerprint<>a.source_fingerprint or f.source_sha256<>a.source_sha256
  or s.snapshot->>'type'<>'variable' or coalesce((b->>'valid')::boolean,false)=false
  or c->>'active'<>'true' or jsonb_array_length(c->'variants') not between 2 and 100 then raise exception 'REMOTE_FAMILY_EVIDENCE_CHANGED'; end if;
 perform app.validate_web_content(d.content);
 if length(d.content->>'name')>200 or length(btrim(d.content->>'description'))=0 or length(d.content->>'description')>20000
  or length(btrim(d.content->>'short_description'))=0 or length(d.content->>'short_description')>2000
  or d.content->>'short_description'<>d.content->>'base_code' or jsonb_array_length(d.content->'images') not between 1 and 20
 then raise exception 'REMOTE_CONTENT_SCOPE'; end if;
 select jsonb_agg(id order by id) into expected from (
  select (value->>'woo_variation_id')::bigint id from jsonb_array_elements(s.snapshot->'variants')
  union all select value::bigint from jsonb_array_elements_text(s.snapshot->'unselected_woo_variation_ids')
 ) q;
 select jsonb_agg((value->>'woo_variation_id')::bigint order by (value->>'woo_variation_id')::bigint) into actual from jsonb_array_elements(c->'variants');
 if expected is null or actual is distinct from expected then raise exception 'REMOTE_INCOMPLETE_FAMILY'; end if;
 for v in select value from jsonb_array_elements(c->'variants') loop
  if v->>'active'<>'true' or v->'attributes'='{}'::jsonb or nullif(v->>'barcode','') is null
   or length(v->>'barcode')>100 or (v->>'price_cents')::bigint not between 0 and 100000000
   or v->>'woo_product_id' is distinct from s.snapshot->>'woo_product_id'
   or not exists(select 1 from app.m9_rows r where r.variant_id=(v->>'id')::uuid and r.barcode=v->>'barcode' and r.source_row=app.m9_current_row(r.variant_id))
   then raise exception 'REMOTE_VARIANT_REVIEW'; end if;
 end loop;
 select jsonb_agg(jsonb_build_object('variant_id',v->'id','barcode',v->'barcode','price_cents',v->'price_cents','attributes',v->'attributes') order by v->>'id') into children from jsonb_array_elements(c->'variants') v;
 if (select count(distinct v->>'barcode') from jsonb_array_elements(children) v)<>jsonb_array_length(children)
  or (select count(distinct v->'attributes') from jsonb_array_elements(children) v)<>jsonb_array_length(children)
 then raise exception 'REMOTE_DUPLICATE_VARIANT'; end if;
 return jsonb_build_object('protocol','m9-remote-family-1','product_id',pid,'revision',d.revision,'fingerprint',md5(c::text),
  'content',d.content,'barcode','M9-P-'||pid::text,'variants',children,
  'descriptive_attributes',coalesce((select jsonb_agg(value order by n) from jsonb_array_elements(s.snapshot->'parent_attributes_source') with ordinality x(value,n) where value->>'variation'='false'),'[]'::jsonb),
  'origin','https://salmon-nightingale-251188.hostingersite.com');
end $$;
revoke all on function app.remote_web_packet(uuid) from public,anon,authenticated,service_role;
create function app.bind_remote_web_gallery(p_job_id uuid,p_claim_id uuid,p_images jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare j app.web_remote_jobs;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict j from app.web_remote_jobs where id=p_job_id for update;
 if j.state<>'RUNNING' or p_claim_id is null or p_claim_id is distinct from j.claim_id or j.packet->>'protocol' is distinct from 'm9-remote-family-1'
  or jsonb_typeof(p_images) is distinct from 'array' then raise exception 'REMOTE_GALLERY_CONFLICT'; end if;
 if jsonb_array_length(p_images)<>jsonb_array_length(j.packet#>'{content,images}') or jsonb_array_length(p_images) not between 1 and 20
  or exists(select 1 from jsonb_array_elements(p_images) with ordinality i(value,n)
    join jsonb_array_elements(j.packet#>'{content,images}') with ordinality p(value,n) using(n)
    where coalesce(i.value->>'sha256','') !~ '^[a-f0-9]{64}$' or i.value->>'alt' is distinct from p.value->>'alt'
      or (select count(*) from jsonb_object_keys(i.value))<>2)
  or (select count(distinct value->>'sha256') from jsonb_array_elements(p_images))<>jsonb_array_length(p_images)
  or (j.gallery_sha256 is not null and j.gallery_sha256<>p_images) then raise exception 'REMOTE_GALLERY_CONFLICT'; end if;
 update app.web_remote_jobs set gallery_sha256=p_images where id=j.id;
end $$;
revoke all on function app.bind_remote_web_gallery(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function app.bind_remote_web_gallery(uuid,uuid,jsonb) to service_role;
create function public.bind_remote_web_gallery(p_job_id uuid,p_claim_id uuid,p_images jsonb) returns void
language sql security invoker set search_path='' as $$ select app.bind_remote_web_gallery(p_job_id,p_claim_id,p_images) $$;
revoke all on function public.bind_remote_web_gallery(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bind_remote_web_gallery(uuid,uuid,jsonb) to service_role;
alter function app.finish_remote_web(uuid,uuid,jsonb) rename to finish_remote_simple_web;
create function app.finish_remote_web(p_job_id uuid,p_claim_id uuid,p_receipt jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare j app.web_remote_jobs; v jsonb; children jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict j from app.web_remote_jobs where id=p_job_id for update;
 if j.packet->>'protocol' is distinct from 'm9-remote-family-1' then perform app.finish_remote_simple_web(p_job_id,p_claim_id,p_receipt);return;end if;
 if p_claim_id is null or p_claim_id is distinct from j.claim_id then raise exception 'REMOTE_CLAIM_MISMATCH'; end if;
 if j.receipt is not null then
  if j.receipt is distinct from p_receipt then raise exception 'REMOTE_RECEIPT_CHANGED';end if;return;
 end if;
 if j.state<>'RUNNING' or p_receipt->>'protocol' is distinct from 'm9-remote-family-1' or p_receipt->>'state' is distinct from 'SUCCEEDED'
  or p_receipt->>'request_id' is distinct from j.id::text or p_receipt->>'product_id' is distinct from j.product_id::text
  or p_receipt->'revision' is distinct from j.packet->'revision' or coalesce(p_receipt->>'remote_product_id','') !~ '^[1-9][0-9]{0,9}$'
 then raise exception 'INVALID_REMOTE_RECEIPT';end if;
 v:=p_receipt->'verified';
 if jsonb_typeof(v->'variants') is distinct from 'array' then raise exception 'REMOTE_VARIANT_READBACK';end if;
 select jsonb_agg(value-'remote_variation_id' order by value->>'variant_id') into children from jsonb_array_elements(v->'variants');
 if children is distinct from j.packet->'variants'
  or exists(select 1 from jsonb_array_elements(v->'variants') where coalesce(value->>'remote_variation_id','') !~ '^[1-9][0-9]{0,9}$' or value->>'remote_variation_id'=p_receipt->>'remote_product_id')
  or (select count(distinct value->>'remote_variation_id') from jsonb_array_elements(v->'variants'))<>jsonb_array_length(v->'variants')
  or v->>'status' is distinct from 'draft' or v->>'purchasable' is distinct from 'false'
  or v->>'barcode' is distinct from j.packet->>'barcode' or v->>'name' is distinct from j.packet#>>'{content,name}'
  or v->>'description' is distinct from j.packet#>>'{content,description}' or v->>'short_description' is distinct from j.packet#>>'{content,short_description}'
  or v->'categories' is distinct from j.packet#>'{content,categories}' or v->'descriptive_attributes' is distinct from j.packet->'descriptive_attributes'
  or j.gallery_sha256 is null or v->'images' is distinct from j.gallery_sha256
 then raise exception 'REMOTE_READBACK_MISMATCH';end if;
 update app.web_remote_jobs set state='SUCCEEDED',receipt=p_receipt,updated_at=now() where id=j.id;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.remote.family.result','product',j.product_id,
 jsonb_build_object('job_id',j.id,'remote_product_id',p_receipt->'remote_product_id','variant_count',jsonb_array_length(children),'production_written',false));
end $$;
revoke all on function app.finish_remote_web(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function app.finish_remote_web(uuid,uuid,jsonb) to service_role;
-- Wrappers explicitly rebound after renaming the legacy implementations.
create or replace function public.finish_remote_web(p_job_id uuid,p_claim_id uuid,p_receipt jsonb) returns void
language sql security invoker set search_path='' as $$ select app.finish_remote_web(p_job_id,p_claim_id,p_receipt) $$;
commit;
