-- Forward draft, LOCAL QA only until the coordinator reviews/applies a CLI migration.
begin;
select app.assert_sicar_staging_enabled();
create table app.m9_delivery_observations (
 request_id uuid primary key,
 archive_sha256 text not null references app.m9_credit_detail_archives(source_plan_sha256),
 document_key text not null check(document_key~'^[a-f0-9]{64}$'),
 revision int not null check(revision>0),
 action text not null check(action in('OBSERVE','REVOKE')),
 revokes_request_id uuid references app.m9_delivery_observations(request_id),
 actor_user_id uuid not null references public.app_users(id),
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 document_snapshot_hash text not null check(document_snapshot_hash~'^[a-f0-9]{64}$'),
 observation jsonb,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(archive_sha256,document_key,revision),
 check((action='OBSERVE' and observation is not null and revokes_request_id is null)
  or(action='REVOKE' and observation is null and revokes_request_id is not null))
);
create index m9_delivery_observations_actor_idx on app.m9_delivery_observations(actor_user_id);
create index m9_delivery_observations_revoke_idx on app.m9_delivery_observations(revokes_request_id);
alter table app.m9_delivery_observations enable row level security;
revoke all on app.m9_delivery_observations from public,anon,authenticated,service_role;
create trigger m9_delivery_observations_immutable before update or delete on app.m9_delivery_observations
 for each row execute function app.m9_legacy_event_immutable();

-- Revisions apply to the immutable archive, not to an operating inventory cut.
create function app.m9_delivery_document_snapshot(src text,dk text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;a app.m9_credit_detail_archives;x jsonb;doc jsonb;ctx jsonb;revision int;
begin
 if current_user<>'postgres' then raise exception 'DELIVERY_MAINTENANCE_ONLY' using errcode='42501';end if;
 actor:=app.m9_legacy_actor();
 select * into strict a from app.m9_credit_detail_archives where source_plan_sha256=src;
 if a.payload_hash<>encode(extensions.digest(convert_to(a.payload::text,'UTF8'),'sha256'),'hex') then raise exception 'DELIVERY_ARCHIVE_CHANGED';end if;
 select account,document into x,doc from jsonb_array_elements(a.payload->'accounts') account
 cross join lateral jsonb_array_elements(account->'documents') document where document->>'key'=dk;
 if doc is null then raise exception 'DELIVERY_DOCUMENT_NOT_IN_ARCHIVE';end if;
 ctx:=jsonb_build_object('archive_sha256',src,'archive_payload_hash',a.payload_hash,'customer_key',x->'key','client_ref',x->'ref','document',doc);
 select coalesce(max(o.revision),0) into revision from app.m9_delivery_observations o where o.archive_sha256=src and o.document_key=dk;
 return ctx||jsonb_build_object('document_snapshot_hash',encode(extensions.digest(convert_to(ctx::text,'UTF8'),'sha256'),'hex'),'revision',revision,'operational_import_allowed',false,'stock_delivery_allowed',false);
end $$;

create function app.m9_record_delivery_observation(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;req uuid;src text;dk text;h text;ctx jsonb;old app.m9_delivery_observations;latest app.m9_delivery_observations;
 o jsonb;ln jsonb;original jsonb;seen int[]:='{}';stamp timestamptz;rec jsonb;next_revision int;
begin
 if current_user<>'postgres' then raise exception 'DELIVERY_MAINTENANCE_ONLY' using errcode='42501';end if;
 actor:=app.m9_legacy_actor();
 if not app.m9_detail_shape(p,array['protocol','project_id','request_id','archive_sha256','document_key','expected_archive_payload_hash','expected_document','expected_revision','action','revokes_request_id','observation'])
  or p->>'protocol' is distinct from 'm9-document-delivery-observation-1' or p->>'project_id' is distinct from 'zsezjtswqeijboezvado'
  or coalesce(p->>'request_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or coalesce(p->>'archive_sha256','')!~'^[a-f0-9]{64}$' or coalesce(p->>'document_key','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p->'expected_revision') is distinct from 'number' or coalesce(p->>'expected_revision','')!~'^(0|[1-9][0-9]{0,8})$'
  or octet_length(p::text)>1000000 then raise exception 'DELIVERY_PLAN_INVALID';end if;
 req:=(p->>'request_id')::uuid;src:=p->>'archive_sha256';dk:=p->>'document_key';
 h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-document-delivery/'||src||'/'||dk,0));
 ctx:=app.m9_delivery_document_snapshot(src,dk);
 if p->>'expected_archive_payload_hash' is distinct from ctx->>'archive_payload_hash' or p->'expected_document' is distinct from ctx->'document' then raise exception 'DELIVERY_SOURCE_DOCUMENT_CHANGED';end if;
 select * into old from app.m9_delivery_observations where request_id=req;
 if found then
  if old.request_hash<>h or old.actor_user_id<>actor then raise exception 'DELIVERY_IDEMPOTENCY_CONFLICT';end if;
  return old.receipt||jsonb_build_object('replayed',true,'historical_receipt_only',true,'current_revision',ctx->'revision');
 end if;
 if p->'expected_revision' is distinct from ctx->'revision' then raise exception 'DELIVERY_REVISION_CHANGED';end if;
 next_revision:=(ctx->>'revision')::int+1;
 if p->>'action'='OBSERVE' then
  if p->'revokes_request_id' is distinct from 'null'::jsonb then raise exception 'DELIVERY_OBSERVATION_INVALID';end if;
  o:=p->'observation';
  if not app.m9_detail_shape(o,array['reviewed_at','reviewer_ref','evidence_sha256','statement','lines','documentary_only','operational_import_allowed','stock_delivery_allowed'])
   or o->'documentary_only' is distinct from 'true'::jsonb or o->'operational_import_allowed' is distinct from 'false'::jsonb or o->'stock_delivery_allowed' is distinct from 'false'::jsonb
   or coalesce(o->>'evidence_sha256','')!~'^[a-f0-9]{64}$' or jsonb_typeof(o->'reviewer_ref') is distinct from 'string' or length(o->>'reviewer_ref') not between 1 and 160 or o->>'reviewer_ref'~'[[:cntrl:]]'
   or coalesce(o->>'statement','') not in('UNKNOWN','ALL_PENDING','ALL_DELIVERED','MIXED') or jsonb_typeof(o->'lines') is distinct from 'array'
   or coalesce(o->>'reviewed_at','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' then raise exception 'DELIVERY_OBSERVATION_INVALID';end if;
  stamp:=(o->>'reviewed_at')::timestamptz;
  if to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>o->>'reviewed_at' or stamp<(ctx->'document'->>'source_at')::timestamptz or stamp>clock_timestamp() then raise exception 'DELIVERY_DATE_INVALID';end if;
  if o->>'statement'='MIXED' then
   if jsonb_array_length(o->'lines')<>jsonb_array_length(ctx->'document'->'lines') then raise exception 'DELIVERY_MIXED_COVERAGE_INVALID';end if;
   for ln in select value from jsonb_array_elements(o->'lines') loop
    if not app.m9_detail_shape(ln,array['index','barcode','status','delivered_qty','pending_qty']) or jsonb_typeof(ln->'index') is distinct from 'number' or coalesce(ln->>'index','')!~'^(0|[1-9][0-9]{0,5})$' then raise exception 'DELIVERY_LINE_INVALID';end if;
    original:=null;
    select value into original from jsonb_array_elements(ctx->'document'->'lines') where value->'index'=ln->'index';
    if original is null or (ln->>'index')::int=any(seen) or ln->'barcode' is distinct from original->'barcode' or ln->>'barcode'~'[[:cntrl:]]' then raise exception 'DELIVERY_LITERAL_LINE_CHANGED';end if;
    seen:=array_append(seen,(ln->>'index')::int);
    if original->>'barcode'='SX00000' or ln->>'status'='UNKNOWN' then
     if ln->>'status' is distinct from 'UNKNOWN' or ln->'delivered_qty' is distinct from 'null'::jsonb or ln->'pending_qty' is distinct from 'null'::jsonb then raise exception 'DELIVERY_UNKNOWN_IS_NOT_PHYSICAL_ZERO';end if;
    else
     if ln->>'status' is distinct from 'QUANTIFIED' or jsonb_typeof(ln->'delivered_qty') is distinct from 'string' or jsonb_typeof(ln->'pending_qty') is distinct from 'string'
      or coalesce(ln->>'delivered_qty','')!~'^(0|[1-9][0-9]{0,8})([.][0-9]{1,6})?$' or coalesce(ln->>'pending_qty','')!~'^(0|[1-9][0-9]{0,8})([.][0-9]{1,6})?$'
      or (ln->>'delivered_qty')::numeric+(ln->>'pending_qty')::numeric<>(original->>'quantity')::numeric then raise exception 'DELIVERY_QUANTITIES_DIFFER';end if;
    end if;
   end loop;
  elsif jsonb_array_length(o->'lines')<>0 then raise exception 'DELIVERY_NO_INFERRED_QUANTITIES';end if;
 elsif p->>'action'='REVOKE' then
  if p->'observation' is distinct from 'null'::jsonb or coalesce(p->>'revokes_request_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'DELIVERY_REVOKE_INVALID';end if;
  select * into latest from app.m9_delivery_observations where archive_sha256=src and document_key=dk order by revision desc limit 1;
  if latest.action is distinct from 'OBSERVE' or latest.request_id is distinct from (p->>'revokes_request_id')::uuid then raise exception 'DELIVERY_REVOKE_NOT_CURRENT';end if;
  o:=null;
 else raise exception 'DELIVERY_ACTION_INVALID';end if;
 rec:=jsonb_build_object('request_id',req,'action',p->>'action','archive_sha256',src,'document_key',dk,'revision',next_revision,'document_snapshot_hash',ctx->'document_snapshot_hash','documentary_only',true,'operational_import_allowed',false,'stock_delivery_allowed',false,'financial_opening_allowed',false,'replayed',false);
 insert into app.m9_delivery_observations(request_id,archive_sha256,document_key,revision,action,revokes_request_id,actor_user_id,request_hash,document_snapshot_hash,observation,receipt)
 values(req,src,dk,next_revision,p->>'action',(p->>'revokes_request_id')::uuid,actor,h,ctx->>'document_snapshot_hash',o,rec);
 return rec;
end $$;
revoke all on function app.m9_delivery_document_snapshot(text,text),app.m9_record_delivery_observation(jsonb) from public,anon,authenticated,service_role;
commit;
