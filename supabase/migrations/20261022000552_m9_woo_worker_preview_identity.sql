begin;
select app.assert_sicar_staging_enabled();
alter table app.m9_woo_worker_control add column identity_expires_at timestamptz;
-- Structural checks here prevent accidental cross-project/environment forwarding.
-- This is NOT a JWT authenticator: only service_role may register the platform token;
-- Vercel verifies its signature at the receiving Preview boundary.
create function public.m9_woo_worker_identity(p_token text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare c app.m9_woo_worker_control; claims jsonb; segment text; expiry timestamptz; sid uuid;
begin
 perform app.assert_sicar_staging_enabled();
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role'
  then raise exception 'WORKER_SERVER_ONLY' using errcode='42501';end if;
 c:=app.m9_woo_worker_window();
 begin
  if p_token is null or length(p_token)>8000 or p_token !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then raise exception 'INVALID';end if;
  segment:=split_part(p_token,'.',2);
  claims:=convert_from(decode(rpad(translate(segment,'-_','+/'),((length(segment)+3)/4)*4,'='),'base64'),'UTF8')::jsonb;
  expiry:=to_timestamp((claims->>'exp')::double precision);
  if claims->>'iss' is distinct from 'https://oidc.vercel.com/procesa-lab'
   or claims->>'aud' is distinct from 'https://vercel.com/procesa-lab'
   or claims->>'sub' is distinct from 'owner:procesa-lab:project:vaquero-hub:environment:preview'
   or claims->>'owner_id' is distinct from 'team_eaH3A7qiH8HLO3AfbC7hzGZj'
   or claims->>'project_id' is distinct from 'prj_IDfkoWQU7qbEYbWJyZOufRw70qNP'
   or claims->>'environment' is distinct from 'preview' or expiry is null
   or expiry<clock_timestamp()+interval '3 minutes' or expiry>clock_timestamp()+interval '2 hours 1 minute'
   or to_timestamp((claims->>'nbf')::double precision)>clock_timestamp()+interval '5 seconds'
   then raise exception 'INVALID';end if;
 exception when others then raise exception 'WORKER_IDENTITY_INVALID';end;
 select id into sid from vault.secrets where name='m9_woo_worker_preview_identity';
 if sid is null then perform vault.create_secret(p_token,'m9_woo_worker_preview_identity','Ephemeral same-project Preview OIDC; wipe at QA end');
 else perform vault.update_secret(sid,p_token);end if;
 expiry:=least(expiry,c.expires_at);
 update app.m9_woo_worker_control set identity_expires_at=expiry where singleton;
 return jsonb_build_object('ready',true,'expires_at',expiry);
end $$;
revoke all on function public.m9_woo_worker_identity(text) from public,anon,authenticated;
grant execute on function public.m9_woo_worker_identity(text) to service_role;

create or replace function app.m9_woo_worker_tick() returns bigint
 language plpgsql security invoker set search_path='' as $$
declare c app.m9_woo_worker_control; secret text; identity text;
begin
 perform app.assert_sicar_staging_enabled();
 select * into strict c from app.m9_woo_worker_control where singleton;
 if not c.enabled or c.expires_at<=clock_timestamp() or c.expires_at>clock_timestamp()+interval '20 minutes'
  or c.identity_expires_at is null or c.identity_expires_at<=clock_timestamp()+interval '120 seconds'
  or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=c.actor_id and u.is_active and r.code='ADMIN')
  or not exists(select 1 from app.m9_woo_worker_jobs where window_id=c.window_id and
   ((state in ('READY','RETRY') and next_attempt_at<=clock_timestamp()) or (state='RUNNING' and lease_until<=clock_timestamp())))
  then return null;end if;
 select decrypted_secret into strict secret from vault.decrypted_secrets where name='m9_woo_worker_preview_token';
 select decrypted_secret into strict identity from vault.decrypted_secrets where name='m9_woo_worker_preview_identity';
 return net.http_post(url:='https://vaquero-hub-git-codex-m9-staging-review-procesa-lab.vercel.app/api/m9/woo-worker',
  body:='{}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret,
   'x-vercel-trusted-oidc-idp-token',identity),timeout_milliseconds:=100000);
end $$;
revoke all on function app.m9_woo_worker_tick() from public,anon,authenticated,service_role;
commit;
