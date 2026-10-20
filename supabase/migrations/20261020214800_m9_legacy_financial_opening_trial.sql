begin;
-- Separate identity book: never fabricate native customer consent or credit sales.
create table app.m9_legacy_finance_events (
 id uuid primary key,
 kind text not null check(kind in ('OPEN','REVERSE','TRIAL')),
 actor_user_id uuid not null references public.app_users(id),
 request_hash text not null,
 receipt jsonb not null,
 created_at timestamptz not null default now()
);
create index m9_legacy_finance_actor_idx on app.m9_legacy_finance_events(actor_user_id);
create table app.m9_legacy_finance_ledger (
 id uuid primary key default extensions.gen_random_uuid(),
 registry_id uuid not null references app.m9_legacy_registry(id),
 document_key text references app.m9_credit_documents(document_key),
 opening_event uuid not null references app.m9_legacy_finance_events(id),
 request_id uuid not null,
 kind text not null check(kind in ('OPEN','PAYMENT_TRIAL','REVERSE')),
 amount_cents bigint not null,
 due_date date,
 actor_user_id uuid not null references public.app_users(id),
 created_at timestamptz not null default now(),
 check((kind='OPEN' and amount_cents>0 and document_key is not null) or (kind in ('PAYMENT_TRIAL','REVERSE') and amount_cents<0))
);
create unique index m9_legacy_finance_document_once on app.m9_legacy_finance_ledger(document_key) where kind='OPEN';
create unique index m9_legacy_finance_payment_once on app.m9_legacy_finance_ledger(request_id) where kind='PAYMENT_TRIAL';
create index m9_legacy_finance_account_idx on app.m9_legacy_finance_ledger(registry_id);
create index m9_legacy_finance_opening_idx on app.m9_legacy_finance_ledger(opening_event);
create index m9_legacy_finance_actor_ledger_idx on app.m9_legacy_finance_ledger(actor_user_id);
create table app.m9_legacy_finance_allocations (
 debit_id uuid not null references app.m9_legacy_finance_ledger(id),
 credit_id uuid not null references app.m9_legacy_finance_ledger(id),
 amount_cents bigint not null check(amount_cents>0),
 primary key(debit_id,credit_id)
);
create index m9_legacy_finance_alloc_credit_idx on app.m9_legacy_finance_allocations(credit_id);
create trigger m9_legacy_finance_events_immutable before update or delete on app.m9_legacy_finance_events for each row execute function app.m9_legacy_event_immutable();
create trigger m9_legacy_finance_ledger_immutable before update or delete on app.m9_legacy_finance_ledger for each row execute function app.m9_legacy_event_immutable();
create trigger m9_legacy_finance_alloc_immutable before update or delete on app.m9_legacy_finance_allocations for each row execute function app.m9_legacy_event_immutable();
alter table app.m9_legacy_finance_events enable row level security;
alter table app.m9_legacy_finance_ledger enable row level security;
alter table app.m9_legacy_finance_allocations enable row level security;
revoke all on app.m9_legacy_finance_events,app.m9_legacy_finance_ledger,app.m9_legacy_finance_allocations from public,anon,authenticated,service_role;

-- A native opening cannot coexist with a legacy opening, even after compensation.
create function app.m9_legacy_no_double_opening() returns trigger
language plpgsql security invoker set search_path='' as $$begin
 if (new.target_customer_id is distinct from old.target_customer_id or new.opening_event_id is distinct from old.opening_event_id) and exists(select 1 from app.m9_legacy_registry r join app.m9_legacy_finance_ledger l on l.registry_id=r.id where r.customer_key=old.customer_key) then raise exception 'M9_LEGACY_NATIVE_DOUBLE_OPENING_BLOCKED';end if;
 return new;
end$$;
create trigger m9_legacy_native_opening_guard before update on app.m9_customer_sources for each row execute function app.m9_legacy_no_double_opening();
revoke all on function app.m9_legacy_no_double_opening() from public,anon,authenticated,service_role;

create function app.m9_legacy_finance_plan(p_batch text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;
begin
 perform app.m9_legacy_actor();
 select coalesce(jsonb_agg(jsonb_build_object('registry_id',r.id,'customer_key',r.customer_key,'source_hash',r.source_hash,
 'documents', (select jsonb_agg(jsonb_build_object('key',d.document_key,'payload',d.payload,'balance',d.balance_cents,'paid',d.paid_cents,'total',d.total_cents,'due',d.due_date,'status',d.financial_status) order by d.document_key) from app.m9_credit_documents d where d.customer_key=r.customer_key),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.payment_key),'[]'::jsonb) from app.m9_credit_source_payments p join app.m9_credit_documents d on d.document_key=p.document_key where d.customer_key=r.customer_key)) order by r.customer_key),'[]'::jsonb) into rows
 from app.m9_legacy_registry r where r.batch_sha256=p_batch and exists(select 1 from app.m9_credit_documents d where d.customer_key=r.customer_key and d.financial_status='OPEN');
 return jsonb_build_object('batch',p_batch,'scope','APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS','accounts',rows,
 'document_count',(select count(*) from app.m9_credit_documents d join app.m9_legacy_registry r on r.customer_key=d.customer_key where r.batch_sha256=p_batch and d.financial_status='OPEN'),
 'amount_cents',(select coalesce(sum(d.balance_cents),0) from app.m9_credit_documents d join app.m9_legacy_registry r on r.customer_key=d.customer_key where r.batch_sha256=p_batch and d.financial_status='OPEN'));
end$$;

create function app.m9_open_legacy_finance(p_request uuid,p_batch text,p_location uuid,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();h text;old app.m9_legacy_finance_events;actual jsonb;d record;lid uuid;ids jsonb:='[]';rec jsonb;
begin
 if current_user<>'postgres' or p_request is null or not app.has_perm('credit.collect') then raise exception 'M9_PRIVATE_FINANCE_MAINTENANCE_ONLY' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-customer-source-import',0));
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 h:=encode(extensions.digest(convert_to(jsonb_build_object('batch',p_batch,'location',p_location,'plan',p_plan)::text,'UTF8'),'sha256'),'hex');
 select * into old from app.m9_legacy_finance_events where id=p_request;
 if found then
  if old.kind<>'OPEN' or old.actor_user_id<>actor or old.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 if not exists(select 1 from app.m9_customer_batches where plan_sha256=p_batch and source_scope='APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS' and source_at between clock_timestamp()-interval '24 hours' and clock_timestamp()) then raise exception 'M9_SOURCE_CUT_STALE';end if;
 -- Default was explicitly confirmed as La Piedad; do not infer another store.
 if p_location is distinct from '467765fe-d18e-43bb-be68-326adbf05ce1'::uuid or not exists(select 1 from public.locations where id=p_location and type='STORE' and is_active and app.can_access_location(id)) then raise exception 'M9_SOURCE_CUT_LOCATION_REQUIRED';end if;
 actual:=app.m9_legacy_finance_plan(p_batch);
 if actual is distinct from p_plan or jsonb_array_length(actual->'accounts')=0 then raise exception 'M9_FINANCE_PLAN_CHANGED';end if;
 if exists(select 1 from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key) where r.batch_sha256=p_batch and (s.target_customer_id is not null or s.opening_event_id is not null or r.source_hash<>encode(extensions.digest(convert_to(s.payload::text,'UTF8'),'sha256'),'hex'))) then raise exception 'M9_LEGACY_SOURCE_CHANGED';end if;
 if exists(select 1 from app.m9_credit_documents d join app.m9_legacy_registry r on r.customer_key=d.customer_key where r.batch_sha256=p_batch and d.financial_status='OPEN' and (d.balance_cents<=0 or d.total_cents<>d.balance_cents+d.paid_cents or d.paid_cents<>(select coalesce(sum(p.amount_cents),0) from app.m9_credit_source_payments p where p.document_key=d.document_key and not p.cancelled) or d.opening_ledger_id is not null)) then raise exception 'M9_FINANCIAL_RECONCILIATION_REQUIRED';end if;
 if exists(select 1 from app.m9_legacy_finance_ledger l join app.m9_legacy_registry r on r.id=l.registry_id where r.batch_sha256=p_batch) then raise exception 'M9_FINANCE_ALREADY_OPEN';end if;
 rec:=jsonb_build_object('event',p_request,'batch',p_batch,'location',p_location,'accounts',jsonb_array_length(actual->'accounts'),'documents',actual->'document_count','amount_cents',actual->'amount_cents','source_plan_sha256',encode(extensions.digest(convert_to(actual::text,'UTF8'),'sha256'),'hex'),'cash_effect_cents',0,'inventory_effect',0,'historical_payments_replayed',false,'staging_only',true,'replayed',false);
 insert into app.m9_legacy_finance_events values(p_request,'OPEN',actor,h,rec,now());
 for d in select d.*,r.id registry_id from app.m9_credit_documents d join app.m9_legacy_registry r on r.customer_key=d.customer_key where r.batch_sha256=p_batch and d.financial_status='OPEN' order by r.id,d.document_key loop
  insert into app.m9_legacy_finance_ledger(registry_id,document_key,opening_event,request_id,kind,amount_cents,due_date,actor_user_id) values(d.registry_id,d.document_key,p_request,p_request,'OPEN',d.balance_cents,d.due_date,actor);
 end loop;
 return rec;
end$$;

create function app.m9_reverse_legacy_finance(p_request uuid,p_opening uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();h text;old app.m9_legacy_finance_events;rec jsonb;l app.m9_legacy_finance_ledger;rid uuid;
begin
 if current_user<>'postgres' or p_request is null or length(coalesce(p_reason,'')) not between 10 and 500 then raise exception 'M9_PRIVATE_FINANCE_MAINTENANCE_ONLY';end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 h:=encode(extensions.digest(convert_to(jsonb_build_object('opening',p_opening,'reason',p_reason)::text,'UTF8'),'sha256'),'hex');
 select * into old from app.m9_legacy_finance_events where id=p_request;
 if found then
  if old.kind<>'REVERSE' or old.actor_user_id<>actor or old.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 if not exists(select 1 from app.m9_legacy_finance_events where id=p_opening and kind='OPEN') or exists(select 1 from app.m9_legacy_finance_ledger where opening_event=p_opening and kind<>'OPEN') then raise exception 'M9_OPENING_NOT_REVERSIBLE';end if;
 if exists(select 1 from app.m9_legacy_finance_allocations a join app.m9_legacy_finance_ledger l on l.id=a.debit_id where l.opening_event=p_opening) then raise exception 'M9_OPENING_HAS_PAYMENTS';end if;
 rec:=jsonb_build_object('opening',p_opening,'reversed_cents',(select sum(amount_cents) from app.m9_legacy_finance_ledger where opening_event=p_opening),'reason',p_reason,'replayed',false);
 insert into app.m9_legacy_finance_events values(p_request,'REVERSE',actor,h,rec,now());
 for l in select * from app.m9_legacy_finance_ledger where opening_event=p_opening and kind='OPEN' order by id loop
  insert into app.m9_legacy_finance_ledger(registry_id,document_key,opening_event,request_id,kind,amount_cents,actor_user_id) values(l.registry_id,l.document_key,p_opening,p_request,'REVERSE',-l.amount_cents,actor) returning id into rid;
  insert into app.m9_legacy_finance_allocations values(l.id,rid,l.amount_cents);
 end loop;
 return rec;
end$$;

-- Trial-only allocation core. Not an operational collection API: no cash receipt.
create function app.m9_legacy_trial_allocate(p_request uuid,p_account uuid,p_amount bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();balance bigint;remaining bigint;take bigint;pid uuid;opening uuid;rec jsonb;l record;parts jsonb:='[]';old app.m9_legacy_finance_ledger;
begin
 if current_user<>'postgres' or current_setting('app.m9_legacy_finance_trial',true) is distinct from 'on' or not app.has_perm('credit.collect') then raise exception 'M9_TRIAL_ONLY' using errcode='42501';end if;
 if p_request is null or p_account is null or p_amount is null or p_amount<=0 or p_amount>999999999 then raise exception 'M9_POSITIVE_AMOUNT_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 select * into old from app.m9_legacy_finance_ledger where request_id=p_request and kind='PAYMENT_TRIAL';
 if found then
  if old.registry_id<>p_account or old.amount_cents<>-p_amount or old.actor_user_id<>actor then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  select jsonb_agg(jsonb_build_object('document',d.document_key,'amount_cents',a.amount_cents) order by d.due_date nulls last,d.document_key) into parts from app.m9_legacy_finance_allocations a join app.m9_legacy_finance_ledger d on d.id=a.debit_id where a.credit_id=old.id;
  return jsonb_build_object('payment',old.id,'amount_cents',p_amount,'allocations',parts,'replayed',true);
 end if;
 select coalesce(sum(amount_cents),0) into balance from app.m9_legacy_finance_ledger where registry_id=p_account;
 if balance<=0 then raise exception 'M9_NO_OPEN_DEBT';end if;
 if p_amount>balance then raise exception 'M9_OVERPAYMENT';end if;
 select opening_event into strict opening from app.m9_legacy_finance_ledger where registry_id=p_account and kind='OPEN' limit 1;
 insert into app.m9_legacy_finance_ledger(registry_id,opening_event,request_id,kind,amount_cents,actor_user_id) values(p_account,opening,p_request,'PAYMENT_TRIAL',-p_amount,actor) returning id into pid;
 remaining:=p_amount;
 for l in select d.id,d.document_key,d.amount_cents-coalesce((select sum(a.amount_cents) from app.m9_legacy_finance_allocations a where a.debit_id=d.id),0) unpaid from app.m9_legacy_finance_ledger d where d.registry_id=p_account and d.kind='OPEN' order by d.due_date nulls last,d.document_key loop
  take:=least(remaining,l.unpaid);
  if take>0 then insert into app.m9_legacy_finance_allocations values(l.id,pid,take);parts:=parts||jsonb_build_array(jsonb_build_object('document',l.document_key,'amount_cents',take));remaining:=remaining-take;end if;
  exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception 'M9_ALLOCATION_MISMATCH';end if;
 return jsonb_build_object('payment',pid,'amount_cents',p_amount,'before_cents',balance,'after_cents',balance-p_amount,'allocations',parts,'replayed',false);
end$$;

create function app.m9_legacy_finance_api(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();rid uuid;aid uuid;amount bigint;h text;old app.m9_legacy_finance_events;result jsonb;replay jsonb;before_balance bigint;after_balance bigint;rows jsonb;
begin
 if octet_length(coalesce(p_input,'{}'::jsonb)::text)>2000 then raise exception 'M9_INPUT_TOO_LARGE';end if;
 if p_action='LIST' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',s.payload->>'source_display_name','balance_cents',q.balance,'documents',q.documents,'entries',(select jsonb_agg(jsonb_build_object('folio',d.source_folio,'amount_cents',l.amount_cents,'due',l.due_date) order by l.due_date nulls last,l.document_key) from app.m9_legacy_finance_ledger l join app.m9_credit_documents d using(document_key) where l.registry_id=r.id and l.kind='OPEN')) order by r.id),'[]'::jsonb) into rows
  from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key) join lateral(select sum(amount_cents) balance,count(*) filter(where kind='OPEN') documents from app.m9_legacy_finance_ledger where registry_id=r.id) q on q.documents>0;
  return jsonb_build_object('accounts',rows,'trial_count',(select count(*) from app.m9_legacy_finance_events where kind='TRIAL'),'cash_collection_enabled',false,'staging_only',true);
 elsif p_action='TRIAL' then
  if not app.has_perm('credit.collect') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  rid:=(p_input->>'request')::uuid;aid:=(p_input->>'account')::uuid;
  if rid is null or aid is null or p_input->>'amount_cents' is null or p_input->>'amount_cents' !~ '^[1-9][0-9]{0,8}$' then raise exception 'M9_POSITIVE_AMOUNT_REQUIRED';end if;
  amount:=(p_input->>'amount_cents')::bigint;
  h:=encode(extensions.digest(convert_to(jsonb_build_object('account',aid,'amount',amount)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
  select * into old from app.m9_legacy_finance_events where id=rid;
  if found then
   if old.kind<>'TRIAL' or old.actor_user_id<>actor or old.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;
   return old.receipt||'{"replayed":true}'::jsonb;
  end if;
  select coalesce(sum(amount_cents),0) into before_balance from app.m9_legacy_finance_ledger where registry_id=aid;
  begin
   perform set_config('app.m9_legacy_finance_trial','on',true);
   result:=app.m9_legacy_trial_allocate(rid,aid,amount);
   replay:=app.m9_legacy_trial_allocate(rid,aid,amount);
   if replay->'replayed' is distinct from 'true'::jsonb or replay->'allocations' is distinct from result->'allocations' then raise exception 'M9_REPLAY_FAILED';end if;
   raise exception 'M9_ROLLBACK_TRIAL' using errcode='PT901';
  exception when sqlstate 'PT901' then null;
  end;
  select coalesce(sum(amount_cents),0) into after_balance from app.m9_legacy_finance_ledger where registry_id=aid;
  if after_balance<>before_balance or exists(select 1 from app.m9_legacy_finance_ledger where request_id=rid) then raise exception 'M9_TRIAL_ROLLBACK_FAILED';end if;
  result:=result||jsonb_build_object('trial_only',true,'rolled_back',true,'replay_verified',true,'account',aid,'retained_balance_cents',after_balance,'cash_effect_cents',0,'inventory_effect',0,'replayed',false);
  insert into app.m9_legacy_finance_events values(rid,'TRIAL',actor,h,result,now());
  return result;
 else raise exception 'M9_ACTION_NOT_ALLOWED';end if;
end$$;
create function public.m9_legacy_finance(p_action text,p_input jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select app.m9_legacy_finance_api(p_action,p_input)$$;
revoke all on function app.m9_legacy_finance_plan(text),app.m9_open_legacy_finance(uuid,text,uuid,jsonb),app.m9_reverse_legacy_finance(uuid,uuid,text),app.m9_legacy_trial_allocate(uuid,uuid,bigint),app.m9_legacy_finance_api(text,jsonb),public.m9_legacy_finance(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app.m9_legacy_finance_api(text,jsonb),public.m9_legacy_finance(text,jsonb) to authenticated;
commit;
