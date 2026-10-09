begin;
create table app.web_remote_gallery_outbox (
 id uuid primary key default gen_random_uuid(),
 parent_id uuid not null references app.web_remote_jobs(id),
 draft_revision integer not null,
 local_images jsonb not null,
 images jsonb not null,
 checkpoint_version integer not null,
 expected_remote_revision text not null,
 state text not null default 'RUNNING' check(state in ('RUNNING','SUCCEEDED','REVIEW_REQUIRED')),
 receipt jsonb,
 created_at timestamptz not null default now(),
 unique(parent_id,draft_revision)
);
alter table app.web_remote_gallery_outbox enable row level security;
revoke all on app.web_remote_gallery_outbox from public,anon,authenticated,service_role;
create function app.begin_remote_gallery_push(p_parent_id uuid,p_actor_id uuid,p_draft_revision integer default null,
 p_local_images jsonb default null,p_images jsonb default null,p_checkpoint_version integer default null,p_remote_revision text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare bound jsonb; j app.web_remote_gallery_outbox; d app.web_product_drafts; c app.web_remote_gallery_checkpoints;
begin
 bound:=app.claim_remote_web(p_parent_id,p_actor_id);
 if bound->>'state' is distinct from 'SUCCEEDED' then raise exception 'REMOTE_NOT_SUCCEEDED'; end if;
 select * into j from app.web_remote_gallery_outbox where parent_id=p_parent_id and state<>'SUCCEEDED' order by created_at limit 1;
 if found then return jsonb_build_object('dispatch',false,'job',to_jsonb(j)); end if;
 if p_images is null then return jsonb_build_object('dispatch',false,'job',null); end if;
 select * into j from app.web_remote_gallery_outbox where parent_id=p_parent_id and draft_revision=p_draft_revision;
 if found then return jsonb_build_object('dispatch',false,'job',to_jsonb(j)); end if;
 select * into d from app.web_product_drafts where product_id=(bound#>>'{packet,product_id}')::uuid for update;
 if not found or d.revision is distinct from p_draft_revision or d.content->'images' is distinct from p_local_images then raise exception 'GALLERY_DRAFT_CHANGED'; end if;
 select * into c from app.web_remote_gallery_checkpoints where job_id=p_parent_id;
 if not found or c.version is distinct from p_checkpoint_version then raise exception 'GALLERY_CHECKPOINT_CHANGED'; end if;
 if jsonb_typeof(p_images) is distinct from 'array' then raise exception 'GALLERY_INVALID'; end if;
 if jsonb_array_length(p_images) not between 1 and 20 or jsonb_array_length(p_images)<>jsonb_array_length(p_local_images)
 or p_remote_revision is null or p_remote_revision !~ '^[a-f0-9]{64}$'
 or exists(select 1 from jsonb_array_elements(p_images) i where jsonb_typeof(i->'sha256') is distinct from 'string' or (i->>'sha256') !~ '^[a-f0-9]{64}$' or jsonb_typeof(i->'alt') is distinct from 'string' or length(i->>'alt')>500)
 then raise exception 'GALLERY_INVALID'; end if;
 insert into app.web_remote_gallery_outbox(parent_id,draft_revision,local_images,images,checkpoint_version,expected_remote_revision)
 values(p_parent_id,p_draft_revision,p_local_images,p_images,p_checkpoint_version,p_remote_revision) returning * into j;
 return jsonb_build_object('dispatch',true,'job',to_jsonb(j));
end $$;
revoke all on function app.begin_remote_gallery_push(uuid,uuid,integer,jsonb,jsonb,integer,text) from public,anon,authenticated;
grant execute on function app.begin_remote_gallery_push(uuid,uuid,integer,jsonb,jsonb,integer,text) to service_role;
create function public.begin_remote_gallery_push(p_parent_id uuid,p_actor_id uuid,p_draft_revision integer default null,
 p_local_images jsonb default null,p_images jsonb default null,p_checkpoint_version integer default null,p_remote_revision text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select app.begin_remote_gallery_push(p_parent_id,p_actor_id,p_draft_revision,p_local_images,p_images,p_checkpoint_version,p_remote_revision)
$$;
revoke all on function public.begin_remote_gallery_push(uuid,uuid,integer,jsonb,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.begin_remote_gallery_push(uuid,uuid,integer,jsonb,jsonb,integer,text) to service_role;
create function app.finish_remote_gallery_push(p_job_id uuid,p_actor_id uuid,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j app.web_remote_gallery_outbox; bound jsonb; g jsonb; common jsonb;
begin
 select * into strict j from app.web_remote_gallery_outbox where id=p_job_id;
 bound:=app.claim_remote_web(j.parent_id,p_actor_id);
 select * into strict j from app.web_remote_gallery_outbox where id=p_job_id for update;
 if j.state='SUCCEEDED' then return jsonb_build_object('state',j.state); end if;
 if bound->>'state' is distinct from 'SUCCEEDED' or p_receipt->>'state' is distinct from 'SUCCEEDED'
 or p_receipt->>'update_id' is distinct from j.id::text or p_receipt->>'parent_id' is distinct from j.parent_id::text
 or p_receipt->'images' is distinct from j.images then raise exception 'GALLERY_RECEIPT_INVALID'; end if;
 g:=p_receipt->'gallery';
 if g->>'origin' is distinct from 'https://salmon-nightingale-251188.hostingersite.com'
 or g->>'product_id' is distinct from bound#>>'{packet,product_id}' or g->>'barcode' is distinct from bound#>>'{packet,barcode}'
 or g->'complete' is distinct from 'true'::jsonb
 or g->>'woo_product_id' is distinct from (select receipt->>'remote_product_id' from app.web_remote_jobs where id=j.parent_id)
 then raise exception 'GALLERY_RECEIPT_IDENTITY'; end if;
 select jsonb_agg(jsonb_build_object('sha256',i.value->>'sha256','alt',i.value->>'alt') order by i.n)
 into common from jsonb_array_elements(g->'images') with ordinality i(value,n);
 if common is distinct from j.images then raise exception 'GALLERY_RECEIPT_IMAGES'; end if;
 perform app.remote_gallery_checkpoint(j.parent_id,p_actor_id,j.checkpoint_version,j.draft_revision,j.local_images,j.images,g->>'revision');
 update app.web_remote_gallery_outbox set state='SUCCEEDED',receipt=p_receipt where id=j.id;
 return jsonb_build_object('state','SUCCEEDED');
end $$;
revoke all on function app.finish_remote_gallery_push(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function app.finish_remote_gallery_push(uuid,uuid,jsonb) to service_role;
create function public.finish_remote_gallery_push(p_job_id uuid,p_actor_id uuid,p_receipt jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select app.finish_remote_gallery_push(p_job_id,p_actor_id,p_receipt) $$;
revoke all on function public.finish_remote_gallery_push(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_remote_gallery_push(uuid,uuid,jsonb) to service_role;
commit;
