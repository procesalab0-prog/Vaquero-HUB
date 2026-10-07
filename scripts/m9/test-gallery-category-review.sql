-- Run in a transaction containing the proposed function and six captured cases;
-- rollback the entire transaction after this script. No synthetic approvals.
create function pg_temp.review_gallery(a jsonb) returns jsonb language sql as $$
 select app.review_gallery_category_binding((a->>'product_id')::uuid,a->'prior_snapshot',
 a->'prior_binding',a->'expected_source',a->'expected_draft',a->>'catalog_hash',
 a->>'evidence_hash',(a->>'captured_at')::timestamptz,a->'mapping')
$$;
create function pg_temp.reject_gallery(a jsonb,wanted text) returns void language plpgsql as $$
begin
 begin perform pg_temp.review_gallery(a);
 exception when others then if sqlerrm=wanted then return; end if; raise exception 'EXPECTED_%,_GOT_%',wanted,sqlerrm; end;
 raise exception 'EXPECTED_REJECTION_%',wanted;
end $$;
do $test$
declare a jsonb; item jsonb; pid uuid; result jsonb; tests integer:=0;
 source_before text; draft_before text; rows_before text; other_bindings_before text;
 audit_count bigint;
begin
 select data into a from gallery_category_cases order by data->>'woo_product_id' limit 1;
 pid:=(a->>'product_id')::uuid;
 select md5(jsonb_agg(to_jsonb(s) order by product_id)::text) into source_before from app.web_content_sources s;
 select md5(jsonb_agg(to_jsonb(d) order by product_id)::text) into draft_before from app.web_product_drafts d;
 select md5(jsonb_agg(to_jsonb(r) order by barcode)::text) into rows_before from app.m9_rows r;
 select md5(jsonb_agg(to_jsonb(b) order by product_id)::text) into other_bindings_before from app.web_category_bindings b
 where product_id not in(select (data->>'product_id')::uuid from gallery_category_cases);
 perform pg_temp.reject_gallery(jsonb_set(a,'{evidence_hash}','"invalid"'),'INVALID_GALLERY_CATEGORY_EVIDENCE'); tests:=tests+1;
 perform pg_temp.reject_gallery(jsonb_set(a,'{captured_at}',to_jsonb(clock_timestamp()-interval '25 hours')),'STALE_CATEGORY_CAPTURE'); tests:=tests+1;
 perform pg_temp.reject_gallery(jsonb_set(a,'{captured_at}',to_jsonb(clock_timestamp()+interval '1 hour')),'STALE_CATEGORY_CAPTURE'); tests:=tests+1;
 perform pg_temp.reject_gallery(jsonb_set(a,'{prior_binding,invalidation_reason}','"DRAFT_CHANGED"'),'PRIOR_GALLERY_EVIDENCE_MISMATCH'); tests:=tests+1;
 perform pg_temp.reject_gallery(jsonb_set(a,'{prior_snapshot,name}','"changed"'),'PRIOR_GALLERY_EVIDENCE_MISMATCH'); tests:=tests+1;
 perform pg_temp.reject_gallery(jsonb_set(a,'{prior_binding,verified_at}','"changed"'),'CATEGORY_BINDING_CHANGED'); tests:=tests+1;
 perform pg_temp.reject_gallery(jsonb_set(a,'{mapping}','[]'),'CATEGORY_MEMBERSHIP_CHANGED'); tests:=tests+1;
 perform pg_temp.reject_gallery(jsonb_set(a,'{expected_source,snapshot,name}','"changed"'),'WEB_SOURCE_CHANGED'); tests:=tests+1;
 perform pg_temp.reject_gallery(jsonb_set(a,'{expected_draft,revision}','99999'),'WEB_DRAFT_CHANGED'); tests:=tests+1;
 perform pg_temp.reject_gallery(jsonb_set(a,'{catalog_hash}',to_jsonb(repeat('0',32))),'WEB_CATALOG_CHANGED'); tests:=tests+1;
 begin
  update app.web_content_sources set snapshot=jsonb_set(snapshot,'{name}','"edited"') where product_id=pid;
  select a||jsonb_build_object('expected_source',to_jsonb(s)) into item from app.web_content_sources s where product_id=pid;
  perform pg_temp.reject_gallery(item,'NOT_A_GALLERY_ONLY_SOURCE_REVIEW'); tests:=tests+1;
  raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 begin
  update app.web_product_drafts set content=jsonb_set(content,'{categories}','["human edit"]') where product_id=pid;
  select a||jsonb_build_object('expected_draft',to_jsonb(d)) into item from app.web_product_drafts d where product_id=pid;
  perform pg_temp.reject_gallery(item,'CATEGORY_CONTENT_CHANGED'); tests:=tests+1;
  raise exception using errcode='ZX001';
 exception when sqlstate 'ZX001' then null; end;
 if has_function_privilege('anon','app.review_gallery_category_binding(uuid,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','app.review_gallery_category_binding(uuid,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz,jsonb)','EXECUTE')
  or has_function_privilege('service_role','app.review_gallery_category_binding(uuid,jsonb,jsonb,jsonb,jsonb,text,text,timestamptz,jsonb)','EXECUTE')
  then raise exception 'CLIENT_PRIVILEGES_EXPOSED'; end if; tests:=tests+1;
 for item in select data from gallery_category_cases loop
  result:=pg_temp.review_gallery(item);
  if result->>'result'<>'REVERIFIED' or result->>'send_allowed'<>'false'
   then raise exception 'INVALID_REVIEW_RESULT'; end if; tests:=tests+1;
  select count(*) into audit_count from public.audit_log;
  result:=pg_temp.review_gallery(item);
  if result->>'result'<>'UNCHANGED' or audit_count<>(select count(*) from public.audit_log)
   then raise exception 'REVIEW_NOT_IDEMPOTENT'; end if; tests:=tests+1;
 end loop;
 if source_before is distinct from(select md5(jsonb_agg(to_jsonb(s) order by product_id)::text) from app.web_content_sources s)
  or draft_before is distinct from(select md5(jsonb_agg(to_jsonb(d) order by product_id)::text) from app.web_product_drafts d)
  or rows_before is distinct from(select md5(jsonb_agg(to_jsonb(r) order by barcode)::text) from app.m9_rows r)
  or other_bindings_before is distinct from(select md5(jsonb_agg(to_jsonb(b) order by product_id)::text) from app.web_category_bindings b
    where product_id not in(select (data->>'product_id')::uuid from gallery_category_cases))
  then raise exception 'UNRELATED_DATA_CHANGED'; end if; tests:=tests+1;
 if exists(select 1 from public.inventory_by_location) or exists(select 1 from public.inventory_movements)
  then raise exception 'INVENTORY_CHANGED'; end if; tests:=tests+1;
 raise notice 'GALLERY_CATEGORY_CHECKS=%',tests;
end $test$;
select jsonb_build_object('checks',27,'cases',6,'rollback_required',true,'send_allowed',false) as result;
