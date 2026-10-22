-- Structural tests of a service-only handoff; fake JWTs are NOT authentication.
-- Vercel signature verification is accepted only through the real scheduled request.
begin;
create temporary table identity_test_results(result jsonb) on commit drop;
create function pg_temp.identity_fixture(c jsonb) returns text language sql immutable as $$
 select 'eyJhbGciOiJSUzI1NiJ9.'||rtrim(translate(replace(encode(convert_to(c::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=')||'.fixture'
$$;
do $$
declare c jsonb;bad jsonb;k text;t text;n integer:=0;caught boolean;sid uuid;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 if exists(select 1 from app.m9_woo_worker_control where enabled) then raise exception 'WORKER_QA_MUST_BE_CLOSED';end if;
 update app.m9_woo_worker_control set enabled=true,actor_id='2b5e4ba1-00f2-48c7-bbe0-273340629711',window_id=gen_random_uuid(),expires_at=clock_timestamp()+interval '10 minutes' where singleton;
 c:=jsonb_build_object('iss','https://oidc.vercel.com/procesa-lab','aud','https://vercel.com/procesa-lab',
  'sub','owner:procesa-lab:project:vaquero-hub:environment:preview','owner_id','team_eaH3A7qiH8HLO3AfbC7hzGZj',
  'project_id','prj_IDfkoWQU7qbEYbWJyZOufRw70qNP','environment','preview',
  'exp',extract(epoch from clock_timestamp()+interval '1 hour'),'nbf',extract(epoch from clock_timestamp()-interval '1 minute'));
 foreach k in array array['iss','aud','sub','owner_id','project_id','environment','exp','missing_exp','nbf','malformed','role'] loop
  bad:=c;
  case k
   when 'exp' then bad:=jsonb_set(bad,'{exp}',to_jsonb(extract(epoch from clock_timestamp()-interval '1 second')));
   when 'missing_exp' then bad:=bad-'exp';
   when 'nbf' then bad:=jsonb_set(bad,'{nbf}',to_jsonb(extract(epoch from clock_timestamp()+interval '1 minute')));
   when 'role' then perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
   when 'malformed' then null;
   else bad:=jsonb_set(bad,array[k],'"another-project-production"');
  end case;
  t:=case when k='malformed' then 'not_a_token' else pg_temp.identity_fixture(bad) end;caught:=false;
  begin perform public.m9_woo_worker_identity(t);
  exception when others then if sqlerrm<>(case when k='role' then 'WORKER_SERVER_ONLY' else 'WORKER_IDENTITY_INVALID' end) then raise;end if;caught:=true;end;
  if not caught then raise exception 'IDENTITY_REJECTION_MISSING %',k;end if;n:=n+1;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 end loop;
 if public.m9_woo_worker_identity(pg_temp.identity_fixture(c))->>'ready'<>'true' then raise exception 'IDENTITY_NOT_READY';end if;
 select id into strict sid from vault.secrets where name='m9_woo_worker_preview_identity';
 perform public.m9_woo_worker_identity(pg_temp.identity_fixture(c));
 if (select count(*) from vault.secrets where name='m9_woo_worker_preview_identity')<>1 or sid is distinct from
  (select id from vault.secrets where name='m9_woo_worker_preview_identity') then raise exception 'IDENTITY_ROTATION_DUPLICATED';end if;
 if exists(select 1 from app.m9_woo_worker_control where identity_expires_at>expires_at) then raise exception 'IDENTITY_OUTLIVES_WINDOW';end if;
 update app.m9_woo_worker_control set identity_expires_at=clock_timestamp()-interval '1 second' where singleton;
 if app.m9_woo_worker_tick() is not null then raise exception 'IDENTITY_EXPIRED_REQUEST_SENT';end if;
 if has_function_privilege('authenticated','public.m9_woo_worker_identity(text)','EXECUTE') or
 has_function_privilege('anon','public.m9_woo_worker_identity(text)','EXECUTE') then raise exception 'IDENTITY_API_LEAK';end if;
 insert into identity_test_results values(jsonb_build_object('negative_checks',n,'encrypted_rotation_same_id',true,'capped_to_window',true,'expired_no_network',true,'real_oidc_authentication',false));
end $$;
select result from identity_test_results;
rollback;
