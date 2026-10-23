-- Forward draft for the SAME private archive. No data mutation outside census.
begin;
select app.assert_sicar_staging_enabled();
create function app.m9_census_renewal_context()returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;v jsonb;
begin
 if current_user<>'postgres'then raise insufficient_privilege;end if;actor:=app.m9_legacy_actor();
 with state as(select r.customer_key,s.source_ref,
 jsonb_build_object('id',r.id,'key',r.customer_key,'batch',r.batch_sha256,'source_hash',r.source_hash,'created_by',r.created_by,'created_at_epoch',extract(epoch from r.created_at)::text,'source',to_jsonb(s))row
 from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key)),
 prior as(select *from app.m9_customer_census_archives order by observed_until desc,source_plan_sha256 limit 1)
 select jsonb_build_object('version','m9-census-registry-context-1','project_id','zsezjtswqeijboezvado','registry_count',(select count(*)from state),
 'registry_sha256',encode(extensions.digest(convert_to(coalesce((select jsonb_agg(row order by customer_key)from state),'[]')::text,'UTF8'),'sha256'),'hex'),
 'registered_accounts',coalesce((select jsonb_agg(jsonb_build_object('key',customer_key,'ref',source_ref)order by customer_key)from state),'[]'),
 'prior_archive',(select jsonb_build_object('source_plan_sha256',source_plan_sha256,'payload_hash',payload_hash,'source_at',to_char(source_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'observed_until',to_char(observed_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))from prior))into v;
 return v;
end $$;
revoke all on function app.m9_census_renewal_context()from public,anon,authenticated,service_role;
create function app.m9_census_renewal_delta(prior jsonb,current_accounts jsonb)returns jsonb
language sql immutable security invoker set search_path='' as $$
 with p as(select value a from jsonb_array_elements(prior->'accounts')),c as(select value a from jsonb_array_elements(current_accounts)),
 paired as(select p.a old,c.a new from p full join c on p.a->>'key'=c.a->>'key')
 select jsonb_build_object(
 'added_keys',coalesce((select jsonb_agg(new->'key'order by new->>'key')from paired where old is null),'[]'),
 'missing_from_visible_scope',coalesce((select jsonb_agg(old->'key'order by old->>'key')from paired where new is null),'[]'),
 'name_changed_keys',coalesce((select jsonb_agg(new->'key'order by new->>'key')from paired where old is not null and new is not null and old->'name'is distinct from new->'name'),'[]'),
 'balance_changed_keys',coalesce((select jsonb_agg(new->'key'order by new->>'key')from paired where old is not null and new is not null and old->'used_cents'is distinct from new->'used_cents'),'[]'),
 'documents_changed_keys',coalesce((select jsonb_agg(new->'key'order by new->>'key')from paired where old is not null and new is not null and
 (select coalesce(jsonb_agg(d-'evidence_sha256'order by d->>'key'),'[]')from jsonb_array_elements(old->'documents')d)is distinct from
 (select coalesce(jsonb_agg(d-'evidence_sha256'order by d->>'key'),'[]')from jsonb_array_elements(new->'documents')d)),'[]'))
$$;
revoke all on function app.m9_census_renewal_delta(jsonb,jsonb)from public,anon,authenticated,service_role;
create function app.m9_archive_general_census_renewal(p jsonb)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;src text;h text;ctx jsonb;prior app.m9_customer_census_archives;old app.m9_customer_census_archives;
 a jsonb;d jsonb;k text;key text;dk text;start_at timestamptz;end_at timestamptz;stamp timestamptz;delta jsonb;hold text;
 keys text[]:='{}';refs text[]:='{}';doc_keys text[]:='{}';sub numeric;total numeric:=0;docs int:=0;registered int:=0;prior_members int:=0;rec jsonb;
begin
 if current_user<>'postgres'then raise insufficient_privilege;end if;actor:=app.m9_legacy_actor();
 if not app.m9_detail_shape(p,array['protocol','source_plan_sha256','source_at','observed_until','scope','archive_only','operational_import_allowed','expected_context','evidence','delta','accounts'])
  or p->>'protocol'is distinct from'm9-census-archive-renewal-1'or p->>'scope'is distinct from'VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY'
  or p->'archive_only'is distinct from'true'::jsonb or p->'operational_import_allowed'is distinct from'false'::jsonb
  or coalesce(p->>'source_plan_sha256','')!~'^[a-f0-9]{64}$'or octet_length(p::text)>4000000
  or jsonb_typeof(p->'accounts')is distinct from'array'then raise exception 'CENSUS_RENEWAL_SCOPE_INVALID';end if;
 if jsonb_array_length(p->'accounts')not between 1 and 5000 then raise exception 'CENSUS_RENEWAL_SCOPE_INVALID';end if;
 src:=p->>'source_plan_sha256';h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 -- Same source nonce as v1. Never wait after taking partial metadata barriers.
 if not pg_try_advisory_xact_lock(hashtextextended('m9-census-archive/'||src,0))then raise lock_not_available;end if;
 lock table app.m9_customer_sources,app.m9_legacy_registry,app.m9_customer_census_archives in share row exclusive mode nowait;
 select *into old from app.m9_customer_census_archives where source_plan_sha256=src;
 if found then
  if old.payload_hash<>h then raise exception 'CENSUS_REPLAY_CHANGED';end if;
  return old.receipt||jsonb_build_object('replayed',true,'historical_receipt_only',true);
 end if;
 ctx:=app.m9_census_renewal_context();
 if p->'expected_context'is distinct from ctx then raise exception 'CENSUS_RENEWAL_CONTEXT_CHANGED';end if;
 select *into strict prior from app.m9_customer_census_archives where source_plan_sha256=ctx#>>'{prior_archive,source_plan_sha256}';
 if prior.payload_hash<>encode(extensions.digest(convert_to(prior.payload::text,'UTF8'),'sha256'),'hex')then raise exception 'CENSUS_RENEWAL_PRIOR_CORRUPTED';end if;
 -- evidence.* pins the exact private input FILE BYTES, not PostgreSQL JSONB
 -- serialization. expected_context above carries the separate PostgreSQL hashes
 -- recomputed under these barriers; never compare hashes across encodings.
 if not app.m9_detail_shape(p->'evidence',array['list_sha256','accounts_sha256','prior_payload_sha256','registry_snapshot_sha256'])then raise exception 'CENSUS_RENEWAL_EVIDENCE_INVALID';end if;
 for k in select jsonb_object_keys(p->'evidence')loop if coalesce(p->'evidence'->>k,'')!~'^[a-f0-9]{64}$'then raise exception 'CENSUS_RENEWAL_EVIDENCE_INVALID';end if;end loop;
 foreach k in array array['source_at','observed_until']loop
  if coalesce(p->>k,'')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'then raise exception 'CENSUS_RENEWAL_DATE_INVALID';end if;
  stamp:=(p->>k)::timestamptz;
  if to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p->>k then raise exception 'CENSUS_RENEWAL_DATE_INVALID';end if;
 end loop;
 start_at:=(p->>'source_at')::timestamptz;end_at:=(p->>'observed_until')::timestamptz;
 if start_at<=prior.observed_until or end_at<start_at or end_at>clock_timestamp()or end_at-start_at>interval'24 hours'then raise exception 'CENSUS_RENEWAL_DATE_INVALID';end if;
 for a in select value from jsonb_array_elements(p->'accounts')loop
  if not app.m9_detail_shape(a,array['key','ref','name','source_at','evidence_sha256','used_cents','overdue_cents','list_balance_cents','previously_registered','present_in_prior_census','holds','documents'])
   or coalesce(a->>'ref','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   or jsonb_typeof(a->'name')is distinct from'string'or length(a->>'name')not between 1 and 500 or a->>'name'<>btrim(a->>'name')or a->>'name'~'[[:cntrl:]]'
   or coalesce(a->>'evidence_sha256','')!~'^[a-f0-9]{64}$'or jsonb_typeof(a->'holds')is distinct from'array'or jsonb_typeof(a->'documents')is distinct from'array'then raise exception 'CENSUS_RENEWAL_ACCOUNT_INVALID';end if;
  key:=encode(extensions.digest(convert_to('{"client_ref":'||(a->'ref')::text||',"tenant":"VSM"}','UTF8'),'sha256'),'hex');
  if a->>'key'is distinct from key or key=any(keys)or a->>'ref'=any(refs)then raise exception 'CENSUS_RENEWAL_IDENTITY_INVALID';end if;
  keys:=array_append(keys,key);refs:=array_append(refs,a->>'ref');
  if a->'previously_registered'is distinct from to_jsonb(exists(select 1 from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key)where r.customer_key=key and s.source_ref=a->>'ref'))
   or a->'present_in_prior_census'is distinct from to_jsonb(exists(select 1 from jsonb_array_elements(prior.payload->'accounts')x where x->>'key'=key and x->'ref'=a->'ref'))then raise exception 'CENSUS_RENEWAL_MEMBERSHIP_CHANGED';end if;
  if a->'previously_registered'='true'::jsonb then registered:=registered+1;end if;if a->'present_in_prior_census'='true'::jsonb then prior_members:=prior_members+1;end if;
  if coalesce(a->>'source_at','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'then raise exception 'CENSUS_RENEWAL_DATE_INVALID';end if;
  stamp:=(a->>'source_at')::timestamptz;
  if stamp<start_at or stamp>end_at or to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>a->>'source_at'then raise exception 'CENSUS_RENEWAL_DATE_INVALID';end if;
  foreach k in array array['used_cents','overdue_cents','list_balance_cents']loop
   if a->k='null'::jsonb and k<>'used_cents'then continue;end if;perform app.m9_detail_amount(a->k);
  end loop;
  if a->'overdue_cents'<>'null'::jsonb and(a->>'overdue_cents')::numeric>(a->>'used_cents')::numeric then raise exception 'CENSUS_RENEWAL_INTERNAL_MISMATCH';end if;
  if a->'list_balance_cents'<>'null'::jsonb and a->'list_balance_cents'is distinct from a->'used_cents'then raise exception 'CENSUS_RENEWAL_INTERNAL_MISMATCH';end if;
  sub:=0;
  for d in select value from jsonb_array_elements(a->'documents')loop
   if not app.m9_detail_shape(d,array['key','folio','total_cents','balance_cents','occurred_label','evidence_sha256'])
    or jsonb_typeof(d->'folio')is distinct from'string'or length(d->>'folio')not between 1 and 100 or d->>'folio'<>btrim(d->>'folio')or d->>'folio'~'[[:cntrl:]]'
    or jsonb_typeof(d->'occurred_label')is distinct from'string'or length(d->>'occurred_label')not between 1 and 40 or d->>'occurred_label'~'[[:cntrl:]]'or coalesce(d->>'evidence_sha256','')!~'^[a-f0-9]{64}$'then raise exception 'CENSUS_RENEWAL_DOCUMENT_INVALID';end if;
   dk:=encode(extensions.digest(convert_to('{"client_ref":'||(a->'ref')::text||',"folio":'||(d->'folio')::text||',"tenant":"VSM"}','UTF8'),'sha256'),'hex');
   if d->>'key'is distinct from dk or dk=any(doc_keys)then raise exception 'CENSUS_RENEWAL_DOCUMENT_IDENTITY_INVALID';end if;doc_keys:=array_append(doc_keys,dk);
   if app.m9_detail_amount(d->'balance_cents')<=0 or app.m9_detail_amount(d->'total_cents')<(d->>'balance_cents')::numeric then raise exception 'CENSUS_RENEWAL_INTERNAL_MISMATCH';end if;
   sub:=sub+(d->>'balance_cents')::numeric;docs:=docs+1;
  end loop;
  if sub<>(a->>'used_cents')::numeric then raise exception 'CENSUS_RENEWAL_INTERNAL_MISMATCH';end if;total:=total+sub;
  if total>9007199254740991 then raise exception 'CENSUS_RENEWAL_UNSAFE_SUM';end if;
 end loop;
 delta:=app.m9_census_renewal_delta(prior.payload,p->'accounts');if p->'delta'is distinct from delta then raise exception 'CENSUS_RENEWAL_DELTA_CHANGED';end if;
 for a in select value from jsonb_array_elements(p->'accounts')loop
  if (select count(*)from jsonb_array_elements(a->'holds'))<>(select count(distinct x)from jsonb_array_elements(a->'holds')x)then raise exception 'CENSUS_RENEWAL_HOLD_INVALID';end if;
  for hold in select jsonb_array_elements_text(a->'holds')loop if hold is null or hold not in('DUPLICATE_NAME_NOT_MERGED','PREVIOUS_BALANCE_CHANGED','PREVIOUS_DOCUMENTS_CHANGED','PRIOR_NAME_CHANGED')then raise exception 'CENSUS_RENEWAL_HOLD_INVALID';end if;end loop;
  if(a->'holds'?'PREVIOUS_BALANCE_CHANGED')is distinct from(delta->'balance_changed_keys'? (a->>'key'))
   or(a->'holds'?'PREVIOUS_DOCUMENTS_CHANGED')is distinct from(delta->'documents_changed_keys'?(a->>'key'))
   or(a->'holds'?'PRIOR_NAME_CHANGED')is distinct from(delta->'name_changed_keys'?(a->>'key'))then raise exception 'CENSUS_RENEWAL_HOLD_INVALID';end if;
 end loop;
 rec:=jsonb_build_object('archive',src,'accounts',jsonb_array_length(p->'accounts'),'previous_accounts',registered,'additional_accounts',jsonb_array_length(p->'accounts')-registered,'documents',docs,'observed_balance_cents',total,'operational_import_allowed',false,'native_customers_created',0,'financial_openings_created',0,'stock_movements_created',0,'replayed',false,'archive_only',true,'prior_census_members',prior_members,'prior_archive',ctx->'prior_archive','registry_sha256',ctx->'registry_sha256','delta',delta);
 insert into app.m9_customer_census_archives values(src,h,start_at,end_at,p,rec,actor,clock_timestamp());return rec;
exception when lock_not_available then raise exception 'CENSUS_RENEWAL_BUSY_RETRY'using errcode='55P03';
end $$;
revoke all on function app.m9_archive_general_census_renewal(jsonb)from public,anon,authenticated,service_role;

-- Preserve the actually installed v1 definition, including its forward alias
-- repair. Only add a protocol dispatch immediately after its existing actor guard.
do $dispatch$
declare definition text;needle text:=' actor:=app.m9_legacy_actor();';dispatch text:=' if p->>''protocol''=''m9-census-archive-renewal-1''then return app.m9_archive_general_census_renewal(p);end if;';
begin
 definition:=pg_get_functiondef('app.m9_archive_general_census(jsonb)'::regprocedure);
 if position(dispatch in definition)>0 then return;end if;
 if position(needle in definition)=0 then raise exception 'CENSUS_RENEWAL_DISPATCH_TARGET_CHANGED';end if;
 execute replace(definition,needle,needle||E'\n'||dispatch);
end $dispatch$;
revoke all on function app.m9_archive_general_census(jsonb)from public,anon,authenticated,service_role;
commit;
