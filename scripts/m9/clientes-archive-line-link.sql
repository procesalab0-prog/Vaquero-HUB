-- Private, metadata-only forward draft. Coordinator applies staging migrations.
begin;
select app.assert_sicar_staging_enabled();
create table app.m9_archived_line_links(
 request_id uuid primary key,
 archive_sha256 text not null references app.m9_credit_detail_archives(source_plan_sha256),
 document_key text not null check(document_key~'^[a-f0-9]{64}$'),line_index int not null check(line_index>=0),
 revision int not null check(revision>0),action text not null check(action in('BIND','REVOKE')),
 revokes_request_id uuid references app.m9_archived_line_links(request_id),
 variant_id uuid references public.variants(id),
 actor_user_id uuid not null references public.app_users(id),request_hash text not null,
 source_snapshot_hash text not null,catalog_snapshot_hash text,
 evidence_sha256 text not null check(evidence_sha256~'^[a-f0-9]{64}$'),receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(archive_sha256,document_key,line_index,revision),
 check((action='BIND' and variant_id is not null and catalog_snapshot_hash is not null and revokes_request_id is null)or(action='REVOKE' and variant_id is null and catalog_snapshot_hash is null and revokes_request_id is not null))
);
create index m9_archived_line_links_variant_idx on app.m9_archived_line_links(variant_id);
create index m9_archived_line_links_actor_idx on app.m9_archived_line_links(actor_user_id);
create index m9_archived_line_links_revoke_idx on app.m9_archived_line_links(revokes_request_id);
alter table app.m9_archived_line_links enable row level security;
revoke all on app.m9_archived_line_links from public,anon,authenticated,service_role;
create trigger m9_archived_line_links_immutable before update or delete on app.m9_archived_line_links for each row execute function app.m9_legacy_event_immutable();

create function app.m9_archived_line_source_snapshot(src text,dk text,idx int) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;a app.m9_credit_detail_archives;doc jsonb;l jsonb;registered jsonb;identity jsonb;ctx jsonb;revision int;ck text;client_ref text;
begin
 if current_user<>'postgres' then raise exception 'LINE_LINK_MAINTENANCE_ONLY' using errcode='42501';end if;actor:=app.m9_legacy_actor();
 select * into strict a from app.m9_credit_detail_archives where source_plan_sha256=src;
 if a.payload_hash<>encode(extensions.digest(convert_to(a.payload::text,'UTF8'),'sha256'),'hex') then raise exception 'LINE_LINK_ARCHIVE_CHANGED';end if;
 select d,ac->>'key',ac->>'ref' into doc,ck,client_ref from jsonb_array_elements(a.payload->'accounts') ac cross join lateral jsonb_array_elements(ac->'documents') d where d->>'key'=dk;
 select value into l from jsonb_array_elements(doc->'lines') where value->'index'=to_jsonb(idx);
 if l is null then raise exception 'LINE_LINK_SOURCE_LINE_ABSENT';end if;
 select to_jsonb(s) into registered from app.m9_credit_source_lines s where s.document_key=dk and s.line_index=idx;
 select jsonb_build_object('document_key',d.document_key,'customer_key',d.customer_key,'source_folio',d.source_folio,'source_document_id',d.payload->>'source_document_id','client_ref',s.source_ref) into identity from app.m9_credit_documents d join app.m9_customer_sources s using(customer_key) where d.document_key=dk;
 select coalesce(max(j.revision),0) into revision from app.m9_archived_line_links j where j.archive_sha256=src and j.document_key=dk and j.line_index=idx;
 ctx:=jsonb_build_object('archive_sha256',src,'archive_payload_hash',a.payload_hash,'customer_key',ck,'client_ref',client_ref,'document',doc,'source_line',l,'registered_line',registered,'registered_document_identity',identity);
 return ctx||jsonb_build_object('source_snapshot_hash',encode(extensions.digest(convert_to(ctx::text,'UTF8'),'sha256'),'hex'),'revision',revision);
end $$;
create function app.m9_archived_line_catalog_snapshot(code text,vid uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('managed_row',to_jsonb(r),'current_row',app.m9_rehearsal_current_row($2),'barcode',to_jsonb(b))
 from app.m9_rows r join public.barcodes b on b.code=r.barcode and b.variant_id=r.variant_id
 where r.barcode=$1 and r.variant_id=$2 and b.source='SICAR' and b.is_primary
 and(select count(*)from public.barcodes x where x.code=$1)=1
 and app.m9_rehearsal_current_row($2)=r.source_row and r.source_row->>'barcode'=$1
$$;
create function app.m9_read_archived_line_link(src text,dk text,idx int) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare ctx jsonb;cat jsonb;j app.m9_archived_line_links;status text;
begin
 ctx:=app.m9_archived_line_source_snapshot(src,dk,idx);
 select * into j from app.m9_archived_line_links where archive_sha256=src and document_key=dk and line_index=idx order by revision desc limit 1;
 if not found then status:='UNREVIEWED';elsif j.action='REVOKE' then status:='REVOKED';else
  cat:=app.m9_archived_line_catalog_snapshot(ctx->'source_line'->>'barcode',j.variant_id);
  status:=case when cat is not null and j.source_snapshot_hash=ctx->>'source_snapshot_hash' and j.catalog_snapshot_hash=encode(extensions.digest(convert_to(cat::text,'UTF8'),'sha256'),'hex')then 'LIVE_EXACT' else 'HELD_SOURCE_OR_CATALOG_CHANGED'end;
 end if;
 return jsonb_build_object('status',status,'revision',ctx->'revision','variant_id',case when status='LIVE_EXACT'then j.variant_id else null end,'raw_archive_modified',false,'delivery_status','UNKNOWN','stock_delivery_allowed',false,'financial_opening_allowed',false);
end $$;
create function app.m9_record_archived_line_link(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;req uuid;src text;dk text;idx int;h text;ctx jsonb;cat jsonb;old app.m9_archived_line_links;latest app.m9_archived_line_links;vid uuid;catalog_hash text;rec jsonb;
begin
 if current_user<>'postgres' then raise exception 'LINE_LINK_MAINTENANCE_ONLY' using errcode='42501';end if;actor:=app.m9_legacy_actor();
 if not app.m9_detail_shape(p,array['protocol','project_id','request_id','archive_sha256','document_key','line_index','expected_archive_payload_hash','expected_document','expected_registered_line','expected_managed_row','expected_current_row','expected_revision','action','revokes_request_id','variant_id','evidence_sha256','reason'])
 or p->>'protocol' is distinct from 'm9-archived-line-link-1' or p->>'project_id' is distinct from 'zsezjtswqeijboezvado'
 or coalesce(p->>'request_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'or coalesce(p->>'archive_sha256','')!~'^[a-f0-9]{64}$'or coalesce(p->>'document_key','')!~'^[a-f0-9]{64}$'
 or jsonb_typeof(p->'line_index')is distinct from 'number'or coalesce(p->>'line_index','')!~'^(0|[1-9][0-9]{0,5})$'or jsonb_typeof(p->'expected_revision')is distinct from 'number'or coalesce(p->>'expected_revision','')!~'^(0|[1-9][0-9]{0,8})$'
 or coalesce(p->>'evidence_sha256','')!~'^[a-f0-9]{64}$'or coalesce(p->>'reason','')not in('EXACT_LITERAL_SICAR_CODE_DOCUMENTARY_ONLY','REVOKE_DOCUMENTARY_LINK_PRESERVE_HISTORY')or octet_length(p::text)>1000000 then raise exception 'LINE_LINK_PLAN_INVALID';end if;
 req:=(p->>'request_id')::uuid;src:=p->>'archive_sha256';dk:=p->>'document_key';idx:=(p->>'line_index')::int;h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 if p->>'action'='BIND' then
  perform pg_advisory_xact_lock(hashtextextended('sicar-catalog-sync',0));
  -- Barriers precede every SHARE lock. A FOR UPDATE holder must complete its
  -- UPDATE/COMMIT before BIND proceeds to catalog fingerprints and FK insertion.
  lock table public.products in exclusive mode;
  lock table public.variants in exclusive mode;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-archived-line-link/'||src||'/'||dk||'/'||idx::text,0));
 lock table app.m9_credit_detail_archives,app.m9_credit_source_lines in share mode;
 ctx:=app.m9_archived_line_source_snapshot(src,dk,idx);
 if p->>'expected_archive_payload_hash'is distinct from ctx->>'archive_payload_hash'or p->'expected_document'is distinct from ctx->'document'then raise exception 'LINE_LINK_SOURCE_DOCUMENT_CHANGED';end if;
 select * into old from app.m9_archived_line_links where request_id=req;
 if found then
  if old.request_hash<>h or old.actor_user_id<>actor then raise exception 'LINE_LINK_IDEMPOTENCY_CONFLICT';end if;
  return old.receipt||jsonb_build_object('replayed',true,'historical_receipt_only',true,'current_revision',ctx->'revision');
 end if;
 if p->'expected_revision'is distinct from ctx->'revision'then raise exception 'LINE_LINK_REVISION_CHANGED';end if;
 if p->>'action'='BIND' then
  if p->>'reason'<>'EXACT_LITERAL_SICAR_CODE_DOCUMENTARY_ONLY'or p->'revokes_request_id'is distinct from 'null'::jsonb or coalesce(p->>'variant_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'then raise exception 'LINE_LINK_BIND_INVALID';end if;
  if ctx->'registered_line'is null or ctx->'registered_line'='null'::jsonb or p->'expected_registered_line'is distinct from ctx->'registered_line'
   or ctx->'registered_document_identity'->'customer_key'is distinct from ctx->'customer_key' or ctx->'registered_document_identity'->'client_ref'is distinct from ctx->'client_ref'
   or ctx->'registered_document_identity'->'source_document_id'is distinct from ctx->'document'->'source_id' or ctx->'registered_document_identity'->'source_folio'is distinct from ctx->'document'->'folio'
   or ctx->'source_line'->'variant_id'is distinct from 'null'::jsonb or ctx->'registered_line'->'variant_id'is distinct from 'null'::jsonb
   or ctx->'source_line'->>'barcode'='SX00000'or exists(select 1 from regexp_split_to_table(ctx->'source_line'->>'barcode','') ch where ascii(ch)<32 or ascii(ch)between 127 and 159)
   or ctx->'source_line'->'barcode'is distinct from ctx->'registered_line'->'barcode'or(ctx->'source_line'->>'quantity')::numeric is distinct from(ctx->'registered_line'->>'quantity')::numeric
   or ctx->'source_line'->>'delivery_status'is distinct from 'UNKNOWN'or ctx->'registered_line'->'payload'->>'delivery_status'is distinct from 'UNKNOWN'
   or ctx->'source_line'->'reserved_qty'is distinct from 'null'::jsonb or ctx->'source_line'->'stock_deduction'is distinct from 'null'::jsonb
   or ctx->'registered_line'->'payload'->'reserved_qty'is distinct from 'null'::jsonb or ctx->'registered_line'->'payload'->'additional_stock_deduction'is distinct from 'null'::jsonb then raise exception 'LINE_LINK_UNMAPPED_LITERAL_SOURCE_REQUIRED';end if;
  -- A catalog writer must finish before these exact fingerprints are checked.
  lock table public.products,public.variants,public.barcodes,public.categories,public.attribute_values,public.variant_attributes,public.m9_variant_details,app.m9_rows,app.m9_sicar_products in share mode;
  vid:=(p->>'variant_id')::uuid;cat:=app.m9_archived_line_catalog_snapshot(ctx->'source_line'->>'barcode',vid);
  if cat is null or cat->'managed_row'is distinct from p->'expected_managed_row'or cat->'current_row'is distinct from p->'expected_current_row'then raise exception 'LINE_LINK_CATALOG_CHANGED_OR_AMBIGUOUS';end if;
  catalog_hash:=encode(extensions.digest(convert_to(cat::text,'UTF8'),'sha256'),'hex');
  select * into latest from app.m9_archived_line_links where archive_sha256=src and document_key=dk and line_index=idx order by revision desc limit 1;
  if latest.action='BIND'then raise exception 'LINE_LINK_ALREADY_BOUND';end if;
 elsif p->>'action'='REVOKE'then
  if p->>'reason'<>'REVOKE_DOCUMENTARY_LINK_PRESERVE_HISTORY'or p->'variant_id'is distinct from 'null'::jsonb or p->'expected_managed_row'is distinct from 'null'::jsonb or p->'expected_current_row'is distinct from 'null'::jsonb or coalesce(p->>'revokes_request_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'then raise exception 'LINE_LINK_REVOKE_INVALID';end if;
  select * into latest from app.m9_archived_line_links where archive_sha256=src and document_key=dk and line_index=idx order by revision desc limit 1;
  if latest.action is distinct from 'BIND'or latest.request_id is distinct from(p->>'revokes_request_id')::uuid then raise exception 'LINE_LINK_REVOKE_NOT_CURRENT';end if;
 else raise exception 'LINE_LINK_ACTION_INVALID';end if;
 rec:=jsonb_build_object('request_id',req,'action',p->>'action','revision',(ctx->>'revision')::int+1,'documentary_only',true,'delivery_status','UNKNOWN','raw_archive_modified',false,'stock_delivery_allowed',false,'financial_opening_allowed',false,'replayed',false);
 insert into app.m9_archived_line_links(request_id,archive_sha256,document_key,line_index,revision,action,revokes_request_id,variant_id,actor_user_id,request_hash,source_snapshot_hash,catalog_snapshot_hash,evidence_sha256,receipt)
 values(req,src,dk,idx,(ctx->>'revision')::int+1,p->>'action',(p->>'revokes_request_id')::uuid,vid,actor,h,ctx->>'source_snapshot_hash',catalog_hash,p->>'evidence_sha256',rec);return rec;
end $$;
revoke all on function app.m9_archived_line_source_snapshot(text,text,int),app.m9_archived_line_catalog_snapshot(text,uuid),app.m9_read_archived_line_link(text,text,int),app.m9_record_archived_line_link(jsonb)from public,anon,authenticated,service_role;
commit;
