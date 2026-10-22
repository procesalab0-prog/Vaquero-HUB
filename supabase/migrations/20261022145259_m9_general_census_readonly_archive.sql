begin;
select app.assert_sicar_staging_enabled();
create table app.m9_customer_census_archives (
 source_plan_sha256 text primary key check(source_plan_sha256 ~ '^[a-f0-9]{64}$'),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 source_at timestamptz not null, observed_until timestamptz not null,
 payload jsonb not null, receipt jsonb not null,
 created_by uuid not null references public.app_users(id), created_at timestamptz not null default clock_timestamp(),
 check(source_at<=observed_until)
);
create index m9_customer_census_actor_idx on app.m9_customer_census_archives(created_by);
alter table app.m9_customer_census_archives enable row level security;
revoke all on app.m9_customer_census_archives from public,anon,authenticated,service_role;
create trigger m9_customer_census_immutable before update or delete on app.m9_customer_census_archives
 for each row execute function app.m9_legacy_event_immutable();

create function app.m9_archive_general_census(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;h text;src text;a jsonb;d jsonb;k text;ref text;key text;dk text;
 old app.m9_customer_census_archives;start_at timestamptz;end_at timestamptz;at_at timestamptz;
 total bigint:=0;subtotal bigint;docs integer:=0;prior integer:=0;n integer;rec jsonb;
begin
 if current_user<>'postgres' then raise exception 'CENSUS_MAINTENANCE_ONLY' using errcode='42501';end if;
 actor:=app.m9_legacy_actor();
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4000000 or
  (select array_agg(x order by x) from jsonb_object_keys(p) x) is distinct from array['accounts','observed_until','protocol','scope','source_at','source_plan_sha256']::text[] or
  p->>'protocol' is distinct from 'm9-census-archive-1' or p->>'scope' is distinct from 'VISIBLE_CUSTOMERS_UNPAID_ROWS_ONLY' or
  coalesce(p->>'source_plan_sha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p->'accounts') is distinct from 'array'
 then raise exception 'CENSUS_SCOPE_INVALID';end if;
 n:=jsonb_array_length(p->'accounts');if n not between 1 and 5000 then raise exception 'CENSUS_SCOPE_INVALID';end if;
 start_at:=(p->>'source_at')::timestamptz;end_at:=(p->>'observed_until')::timestamptz;
 if start_at is null or end_at is null or not isfinite(start_at) or not isfinite(end_at) or start_at>end_at or end_at>clock_timestamp() or end_at-start_at>interval '24 hours' then raise exception 'CENSUS_DATE_INVALID';end if;
 -- Historical archive only: freshness is shown, never reset and never grants operation.
 src:=p->>'source_plan_sha256';h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-census-archive/'||src,0));
 select * into old from app.m9_customer_census_archives where source_plan_sha256=src;
 if old.source_plan_sha256 is not null then
  if old.payload_hash<>h then raise exception 'CENSUS_REPLAY_CHANGED';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 if (select count(distinct x->>'key') from jsonb_array_elements(p->'accounts') x)<>n or
  (select count(distinct x->>'ref') from jsonb_array_elements(p->'accounts') x)<>n then raise exception 'CENSUS_IDENTITY_DUPLICATE';end if;
 for a in select value from jsonb_array_elements(p->'accounts') loop
  if jsonb_typeof(a) is distinct from 'object' or
   (select array_agg(x order by x) from jsonb_object_keys(a) x) is distinct from array['documents','evidence_sha256','holds','key','list_balance_cents','name','overdue_cents','previously_registered','ref','source_at','used_cents']::text[]
   or jsonb_typeof(a->'documents') is distinct from 'array' or jsonb_typeof(a->'holds') is distinct from 'array' or
   jsonb_typeof(a->'name') is distinct from 'string' or length(a->>'name') not between 1 and 500 or a->>'name'<>btrim(a->>'name') or
   coalesce(a->>'ref','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or coalesce(a->>'evidence_sha256','') !~ '^[a-f0-9]{64}$'
   then raise exception 'CENSUS_ACCOUNT_INVALID';end if;
  ref:=a->>'ref';key:=encode(extensions.digest(convert_to('{"client_ref":'||to_jsonb(ref)::text||',"tenant":"VSM"}','UTF8'),'sha256'),'hex');
  if a->>'key' is distinct from key then raise exception 'CENSUS_IDENTITY_CHANGED';end if;
  at_at:=(a->>'source_at')::timestamptz;
  if at_at is null or not isfinite(at_at) or at_at<start_at or at_at>end_at then raise exception 'CENSUS_DATE_INVALID';end if;
  foreach k in array array['used_cents','overdue_cents','list_balance_cents'] loop
   if a->k='null'::jsonb and k<>'used_cents' then continue;end if;
   if jsonb_typeof(a->k) is distinct from 'number' or coalesce(a->>k,'') !~ '^(0|[1-9][0-9]{0,15})$' or (a->>k)::numeric>9007199254740991 then raise exception 'CENSUS_AMOUNT_INVALID';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(a->'holds') x where x<>'"DUPLICATE_NAME_NOT_MERGED"'::jsonb) then raise exception 'CENSUS_ACCOUNT_REVIEW_REQUIRED';end if;
  if a->'previously_registered' is distinct from to_jsonb(exists(select 1 from app.m9_legacy_registry r where r.customer_key=key)) then raise exception 'CENSUS_PREVIOUS_IDENTITY_CHANGED';end if;
  if a->'previously_registered'='true'::jsonb then
   if not exists(select 1 from app.m9_customer_sources s where s.customer_key=key and s.source_ref=ref and s.used_cents=(a->>'used_cents')::bigint) then raise exception 'CENSUS_PREVIOUS_BALANCE_CHANGED';end if;
   prior:=prior+1;
  end if;
  subtotal:=0;
  if (select count(distinct x->>'key') from jsonb_array_elements(a->'documents') x)<>jsonb_array_length(a->'documents') then raise exception 'CENSUS_DOCUMENT_DUPLICATE';end if;
  for d in select value from jsonb_array_elements(a->'documents') loop
   if jsonb_typeof(d) is distinct from 'object' or
    (select array_agg(x order by x) from jsonb_object_keys(d) x) is distinct from array['balance_cents','evidence_sha256','folio','key','occurred_label','total_cents']::text[] or
    jsonb_typeof(d->'folio') is distinct from 'string' or length(d->>'folio') not between 1 and 100 or d->>'folio'<>btrim(d->>'folio') or
    coalesce(d->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(d->'occurred_label') is distinct from 'string' or length(d->>'occurred_label') not between 1 and 40
    then raise exception 'CENSUS_DOCUMENT_INVALID';end if;
   dk:=encode(extensions.digest(convert_to('{"client_ref":'||to_jsonb(ref)::text||',"folio":'||(d->'folio')::text||',"tenant":"VSM"}','UTF8'),'sha256'),'hex');
   if d->>'key' is distinct from dk then raise exception 'CENSUS_DOCUMENT_IDENTITY_CHANGED';end if;
   foreach k in array array['total_cents','balance_cents'] loop
    if jsonb_typeof(d->k) is distinct from 'number' or coalesce(d->>k,'') !~ '^[1-9][0-9]{0,15}$' or (d->>k)::numeric>9007199254740991 then raise exception 'CENSUS_AMOUNT_INVALID';end if;
   end loop;
   if (d->>'balance_cents')::bigint>(d->>'total_cents')::bigint then raise exception 'CENSUS_TOTALS_CHANGED';end if;
   subtotal:=subtotal+(d->>'balance_cents')::bigint;docs:=docs+1;
  end loop;
  if subtotal<>(a->>'used_cents')::bigint then raise exception 'CENSUS_TOTALS_CHANGED';end if;
  total:=total+subtotal;
 end loop;
 if exists(select 1 from app.m9_legacy_registry r where not exists(select 1 from jsonb_array_elements(p->'accounts') a where a->>'key'=r.customer_key)) then raise exception 'CENSUS_PREVIOUS_SCOPE_MISSING';end if;
 rec:=jsonb_build_object('archive',src,'accounts',n,'previous_accounts',prior,'additional_accounts',n-prior,'documents',docs,
  'observed_balance_cents',total,'operational_import_allowed',false,'native_customers_created',0,'financial_openings_created',0,'stock_movements_created',0,'replayed',false);
 insert into app.m9_customer_census_archives values(src,h,start_at,end_at,p,rec,actor,clock_timestamp());
 return rec;
end $$;
revoke all on function app.m9_archive_general_census(jsonb) from public,anon,authenticated,service_role;

create function app.m9_general_migration_read(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();c app.m9_customer_census_archives;q text;f text;pg integer;key text;allrows jsonb;total integer;result jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>2000 or
  exists(select 1 from jsonb_object_keys(p) k where k not in ('q','filter','page','key')) then raise exception 'CENSUS_QUERY_INVALID';end if;
 q:=coalesce(p->>'q','');f:=coalesce(p->>'filter','all');key:=p->>'key';
 if (p ? 'q' and jsonb_typeof(p->'q') is distinct from 'string') or length(q)>100 or f not in ('all','additional','debt','review') or
  (p ? 'page' and (jsonb_typeof(p->'page') is distinct from 'number' or coalesce(p->>'page','') !~ '^[1-9][0-9]{0,5}$')) or
  (key is not null and key !~ '^[a-f0-9]{64}$') then raise exception 'CENSUS_QUERY_INVALID';end if;
 pg:=coalesce((p->>'page')::integer,1);
 select * into c from app.m9_customer_census_archives order by observed_until desc,source_plan_sha256 limit 1;
 if c.source_plan_sha256 is null then raise exception 'CENSUS_ARCHIVE_NOT_READY';end if;
 select coalesce(jsonb_agg(a order by (a->>'used_cents')::bigint desc,a->>'name',a->>'key'),'[]'::jsonb) into allrows
 from jsonb_array_elements(c.payload->'accounts') a
 where (q='' or position(lower(q) in lower(a->>'name'))>0 or position(lower(q) in a->>'ref')>0 or
  exists(select 1 from jsonb_array_elements(a->'documents') d where position(lower(q) in lower(d->>'folio'))>0))
 and (key is null or a->>'key'=key)
 and (f='all' or (f='additional' and a->'previously_registered'='false'::jsonb) or (f='debt' and (a->>'used_cents')::bigint>0) or (f='review' and jsonb_array_length(a->'holds')>0));
 total:=jsonb_array_length(allrows);pg:=least(pg,greatest(1,(total+19)/20));
 select coalesce(jsonb_agg(a order by ord),'[]'::jsonb) into result from jsonb_array_elements(allrows) with ordinality x(a,ord) where ord>(pg-1)*20 and ord<=pg*20;
 return jsonb_build_object('archive',c.source_plan_sha256,'source_at',c.source_at,'observed_until',c.observed_until,
  'historical',true,'operational_import_allowed',false,'source_older_than_24h',c.source_at<clock_timestamp()-interval '24 hours',
  'summary',c.receipt,'total',total,'page',pg,'pages',greatest(1,(total+19)/20),'rows',result,
  'catalog_loaded_codes',(select count(distinct variant_id) from app.sicar_catalog_links),
  'legacy_registered',(select count(*) from app.m9_legacy_registry),
  'legacy_operating_balance_cents',(select coalesce(sum(amount_cents),0) from app.m9_legacy_finance_ledger),
  'pilot_codes',(select count(*) from app.m9_pilot_stock_drafts),
  'pilot_pending_fields',(select count(*) filter(where physical_qty is null)+count(*) filter(where sold_waiting_qty is null)+count(*) filter(where separated_qty is null) from app.m9_pilot_stock_drafts),
  'operating_windows',(select count(*) from app.m9_legacy_operating_windows w where expires_at>clock_timestamp() and not exists(select 1 from app.m9_legacy_operating_revocations r where r.window_id=w.id)));
end $$;
revoke all on function app.m9_general_migration_read(jsonb) from public,anon,service_role;
grant execute on function app.m9_general_migration_read(jsonb) to authenticated;
create function public.m9_general_migration_read(p_input jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select app.m9_general_migration_read(p_input);$$;
revoke all on function public.m9_general_migration_read(jsonb) from public,anon,service_role;
grant execute on function public.m9_general_migration_read(jsonb) to authenticated;
commit;
