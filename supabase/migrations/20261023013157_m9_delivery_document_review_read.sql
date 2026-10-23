-- Read-only draft. Root creates/applies the staging CLI migration after review.
begin;
select app.assert_sicar_staging_enabled();
create function app.m9_delivery_review_read(p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();archive app.m9_credit_detail_archives;a jsonb;d jsonb;l jsonb;
 q text;f text;focused text;page_no int;pages int;total int;rows jsonb:='[]';result jsonb;line_views jsonb;row_view jsonb;sidecar jsonb;obs app.m9_delivery_observations;
 docs int:=0;lines int:=0;raw_mapped int:=0;unmapped int:=0;live_links int:=0;unknown_docs int:=0;observed_docs int:=0;
 doc_mapped int;doc_live int;doc_unresolved int;generic int;statement text;matches boolean;identity_kind text;
begin
 -- actor guard above precedes every data/empty/error path. It enforces an
 -- active ADMIN, customers.manage and the existing staging-only control.
 if p_input is null or jsonb_typeof(p_input)is distinct from 'object' or octet_length(p_input::text)>2000 then raise exception 'DELIVERY_REVIEW_QUERY_INVALID';end if;
 if exists(select 1 from jsonb_object_keys(p_input)k where k not in('q','filter','page','document'))
  or(p_input?'q'and(jsonb_typeof(p_input->'q')is distinct from 'string'or length(p_input->>'q')>100))
  or(p_input?'filter'and(jsonb_typeof(p_input->'filter')is distinct from 'string'or p_input->>'filter'not in('all','unknown','identity','sidecar')))
  or(p_input?'page'and(jsonb_typeof(p_input->'page')is distinct from 'number'or coalesce(p_input->>'page','')!~'^[1-9][0-9]{0,5}$'))
  or(p_input?'document'and(jsonb_typeof(p_input->'document')is distinct from 'string'or coalesce(p_input->>'document','')!~'^[a-f0-9]{64}$'))then raise exception 'DELIVERY_REVIEW_QUERY_INVALID';end if;
 q:=btrim(coalesce(p_input->>'q',''));f:=coalesce(p_input->>'filter','all');focused:=p_input->>'document';page_no:=coalesce((p_input->>'page')::int,1);
 select*into archive from app.m9_credit_detail_archives order by source_until desc,source_plan_sha256 limit 1;
 if archive.source_plan_sha256 is null then return jsonb_build_object('protocol','m9-delivery-review-page-1','ready',false,'read_only',true,'responses_enabled',false,'operational_import_allowed',false);end if;
 if archive.payload_hash<>encode(extensions.digest(convert_to(archive.payload::text,'UTF8'),'sha256'),'hex')then raise exception 'DELIVERY_REVIEW_ARCHIVE_CHANGED';end if;
 for a in select value from jsonb_array_elements(archive.payload->'accounts')loop
  for d in select value from jsonb_array_elements(a->'documents')loop
   docs:=docs+1;unknown_docs:=unknown_docs+1;line_views:='[]';doc_mapped:=0;doc_live:=0;doc_unresolved:=0;generic:=0;
   for l in select value from jsonb_array_elements(d->'lines')order by(value->>'index')::int loop
    if l->>'delivery_status'is distinct from 'UNKNOWN'then raise exception 'DELIVERY_REVIEW_SOURCE_STATUS_INVALID';end if;
    lines:=lines+1;sidecar:='{"status":"UNREVIEWED"}'::jsonb;
    if l->'variant_id'is distinct from 'null'::jsonb then raw_mapped:=raw_mapped+1;doc_mapped:=doc_mapped+1;identity_kind:='ARCHIVE';
    else
     unmapped:=unmapped+1;
     if exists(select 1 from app.m9_archived_line_links j where j.archive_sha256=archive.source_plan_sha256 and j.document_key=d->>'key'and j.line_index=(l->>'index')::int)then
      sidecar:=app.m9_read_archived_line_link(archive.source_plan_sha256,d->>'key',(l->>'index')::int);
     end if;
     if sidecar->>'status'='LIVE_EXACT'then live_links:=live_links+1;doc_live:=doc_live+1;identity_kind:='SIDECAR';else doc_unresolved:=doc_unresolved+1;identity_kind:='UNRESOLVED';end if;
    end if;
    if l->>'barcode'='SX00000'then generic:=generic+1;end if;
    line_views:=line_views||jsonb_build_array(jsonb_build_object('index',l->'index','barcode',l->'barcode','description',l->'description','source_quantity',l->'quantity','generic_debt',l->>'barcode'='SX00000','source_delivery_status','UNKNOWN','identity_kind',identity_kind,'sidecar_status',sidecar->>'status'));
   end loop;
   statement:='UNKNOWN';obs:=null;
   select*into obs from app.m9_delivery_observations o where o.archive_sha256=archive.source_plan_sha256 and o.document_key=d->>'key'order by o.revision desc limit 1;
   if obs.action='OBSERVE'and obs.document_snapshot_hash=app.m9_delivery_document_snapshot(archive.source_plan_sha256,d->>'key')->>'document_snapshot_hash'then statement:=obs.observation->>'statement';observed_docs:=observed_docs+1;end if;
   matches:=(q=''or position(lower(q)in lower(a->>'name'))>0 or position(q in a->>'ref')>0 or position(lower(q)in lower(d->>'folio'))>0 or position(lower(q)in lower(d->>'historical_name'))>0 or exists(select 1 from jsonb_array_elements(d->'lines')x where position(q in x->>'barcode')>0))
    and(focused is null or focused=d->>'key')and(f in('all','unknown')or(f='identity'and doc_unresolved>0)or(f='sidecar'and doc_live>0));
   if matches then
    row_view:=jsonb_build_object('document_key',d->'key','customer_key',a->'key','client_ref',a->'ref','account_name',a->'name','historical_name',d->'historical_name','folio',d->'folio','source_document_id',d->'source_id','source_at',d->'source_at','source_evidence_sha256',d->'evidence_sha256','source_delivery_status','UNKNOWN','documentary_statement',statement,'observation_revision',coalesce(obs.revision,0),'lines',line_views,'raw_mapped_lines',doc_mapped,'live_documentary_links',doc_live,'unresolved_identity_lines',doc_unresolved,'generic_lines',generic);
    rows:=rows||jsonb_build_array(row_view);
   end if;
  end loop;
 end loop;
 total:=jsonb_array_length(rows);pages:=greatest(1,(total+7)/8);page_no:=least(page_no,pages);
 select coalesce(jsonb_agg(x order by x->>'account_name',x->>'folio',x->>'document_key'),'[]')into result from(select value x from jsonb_array_elements(rows)order by value->>'account_name',value->>'folio',value->>'document_key'limit 8 offset(page_no-1)*8)t;
 return jsonb_build_object('protocol','m9-delivery-review-page-1','ready',true,'read_only',true,'responses_enabled',false,'operational_import_allowed',false,'archive_sha256',archive.source_plan_sha256,'source_from',archive.source_from,'source_until',archive.source_until,'source_older_than_24h',archive.source_from<clock_timestamp()-interval '24 hours','summary',jsonb_build_object('documents',docs,'lines',lines,'unknown_documents',unknown_docs,'unknown_lines',lines,'raw_mapped_lines',raw_mapped,'raw_unmapped_lines',unmapped,'live_documentary_links',live_links,'effective_documentary_identities',raw_mapped+live_links,'observed_documents',observed_docs),'total',total,'page',page_no,'pages',pages,'page_size',8,'rows',result);
end $$;
revoke all on function app.m9_delivery_review_read(jsonb)from public,anon,service_role;
grant execute on function app.m9_delivery_review_read(jsonb)to authenticated;
create function public.m9_delivery_review_read(p_input jsonb default '{}'::jsonb)returns jsonb
language sql stable security invoker set search_path=''as $$select app.m9_delivery_review_read(p_input);$$;
revoke all on function public.m9_delivery_review_read(jsonb)from public,anon,service_role;
grant execute on function public.m9_delivery_review_read(jsonb)to authenticated;
commit;
