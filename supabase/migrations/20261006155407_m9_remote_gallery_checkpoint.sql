begin;
create table app.web_remote_gallery_checkpoints (
 job_id uuid primary key references app.web_remote_jobs(id),
 version integer not null check(version>0),
 images jsonb not null,
 remote_revision text not null,
 updated_at timestamptz not null default now()
);
alter table app.web_remote_gallery_checkpoints enable row level security;
revoke all on app.web_remote_gallery_checkpoints from public,anon,authenticated,service_role;
-- Only the trusted server can checkpoint byte hashes it has independently read.
-- claim_remote_web rechecks the job owner and their current permissions.
create function app.remote_gallery_checkpoint(p_job_id uuid,p_actor_id uuid,p_expected_version integer default null,
 p_draft_revision integer default null,p_local_images jsonb default null,p_images jsonb default null,p_remote_revision text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare bound jsonb; previous app.web_remote_gallery_checkpoints; draft app.web_product_drafts; result app.web_remote_gallery_checkpoints;
begin
 bound:=app.claim_remote_web(p_job_id,p_actor_id);
 if bound->>'state' is distinct from 'SUCCEEDED' then raise exception 'REMOTE_NOT_SUCCEEDED'; end if;
 select * into previous from app.web_remote_gallery_checkpoints where job_id=p_job_id;
 if p_images is null then
  return jsonb_build_object('version',coalesce(previous.version,0),'images',previous.images);
 end if;
 if p_expected_version is distinct from coalesce(previous.version,0) then raise exception 'GALLERY_CHECKPOINT_CHANGED'; end if;
 if jsonb_typeof(p_images) is distinct from 'array' then raise exception 'GALLERY_INVALID'; end if;
 if jsonb_array_length(p_images) not between 1 and 20 or p_remote_revision is null or p_remote_revision !~ '^[a-f0-9]{64}$'
 or exists(select 1 from jsonb_array_elements(p_images) i where jsonb_typeof(i->'sha256') is distinct from 'string'
  or (i->>'sha256') !~ '^[a-f0-9]{64}$' or jsonb_typeof(i->'alt') is distinct from 'string' or length(i->>'alt')>500)
 or (select count(distinct i->>'sha256') from jsonb_array_elements(p_images) i)<>jsonb_array_length(p_images)
 then raise exception 'GALLERY_INVALID'; end if;
 select * into draft from app.web_product_drafts where product_id=(bound#>>'{packet,product_id}')::uuid for update;
 if not found or draft.revision is distinct from p_draft_revision or draft.content->'images' is distinct from p_local_images
 then raise exception 'GALLERY_DRAFT_CHANGED'; end if;
 if jsonb_array_length(p_images)<>jsonb_array_length(p_local_images) or exists(
  select 1 from jsonb_array_elements(p_images) with ordinality i(value,n)
   join jsonb_array_elements(p_local_images) with ordinality l(value,n) using(n)
   where i.value->>'alt' is distinct from l.value->>'alt'
 ) then raise exception 'GALLERY_INVALID'; end if;
 -- Exact retries do not create new versions. Job lock serializes competing checkpoints.
 if previous.images=p_images and previous.remote_revision=p_remote_revision then
  return jsonb_build_object('version',previous.version,'images',previous.images);
 end if;
 insert into app.web_remote_gallery_checkpoints(job_id,version,images,remote_revision)
 values(p_job_id,coalesce(previous.version,0)+1,p_images,p_remote_revision)
 on conflict(job_id) do update set version=excluded.version,images=excluded.images,remote_revision=excluded.remote_revision,updated_at=now()
 returning * into result;
 return jsonb_build_object('version',result.version,'images',result.images);
end $$;
revoke all on function app.remote_gallery_checkpoint(uuid,uuid,integer,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function app.remote_gallery_checkpoint(uuid,uuid,integer,integer,jsonb,jsonb,text) to service_role;
create function public.remote_gallery_checkpoint(p_job_id uuid,p_actor_id uuid,p_expected_version integer default null,
 p_draft_revision integer default null,p_local_images jsonb default null,p_images jsonb default null,p_remote_revision text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select app.remote_gallery_checkpoint(p_job_id,p_actor_id,p_expected_version,p_draft_revision,p_local_images,p_images,p_remote_revision)
$$;
revoke all on function public.remote_gallery_checkpoint(uuid,uuid,integer,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.remote_gallery_checkpoint(uuid,uuid,integer,integer,jsonb,jsonb,text) to service_role;
commit;
