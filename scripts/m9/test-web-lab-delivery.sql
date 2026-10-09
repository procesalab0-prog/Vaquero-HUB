-- Staging fixture regression. The caller MUST wrap this file in BEGIN/ROLLBACK.
-- Temporary prices are synthetic; no new SICAR source or production operation.
do $test$
declare pid uuid; actor uuid; old app.web_lab_jobs; d jsonb; j jsonb; claim jsonb; req uuid; vid uuid; n int:=0; baseline jsonb; rev int; receipt jsonb;
begin
 for old in select distinct on(product_id) * from app.web_lab_jobs where state='SUCCEEDED' order by product_id,revision desc loop
  pid:=old.product_id;actor:=old.actor_id;rev:=old.revision;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  d:=app.read_web_draft(pid,null); baseline:=d->'content';
  if app.read_web_lab(pid)->>'can_request'<>'false' then raise exception 'TEST_UNCHANGED'; end if;n:=n+1;
  vid:=(old.packet#>>'{catalog,variants,0,id}')::uuid;
  update public.variants set price_cents=price_cents+100 where id=vid;
  if app.read_web_lab(pid)->>'can_request'<>'false' then raise exception 'TEST_UNREVIEWED_PRICE'; end if;n:=n+1;
  -- Rollback-only fixture stands in for an independently reviewed catalogue cut.
  update app.m9_rows set source_row=app.m9_current_row(variant_id) where variant_id=vid;
  update app.web_lab_family_evidence set catalog_fingerprint=md5(app.web_catalog_snapshot(pid)::text) where product_id=pid;
  d:=app.read_web_draft(pid,null);
  if app.read_web_lab(pid)->>'can_request'<>'true' or d->'content'<>baseline then raise exception 'TEST_PRICE_ONLY_READY'; end if;n:=n+1;
  req:=gen_random_uuid();j:=app.enqueue_web_lab(pid,(d->>'revision')::int,d->>'fingerprint',req);
  if (j#>>'{job,revision}')::int<>rev+1 or j#>>'{job,editorial_revision}'<>d->>'revision' then raise exception 'TEST_SEPARATE_REVISIONS'; end if;n:=n+1;
  if app.enqueue_web_lab(pid,(d->>'revision')::int,d->>'fingerprint',req)<>j then raise exception 'TEST_RETRY'; end if;n:=n+1;
  begin perform app.enqueue_web_lab(pid,(d->>'revision')::int,d->>'fingerprint',gen_random_uuid()); raise exception 'TEST_DUPLICATE'; exception when raise_exception then if sqlerrm<>'LAB_ALREADY_REQUESTED' then raise; end if;end;n:=n+1;
  begin
   update public.variants set price_cents=price_cents+1 where id=vid;
   if app.claim_web_lab((j#>>'{job,id}')::uuid)->>'state'<>'SUPERSEDED' then raise exception 'TEST_STALE_PRICE'; end if;
   n:=n+1;raise exception using errcode='ZX001';
  exception when sqlstate 'ZX001' then null; end;
  claim:=app.claim_web_lab((j#>>'{job,id}')::uuid);
  if claim->>'state'<>'RUNNING' or claim#>'{packet,content}'<>baseline or claim#>'{packet,previous,receipt}'<>old.receipt then raise exception 'TEST_CLAIM_IDENTITY'; end if;n:=n+1;
  receipt:=old.receipt||jsonb_build_object('evidence_sha256',repeat('a',64));
  perform app.finish_web_lab((claim->>'id')::uuid,(claim->>'claim_id')::uuid,receipt);
  if app.read_web_lab(pid)->>'can_request'<>'false' then raise exception 'TEST_NO_RESEND'; end if;n:=n+1;
  -- A second price change keeps the same editorial revision and advances delivery again.
  update public.variants set price_cents=price_cents+100 where id=vid;
  update app.m9_rows set source_row=app.m9_current_row(variant_id) where variant_id=vid;
  update app.web_lab_family_evidence set catalog_fingerprint=md5(app.web_catalog_snapshot(pid)::text) where product_id=pid;
  d:=app.read_web_draft(pid,null);
  j:=app.enqueue_web_lab(pid,(d->>'revision')::int,d->>'fingerprint',gen_random_uuid());
  if (j#>>'{job,revision}')::int<>rev+2 or j#>>'{job,editorial_revision}'<>d->>'revision' then raise exception 'TEST_SECOND_PRICE'; end if;n:=n+1;
  -- Saving text while queued invalidates the frozen packet.
  perform app.save_web_draft(pid,jsonb_set(d->'content','{description}',to_jsonb((d#>>'{content,description}')||' ROLLBACK TEST.')),(d->>'revision')::int,d->>'fingerprint',gen_random_uuid());
  if app.claim_web_lab((j#>>'{job,id}')::uuid)->>'state'<>'SUPERSEDED' then raise exception 'TEST_STALE_TEXT'; end if;n:=n+1;
  d:=app.read_web_draft(pid,null);
  j:=app.enqueue_web_lab(pid,(d->>'revision')::int,d->>'fingerprint',gen_random_uuid());
  if (j#>>'{job,revision}')::int<>rev+3 then raise exception 'TEST_SUPERSEDED_SEQUENCE'; end if;n:=n+1;
  claim:=app.claim_web_lab((j#>>'{job,id}')::uuid);
  if claim->>'state'<>'RUNNING' then raise exception 'TEST_EDITORIAL_AFTER_PRICE'; end if;n:=n+1;
 end loop;
 if n<>26 then raise exception 'TEST_COUNT_%',n; end if;
 if exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(role) where has_function_privilege(role,'app.web_lab_delivery_packet(uuid,jsonb)','EXECUTE') or has_function_privilege(role,'app.web_lab_delivery_identity(jsonb)','EXECUTE')) then raise exception 'TEST_PRIVATE'; end if;
end $test$;
select 27 as checks_passed,'ROLLBACK_ONLY_SYNTHETIC_PRICES' as mode;
