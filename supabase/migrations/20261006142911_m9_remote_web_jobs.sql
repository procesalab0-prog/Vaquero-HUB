begin;
-- Separate remote test outbox. No production Woo IDs, stock, or local queue changes.
create table app.web_remote_jobs (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null unique references public.products(id),
 actor_id uuid not null references public.app_users(id),
 request_id uuid not null,
 request_hash text not null,
 packet jsonb not null,
 state text not null default 'READY' check(state in ('READY','RUNNING','SUCCEEDED','REVIEW_REQUIRED','SUPERSEDED')),
 claim_id uuid,
 image_sha256 text check(image_sha256 ~ '^[0-9a-f]{64}$'),
 receipt jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(actor_id,request_id)
);
alter table app.web_remote_jobs enable row level security;
revoke all on app.web_remote_jobs from public,anon,authenticated,service_role;
create index web_remote_jobs_actor on app.web_remote_jobs(actor_id);

create function app.remote_web_packet(pid uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare d app.web_product_drafts; c jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into d from app.web_product_drafts where product_id=pid;
 if d.product_id is null then raise exception 'REMOTE_SAVE_REQUIRED'; end if;
 perform app.validate_web_content(d.content);
 c:=app.web_catalog_snapshot(pid);
 -- This rollout creates NEW simple products only, never truncates an existing
 -- family/gallery/categories or silently treats a migration candidate as approved.
 if c is null or c->>'active'<>'true' or jsonb_array_length(c->'variants')<>1
  or c#>>'{variants,0,active}'<>'true' or c#>'{variants,0,attributes}'<>'{}'::jsonb
  or c#>>'{variants,0,woo_product_id}' is not null
  or c#>>'{variants,0,woo_variation_id}' is not null
  or exists(select 1 from app.web_content_sources where product_id=pid)
  or coalesce(length(c#>>'{variants,0,barcode}'),0)=0
  or (c#>>'{variants,0,price_cents}')::bigint not between 0 and 100000000
  then raise exception 'REMOTE_NEW_SIMPLE_ONLY'; end if;
 if jsonb_array_length(d.content->'images')<>1 or jsonb_array_length(d.content->'categories')<>0
  or length(d.content->>'name')>200 or length(btrim(d.content->>'description'))=0
  or length(d.content->>'description')>20000
  or length(btrim(d.content->>'short_description'))=0 or length(d.content->>'short_description')>2000
  then raise exception 'REMOTE_CONTENT_SCOPE'; end if;
 return jsonb_build_object('product_id',pid,'revision',d.revision,'fingerprint',md5(c::text),
  'content',d.content,'barcode',c#>>'{variants,0,barcode}',
  'variant_id',c#>>'{variants,0,id}','price_cents',(c#>>'{variants,0,price_cents}')::bigint,
  'origin','https://salmon-nightingale-251188.hostingersite.com');
end $$;
revoke all on function app.remote_web_packet(uuid) from public,anon,authenticated,service_role;

create function app.read_remote_web(p_product_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d jsonb; j app.web_remote_jobs; reason text; candidate jsonb;
begin
 d:=app.read_web_draft(p_product_id,null);
 select * into j from app.web_remote_jobs where product_id=p_product_id;
 begin candidate:=app.remote_web_packet(p_product_id);
 exception when others then reason:=SQLERRM; end;
 return jsonb_build_object('enabled',true,'production_enabled',false,
  'eligible',candidate is not null and (d->>'can_edit')::boolean and j.id is null,
  'reason',reason,'job',case when j.id is null then null else jsonb_build_object(
   'id',j.id,'state',j.state,'revision',j.packet->'revision',
   'remote_product_id',j.receipt->'remote_product_id') end);
end $$;
revoke all on function app.read_remote_web(uuid) from public,anon,service_role;
grant execute on function app.read_remote_web(uuid) to authenticated;
create function public.read_remote_web(p_product_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select app.read_remote_web(p_product_id) $$;
revoke all on function public.read_remote_web(uuid) from public,anon,service_role;
grant execute on function public.read_remote_web(uuid) to authenticated;

create function app.enqueue_remote_web(p_product_id uuid,p_revision integer,p_fingerprint text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; p jsonb; j app.web_remote_jobs; h text;
begin
 d:=app.read_web_draft(p_product_id,null);
 if (d->>'can_edit')::boolean is not true then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if p_request_id is null or p_revision is null then raise exception 'INVALID_REMOTE_REQUEST'; end if;
 h:=md5(jsonb_build_array(p_product_id,p_revision,p_fingerprint)::text);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,9));
 select * into j from app.web_remote_jobs where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if j.request_hash<>h then raise exception 'REMOTE_REQUEST_REUSED'; end if;
  return app.read_remote_web(p_product_id);
 end if;
 perform 1 from public.products where id=p_product_id for update;
 p:=app.remote_web_packet(p_product_id);
 if p_revision is distinct from (p->>'revision')::integer or p_fingerprint is distinct from p->>'fingerprint' then raise exception 'REMOTE_SAVED_VERSION_CHANGED'; end if;
 if exists(select 1 from app.web_remote_jobs where product_id=p_product_id) then raise exception 'REMOTE_ALREADY_REQUESTED'; end if;
 insert into app.web_remote_jobs(product_id,actor_id,request_id,request_hash,packet)
 values(p_product_id,auth.uid(),p_request_id,h,p) returning * into j;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.remote.enqueue','product',p_product_id,
 jsonb_build_object('job_id',j.id,'actor',auth.uid(),'production_written',false));
 return app.read_remote_web(p_product_id);
end $$;
revoke all on function app.enqueue_remote_web(uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function app.enqueue_remote_web(uuid,integer,text,uuid) to authenticated;
create function public.enqueue_remote_web(p_product_id uuid,p_revision integer,p_fingerprint text,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app.enqueue_remote_web(p_product_id,p_revision,p_fingerprint,p_request_id) $$;
revoke all on function public.enqueue_remote_web(uuid,integer,text,uuid) from public,anon,service_role;
grant execute on function public.enqueue_remote_web(uuid,integer,text,uuid) to authenticated;

-- Narrow worker API: only server service credential; UI cannot forge receipts/claims.
create function app.claim_remote_web(p_job_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j app.web_remote_jobs; fresh jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict j from app.web_remote_jobs where id=p_job_id for update;
 if j.actor_id is distinct from p_actor_id then raise exception 'REMOTE_OWNER_MISMATCH'; end if;
 if not exists(select 1 from public.app_users u where u.id=p_actor_id and u.is_active
  and exists(select 1 from public.role_permissions r where r.role_id=u.role_id and r.permission_code='products.read')
  and (exists(select 1 from public.role_permissions r where r.role_id=u.role_id and r.permission_code='products.update')
   or (exists(select 1 from public.role_permissions r where r.role_id=u.role_id and r.permission_code='products.create')
    and exists(select 1 from public.products p where p.id=j.product_id and p.created_by=p_actor_id))))
  then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 if j.state='READY' then
  begin fresh:=app.remote_web_packet(j.product_id); exception when others then fresh:=null; end;
  if fresh is distinct from j.packet then
   update app.web_remote_jobs set state='SUPERSEDED',updated_at=now() where id=j.id;
   return jsonb_build_object('state','SUPERSEDED');
  end if;
  update app.web_remote_jobs set state='RUNNING',claim_id=gen_random_uuid(),updated_at=now() where id=j.id returning * into j;
  return jsonb_build_object('state',j.state,'dispatch',true,'id',j.id,'claim_id',j.claim_id,'packet',j.packet);
 end if;
 -- Existing running requests can ONLY be reconciled by GET; no lease auto retry.
 return jsonb_build_object('state',j.state,'dispatch',false,'id',j.id,'claim_id',j.claim_id,'packet',j.packet);
end $$;
revoke all on function app.claim_remote_web(uuid,uuid) from public,anon,authenticated;
grant execute on function app.claim_remote_web(uuid,uuid) to service_role;
create function public.claim_remote_web(p_job_id uuid,p_actor_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app.claim_remote_web(p_job_id,p_actor_id) $$;
revoke all on function public.claim_remote_web(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_remote_web(uuid,uuid) to service_role;

create function app.bind_remote_web_image(p_job_id uuid,p_claim_id uuid,p_sha256 text) returns void
language plpgsql security definer set search_path='' as $$
declare j app.web_remote_jobs;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict j from app.web_remote_jobs where id=p_job_id for update;
 if j.state<>'RUNNING' or p_claim_id is distinct from j.claim_id or p_claim_id is null
  or coalesce(p_sha256,'') !~ '^[0-9a-f]{64}$'
  or (j.image_sha256 is not null and j.image_sha256<>p_sha256) then raise exception 'REMOTE_IMAGE_CONFLICT'; end if;
 update app.web_remote_jobs set image_sha256=p_sha256 where id=j.id;
end $$;
revoke all on function app.bind_remote_web_image(uuid,uuid,text) from public,anon,authenticated;
grant execute on function app.bind_remote_web_image(uuid,uuid,text) to service_role;
create function public.bind_remote_web_image(p_job_id uuid,p_claim_id uuid,p_sha256 text) returns void
language sql security invoker set search_path='' as $$ select app.bind_remote_web_image(p_job_id,p_claim_id,p_sha256) $$;
revoke all on function public.bind_remote_web_image(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bind_remote_web_image(uuid,uuid,text) to service_role;

create function app.finish_remote_web(p_job_id uuid,p_claim_id uuid,p_receipt jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare j app.web_remote_jobs; v jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict j from app.web_remote_jobs where id=p_job_id for update;
 if p_claim_id is null or p_claim_id is distinct from j.claim_id then raise exception 'REMOTE_CLAIM_MISMATCH'; end if;
 if j.receipt is not null then
  if j.receipt is distinct from p_receipt then raise exception 'REMOTE_RECEIPT_CHANGED'; end if;
  return;
 end if;
 if j.state<>'RUNNING' or p_receipt->>'state' is distinct from 'SUCCEEDED'
  or p_receipt->>'request_id' is distinct from j.id::text
  or p_receipt->>'product_id' is distinct from j.product_id::text
  or p_receipt->'revision' is distinct from j.packet->'revision'
  or coalesce(p_receipt->>'remote_product_id','') !~ '^[1-9][0-9]{0,9}$'
  then raise exception 'INVALID_REMOTE_RECEIPT'; end if;
 v:=p_receipt->'verified';
 if v->>'status' is distinct from 'draft' or v->>'purchasable' is distinct from 'false'
  or v->>'barcode' is distinct from j.packet->>'barcode'
  or v->'price_cents' is distinct from j.packet->'price_cents'
  or v->>'name' is distinct from j.packet#>>'{content,name}'
  or v->>'description' is distinct from j.packet#>>'{content,description}'
  or v->>'short_description' is distinct from j.packet#>>'{content,short_description}'
  or j.image_sha256 is null or v->>'image_sha256' is distinct from j.image_sha256
  then raise exception 'REMOTE_READBACK_MISMATCH'; end if;
 update app.web_remote_jobs set state='SUCCEEDED',receipt=p_receipt,updated_at=now() where id=j.id;
 insert into public.audit_log(action,entity_type,entity_id,metadata) values('m9.remote.result','product',j.product_id,
 jsonb_build_object('job_id',j.id,'remote_product_id',p_receipt->'remote_product_id','production_written',false));
end $$;
revoke all on function app.finish_remote_web(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function app.finish_remote_web(uuid,uuid,jsonb) to service_role;
create function public.finish_remote_web(p_job_id uuid,p_claim_id uuid,p_receipt jsonb) returns void
language sql security invoker set search_path='' as $$ select app.finish_remote_web(p_job_id,p_claim_id,p_receipt) $$;
revoke all on function public.finish_remote_web(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_remote_web(uuid,uuid,jsonb) to service_role;
commit;
