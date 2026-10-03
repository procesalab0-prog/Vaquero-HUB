-- Run on the staging laboratory baseline in BEGIN / ROLLBACK.
do $test$
declare pid uuid; old app.web_lab_jobs; actor uuid; d jsonb; j jsonb; claim jsonb; req uuid:=gen_random_uuid(); receipt jsonb; n int:=0;
begin
 select * into strict old from app.web_lab_jobs q where q.state='SUCCEEDED' and q.packet->>'mode'='create' and q.receipt->>'local_product_id'='18';
 pid:=old.product_id; actor:=old.actor_id;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 d:=app.read_web_draft(pid,null);
 begin perform app.enqueue_web_lab(pid,(d->>'revision')::int,d->>'fingerprint',req); raise exception 'TEST_REPEAT_REVISION'; exception when raise_exception then if sqlerrm<>'LAB_REVISION_ALREADY_SENT' then raise; end if; end; n:=n+1;
 perform app.save_web_draft(pid,jsonb_set(d->'content','{name}','"SQL rollback test only"'),(d->>'revision')::int,d->>'fingerprint',gen_random_uuid());
 j:=app.enqueue_web_lab(pid,(d->>'revision')::int+1,d->>'fingerprint',req);
 claim:=app.claim_web_lab((j#>>'{job,id}')::uuid);
 if claim#>>'{packet,mode}'<>'update' or claim#>>'{packet,previous,receipt,local_product_id}'<>'18' then raise exception 'TEST_PREVIOUS_TARGET'; end if; n:=n+1;
 if (select count(*) from app.web_lab_jobs where product_id=pid)<>2 then raise exception 'TEST_HISTORY'; end if; n:=n+1;
 begin perform app.enqueue_web_lab(pid,(d->>'revision')::int+1,d->>'fingerprint',gen_random_uuid()); raise exception 'TEST_ACTIVE_DUPLICATE'; exception when raise_exception then if sqlerrm<>'LAB_ALREADY_REQUESTED' then raise; end if; end; n:=n+1;
 receipt:=old.receipt||'{"local_product_id":999}';
 begin perform app.finish_web_lab((claim->>'id')::uuid,(claim->>'claim_id')::uuid,receipt); raise exception 'TEST_TARGET_CHANGED'; exception when raise_exception then if sqlerrm<>'LAB_TARGET_CHANGED' then raise; end if; end; n:=n+1;
 receipt:=old.receipt||jsonb_build_object('evidence_sha256',repeat('2',64));
 j:=app.finish_web_lab((claim->>'id')::uuid,(claim->>'claim_id')::uuid,receipt);
 if j->>'state'<>'SUCCEEDED' then raise exception 'TEST_UPDATE_SUCCESS'; end if; n:=n+1;
 j:=app.read_web_lab(pid);
 if j->>'local_product_id'<>'18' or (j->>'last_verified_revision')::int<>(d->>'revision')::int+1 then raise exception 'TEST_VISIBLE_RESULT'; end if; n:=n+1;
 if exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(role) where has_table_privilege(role,'app.web_lab_jobs','SELECT') or has_function_privilege(role,'app.claim_web_lab(uuid)','EXECUTE')) then raise exception 'TEST_PRIVATE'; end if; n:=n+1;
 if n<>8 then raise exception 'TEST_COUNT_%',n; end if;
end $test$;
select 8 as checks_passed;
