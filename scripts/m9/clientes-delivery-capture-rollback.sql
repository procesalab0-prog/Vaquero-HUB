-- REVIEWED COORDINATOR ONLY: explicit UNKNOWN documentary QA, always ROLLBACK.
-- Requires an existing real active ADMIN JWT subject set by the coordinator.
-- No fabricated delivery quantities, debts, native clients or operational data.
begin;
set local statement_timeout='20s';
select app.assert_sicar_staging_enabled();
do $$
declare actor uuid:=app.m9_legacy_actor();src text;dk text;ctx jsonb;p jsonb;r jsonb;retry jsonb;undo jsonb;withdrawal jsonb;
begin
 select source_plan_sha256 into strict src from app.m9_credit_detail_archives order by source_until desc,source_plan_sha256 limit 1;
 select doc->>'key'into strict dk from app.m9_credit_detail_archives a cross join lateral jsonb_array_elements(a.payload->'accounts')acct cross join lateral jsonb_array_elements(acct->'documents')doc where a.source_plan_sha256=src order by doc->>'key'limit 1;
 ctx:=app.m9_delivery_document_snapshot(src,dk);
 p:=jsonb_build_object('protocol','m9-delivery-capture-request-1','request_id',extensions.gen_random_uuid(),'archive_sha256',src,'document_key',dk,'expected_archive_payload_hash',ctx->'archive_payload_hash','expected_document_snapshot_hash',ctx->'document_snapshot_hash','expected_revision',ctx->'revision','action','OBSERVE','choice','UNKNOWN','revokes_request_id',null,'confirmed',true);
 r:=public.m9_delivery_capture_write(p);retry:=public.m9_delivery_capture_write(p);
 if retry->'replayed'is distinct from 'true'::jsonb or retry->'reviewed_at'is distinct from r->'reviewed_at'or retry->'source_evidence_sha256'is distinct from r->'source_evidence_sha256'or r->'operational_import_allowed'is distinct from 'false'::jsonb then raise exception 'DOCUMENTARY_QA_REPLAY_OR_SAFETY_FAILED';end if;
 undo:=p||jsonb_build_object('request_id',extensions.gen_random_uuid(),'expected_revision',r->'revision','action','REVOKE','choice',null,'revokes_request_id',r->'request_id');
 withdrawal:=public.m9_delivery_capture_write(undo);retry:=public.m9_delivery_capture_write(undo);
 if retry->'replayed'is distinct from 'true'::jsonb or withdrawal->>'action'is distinct from 'REVOKE'then raise exception 'DOCUMENTARY_QA_WITHDRAWAL_FAILED';end if;
 raise notice 'Documentary UNKNOWN/replay/withdrawal/replay passed; transaction will ROLLBACK, no responses retained.';
end $$;
rollback;
