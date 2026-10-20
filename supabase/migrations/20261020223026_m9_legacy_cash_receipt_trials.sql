begin;
create table app.m9_legacy_cash_receipts (
 id uuid primary key,
 registry_id uuid not null references app.m9_legacy_registry(id),
 session_id uuid not null references public.cash_sessions(id),
 location_id uuid not null references public.locations(id),
 ledger_id uuid not null unique references app.m9_legacy_finance_ledger(id),
 actor_user_id uuid not null references public.app_users(id),
 request_hash text not null,
 receipt jsonb not null,
 created_at timestamptz not null default now()
);
create index m9_legacy_cash_receipts_account_idx on app.m9_legacy_cash_receipts(registry_id);
create index m9_legacy_cash_receipts_session_idx on app.m9_legacy_cash_receipts(session_id);
create index m9_legacy_cash_receipts_location_idx on app.m9_legacy_cash_receipts(location_id);
create index m9_legacy_cash_receipts_actor_idx on app.m9_legacy_cash_receipts(actor_user_id);
create table app.m9_legacy_cash_trials (
 id uuid primary key,
 actor_user_id uuid not null references public.app_users(id),
 location_id uuid not null references public.locations(id),
 request_hash text not null,
 receipt jsonb not null,
 created_at timestamptz not null default now()
);
create index m9_legacy_cash_trials_actor_idx on app.m9_legacy_cash_trials(actor_user_id);
create index m9_legacy_cash_trials_location_idx on app.m9_legacy_cash_trials(location_id);
alter table app.m9_legacy_cash_receipts enable row level security;
alter table app.m9_legacy_cash_trials enable row level security;
revoke all on app.m9_legacy_cash_receipts,app.m9_legacy_cash_trials from public,anon,authenticated,service_role;
create trigger m9_legacy_cash_receipts_immutable before update or delete on app.m9_legacy_cash_receipts for each row execute function app.m9_legacy_event_immutable();
create trigger m9_legacy_cash_trials_immutable before update or delete on app.m9_legacy_cash_trials for each row execute function app.m9_legacy_event_immutable();

-- A single transactional collection engine, callable only by maintenance or the
-- rollback wrapper below. No public endpoint commits a fictitious payment.
create function app.m9_record_legacy_cash_trial(p_request uuid,p_account uuid,p_session uuid,p_parts jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();h text;old app.m9_legacy_cash_receipts;cash_session public.cash_sessions;
 part jsonb;pm public.payment_methods;amount bigint;total bigint:=0;cash bigint:=0;tendered bigint;change bigint:=0;normalized jsonb:='[]';
 allocation jsonb;folio bigint;location_code text;rec jsonb;prior_cash_flag text;prior_trial_flag text;source_name text;
begin
 if current_user<>'postgres' or current_setting('app.m9_legacy_cash_trial',true) is distinct from 'on' or not app.has_perm('credit.collect') then raise exception 'M9_CASH_TRIAL_ONLY' using errcode='42501';end if;
 if p_request is null or p_account is null or p_session is null or jsonb_typeof(p_parts) is distinct from 'array' then raise exception 'M9_INVALID_PAYMENT';end if;
 if jsonb_array_length(p_parts) not between 1 and 3 or exists(select 1 from jsonb_array_elements(p_parts) x where jsonb_typeof(x)<>'object') or exists(select 1 from jsonb_array_elements(p_parts) x group by x->>'method_code' having count(*)>1) then raise exception 'M9_INVALID_PAYMENT';end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('account',p_account,'session',p_session,'parts',p_parts)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 select * into old from app.m9_legacy_cash_receipts where id=p_request;
 if found then
  if old.actor_user_id<>actor or old.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 select * into cash_session from public.cash_sessions where id=p_session and status='OPEN' for update;
 if not found or cash_session.cashier_user_id<>actor or not app.can_access_location(cash_session.location_id) then raise exception 'M9_SESSION_FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from app.m9_legacy_finance_ledger l join app.m9_legacy_finance_events e on e.id=l.opening_event where l.registry_id=p_account and l.kind='OPEN' and e.receipt->>'location'=cash_session.location_id::text) then raise exception 'M9_ACCOUNT_LOCATION_MISMATCH';end if;
 for part in select value from jsonb_array_elements(p_parts) loop
  if part->>'method_code' is null or part->>'method_code' not in ('CASH','CARD','TRANSFER') or part->>'amount_cents' is null or part->>'amount_cents' !~ '^[1-9][0-9]{0,8}$' then raise exception 'M9_INVALID_PAYMENT';end if;
  amount:=(part->>'amount_cents')::bigint;
  select * into pm from public.payment_methods where code=part->>'method_code' and is_active;
  if not found or (pm.code='CASH' and pm.kind<>'CASH') or (pm.code<>'CASH' and pm.kind='CASH') then raise exception 'M9_PAYMENT_METHOD_UNAVAILABLE';end if;
  if pm.code='CASH' then
   if part->>'tendered_cents' is null or part->>'tendered_cents' !~ '^[1-9][0-9]{0,8}$' then raise exception 'M9_CASH_TENDERED_REQUIRED';end if;
   tendered:=(part->>'tendered_cents')::bigint;
   if tendered<amount then raise exception 'M9_INSUFFICIENT_TENDERED';end if;
   cash:=cash+amount;change:=tendered-amount;
   normalized:=normalized||jsonb_build_array(jsonb_build_object('method_code',pm.code,'name',pm.name,'amount_cents',amount,'tendered_cents',tendered,'change_cents',change));
  else
   if length(btrim(coalesce(part->>'reference',''))) not between 3 and 100 then raise exception 'M9_PAYMENT_REFERENCE_REQUIRED';end if;
   normalized:=normalized||jsonb_build_array(jsonb_build_object('method_code',pm.code,'name',pm.name,'amount_cents',amount,'reference',btrim(part->>'reference')));
  end if;
  total:=total+amount;
 end loop;
 if total>999999999 then raise exception 'M9_INVALID_PAYMENT';end if;
 prior_trial_flag:=current_setting('app.m9_legacy_finance_trial',true);
 perform set_config('app.m9_legacy_finance_trial','on',true);
 allocation:=app.m9_legacy_trial_allocate(p_request,p_account,total);
 perform set_config('app.m9_legacy_finance_trial',coalesce(prior_trial_flag,''),true);
 insert into public.folios(location_id,document_type,next_number) values(cash_session.location_id,'M9_LEGACY_PAYMENT_TRIAL',2)
 on conflict(location_id,document_type) do update set next_number=public.folios.next_number+1 returning next_number-1 into folio;
 select code into strict location_code from public.locations where id=cash_session.location_id;
 select s.payload->>'source_display_name' into strict source_name from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key) where r.id=p_account;
 rec:=allocation||jsonb_build_object('id',p_request,'folio','ENSAYO-'||location_code||'-AH-'||lpad(folio::text,6,'0'),'customer_name',source_name,'account',p_account,'session',p_session,'location',cash_session.location_id,'received_at',clock_timestamp(),'parts',normalized,'cash_delta_cents',cash,'change_cents',change,'trial_only',true,'valid_payment_receipt',false,'replayed',false);
 insert into app.m9_legacy_cash_receipts values(p_request,p_account,p_session,cash_session.location_id,(allocation->>'payment')::uuid,actor,h,rec,now());
 prior_cash_flag:=current_setting('app.cash_write',true);
 perform set_config('app.cash_write','on',true);
 if cash>0 then
  insert into public.cash_movements(session_id,location_id,movement_type,amount_cents,reference_type,reference_id,user_id,metadata)
  values(p_session,cash_session.location_id,'CREDIT_PAYMENT',cash,'M9_LEGACY_PAYMENT_TRIAL',p_request::text,actor,jsonb_build_object('folio',rec->>'folio','registry_id',p_account,'trial_only',true));
 end if;
 perform set_config('app.cash_write',coalesce(prior_cash_flag,''),true);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,metadata) values(actor,'m9.legacy_cash.trial_received','m9_legacy_cash_receipts',p_request::text,cash_session.location_id,jsonb_build_object('total_cents',total,'cash_delta_cents',cash,'trial_only',true));
 return rec;
end$$;

create function app.m9_legacy_cash_api(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();rid uuid;aid uuid;sid uuid;h text;old app.m9_legacy_cash_trials;rec jsonb;again jsonb;before_balance bigint;after_balance bigint;before_cash bigint;after_cash bigint;before_folio jsonb;after_folio jsonb;before_audit bigint;prior_mode text;loc uuid;
begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>4000 then raise exception 'M9_INVALID_PAYMENT';end if;
 if p_action='CONTEXT' then
  if not app.has_perm('credit.collect') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  return jsonb_build_object('session',(select jsonb_build_object('id',s.id,'location_id',s.location_id,'location',l.name) from public.cash_sessions s join public.locations l on l.id=s.location_id where s.status='OPEN' and s.cashier_user_id=actor and app.can_access_location(s.location_id) order by s.id limit 1),
  'last_trial',(select jsonb_build_object('id',t.id,'amount_cents',t.receipt->'amount_cents') from app.m9_legacy_cash_trials t where t.actor_user_id=actor and app.can_access_location(t.location_id) order by t.created_at desc,t.id limit 1));
 elsif p_action='RECEIPT' then
  rid:=(p_input->>'request')::uuid;
  select * into old from app.m9_legacy_cash_trials t where t.id=rid and t.actor_user_id=actor and app.can_access_location(t.location_id);
  if not found then raise exception 'M9_RECEIPT_NOT_FOUND' using errcode='42501';end if;
  return old.receipt;
 elsif p_action='TRIAL' then
  if not app.has_perm('credit.collect') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  rid:=(p_input->>'request')::uuid;aid:=(p_input->>'account')::uuid;sid:=(p_input->>'session')::uuid;
  if rid is null or aid is null or sid is null then raise exception 'M9_INVALID_PAYMENT';end if;
  h:=encode(extensions.digest(convert_to(jsonb_build_object('account',aid,'session',sid,'parts',p_input->'parts')::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
  select * into old from app.m9_legacy_cash_trials where id=rid;
  if found then
   if old.actor_user_id<>actor or old.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   if not app.can_access_location(old.location_id) then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
   return old.receipt||'{"replayed":true}'::jsonb;
  end if;
  select location_id into loc from public.cash_sessions where id=sid and status='OPEN' and cashier_user_id=actor and app.can_access_location(location_id) for update;
  if not found then raise exception 'M9_SESSION_FORBIDDEN' using errcode='42501';end if;
  select coalesce(sum(amount_cents),0) into before_balance from app.m9_legacy_finance_ledger where registry_id=aid;
  select coalesce(sum(amount_cents),0) into before_cash from public.cash_movements where session_id=sid;
  select to_jsonb(f) into before_folio from public.folios f where f.location_id=loc and f.document_type='M9_LEGACY_PAYMENT_TRIAL';
  select count(*) into before_audit from public.audit_log where entity_type='m9_legacy_cash_receipts' and entity_id=rid::text;
  prior_mode:=current_setting('app.m9_legacy_cash_trial',true);
  begin
   perform set_config('app.m9_legacy_cash_trial','on',true);
   rec:=app.m9_record_legacy_cash_trial(rid,aid,sid,p_input->'parts');
   again:=app.m9_record_legacy_cash_trial(rid,aid,sid,p_input->'parts');
   select coalesce(sum(amount_cents),0) into after_cash from public.cash_movements where session_id=sid;
   if again->'replayed'<>'true'::jsonb or again-'replayed' is distinct from rec-'replayed' or after_cash-before_cash<>(rec->>'cash_delta_cents')::bigint or (select count(*) from public.cash_movements where reference_type='M9_LEGACY_PAYMENT_TRIAL' and reference_id=rid::text)<>(case when (rec->>'cash_delta_cents')::bigint>0 then 1 else 0 end) then raise exception 'M9_CASH_RECONCILIATION_FAILED';end if;
   raise exception 'M9_CASH_TRIAL_ROLLBACK' using errcode='PT902';
  exception when sqlstate 'PT902' then null;end;
  perform set_config('app.m9_legacy_cash_trial',coalesce(prior_mode,''),true);
  select coalesce(sum(amount_cents),0) into after_balance from app.m9_legacy_finance_ledger where registry_id=aid;
  select coalesce(sum(amount_cents),0) into after_cash from public.cash_movements where session_id=sid;
  select to_jsonb(f) into after_folio from public.folios f where f.location_id=loc and f.document_type='M9_LEGACY_PAYMENT_TRIAL';
  if before_balance<>after_balance or before_cash<>after_cash or before_folio is distinct from after_folio or exists(select 1 from app.m9_legacy_cash_receipts where id=rid) or exists(select 1 from app.m9_legacy_finance_ledger where request_id=rid) or (select count(*) from public.audit_log where entity_type='m9_legacy_cash_receipts' and entity_id=rid::text)<>before_audit then raise exception 'M9_CASH_TRIAL_ROLLBACK_FAILED';end if;
  rec:=rec||jsonb_build_object('request',rid,'rolled_back',true,'replay_verified',true,'cash_delta_verified',true,'retained_balance_cents',after_balance,'valid_payment_receipt',false);
  insert into app.m9_legacy_cash_trials values(rid,actor,loc,h,rec,now());
  return rec;
 else raise exception 'M9_ACTION_NOT_ALLOWED';end if;
end$$;
create function public.m9_legacy_cash(p_action text,p_input jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select app.m9_legacy_cash_api(p_action,p_input)$$;
revoke all on function app.m9_record_legacy_cash_trial(uuid,uuid,uuid,jsonb),app.m9_legacy_cash_api(text,jsonb),public.m9_legacy_cash(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app.m9_legacy_cash_api(text,jsonb),public.m9_legacy_cash(text,jsonb) to authenticated;
commit;
