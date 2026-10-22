begin;
select app.assert_sicar_staging_enabled();
create table app.m9_credit_detail_archives(
 source_plan_sha256 text primary key check(source_plan_sha256~'^[a-f0-9]{64}$'),
 payload_hash text not null check(payload_hash~'^[a-f0-9]{64}$'),
 source_from timestamptz not null,source_until timestamptz not null,
 payload jsonb not null,receipt jsonb not null,
 created_by uuid not null references public.app_users(id),created_at timestamptz not null default clock_timestamp(),
 check(source_from<=source_until)
);
create index m9_credit_detail_actor_idx on app.m9_credit_detail_archives(created_by);
alter table app.m9_credit_detail_archives enable row level security;
revoke all on app.m9_credit_detail_archives from public,anon,authenticated,service_role;
create trigger m9_credit_detail_immutable before update or delete on app.m9_credit_detail_archives
 for each row execute function app.m9_legacy_event_immutable();

create function app.m9_detail_shape(v jsonb,keys text[]) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(case when jsonb_typeof(v)='object' then
 (select array_agg(k order by k) from jsonb_object_keys(v) k)=(select array_agg(k order by k) from unnest(keys) k)
 else false end,false);
$$;
create function app.m9_detail_amount(v jsonb) returns bigint language plpgsql immutable security invoker set search_path='' as $$
begin
 if jsonb_typeof(v) is distinct from 'number' or coalesce(v#>>'{}','')!~'^(0|[1-9][0-9]{0,15})$' or (v#>>'{}')::numeric>9007199254740991 then raise exception 'DETAIL_AMOUNT_INVALID';end if;
 return (v#>>'{}')::bigint;
end $$;
revoke all on function app.m9_detail_shape(jsonb,text[]),app.m9_detail_amount(jsonb) from public,anon,authenticated,service_role;

create function app.m9_archive_credit_details(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;src text;h text;old app.m9_credit_detail_archives;from_at timestamptz;until_at timestamptz;stamp timestamptz;
 a jsonb;d jsonb;l jsonb;pay jsonb;k text;ck text;dk text;pk text;v uuid;
 account_keys text[]:='{}';refs text[]:='{}';doc_keys text[]:='{}';source_ids text[]:='{}';payment_keys text[]:='{}';indices int[];
 total bigint;balance bigint;paid bigint;active bigint;account_total bigint;grand_total bigint:=0;
 docs int:=0;open_docs int:=0;paid_docs int:=0;payments int:=0;cancelled int:=0;active_total bigint:=0;cancelled_total bigint:=0;lines int:=0;mapped int:=0;review int:=0;zero_history int:=0;names int:=0;changed int:=0;rec jsonb;
begin
 if current_user<>'postgres' then raise exception 'DETAIL_MAINTENANCE_ONLY' using errcode='42501';end if;
 actor:=app.m9_legacy_actor();
 if not app.m9_detail_shape(p,array['protocol','source_plan_sha256','source_from','source_until','operational_import_allowed','accounts']) or octet_length(p::text)>4000000 or
 p->>'protocol' is distinct from 'm9-credit-detail-archive-1' or coalesce(p->>'source_plan_sha256','')!~'^[a-f0-9]{64}$' or
 p->'operational_import_allowed' is distinct from 'false'::jsonb or jsonb_typeof(p->'accounts') is distinct from 'array' then raise exception 'DETAIL_SCOPE_INVALID';end if;
 if jsonb_array_length(p->'accounts') not between 1 and 5000 then raise exception 'DETAIL_SCOPE_INVALID';end if;
 from_at:=(p->>'source_from')::timestamptz;until_at:=(p->>'source_until')::timestamptz;
 if from_at is null or until_at is null or not isfinite(from_at) or not isfinite(until_at) or from_at>until_at or until_at>clock_timestamp() or until_at-from_at>interval '24 hours' then raise exception 'DETAIL_DATE_INVALID';end if;
 src:=p->>'source_plan_sha256';h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-credit-detail/'||src,0));
 select * into old from app.m9_credit_detail_archives where source_plan_sha256=src;
 if old.source_plan_sha256 is not null then
  if old.payload_hash<>h then raise exception 'DETAIL_REPLAY_CHANGED';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 for a in select value from jsonb_array_elements(p->'accounts') loop
  if not app.m9_detail_shape(a,array['key','ref','name','source_at','balance_cents','documents']) or jsonb_typeof(a->'documents') is distinct from 'array' or
   jsonb_typeof(a->'name') is distinct from 'string' or length(a->>'name') not between 1 and 500 or a->>'name'<>btrim(a->>'name') or
   coalesce(a->>'ref','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'DETAIL_ACCOUNT_INVALID';end if;
  ck:=encode(extensions.digest(convert_to('{"client_ref":'||(a->'ref')::text||',"tenant":"VSM"}','UTF8'),'sha256'),'hex');
  if a->>'key' is distinct from ck or ck=any(account_keys) or a->>'ref'=any(refs) then raise exception 'DETAIL_ACCOUNT_IDENTITY_INVALID';end if;
  account_keys:=array_append(account_keys,ck);refs:=array_append(refs,a->>'ref');
  stamp:=(a->>'source_at')::timestamptz;if stamp is null or not isfinite(stamp) or stamp<from_at or stamp>until_at then raise exception 'DETAIL_DATE_INVALID';end if;
  account_total:=0;
  for d in select value from jsonb_array_elements(a->'documents') loop
   if not app.m9_detail_shape(d,array['key','folio','source_id','source_at','historical_name','total_cents','balance_cents','paid_cents','due_date','holds','linked_history_complete','evidence_sha256','payments','lines']) or
    jsonb_typeof(d->'folio') is distinct from 'string' or length(d->>'folio') not between 1 and 100 or d->>'folio'<>btrim(d->>'folio') or
    coalesce(d->>'source_id','')!~'^[a-f0-9]{24}$' or coalesce(d->>'evidence_sha256','')!~'^[a-f0-9]{64}$' or
    jsonb_typeof(d->'historical_name') is distinct from 'string' or length(d->>'historical_name') not between 1 and 500 or
    jsonb_typeof(d->'holds') is distinct from 'array' or jsonb_typeof(d->'linked_history_complete') is distinct from 'boolean' or
    jsonb_typeof(d->'payments') is distinct from 'array' or jsonb_typeof(d->'lines') is distinct from 'array' or jsonb_array_length(d->'lines')<1 then raise exception 'DETAIL_DOCUMENT_INVALID';end if;
   dk:=encode(extensions.digest(convert_to('{"client_ref":'||(a->'ref')::text||',"folio":'||(d->'folio')::text||',"tenant":"VSM"}','UTF8'),'sha256'),'hex');
   if d->>'key' is distinct from dk or dk=any(doc_keys) or d->>'source_id'=any(source_ids) then raise exception 'DETAIL_DOCUMENT_IDENTITY_INVALID';end if;
   doc_keys:=array_append(doc_keys,dk);source_ids:=array_append(source_ids,d->>'source_id');
   stamp:=(d->>'source_at')::timestamptz;if stamp is null or not isfinite(stamp) or stamp<from_at or stamp>until_at then raise exception 'DETAIL_DATE_INVALID';end if;
   total:=app.m9_detail_amount(d->'total_cents');balance:=app.m9_detail_amount(d->'balance_cents');paid:=app.m9_detail_amount(d->'paid_cents');
   if total<=0 or total<>balance+paid then raise exception 'DETAIL_TOTALS_INVALID';end if;
   if balance>0 then
    if coalesce(d->>'due_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (d->>'due_date')::date::text<>d->>'due_date' then raise exception 'DETAIL_DUE_DATE_INVALID';end if;
    open_docs:=open_docs+1;
   else
    if d->'due_date' is distinct from 'null'::jsonb then raise exception 'DETAIL_PAID_DUE_DATE_INVENTED';end if;paid_docs:=paid_docs+1;
   end if;
   if exists(select 1 from jsonb_array_elements_text(d->'holds') x where x not in ('HISTORICAL_CUSTOMER_NAME_DIFFERS','NEW_DOCUMENT_SINCE_BASELINE','AMOUNT_CHANGED_SINCE_BASELINE','SOURCE_ID_CHANGED','LINE_SUM_DIFFERS_FROM_TOTAL')) then raise exception 'DETAIL_HOLD_INVALID';end if;
   if (d->>'historical_name'<>a->>'name') is distinct from (d->'holds' ? 'HISTORICAL_CUSTOMER_NAME_DIFFERS') then raise exception 'DETAIL_NAME_REVIEW_MISSING';end if;
   if jsonb_array_length(d->'holds')>0 then review:=review+1;end if;
   if d->'holds' ? 'HISTORICAL_CUSTOMER_NAME_DIFFERS' then names:=names+1;end if;
   if d->'holds' ? 'AMOUNT_CHANGED_SINCE_BASELINE' then changed:=changed+1;end if;
   active:=0;
   for pay in select value from jsonb_array_elements(d->'payments') loop
    if not app.m9_detail_shape(pay,array['key','ref','occurred_label','amount_cents','cancelled','evidence_sha256']) or coalesce(pay->>'ref','')!~'^Abono [0-9]+$' or jsonb_typeof(pay->'cancelled') is distinct from 'boolean' or coalesce(pay->>'evidence_sha256','')!~'^[a-f0-9]{64}$' or coalesce(pay->>'occurred_label','')!~'^[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} [AP]M$' then raise exception 'DETAIL_PAYMENT_INVALID';end if;
    pk:=encode(extensions.digest(convert_to('{"source_ref":'||(pay->'ref')::text||',"tenant":"VSM"}','UTF8'),'sha256'),'hex');
    if pay->>'key' is distinct from pk or pk=any(payment_keys) then raise exception 'DETAIL_PAYMENT_IDENTITY_INVALID';end if;payment_keys:=array_append(payment_keys,pk);
    total:=app.m9_detail_amount(pay->'amount_cents');if total<=0 then raise exception 'DETAIL_PAYMENT_INVALID';end if;
    if (pay->>'cancelled')::boolean then cancelled:=cancelled+1;cancelled_total:=cancelled_total+total;else active:=active+total;active_total:=active_total+total;end if;payments:=payments+1;
   end loop;
   if active<>paid then raise exception 'DETAIL_ACTIVE_PAYMENTS_DIFFER';end if;
   if d->'linked_history_complete'='false'::jsonb then
    if paid<>0 or jsonb_array_length(d->'payments')<>0 then raise exception 'DETAIL_UNOBSERVED_HISTORY_INVALID';end if;zero_history:=zero_history+1;
   end if;
   indices:='{}';
   for l in select value from jsonb_array_elements(d->'lines') loop
    if not app.m9_detail_shape(l,array['index','barcode','quantity','description','variant_id','holds','delivery_status','reserved_qty','stock_deduction']) or
     jsonb_typeof(l->'index') is distinct from 'number' or coalesce(l->>'index','')!~'^(0|[1-9][0-9]{0,5})$' or (l->>'index')::int=any(indices) or
     jsonb_typeof(l->'barcode') is distinct from 'string' or length(l->>'barcode') not between 1 and 500 or l->>'barcode'<>btrim(l->>'barcode') or
     jsonb_typeof(l->'quantity') is distinct from 'string' or coalesce(l->>'quantity','')!~'^[1-9][0-9]{0,8}$' or
     jsonb_typeof(l->'description') is distinct from 'string' or length(l->>'description') not between 1 and 1000 or
     jsonb_typeof(l->'holds') is distinct from 'array' or not(l->'holds' ? 'DELIVERY_NOT_OBSERVED') or
     l->>'delivery_status' is distinct from 'UNKNOWN' or l->'reserved_qty' is distinct from 'null'::jsonb or l->'stock_deduction' is distinct from 'null'::jsonb then raise exception 'DETAIL_LINE_INVALID';end if;
    indices:=array_append(indices,(l->>'index')::int);
    if exists(select 1 from jsonb_array_elements_text(l->'holds') x where x not in ('DELIVERY_NOT_OBSERVED','LEGACY_GENERIC_DEBT_LINE','AMBIGUOUS_BARCODE','BARCODE_NOT_IN_STAGING','SOURCE_LINE_PRICE_REVIEW')) then raise exception 'DETAIL_LINE_HOLD_INVALID';end if;
    if l->'variant_id'<>'null'::jsonb then
     if coalesce(l->>'variant_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or l->>'barcode'='SX00000' or l->'holds' ? 'LEGACY_GENERIC_DEBT_LINE' then raise exception 'DETAIL_MAPPING_INVALID';end if;
     v:=(l->>'variant_id')::uuid;
     if (select count(distinct b.variant_id) from public.barcodes b where b.code=l->>'barcode')<>1 or not exists(select 1 from public.barcodes b join public.variants v2 on v2.id=b.variant_id where b.code=l->>'barcode' and b.variant_id=v) then raise exception 'DETAIL_MAPPING_CHANGED';end if;mapped:=mapped+1;
    elsif not(l->'holds' ?| array['LEGACY_GENERIC_DEBT_LINE','AMBIGUOUS_BARCODE','BARCODE_NOT_IN_STAGING']) then raise exception 'DETAIL_UNMAPPED_HOLD_REQUIRED';end if;
    lines:=lines+1;
   end loop;
   docs:=docs+1;account_total:=account_total+balance;
  end loop;
  if account_total<>app.m9_detail_amount(a->'balance_cents') then raise exception 'DETAIL_ACCOUNT_TOTALS_DIFFER';end if;grand_total:=grand_total+account_total;
 end loop;
 rec:=jsonb_build_object('archive',src,'accounts',cardinality(account_keys),'documents',docs,'open_documents',open_docs,'paid_documents',paid_docs,'observed_balance_cents',grand_total,'historical_payments',payments,'cancelled_payments',cancelled,'active_paid_cents',active_total,'cancelled_cents',cancelled_total,'credit_lines',lines,'mapped_lines',mapped,'unmapped_lines',lines-mapped,'review_documents',review,'historical_name_differences',names,'changed_amounts',changed,'explicit_zero_active_documents',zero_history,'operational_import_allowed',false,'replayed',false);
 insert into app.m9_credit_detail_archives values(src,h,from_at,until_at,p,rec,actor,clock_timestamp());return rec;
end $$;
revoke all on function app.m9_archive_credit_details(jsonb) from public,anon,authenticated,service_role;

create function app.m9_credit_detail_read(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();c app.m9_credit_detail_archives;q text;f text;pg int;rows jsonb;result jsonb;n int;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>2000 or exists(select 1 from jsonb_object_keys(p) k where k not in ('q','filter','page')) then raise exception 'DETAIL_QUERY_INVALID';end if;
 q:=coalesce(p->>'q','');f:=coalesce(p->>'filter','all');
 if (p ? 'q' and jsonb_typeof(p->'q') is distinct from 'string') or length(q)>100 or f not in ('all','review','unmapped','paid') or (p ? 'filter' and jsonb_typeof(p->'filter') is distinct from 'string') or
  (p ? 'page' and (jsonb_typeof(p->'page') is distinct from 'number' or coalesce(p->>'page','')!~'^[1-9][0-9]{0,5}$')) then raise exception 'DETAIL_QUERY_INVALID';end if;
 pg:=coalesce((p->>'page')::int,1);
 select * into c from app.m9_credit_detail_archives order by source_until desc,source_plan_sha256 limit 1;
 if c.source_plan_sha256 is null then return jsonb_build_object('ready',false,'operational_import_allowed',false);end if;
 select coalesce(jsonb_agg(a order by (a->>'balance_cents')::bigint desc,a->>'name',a->>'key'),'[]'::jsonb) into rows from jsonb_array_elements(c.payload->'accounts') a
 where (q='' or position(lower(q) in lower(a->>'name'))>0 or position(lower(q) in a->>'ref')>0 or exists(select 1 from jsonb_array_elements(a->'documents') d where position(lower(q) in lower(d->>'folio'))>0 or position(lower(q) in lower(d->>'historical_name'))>0 or exists(select 1 from jsonb_array_elements(d->'lines') l where position(q in l->>'barcode')>0)))
 and (f='all' or exists(select 1 from jsonb_array_elements(a->'documents') d where (f='review' and jsonb_array_length(d->'holds')>0) or (f='paid' and d->'balance_cents'='0'::jsonb) or (f='unmapped' and exists(select 1 from jsonb_array_elements(d->'lines') l where l->'variant_id'='null'::jsonb))));
 n:=jsonb_array_length(rows);pg:=least(pg,greatest(1,(n+9)/10));
 select coalesce(jsonb_agg(a order by ord),'[]'::jsonb) into result from jsonb_array_elements(rows) with ordinality x(a,ord) where ord>(pg-1)*10 and ord<=pg*10;
 return jsonb_build_object('ready',true,'archive',c.source_plan_sha256,'source_from',c.source_from,'source_until',c.source_until,'source_older_than_24h',c.source_from<clock_timestamp()-interval '24 hours','historical',true,'operational_import_allowed',false,'summary',c.receipt,'rows',result,'total',n,'page',pg,'pages',greatest(1,(n+9)/10));
end $$;
revoke all on function app.m9_credit_detail_read(jsonb) from public,anon,service_role;
grant execute on function app.m9_credit_detail_read(jsonb) to authenticated;
create function public.m9_credit_detail_read(p_input jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select app.m9_credit_detail_read(p_input);$$;
revoke all on function public.m9_credit_detail_read(jsonb) from public,anon,service_role;
grant execute on function public.m9_credit_detail_read(jsonb) to authenticated;
commit;
