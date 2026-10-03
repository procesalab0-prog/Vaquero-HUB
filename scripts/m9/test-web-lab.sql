-- Run on staging inside BEGIN / ROLLBACK; never retains the artificial draft/job.
do $test$
declare pid uuid; actor uuid; d jsonb; j jsonb; claim jsonb; receipt jsonb; req uuid:=gen_random_uuid(); jid uuid; n int:=0;
begin
 select product_id into strict pid from app.web_content_sources where snapshot->>'woo_product_id'='19771';
 select updated_by into strict actor from app.web_product_drafts limit 1;
 if exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(role) where
  has_table_privilege(role,'app.web_lab_jobs','SELECT') or has_table_privilege(role,'app.web_lab_enabled_products','UPDATE') or
  has_function_privilege(role,'app.claim_web_lab(uuid)','EXECUTE') or
  has_function_privilege(role,'app.finish_web_lab(uuid,uuid,jsonb)','EXECUTE') or
  has_function_privilege(role,'app.web_lab_packet(uuid)','EXECUTE')) then raise exception 'TEST_PRIVATE_ACCESS'; end if;
 n:=n+1;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform app.read_web_lab(pid); raise exception 'TEST_ANON'; exception when insufficient_privilege then null; end;
 n:=n+1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 d:=app.read_web_draft(pid,null);
 begin perform app.enqueue_web_lab(pid,0,d->>'fingerprint',req); raise exception 'TEST_DISABLED'; exception when raise_exception then if sqlerrm<>'LAB_NOT_ENABLED' then raise; end if; end;
 n:=n+1;
 insert into app.web_lab_enabled_products(product_id,source_fingerprint,enabled,store_id)
 select pid,md5(snapshot::text),true,'m9-local-2026-10-02' from app.web_content_sources where product_id=pid;
 begin perform app.web_lab_packet(pid); raise exception 'TEST_UNSAVED'; exception when raise_exception then if sqlerrm<>'LAB_SAVE_REQUIRED' then raise; end if; end;
 n:=n+1;
 perform app.save_web_draft(pid,d->'content',0,d->>'fingerprint',gen_random_uuid());
 begin perform app.enqueue_web_lab(pid,9,d->>'fingerprint',req); raise exception 'TEST_STALE'; exception when raise_exception then if sqlerrm<>'LAB_SAVED_VERSION_CHANGED' then raise; end if; end;
 n:=n+1;
 j:=app.enqueue_web_lab(pid,1,d->>'fingerprint',req); jid:=(j#>>'{job,id}')::uuid;
 if j#>>'{job,state}'<>'READY' or jid is null then raise exception 'TEST_READY'; end if;
 if app.enqueue_web_lab(pid,1,d->>'fingerprint',req)<>j then raise exception 'TEST_REPEAT'; end if;
 n:=n+2;
 begin perform app.enqueue_web_lab(pid,2,d->>'fingerprint',req); raise exception 'TEST_REUSED'; exception when raise_exception then if sqlerrm<>'LAB_REQUEST_REUSED' then raise; end if; end;
 n:=n+1;
 begin perform app.enqueue_web_lab(pid,1,d->>'fingerprint',gen_random_uuid()); raise exception 'TEST_DUPLICATE'; exception when raise_exception then if sqlerrm<>'LAB_ALREADY_REQUESTED' then raise; end if; end;
 n:=n+1;
 begin
  update app.web_product_drafts set revision=revision+1 where product_id=pid;
  if app.claim_web_lab(jid)->>'state'<>'SUPERSEDED' then raise exception 'TEST_CHANGED_DISPATCH'; end if;
  n:=n+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 claim:=app.claim_web_lab(jid);
 if claim->>'state'<>'RUNNING' then raise exception 'TEST_CLAIM'; end if;
 n:=n+1;
 begin perform app.claim_web_lab(jid); raise exception 'TEST_DOUBLE_CLAIM'; exception when raise_exception then if sqlerrm<>'LAB_NOT_READY' then raise; end if; end;
 n:=n+1;
 receipt:=jsonb_build_object('state','SUCCEEDED','store_id','m9-local-2026-10-02','local_product_id',999,'variant_id',claim#>>'{packet,catalog,variants,0,id}','evidence_sha256',repeat('1',64));
 begin perform app.finish_web_lab(jid,gen_random_uuid(),receipt); raise exception 'TEST_BAD_CLAIM'; exception when raise_exception then if sqlerrm<>'LAB_CLAIM_MISMATCH' then raise; end if; end;
 n:=n+1;
 begin perform app.finish_web_lab(jid,(claim->>'claim_id')::uuid,receipt||'{"stock_quantity":4}'); raise exception 'TEST_BAD_RECEIPT'; exception when raise_exception then if sqlerrm<>'INVALID_LAB_RECEIPT' then raise; end if; end;
 n:=n+1;
 j:=app.finish_web_lab(jid,(claim->>'claim_id')::uuid,receipt);
 if j->>'state'<>'SUCCEEDED' or app.finish_web_lab(jid,(claim->>'claim_id')::uuid,receipt)<>j then raise exception 'TEST_RESULT'; end if;
 n:=n+1;
 if n<>15 then raise exception 'TEST_COUNT_%',n; end if;
end $test$;
select 15 as checks_passed, 'ROLLBACK_REQUIRED' as mode;
