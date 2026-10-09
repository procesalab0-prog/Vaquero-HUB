begin;
-- Supervised LOCAL laboratory only. No credentials, stock or live Woo IDs as targets.
create table app.web_lab_enabled_products (
 product_id uuid primary key references public.products(id),
 source_fingerprint text not null,
 enabled boolean not null default false,
 store_id text not null check(store_id='m9-local-2026-10-02')
);
create table app.web_lab_jobs (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id),
 actor_id uuid not null references public.app_users(id),
 request_id uuid not null,
 request_hash text not null,
 revision integer not null check(revision>0),
 packet jsonb not null,
 state text not null default 'READY' check(state in ('READY','RUNNING','SUCCEEDED','REVIEW_REQUIRED','SUPERSEDED')),
 claim_id uuid,
 receipt jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(actor_id,request_id)
);
-- The first UI trial only creates one isolated draft per enabled product.
create unique index web_lab_one_create on app.web_lab_jobs(product_id) where state<>'SUPERSEDED';
alter table app.web_lab_enabled_products enable row level security;
alter table app.web_lab_jobs enable row level security;
revoke all on app.web_lab_enabled_products,app.web_lab_jobs from public,anon,authenticated,service_role;

create function app.web_lab_packet(pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d app.web_product_drafts; s app.web_content_sources; e app.web_lab_enabled_products; c jsonb; b jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into e from app.web_lab_enabled_products where product_id=pid and enabled;
 if not found then raise exception 'LAB_NOT_ENABLED'; end if;
 select * into s from app.web_content_sources where product_id=pid;
 if s.product_id is null or md5(s.snapshot::text)<>e.source_fingerprint then raise exception 'LAB_SOURCE_CHANGED'; end if;
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
 return jsonb_build_object('version',1,'store',jsonb_build_object('id',e.store_id,'base_url','http://127.0.0.1:9417','environment','LOCAL_WOO_TEST'),
 'product_id',pid,'revision',d.revision,'mode','create','type','simple','content',d.content,
 'catalog',c,'fingerprint',md5(c::text),'category_evidence',b,'source_fingerprint',e.source_fingerprint);
end $$;
revoke all on function app.web_lab_packet(uuid) from public,anon,authenticated,service_role;

create function app.read_web_lab(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d jsonb; j app.web_lab_jobs; enabled boolean;
begin
 d:=app.read_web_draft(p_product_id,null); -- authenticated permission and staging checks
 select coalesce(e.enabled,false) into enabled from app.web_lab_enabled_products e where product_id=p_product_id;
 select * into j from app.web_lab_jobs where product_id=p_product_id order by created_at desc,id desc limit 1;
 return jsonb_build_object('enabled',coalesce(enabled,false),'supervised',true,'production_enabled',false,
 'job',case when j.id is null then null else jsonb_build_object('id',j.id,'state',j.state,'revision',j.revision,
 'created_at',j.created_at,'updated_at',j.updated_at,'local_product_id',j.receipt->'local_product_id') end);
end $$;
revoke all on function app.read_web_lab(uuid) from public,anon,service_role;
grant execute on function app.read_web_lab(uuid) to authenticated;
create function public.read_web_lab(p_product_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select app.read_web_lab(p_product_id) $$;
revoke all on function public.read_web_lab(uuid) from public,anon,service_role;
grant execute on function public.read_web_lab(uuid) to authenticated;

create function app.enqueue_web_lab(p_product_id uuid,p_revision integer,p_fingerprint text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; packet jsonb; j app.web_lab_jobs; h text;
begin
 d:=app.read_web_draft(p_product_id,null);
 if coalesce((d->>'can_edit')::boolean,false)=false then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_request_id is null or p_revision is null then raise exception 'INVALID_LAB_REQUEST'; end if;
 h:=md5(jsonb_build_array(p_product_id,p_revision,p_fingerprint)::text);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,1));
 select * into j from app.web_lab_jobs where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if j.request_hash<>h then raise exception 'LAB_REQUEST_REUSED'; end if;
  return app.read_web_lab(p_product_id);
 end if;
 perform 1 from public.products where id=p_product_id for update;
 packet:=app.web_lab_packet(p_product_id);
 if p_revision<>(packet->>'revision')::integer or p_fingerprint is distinct from packet->>'fingerprint' then raise exception 'LAB_SAVED_VERSION_CHANGED'; end if;
 if exists(select 1 from app.web_lab_jobs where product_id=p_product_id and state<>'SUPERSEDED') then raise exception 'LAB_ALREADY_REQUESTED'; end if;
 insert into app.web_lab_jobs(product_id,actor_id,request_id,request_hash,revision,packet)
 values(p_product_id,auth.uid(),p_request_id,h,p_revision,packet) returning * into j;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.web_lab.enqueue','product',p_product_id,
  jsonb_build_object('job_id',j.id,'actor',auth.uid(),'revision',p_revision,'production_written',false));
 return app.read_web_lab(p_product_id);
end $$;
revoke all on function app.enqueue_web_lab(uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function app.enqueue_web_lab(uuid,integer,text,uuid) to authenticated;
create function public.enqueue_web_lab(p_product_id uuid,p_revision integer,p_fingerprint text,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app.enqueue_web_lab(p_product_id,p_revision,p_fingerprint,p_request_id) $$;
revoke all on function public.enqueue_web_lab(uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function public.enqueue_web_lab(uuid,integer,text,uuid) to authenticated;

-- Administrative bridge: inaccessible to API users and service_role; no lease/retry POST.
create function app.claim_web_lab(p_job_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j app.web_lab_jobs; fresh jsonb; pid uuid;
begin
 perform app.assert_sicar_staging_enabled();
 select product_id into strict pid from app.web_lab_jobs where id=p_job_id;
 perform 1 from public.products where id=pid for update;
 select * into strict j from app.web_lab_jobs where id=p_job_id for update;
 if j.state<>'READY' then raise exception 'LAB_NOT_READY'; end if;
 begin fresh:=app.web_lab_packet(pid); exception when others then fresh:=null; end;
 if fresh is distinct from j.packet then
  update app.web_lab_jobs set state='SUPERSEDED',updated_at=now() where id=j.id;
  return jsonb_build_object('id',j.id,'state','SUPERSEDED');
 end if;
 update app.web_lab_jobs set state='RUNNING',claim_id=gen_random_uuid(),updated_at=now() where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'state',j.state,'claim_id',j.claim_id,'packet',j.packet);
end $$;
revoke all on function app.claim_web_lab(uuid) from public,anon,authenticated,service_role;

create function app.finish_web_lab(p_job_id uuid,p_claim_id uuid,p_receipt jsonb) returns jsonb
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
 update app.web_lab_jobs set state=p_receipt->>'state',receipt=p_receipt,updated_at=now() where id=j.id;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.web_lab.result','product',j.product_id,
  jsonb_build_object('job_id',j.id,'revision',j.revision,'receipt',p_receipt,'production_written',false));
 return jsonb_build_object('id',j.id,'state',p_receipt->>'state');
end $$;
revoke all on function app.finish_web_lab(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
commit;
