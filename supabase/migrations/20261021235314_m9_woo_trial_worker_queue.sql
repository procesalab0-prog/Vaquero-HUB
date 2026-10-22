begin;
-- Deliberately refuses to install in a production database.
select app.assert_sicar_staging_enabled();
create extension if not exists pg_cron with schema pg_catalog;
create table app.m9_woo_worker_control (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 actor_id uuid references public.app_users(id), window_id uuid, expires_at timestamptz,
 check((not enabled and actor_id is null and window_id is null and expires_at is null)
  or (enabled and actor_id is not null and window_id is not null and expires_at is not null))
);
insert into app.m9_woo_worker_control(singleton) values(true);
create table app.m9_woo_worker_jobs (
 id uuid primary key, actor_id uuid not null references public.app_users(id),
 parent_id uuid not null references app.web_remote_jobs(id), window_id uuid not null,
 phase text not null default 'ORDER' check(phase in ('ORDER','AVAILABILITY','COMPLETE')),
 state text not null default 'READY' check(state in ('READY','RUNNING','RETRY','REVIEW','DONE')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 claims integer not null default 0 check(claims>=0), lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default clock_timestamp(), last_error text,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check((state='RUNNING' and lease_token is not null and lease_until is not null)
  or (state<>'RUNNING' and lease_token is null and lease_until is null)),
 check((state='DONE')=(phase='COMPLETE')),
 check(last_error is null or last_error ~ '^[A-Z][A-Z0-9_]{4,79}$')
);
create index m9_woo_worker_due on app.m9_woo_worker_jobs(window_id,state,next_attempt_at);
create table app.m9_woo_worker_events (
 id bigint generated always as identity primary key,
 job_id uuid not null references app.m9_woo_worker_jobs(id),
 event text not null check(event in ('ENQUEUE','CLAIM','ADVANCE','RETRY','REVIEW','DONE')),
 phase text not null, attempt integer not null, code text,
 occurred_at timestamptz not null default clock_timestamp()
);
alter table app.m9_woo_worker_control enable row level security;
alter table app.m9_woo_worker_jobs enable row level security;
alter table app.m9_woo_worker_events enable row level security;
revoke all on app.m9_woo_worker_control,app.m9_woo_worker_jobs,app.m9_woo_worker_events from public,anon,authenticated,service_role;
revoke all on sequence app.m9_woo_worker_events_id_seq from public,anon,authenticated,service_role;
create trigger m9_woo_worker_events_immutable before update or delete on app.m9_woo_worker_events
 for each row execute function app.m9_woo_pilot_immutable();

create function app.m9_woo_worker_window() returns app.m9_woo_worker_control
 language plpgsql security invoker set search_path='' as $$
declare c app.m9_woo_worker_control;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict c from app.m9_woo_worker_control where singleton for update;
 if not c.enabled or c.expires_at<=clock_timestamp() or c.expires_at>clock_timestamp()+interval '20 minutes'
  then raise exception 'WORKER_WINDOW_REQUIRED';end if;
 if not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id
  where u.id=c.actor_id and u.is_active and r.code='ADMIN') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 return c;
end $$;
revoke all on function app.m9_woo_worker_window() from public,anon,authenticated,service_role;

-- Service-only state machine. Fenced tokens authorize one phase of one fixed trial.
create function public.m9_woo_worker(p_action text,p_input jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare c app.m9_woo_worker_control; j app.m9_woo_worker_jobs;
 actor uuid; tid uuid; parent uuid; tok uuid; code text; transient boolean; ev text;
begin
 perform app.assert_sicar_staging_enabled();
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
  then raise exception 'WORKER_SERVER_ONLY' using errcode='42501';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1000 then raise exception 'WORKER_INPUT_INVALID';end if;
 c:=app.m9_woo_worker_window();
 if p_action='ENQUEUE' then
  if (select array_agg(k order by k) from jsonb_object_keys(p_input) k) is distinct from array['actor_id','id','parent_id']::text[] then raise exception 'WORKER_INPUT_INVALID';end if;
  actor:=(p_input->>'actor_id')::uuid;tid:=(p_input->>'id')::uuid;parent:=(p_input->>'parent_id')::uuid;
  if actor is distinct from c.actor_id then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  if tid is null or parent is null then raise exception 'WORKER_INPUT_INVALID';end if;
  select * into j from app.m9_woo_worker_jobs where id=tid for update;
  if j.id is not null then
   if j.actor_id is distinct from actor or j.parent_id is distinct from parent then raise exception 'WORKER_REQUEST_CHANGED';end if;
   return jsonb_build_object('id',j.id,'state',j.state,'phase',j.phase,'replayed',true);
  end if;
  if parent not in ('97c82026-b3cc-4c60-8f22-13d7c00fb33a'::uuid,'ba239bba-7691-43cc-9c76-8768a1af9f21'::uuid)
   or not exists(select 1 from app.web_remote_jobs where id=parent and actor_id=actor and state='SUCCEEDED') then raise exception 'WORKER_FAMILY_ONLY';end if;
  if exists(select 1 from app.m9_woo_connected_trials where id=tid and (actor_id<>actor or parent_id<>parent)) then raise exception 'WORKER_REQUEST_CHANGED';end if;
  if (select count(*) from app.m9_woo_worker_jobs where window_id=c.window_id)>=5 then raise exception 'WORKER_WINDOW_LIMIT';end if;
  insert into app.m9_woo_worker_jobs(id,actor_id,parent_id,window_id) values(tid,actor,parent,c.window_id);
  insert into app.m9_woo_worker_events(job_id,event,phase,attempt) values(tid,'ENQUEUE','ORDER',0);
  return jsonb_build_object('id',tid,'state','READY','phase','ORDER','replayed',false);
 elsif p_action='CLAIM' then
  if p_input<>'{}'::jsonb then raise exception 'WORKER_INPUT_INVALID';end if;
  -- One live worker for this window, including invocations overlapping a cron tick.
  if exists(select 1 from app.m9_woo_worker_jobs where state='RUNNING' and window_id=c.window_id and lease_until>clock_timestamp()) then return '{}'::jsonb;end if;
  select * into j from app.m9_woo_worker_jobs where window_id=c.window_id and actor_id=c.actor_id
   and ((state in ('READY','RETRY') and next_attempt_at<=clock_timestamp()) or (state='RUNNING' and lease_until<=clock_timestamp()))
   order by next_attempt_at,created_at,id for update skip locked limit 1;
  if j.id is null then return '{}'::jsonb;end if;
  if j.attempts>=3 then
   update app.m9_woo_worker_jobs set state='REVIEW',lease_token=null,lease_until=null,last_error='WORKER_RETRIES_EXHAUSTED',updated_at=clock_timestamp() where id=j.id;
   insert into app.m9_woo_worker_events(job_id,event,phase,attempt,code) values(j.id,'REVIEW',j.phase,j.attempts,'WORKER_RETRIES_EXHAUSTED');
   return '{}'::jsonb;
  end if;
  update app.m9_woo_worker_jobs set state='RUNNING',attempts=attempts+1,claims=claims+1,lease_token=gen_random_uuid(),
   lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() where id=j.id returning * into j;
  insert into app.m9_woo_worker_events(job_id,event,phase,attempt) values(j.id,'CLAIM',j.phase,j.attempts);
  return jsonb_build_object('id',j.id,'actor_id',j.actor_id,'parent_id',j.parent_id,'phase',j.phase,'lease_token',j.lease_token,'attempt',j.attempts);
 end if;
 if p_action not in ('CHECK','COMPLETE','FAIL') or p_action is null then raise exception 'WORKER_ACTION_INVALID';end if;
 if (select array_agg(k order by k) from jsonb_object_keys(p_input) k) is distinct from
  (case when p_action='FAIL' then array['code','id','lease_token']::text[] else array['id','lease_token']::text[] end) then raise exception 'WORKER_INPUT_INVALID';end if;
 tid:=(p_input->>'id')::uuid;tok:=(p_input->>'lease_token')::uuid;
 select * into j from app.m9_woo_worker_jobs where id=tid for update;
 if j.id is null or j.state<>'RUNNING' or j.window_id<>c.window_id or j.actor_id<>c.actor_id
  or tok is null or j.lease_token is distinct from tok or j.lease_until<=clock_timestamp() then raise exception 'WORKER_LEASE_LOST';end if;
 if p_action='CHECK' then return jsonb_build_object('ok',true,'phase',j.phase);end if;
 if p_action='COMPLETE' then
  if j.phase='ORDER' then
   if not exists(select 1 from app.m9_woo_connected_trials t where t.id=j.id and t.actor_id=j.actor_id and t.parent_id=j.parent_id and t.state='VERIFIED'
    and t.result->'availability_capture_rollback'='true'::jsonb) then raise exception 'WORKER_ORDER_NOT_VERIFIED';end if;
   update app.m9_woo_worker_jobs set phase='AVAILABILITY',state='READY',attempts=0,last_error=null,lease_token=null,lease_until=null,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
   ev:='ADVANCE';
  else
   if not exists(select 1 from app.m9_remote_availability_trials t where t.id=j.id and t.actor_id=j.actor_id and t.state='VERIFIED'
    and t.receipt->'restored'='true'::jsonb) then raise exception 'WORKER_AVAILABILITY_NOT_VERIFIED';end if;
   update app.m9_woo_worker_jobs set phase='COMPLETE',state='DONE',last_error=null,lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
   ev:='DONE';
  end if;
  insert into app.m9_woo_worker_events(job_id,event,phase,attempt) values(j.id,ev,j.phase,j.attempts);
 else
  code:=p_input->>'code';
  if code is null or code !~ '^[A-Z][A-Z0-9_]{4,79}$' then raise exception 'WORKER_INPUT_INVALID';end if;
  -- Conservative allowlist: ambiguity, changed identity and HTTP409 never retry writes.
  transient:=code in ('WORKER_NETWORK_TIMEOUT','TRIAL_HTTP_408','TRIAL_HTTP_429','TRIAL_HTTP_500','TRIAL_HTTP_502','TRIAL_HTTP_503','TRIAL_HTTP_504','WORKER_DATABASE_UNAVAILABLE');
  ev:=case when transient and j.attempts<3 then 'RETRY' else 'REVIEW' end;
  update app.m9_woo_worker_jobs set state=ev,last_error=code,lease_token=null,lease_until=null,
   next_attempt_at=clock_timestamp()+make_interval(secs=>30*power(2,j.attempts-1)::integer),updated_at=clock_timestamp() where id=j.id;
  insert into app.m9_woo_worker_events(job_id,event,phase,attempt,code) values(j.id,ev,j.phase,j.attempts,code);
 end if;
 select * into strict j from app.m9_woo_worker_jobs where id=tid;
 return jsonb_build_object('id',j.id,'state',j.state,'phase',j.phase);
end $$;
revoke all on function public.m9_woo_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.m9_woo_worker(text,jsonb) to service_role;

create function public.m9_woo_worker_status() returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.current_user_id();
begin
 perform app.assert_sicar_staging_enabled();
 if actor is null or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 return jsonb_build_object('window_open',exists(select 1 from app.m9_woo_worker_control where singleton and enabled and actor_id=actor and expires_at>clock_timestamp()),
  'jobs',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from
   (select id,parent_id,state,phase,attempts,claims,last_error,next_attempt_at,created_at,updated_at from app.m9_woo_worker_jobs where actor_id=actor order by created_at desc limit 20) x));
end $$;
revoke all on function public.m9_woo_worker_status() from public,anon,service_role;
grant execute on function public.m9_woo_worker_status() to authenticated;

-- No schedule or secret is installed by the migration. Operator opens a bounded QA window.
create function app.m9_woo_worker_tick() returns bigint
 language plpgsql security invoker set search_path='' as $$
declare c app.m9_woo_worker_control; secret text;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict c from app.m9_woo_worker_control where singleton;
 if not c.enabled or c.expires_at<=clock_timestamp() or c.expires_at>clock_timestamp()+interval '20 minutes'
  or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=c.actor_id and u.is_active and r.code='ADMIN')
  or not exists(select 1 from app.m9_woo_worker_jobs where window_id=c.window_id and
   ((state in ('READY','RETRY') and next_attempt_at<=clock_timestamp()) or (state='RUNNING' and lease_until<=clock_timestamp())))
  then return null;end if;
 select decrypted_secret into strict secret from vault.decrypted_secrets where name='m9_woo_worker_preview_token';
 return net.http_post(url:='https://vaquero-hub-git-codex-m9-staging-review-procesa-lab.vercel.app/api/m9/woo-worker',
  body:='{}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),timeout_milliseconds:=100000);
end $$;
revoke all on function app.m9_woo_worker_tick() from public,anon,authenticated,service_role;
commit;
