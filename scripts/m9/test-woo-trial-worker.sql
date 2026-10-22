-- Protocol/state tests only: no remote writes, all fixture rows roll back.
begin;
set local statement_timeout='30s';
create temporary table worker_test_results(result jsonb) on commit drop;
create function pg_temp.expect_worker(action text, input jsonb, wanted text) returns void language plpgsql as $$
declare caught boolean:=false;
begin
 begin perform public.m9_woo_worker(action,input);
 exception when others then if sqlerrm<>wanted then raise exception 'EXPECTED %, GOT %',wanted,sqlerrm;end if;caught:=true;end;
 if not caught then raise exception 'MISSING_REJECTION %',wanted;end if;
end $$;
do $$
declare actor uuid:='2b5e4ba1-00f2-48c7-bbe0-273340629711';wid uuid:=gen_random_uuid();tid uuid:=gen_random_uuid();
 parent uuid:='97c82026-b3cc-4c60-8f22-13d7c00fb33a';i jsonb;c jsonb;f jsonb;oldf jsonb;r jsonb;checks integer:=0;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 i:=jsonb_build_object('id',tid,'actor_id',actor,'parent_id',parent);
 perform pg_temp.expect_worker('ENQUEUE',i,'WORKER_WINDOW_REQUIRED');checks:=checks+1;
 update app.m9_woo_worker_control set enabled=true,actor_id=actor,window_id=wid,expires_at=clock_timestamp()+interval '10 minutes' where singleton;
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 perform pg_temp.expect_worker('ENQUEUE',i,'WORKER_SERVER_ONLY');checks:=checks+1;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.expect_worker('ENQUEUE',jsonb_set(i,'{actor_id}','"00000000-0000-0000-0000-000000000001"'),'NOT_AUTHORIZED');checks:=checks+1;
 perform pg_temp.expect_worker('ENQUEUE',jsonb_set(i,'{parent_id}',to_jsonb(gen_random_uuid())),'WORKER_FAMILY_ONLY');checks:=checks+1;
 perform pg_temp.expect_worker('ENQUEUE',i||'{"quantity":99}','WORKER_INPUT_INVALID');checks:=checks+1;
 r:=public.m9_woo_worker('ENQUEUE',i);
 if r->>'state'<>'READY' or public.m9_woo_worker('ENQUEUE',i)->>'replayed'<>'true' then raise exception 'WORKER_ENQUEUE_REPLAY_FAILED';end if;
 perform pg_temp.expect_worker('ENQUEUE',jsonb_set(i,'{parent_id}','"ba239bba-7691-43cc-9c76-8768a1af9f21"'),'WORKER_REQUEST_CHANGED');checks:=checks+1;
 c:=public.m9_woo_worker('CLAIM','{}');f:=jsonb_build_object('id',tid,'lease_token',c->'lease_token');
 if c->>'id'<>tid::text or public.m9_woo_worker('CLAIM','{}')<>'{}'::jsonb then raise exception 'WORKER_DOUBLE_CLAIM';end if;
 perform pg_temp.expect_worker('CHECK',jsonb_set(f,'{lease_token}',to_jsonb(gen_random_uuid())),'WORKER_LEASE_LOST');checks:=checks+1;
 perform pg_temp.expect_worker('COMPLETE',f,'WORKER_ORDER_NOT_VERIFIED');checks:=checks+1;
 perform pg_temp.expect_worker('CHECK',f||'{"phase":"AVAILABILITY"}','WORKER_INPUT_INVALID');checks:=checks+1;
 oldf:=f;
 update app.m9_woo_worker_jobs set lease_until=clock_timestamp()-interval '1 second' where id=tid;
 perform pg_temp.expect_worker('CHECK',f,'WORKER_LEASE_LOST');checks:=checks+1;
 c:=public.m9_woo_worker('CLAIM','{}');f:=jsonb_build_object('id',tid,'lease_token',c->'lease_token');
 if c->'lease_token'=oldf->'lease_token' or c->>'attempt'<>'2' then raise exception 'WORKER_FENCE_NOT_ROTATED';end if;
 perform pg_temp.expect_worker('FAIL',oldf||'{"code":"TRIAL_HTTP_503"}','WORKER_LEASE_LOST');checks:=checks+1;
 r:=public.m9_woo_worker('FAIL',f||'{"code":"TRIAL_HTTP_503"}');
 if r->>'state'<>'RETRY' or public.m9_woo_worker('CLAIM','{}')<>'{}'::jsonb then raise exception 'WORKER_BACKOFF_MISSING';end if;
 update app.m9_woo_worker_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=tid;
 c:=public.m9_woo_worker('CLAIM','{}');f:=jsonb_build_object('id',tid,'lease_token',c->'lease_token');
 if c->>'attempt'<>'3' or public.m9_woo_worker('FAIL',f||'{"code":"TRIAL_HTTP_503"}')->>'state'<>'REVIEW' then raise exception 'WORKER_RETRY_CAP_MISSING';end if;
 if public.m9_woo_worker('CLAIM','{}')<>'{}'::jsonb then raise exception 'WORKER_REVIEW_RECLAIMED';end if;
 -- Both phases may finish only against durable, previously accepted receipts.
 tid:='fa7c3585-be58-45af-94f7-ee4839f06b03';i:=jsonb_set(i,'{id}',to_jsonb(tid));
 perform public.m9_woo_worker('ENQUEUE',i);c:=public.m9_woo_worker('CLAIM','{}');f:=jsonb_build_object('id',tid,'lease_token',c->'lease_token');
 if public.m9_woo_worker('COMPLETE',f)->>'phase'<>'AVAILABILITY' then raise exception 'WORKER_PHASE_NOT_PERSISTED';end if;
 perform pg_temp.expect_worker('COMPLETE',f,'WORKER_LEASE_LOST');checks:=checks+1;
 c:=public.m9_woo_worker('CLAIM','{}');f:=jsonb_build_object('id',tid,'lease_token',c->'lease_token');
 if public.m9_woo_worker('COMPLETE',f)->>'state'<>'DONE' then raise exception 'WORKER_DONE_FAILED';end if;
 if public.m9_woo_worker('ENQUEUE',i)->>'state'<>'DONE' then raise exception 'WORKER_DONE_REOPENED';end if;
 -- A fresh uncertain request never gets a transient retry.
 tid:=gen_random_uuid();i:=jsonb_set(i,'{id}',to_jsonb(tid));perform public.m9_woo_worker('ENQUEUE',i);
 c:=public.m9_woo_worker('CLAIM','{}');f:=jsonb_build_object('id',tid,'lease_token',c->'lease_token');
 if public.m9_woo_worker('FAIL',f||'{"code":"TRIAL_CREATION_UNCERTAIN"}')->>'state'<>'REVIEW' then raise exception 'WORKER_AMBIGUITY_RETRIED';end if;
 -- Closing a window revokes even an otherwise valid live lease.
 tid:=gen_random_uuid();i:=jsonb_set(i,'{id}',to_jsonb(tid));perform public.m9_woo_worker('ENQUEUE',i);
 c:=public.m9_woo_worker('CLAIM','{}');f:=jsonb_build_object('id',tid,'lease_token',c->'lease_token');
 update app.m9_woo_worker_control set expires_at=clock_timestamp()-interval '1 second' where singleton;
 perform pg_temp.expect_worker('CHECK',f,'WORKER_WINDOW_REQUIRED');checks:=checks+1;
 if app.m9_woo_worker_tick() is not null then raise exception 'WORKER_TICK_WHILE_EXPIRED';end if;
 update app.m9_woo_worker_control set enabled=false,actor_id=null,window_id=null,expires_at=null where singleton;
 if app.m9_woo_worker_tick() is not null then raise exception 'WORKER_TICK_WHILE_DISABLED';end if;
 if has_function_privilege('anon','public.m9_woo_worker(text,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.m9_woo_worker(text,jsonb)','EXECUTE')
  or has_function_privilege('service_role','app.m9_woo_worker_tick()','EXECUTE')
  or has_table_privilege('authenticated','app.m9_woo_worker_jobs','SELECT') then raise exception 'WORKER_PRIVILEGE_LEAK';end if;
 insert into worker_test_results values(jsonb_build_object('negative_checks',checks,'claim_exclusion',true,'fenced_expiry_recovery',true,
  'bounded_retries',true,'backoff',true,'uncertain_requires_review',true,'two_phase_verified',true,'idempotent_enqueue',true,
  'inactive_tick_no_network',true,'real_remote_write',false));
end $$;
select result from worker_test_results;
rollback;
