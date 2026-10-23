-- Forward draft; coordinator alone applies a reviewed CLI migration in staging.
begin;
select app.assert_sicar_staging_enabled();

create function app.m9_delivery_capture_context(src text, dk text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();ctx jsonb;last_event app.m9_delivery_observations;
begin
 ctx:=app.m9_delivery_document_snapshot(src,dk);
 select * into last_event from app.m9_delivery_observations where archive_sha256=src and document_key=dk order by revision desc limit 1;
 return jsonb_build_object('archive_payload_hash',ctx->'archive_payload_hash','document_snapshot_hash',ctx->'document_snapshot_hash','revision',ctx->'revision',
 'latest_request_id',last_event.request_id,'latest_action',last_event.action,
 'status',case when last_event.request_id is null then 'NONE' when last_event.document_snapshot_hash<>ctx->>'document_snapshot_hash' then 'STALE' when last_event.action='REVOKE' then 'REVOKED' else 'LIVE' end);
end $$;
revoke all on function app.m9_delivery_capture_context(text,text) from public,anon,authenticated,service_role;

create function app.m9_delivery_capture_read(p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();v jsonb;d jsonb;rows jsonb:='[]';a app.m9_credit_detail_archives;ctx jsonb;concrete int:=0;event app.m9_delivery_observations;
 base_query jsonb;result jsonb;review_filter text;page_no int;pages int;total int;source_pages int;i int;is_concrete boolean;
begin
 if p_input is null or jsonb_typeof(p_input)is distinct from 'object' then raise exception 'DELIVERY_CAPTURE_QUERY_INVALID';end if;
 review_filter:=coalesce(p_input->>'review_filter','all');
 if (p_input?'review_filter'and jsonb_typeof(p_input->'review_filter')is distinct from 'string')or review_filter not in('all','pending','concrete')then raise exception 'DELIVERY_CAPTURE_QUERY_INVALID';end if;
 base_query:=p_input-'review_filter';
 -- Validate the original query first, including requested page, using the old
 -- guarded reader unchanged. Filter the FULL result before paging the queue.
 v:=app.m9_delivery_review_read(base_query);
 if v->'ready'='true'::jsonb then
  page_no:=coalesce((base_query->>'page')::int,1);source_pages:=(v->>'pages')::int;
  for i in 1..source_pages loop
   result:=app.m9_delivery_review_read(base_query||jsonb_build_object('page',i));
   for d in select value from jsonb_array_elements(result->'rows')loop
    ctx:=app.m9_delivery_capture_context(v->>'archive_sha256',d->>'document_key');
    is_concrete:=ctx->>'status'='LIVE'and d->>'documentary_statement' in('ALL_PENDING','ALL_DELIVERED')and(d->>'generic_lines')::int=0;
    if review_filter='all'or(review_filter='concrete'and is_concrete)or(review_filter='pending'and not is_concrete)then
     rows:=rows||jsonb_build_array(d||jsonb_build_object('capture_context',ctx));
    end if;
   end loop;
  end loop;
  total:=jsonb_array_length(rows);pages:=greatest(1,(total+7)/8);page_no:=least(page_no,pages);
  select coalesce(jsonb_agg(x order by x->>'account_name',x->>'folio',x->>'document_key'),'[]')into result from(select value x from jsonb_array_elements(rows)order by value->>'account_name',value->>'folio',value->>'document_key'limit 8 offset(page_no-1)*8)t;
  v:=v||jsonb_build_object('rows',result,'total',total,'page',page_no,'pages',pages);
  select * into strict a from app.m9_credit_detail_archives where source_plan_sha256=v->>'archive_sha256';
  for d in select doc from jsonb_array_elements(a.payload->'accounts')acct cross join lateral jsonb_array_elements(acct->'documents')doc loop
   ctx:=app.m9_delivery_capture_context(a.source_plan_sha256,d->>'key');
   select * into event from app.m9_delivery_observations where archive_sha256=a.source_plan_sha256 and document_key=d->>'key' order by revision desc limit 1;
   if ctx->>'status'='LIVE'and event.observation->>'statement' in('ALL_PENDING','ALL_DELIVERED')and not exists(select 1 from jsonb_array_elements(d->'lines')l where l->>'barcode'='SX00000')then concrete:=concrete+1;end if;
  end loop;
  v:=jsonb_set(v,'{summary}',(v->'summary')||jsonb_build_object('concrete_documentary_reviews',concrete,'pending_documentary_reviews',(v->'summary'->>'documents')::int-concrete));
 end if;
 return v||jsonb_build_object('protocol','m9-delivery-capture-page-1','responses_enabled',true,'documentary_only',true,'stock_delivery_allowed',false,'financial_opening_allowed',false);
end $$;
revoke all on function app.m9_delivery_capture_read(jsonb) from public,anon,authenticated,service_role;
grant execute on function app.m9_delivery_capture_read(jsonb) to authenticated;
create function public.m9_delivery_capture_read(p_input jsonb default '{}'::jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$select app.m9_delivery_capture_read(p_input);$$;
revoke all on function public.m9_delivery_capture_read(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.m9_delivery_capture_read(jsonb) to authenticated;

create function app.m9_delivery_capture_write(p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();ctx jsonb;src text;dk text;choice text;stamp text;o jsonb;lines jsonb:='[]';ln jsonb;
 previous app.m9_delivery_observations;req uuid;rec jsonb;generated jsonb;
begin
 if not app.m9_detail_shape(p_input,array['protocol','request_id','archive_sha256','document_key','expected_archive_payload_hash','expected_document_snapshot_hash','expected_revision','action','choice','revokes_request_id','confirmed'])
  or p_input->>'protocol' is distinct from 'm9-delivery-capture-request-1' or p_input->'confirmed' is distinct from 'true'::jsonb
  or coalesce(p_input->>'request_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or coalesce(p_input->>'archive_sha256','')!~'^[a-f0-9]{64}$' or coalesce(p_input->>'document_key','')!~'^[a-f0-9]{64}$'
  or coalesce(p_input->>'expected_archive_payload_hash','')!~'^[a-f0-9]{64}$' or coalesce(p_input->>'expected_document_snapshot_hash','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_input->'expected_revision') is distinct from 'number' or coalesce(p_input->>'expected_revision','')!~'^(0|[1-9][0-9]{0,8})$'
  or octet_length(p_input::text)>4000 then raise exception 'DELIVERY_CAPTURE_INPUT_INVALID';end if;
 src:=p_input->>'archive_sha256';dk:=p_input->>'document_key';req:=(p_input->>'request_id')::uuid;choice:=p_input->>'choice';
 -- Common lock with maintenance writes; SHARE prevents an archive insert/update
 -- changing the latest cut between validation and append. No stock/table locks.
 perform pg_advisory_xact_lock(hashtextextended('m9-document-delivery/'||src||'/'||dk,0));
 lock table app.m9_credit_detail_archives in share mode;
 if src is distinct from(select source_plan_sha256 from app.m9_credit_detail_archives order by source_until desc,source_plan_sha256 limit 1) then raise exception 'DELIVERY_CAPTURE_ARCHIVE_NOT_CURRENT';end if;
 ctx:=app.m9_delivery_document_snapshot(src,dk);
 if p_input->>'expected_archive_payload_hash' is distinct from ctx->>'archive_payload_hash'
  or p_input->>'expected_document_snapshot_hash' is distinct from ctx->>'document_snapshot_hash' then raise exception 'DELIVERY_CAPTURE_CONTEXT_CHANGED';end if;
 select * into previous from app.m9_delivery_observations where request_id=req;
 -- Reuse the original server timestamp only for exact idempotent replay.
 -- The maintenance writer still compares its full generated request hash+actor.
 stamp:=case when previous.action='OBSERVE' then previous.observation->>'reviewed_at' else to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')end;
 if p_input->>'action'='OBSERVE' then
  if jsonb_typeof(p_input->'choice') is distinct from 'string' or choice not in('UNKNOWN','ALL_PENDING','ALL_DELIVERED','PARTIAL_REVIEW') or p_input->'revokes_request_id' is distinct from 'null'::jsonb then raise exception 'DELIVERY_CAPTURE_CHOICE_INVALID';end if;
  if choice<>'UNKNOWN'and exists(select 1 from jsonb_array_elements(ctx->'document'->'lines')l where l->>'barcode'='SX00000')then raise exception 'DELIVERY_CAPTURE_PHYSICAL_SCOPE_UNKNOWN';end if;
  if choice in('ALL_PENDING','ALL_DELIVERED') then
   if jsonb_array_length(ctx->'document'->'lines')=0 or exists(select 1 from jsonb_array_elements(ctx->'document'->'lines')l where l->>'barcode'='SX00000' or l->>'barcode'~'[[:cntrl:]]' or coalesce(l->>'quantity','')!~'^[1-9][0-9]{0,8}$')then raise exception 'DELIVERY_CAPTURE_PHYSICAL_SCOPE_UNKNOWN';end if;
  end if;
  if choice='PARTIAL_REVIEW' then
   for ln in select value from jsonb_array_elements(ctx->'document'->'lines') order by(value->>'index')::int loop
    lines:=lines||jsonb_build_array(jsonb_build_object('index',ln->'index','barcode',ln->'barcode','status','UNKNOWN','delivered_qty',null,'pending_qty',null));
   end loop;
  end if;
  o:=jsonb_build_object('reviewed_at',stamp,'reviewer_ref',actor::text,'evidence_sha256',ctx->'document'->'evidence_sha256','statement',case when choice='PARTIAL_REVIEW' then 'MIXED' else choice end,'lines',lines,'documentary_only',true,'operational_import_allowed',false,'stock_delivery_allowed',false);
 elsif p_input->>'action'='REVOKE' then
  if p_input->'choice' is distinct from 'null'::jsonb or coalesce(p_input->>'revokes_request_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'then raise exception 'DELIVERY_CAPTURE_REVOKE_INVALID';end if;
  o:=null;
 else raise exception 'DELIVERY_CAPTURE_ACTION_INVALID';end if;
 generated:=jsonb_build_object('protocol','m9-document-delivery-observation-1','project_id','zsezjtswqeijboezvado','request_id',req,'archive_sha256',src,'document_key',dk,'expected_archive_payload_hash',ctx->'archive_payload_hash','expected_document',ctx->'document','expected_revision',p_input->'expected_revision','action',p_input->'action','revokes_request_id',p_input->'revokes_request_id','observation',o);
 rec:=app.m9_record_delivery_observation(generated);
 return rec||jsonb_build_object('protocol','m9-delivery-capture-receipt-1','choice',choice,'reviewed_at',case when p_input->>'action'='OBSERVE' then stamp else null end,'source_evidence_sha256',ctx->'document'->'evidence_sha256','documentary_only',true,'source_delivery_status','UNKNOWN');
end $$;
revoke all on function app.m9_delivery_capture_write(jsonb) from public,anon,authenticated,service_role;
grant execute on function app.m9_delivery_capture_write(jsonb) to authenticated;
create function public.m9_delivery_capture_write(p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select app.m9_delivery_capture_write(p_input);$$;
revoke all on function public.m9_delivery_capture_write(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.m9_delivery_capture_write(jsonb) to authenticated;
-- Existing maintenance functions and tables retain their closed ACLs.
commit;
