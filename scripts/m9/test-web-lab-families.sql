-- Operator regression against the five-size staging fixture. Always BEGIN/ROLLBACK.
do $test$
declare pid uuid; actor uuid; d jsonb; packet jsonb; j jsonb; claim jsonb; receipt jsonb; req uuid:=gen_random_uuid(); jid uuid; n int:=0;
begin
 select product_id into strict pid from app.web_content_sources where snapshot->>'woo_product_id'='5630';
 select updated_by into strict actor from app.web_product_drafts limit 1;
 if exists(select 1 from (values('anon'),('authenticated'),('service_role')) r(role) where
  has_table_privilege(role,'app.web_lab_family_evidence','SELECT') or
  has_function_privilege(role,'app.web_lab_simple_packet(uuid)','EXECUTE') or
  has_function_privilege(role,'app.finish_web_lab_simple(uuid,uuid,jsonb)','EXECUTE')) then raise exception 'TEST_PRIVATE'; end if; n:=n+1;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform app.read_web_lab(pid); raise exception 'TEST_ANON'; exception when insufficient_privilege then null; end; n:=n+1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into app.web_lab_enabled_products(product_id,source_fingerprint,enabled,store_id)
 select pid,md5(snapshot::text),true,'m9-local-2026-10-02' from app.web_content_sources where product_id=pid
 on conflict(product_id) do update set enabled=true,source_fingerprint=excluded.source_fingerprint;
 begin perform app.web_lab_packet(pid); raise exception 'TEST_NO_FAMILY_EVIDENCE'; exception when raise_exception then if sqlerrm<>'LAB_FAMILY_REVIEW_REQUIRED' then raise; end if; end; n:=n+1;
 insert into app.web_lab_family_evidence(product_id,source_sha256,source_fingerprint,catalog_fingerprint,evidence_sha256)
 select pid,source_sha256,md5(snapshot::text),md5(app.web_catalog_snapshot(pid)::text),repeat('1',64) from app.web_content_sources where product_id=pid;
 d:=app.read_web_draft(pid,null);
 perform app.save_web_draft(pid,d->'content',(d->>'revision')::int,d->>'fingerprint',gen_random_uuid());
 d:=app.read_web_draft(pid,null); packet:=app.web_lab_packet(pid);
 if packet->>'type'<>'variable' or packet->>'version'<>'3' or jsonb_array_length(packet#>'{catalog,variants}')<>5 then raise exception 'TEST_COMPLETE_PACKET'; end if; n:=n+1;
 j:=app.enqueue_web_lab(pid,(d->>'revision')::int,d->>'fingerprint',req); jid:=(j#>>'{job,id}')::uuid;
 if app.enqueue_web_lab(pid,(d->>'revision')::int,d->>'fingerprint',req)<>j then raise exception 'TEST_REPEAT'; end if; n:=n+1;
 begin
  update public.variants set price_cents=price_cents+1 where id=(packet#>>'{catalog,variants,0,id}')::uuid;
  if app.claim_web_lab(jid)->>'state'<>'SUPERSEDED' then raise exception 'TEST_CHANGED_PRICE'; end if;
  n:=n+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update app.web_content_sources set source_sha256=repeat('2',64) where product_id=pid;
  if app.claim_web_lab(jid)->>'state'<>'SUPERSEDED' then raise exception 'TEST_NEW_EXPORT'; end if;
  n:=n+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update public.variants set is_active=false where id=(packet#>>'{catalog,variants,0,id}')::uuid;
  if app.claim_web_lab(jid)->>'state'<>'SUPERSEDED' then raise exception 'TEST_INACTIVE_MEMBER'; end if;
  n:=n+1; raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 claim:=app.claim_web_lab(jid);
 if claim->>'state'<>'RUNNING' then raise exception 'TEST_CLAIM'; end if; n:=n+1;
 receipt:=jsonb_build_object('state','SUCCEEDED','store_id','m9-local-2026-10-02','local_product_id',900,
  'variants',(select jsonb_agg(jsonb_build_object('variant_id',value->>'id','local_variation_id',900+ordinality)) from jsonb_array_elements(packet#>'{catalog,variants}') with ordinality), 'evidence_sha256',repeat('3',64));
 begin perform app.finish_web_lab(jid,(claim->>'claim_id')::uuid,receipt||jsonb_build_object('variants',(receipt->'variants')-0)); raise exception 'TEST_MISSING_CHILD'; exception when raise_exception then if sqlerrm<>'INVALID_LAB_VARIANT_RECEIPT' then raise; end if; end; n:=n+1;
 begin perform app.finish_web_lab(jid,(claim->>'claim_id')::uuid,jsonb_set(receipt,'{variants,1,local_variation_id}',receipt#>'{variants,0,local_variation_id}')); raise exception 'TEST_DUPLICATE_CHILD'; exception when raise_exception then if sqlerrm<>'INVALID_LAB_VARIANT_RECEIPT' then raise; end if; end; n:=n+1;
 begin perform app.finish_web_lab(jid,(claim->>'claim_id')::uuid,receipt||'{"stock_quantity":5}'); raise exception 'TEST_STOCK'; exception when raise_exception then if sqlerrm<>'INVALID_LAB_RECEIPT' then raise; end if; end; n:=n+1;
 j:=app.finish_web_lab(jid,(claim->>'claim_id')::uuid,receipt);
 if j->>'state'<>'SUCCEEDED' or app.finish_web_lab(jid,(claim->>'claim_id')::uuid,receipt)<>j then raise exception 'TEST_RESULT'; end if; n:=n+1;
 if jsonb_array_length(app.read_web_lab(pid)->'last_verified_variants')<>5 then raise exception 'TEST_VISIBLE_MAPPINGS'; end if; n:=n+1;
 perform app.save_web_draft(pid,jsonb_set(d->'content','{description}',to_jsonb((d#>>'{content,description}')||' Prueba rollback.')),(d->>'revision')::int,d->>'fingerprint',gen_random_uuid());
 j:=app.enqueue_web_lab(pid,(d->>'revision')::int+1,d->>'fingerprint',gen_random_uuid());claim:=app.claim_web_lab((j#>>'{job,id}')::uuid);
 if claim#>>'{packet,version}'<>'4' or claim#>>'{packet,mode}'<>'update' then raise exception 'TEST_UPDATE'; end if; n:=n+1;
 begin perform app.finish_web_lab((claim->>'id')::uuid,(claim->>'claim_id')::uuid,jsonb_set(receipt,'{variants,0,local_variation_id}','999')); raise exception 'TEST_CHANGED_CHILD'; exception when raise_exception then if sqlerrm<>'LAB_TARGET_CHANGED' then raise; end if; end; n:=n+1;
 if n<>16 then raise exception 'TEST_COUNT_%',n; end if;
end $test$;
select 16 as checks_passed,'ROLLBACK_REQUIRED' as mode;
