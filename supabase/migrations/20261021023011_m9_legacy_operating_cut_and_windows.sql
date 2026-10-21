begin;
create table app.m9_legacy_operating_cuts (
 id uuid primary key,
 source_batch text not null references app.m9_customer_batches(plan_sha256),
 source_at timestamptz not null,
 payload_hash text not null,
 payload jsonb not null,
 actor_user_id uuid not null references public.app_users(id),
 created_at timestamptz not null default now()
);
create index m9_operating_cut_batch_idx on app.m9_legacy_operating_cuts(source_batch);
create index m9_operating_cut_actor_idx on app.m9_legacy_operating_cuts(actor_user_id);
create table app.m9_legacy_operating_windows (
 id uuid primary key,
 cut_id uuid not null references app.m9_legacy_operating_cuts(id),
 kind text not null check(kind in ('REHEARSAL','OPERATING')),
 actor_user_id uuid not null references public.app_users(id),
 location_id uuid not null references public.locations(id),
 activated_at timestamptz not null default now(),
 expires_at timestamptz not null,
 approval jsonb not null,
 check(expires_at>activated_at and expires_at<=activated_at+interval '15 minutes'),
 check(kind='REHEARSAL' or (approval @> '{"human_approved":true,"single_writer_confirmed":true}'::jsonb and coalesce(approval->>'evidence_sha256','') ~ '^[a-f0-9]{64}$'))
);
create index m9_operating_window_cut_idx on app.m9_legacy_operating_windows(cut_id);
create index m9_operating_window_actor_idx on app.m9_legacy_operating_windows(actor_user_id);
create index m9_operating_window_location_idx on app.m9_legacy_operating_windows(location_id);
create table app.m9_legacy_operating_revocations (
 window_id uuid primary key references app.m9_legacy_operating_windows(id),
 actor_user_id uuid not null references public.app_users(id),
 reason text not null check(length(reason) between 10 and 500),
 created_at timestamptz not null default now()
);
create index m9_operating_revoke_actor_idx on app.m9_legacy_operating_revocations(actor_user_id);
alter table app.m9_legacy_operating_cuts enable row level security;
alter table app.m9_legacy_operating_windows enable row level security;
alter table app.m9_legacy_operating_revocations enable row level security;
revoke all on app.m9_legacy_operating_cuts,app.m9_legacy_operating_windows,app.m9_legacy_operating_revocations from public,anon,authenticated,service_role;
create trigger m9_operating_cuts_immutable before update or delete on app.m9_legacy_operating_cuts for each row execute function app.m9_legacy_event_immutable();
create trigger m9_operating_windows_immutable before update or delete on app.m9_legacy_operating_windows for each row execute function app.m9_legacy_event_immutable();
create trigger m9_operating_revocations_immutable before update or delete on app.m9_legacy_operating_revocations for each row execute function app.m9_legacy_event_immutable();

create function app.m9_register_operating_cut(p_id uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();old app.m9_legacy_operating_cuts;h text;item jsonb;doc jsonb;r app.m9_legacy_registry;s app.m9_customer_sources;d app.m9_credit_documents;total bigint:=0;docs int:=0;actual_plan jsonb;scope_count int;
begin
 if current_user<>'postgres' or not app.has_perm('credit.collect') or p_id is null then raise exception 'M9_PRIVATE_OPERATING_MAINTENANCE_ONLY' using errcode='42501';end if;
 if p_payload->>'scope' is distinct from 'OPEN_DOCUMENTS_ONLY_NOT_FULL_RENEWAL' or p_payload->>'source_batch' is null or jsonb_typeof(p_payload->'accounts') is distinct from 'array' or jsonb_array_length(p_payload->'accounts')=0 or p_payload->>'source_at' is null or coalesce(p_payload->>'list_evidence_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_payload->>'accounts_evidence_sha256','') !~ '^[a-f0-9]{64}$' or coalesce(p_payload->>'documents_evidence_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'M9_OPERATING_CUT_INVALID';end if;
 h:=encode(extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-customer-source-import',0));
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 select * into old from app.m9_legacy_operating_cuts where id=p_id;
 if found then
  if old.actor_user_id<>actor or old.payload_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('cut',p_id,'replayed',true,'source_at',old.source_at);
 end if;
 if not exists(select 1 from app.m9_customer_batches where plan_sha256=p_payload->>'source_batch' and source_scope='APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS') or (p_payload->>'source_at')::timestamptz not between clock_timestamp()-interval '24 hours' and clock_timestamp() then raise exception 'M9_OPERATING_SOURCE_STALE';end if;
 actual_plan:=app.m9_legacy_finance_plan(p_payload->>'source_batch');
 if p_payload->>'base_plan_sha256' is distinct from encode(extensions.digest(convert_to(actual_plan::text,'UTF8'),'sha256'),'hex') or jsonb_array_length(p_payload->'accounts')<>jsonb_array_length(actual_plan->'accounts') then raise exception 'M9_OPERATING_BASE_CHANGED';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'accounts') x group by x->>'registry_id' having count(*)>1) then raise exception 'M9_OPERATING_SCOPE_DUPLICATE';end if;
 for item in select value from jsonb_array_elements(p_payload->'accounts') loop
  select * into strict r from app.m9_legacy_registry where id=(item->>'registry_id')::uuid and batch_sha256=p_payload->>'source_batch';
  select * into strict s from app.m9_customer_sources where customer_key=r.customer_key;
  if item->>'source_ref' is distinct from s.source_ref or (item->>'balance_cents')::bigint is distinct from s.used_cents or (item->>'balance_cents')::bigint is distinct from (select coalesce(sum(amount_cents),0) from app.m9_legacy_finance_ledger where registry_id=r.id) or exists(select 1 from app.m9_legacy_finance_ledger where registry_id=r.id and kind<>'OPEN') then raise exception 'M9_OPERATING_ACCOUNT_CHANGED';end if;
  if jsonb_typeof(item->'documents') is distinct from 'array' or jsonb_array_length(item->'documents')<>(select count(*) from app.m9_credit_documents where customer_key=r.customer_key and financial_status='OPEN') or exists(select 1 from jsonb_array_elements(item->'documents') x group by x->>'key' having count(*)>1) then raise exception 'M9_OPERATING_DOCUMENT_SCOPE_CHANGED';end if;
  for doc in select value from jsonb_array_elements(item->'documents') loop
   select * into strict d from app.m9_credit_documents where document_key=doc->>'key' and customer_key=r.customer_key and financial_status='OPEN';
   if doc->>'folio' is distinct from d.source_folio or doc->>'source_document_id' is distinct from d.payload->>'source_document_id' or (doc->>'balance_cents')::bigint is distinct from d.balance_cents or (doc->>'total_cents')::bigint is distinct from d.total_cents or (doc->>'paid_cents')::bigint is distinct from d.paid_cents or doc->>'due_date' is distinct from d.due_date::text or doc->'payments' is distinct from (select coalesce(jsonb_agg(jsonb_build_object('source_ref',p.source_ref,'amount_cents',p.amount_cents,'cancelled',p.cancelled) order by p.source_ref),'[]'::jsonb) from app.m9_credit_source_payments p where p.document_key=d.document_key) then raise exception 'M9_OPERATING_DOCUMENT_CHANGED';end if;
   if not exists(select 1 from app.m9_legacy_finance_ledger where registry_id=r.id and document_key=d.document_key and kind='OPEN' and amount_cents=d.balance_cents) then raise exception 'M9_OPERATING_OPENING_CHANGED';end if;
   total:=total+d.balance_cents;docs:=docs+1;
  end loop;
 end loop;
 if total<>(actual_plan->>'amount_cents')::bigint or docs<>(actual_plan->>'document_count')::int then raise exception 'M9_OPERATING_TOTAL_CHANGED';end if;
 insert into app.m9_legacy_operating_cuts values(p_id,p_payload->>'source_batch',(p_payload->>'source_at')::timestamptz,h,p_payload,actor,now());
 return jsonb_build_object('cut',p_id,'accounts',jsonb_array_length(p_payload->'accounts'),'documents',docs,'balance_cents',total,'source_at',p_payload->>'source_at','operating_enabled',false,'replayed',false);
end$$;

create function app.m9_legacy_window_guard(p_window uuid,p_account uuid,p_session uuid,p_allow_rehearsal boolean default false) returns uuid
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();w app.m9_legacy_operating_windows;c app.m9_legacy_operating_cuts;cs public.cash_sessions;
begin
 if not app.has_perm('credit.collect') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 select * into w from app.m9_legacy_operating_windows where id=p_window;
 if not found or w.actor_user_id<>actor or w.expires_at<=clock_timestamp() or w.activated_at>clock_timestamp() or exists(select 1 from app.m9_legacy_operating_revocations where window_id=p_window) or (w.kind<>'OPERATING' and not coalesce(p_allow_rehearsal,false)) then raise exception 'M9_OPERATING_WINDOW_CLOSED' using errcode='42501';end if;
 select * into strict c from app.m9_legacy_operating_cuts where id=w.cut_id;
 if c.source_at>clock_timestamp() or c.source_at<clock_timestamp()-(case when w.kind='OPERATING' then interval '30 minutes' else interval '24 hours' end) then raise exception 'M9_OPERATING_SOURCE_STALE';end if;
 if c.payload->>'base_plan_sha256' is distinct from encode(extensions.digest(convert_to(app.m9_legacy_finance_plan(c.source_batch)::text,'UTF8'),'sha256'),'hex') then raise exception 'M9_OPERATING_BASE_CHANGED';end if;
 if not exists(select 1 from jsonb_array_elements(c.payload->'accounts') x where x->>'registry_id'=p_account::text) then raise exception 'M9_OPERATING_ACCOUNT_NOT_APPROVED';end if;
 select * into cs from public.cash_sessions where id=p_session and status='OPEN' for update;
 if not found or cs.cashier_user_id<>actor or cs.location_id<>w.location_id or not app.can_access_location(cs.location_id) then raise exception 'M9_SESSION_FORBIDDEN' using errcode='42501';end if;
 if exists(select 1 from app.m9_legacy_finance_ledger where registry_id=p_account and kind='REVERSE') then raise exception 'M9_OPERATING_OPENING_CHANGED';end if;
 return w.cut_id;
end$$;

create function app.m9_activate_legacy_window(p_id uuid,p_cut uuid,p_approval jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();c app.m9_legacy_operating_cuts;w app.m9_legacy_operating_windows;
begin
 if current_user<>'postgres' or p_id is null or not app.has_perm('credit.collect') then raise exception 'M9_PRIVATE_OPERATING_MAINTENANCE_ONLY' using errcode='42501';end if;
 if p_approval->'human_approved' is distinct from 'true'::jsonb or p_approval->'single_writer_confirmed' is distinct from 'true'::jsonb or p_approval->'cut_confirmed' is distinct from 'true'::jsonb or p_approval->>'evidence_sha256' is null or p_approval->>'evidence_sha256' !~ '^[a-f0-9]{64}$' or length(coalesce(p_approval->>'reason','')) not between 10 and 500 then raise exception 'M9_OPERATING_HUMAN_APPROVAL_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 select * into strict c from app.m9_legacy_operating_cuts where id=p_cut;
 select * into w from app.m9_legacy_operating_windows where id=p_id;
 if found then if w.kind<>'OPERATING' or w.cut_id<>p_cut or w.actor_user_id<>actor or w.approval is distinct from p_approval then raise exception 'IDEMPOTENCY_CONFLICT';end if;return to_jsonb(w)||'{"replayed":true}'::jsonb;end if;
 if c.source_at not between clock_timestamp()-interval '30 minutes' and clock_timestamp() then raise exception 'M9_OPERATING_SOURCE_STALE';end if;
 if exists(select 1 from app.m9_legacy_operating_windows ow where ow.kind='OPERATING' and ow.expires_at>clock_timestamp() and not exists(select 1 from app.m9_legacy_operating_revocations rv where rv.window_id=ow.id)) then raise exception 'M9_OPERATING_WINDOW_ALREADY_OPEN';end if;
 insert into app.m9_legacy_operating_windows(id,cut_id,kind,actor_user_id,location_id,expires_at,approval) values(p_id,p_cut,'OPERATING',actor,'467765fe-d18e-43bb-be68-326adbf05ce1',now()+interval '15 minutes',p_approval) returning * into w;
 return to_jsonb(w)||'{"replayed":false}'::jsonb;
end$$;
create function app.m9_revoke_legacy_window(p_window uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();
begin
 if current_user<>'postgres' or length(coalesce(p_reason,'')) not between 10 and 500 then raise exception 'M9_PRIVATE_OPERATING_MAINTENANCE_ONLY';end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 if not exists(select 1 from app.m9_legacy_operating_windows where id=p_window and actor_user_id=actor) then raise exception 'NOT_AUTHORIZED';end if;
 insert into app.m9_legacy_operating_revocations values(p_window,actor,p_reason,now()) on conflict(window_id) do nothing;
 return jsonb_build_object('window',p_window,'revoked',true);
end$$;
-- Actual payment entries are distinct from reversible trial entries.
alter table app.m9_legacy_finance_ledger drop constraint m9_legacy_finance_ledger_kind_check;
alter table app.m9_legacy_finance_ledger drop constraint m9_legacy_finance_ledger_check;
alter table app.m9_legacy_finance_ledger add constraint m9_legacy_finance_ledger_kind_check check(kind in ('OPEN','PAYMENT_TRIAL','PAYMENT','REVERSE'));
alter table app.m9_legacy_finance_ledger add constraint m9_legacy_finance_ledger_check check((kind='OPEN' and amount_cents>0 and document_key is not null) or (kind in ('PAYMENT_TRIAL','PAYMENT','REVERSE') and amount_cents<0));
create unique index m9_legacy_operating_payment_once on app.m9_legacy_finance_ledger(request_id) where kind='PAYMENT';

create function app.m9_legacy_allocate_operating(p_request uuid,p_account uuid,p_amount bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();balance bigint;remaining bigint;take bigint;pid uuid;opening uuid;rec jsonb;l record;parts jsonb:='[]';old app.m9_legacy_finance_ledger;
begin
 if current_user<>'postgres' or current_setting('app.m9_operating_write',true) is distinct from 'on' or not app.has_perm('credit.collect') then raise exception 'M9_OPERATING_PRIVATE_WRITE_ONLY' using errcode='42501';end if;
 if p_request is null or p_account is null or p_amount is null or p_amount<=0 or p_amount>999999999 then raise exception 'M9_POSITIVE_AMOUNT_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 select * into old from app.m9_legacy_finance_ledger where request_id=p_request and kind='PAYMENT';
 if found then
  if old.registry_id<>p_account or old.amount_cents<>-p_amount or old.actor_user_id<>actor then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  select jsonb_agg(jsonb_build_object('document',d.document_key,'amount_cents',a.amount_cents) order by d.due_date nulls last,d.document_key) into parts from app.m9_legacy_finance_allocations a join app.m9_legacy_finance_ledger d on d.id=a.debit_id where a.credit_id=old.id;
  return jsonb_build_object('payment',old.id,'amount_cents',p_amount,'allocations',parts,'replayed',true);
 end if;
 select coalesce(sum(amount_cents),0) into balance from app.m9_legacy_finance_ledger where registry_id=p_account;
 if balance<=0 then raise exception 'M9_NO_OPEN_DEBT';end if;
 if p_amount>balance then raise exception 'M9_OVERPAYMENT';end if;
 select opening_event into strict opening from app.m9_legacy_finance_ledger where registry_id=p_account and kind='OPEN' limit 1;
 insert into app.m9_legacy_finance_ledger(registry_id,opening_event,request_id,kind,amount_cents,actor_user_id) values(p_account,opening,p_request,'PAYMENT',-p_amount,actor) returning id into pid;
 remaining:=p_amount;
 for l in select d.id,d.document_key,d.amount_cents-coalesce((select sum(a.amount_cents) from app.m9_legacy_finance_allocations a where a.debit_id=d.id),0) unpaid from app.m9_legacy_finance_ledger d where d.registry_id=p_account and d.kind='OPEN' order by d.due_date nulls last,d.document_key loop
  take:=least(remaining,l.unpaid);
  if take>0 then insert into app.m9_legacy_finance_allocations values(l.id,pid,take);parts:=parts||jsonb_build_array(jsonb_build_object('document',l.document_key,'amount_cents',take));remaining:=remaining-take;end if;
  exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception 'M9_ALLOCATION_MISMATCH';end if;
 return jsonb_build_object('payment',pid,'amount_cents',p_amount,'before_cents',balance,'after_cents',balance-p_amount,'allocations',parts,'replayed',false);
end$$;


create function app.m9_record_legacy_operating_payment(p_request uuid,p_account uuid,p_session uuid,p_parts jsonb,p_window uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();h text;old app.m9_legacy_cash_receipts;cash_session public.cash_sessions;
 part jsonb;pm public.payment_methods;amount bigint;total bigint:=0;cash bigint:=0;tendered bigint;change bigint:=0;normalized jsonb:='[]';
 allocation jsonb;folio bigint;location_code text;rec jsonb;prior_cash_flag text;prior_trial_flag text;source_name text;
begin
 if current_user<>'postgres' or not app.has_perm('credit.collect') then raise exception 'M9_PRIVATE_OPERATING_MAINTENANCE_ONLY' using errcode='42501';end if;
 if p_request is null or p_account is null or p_session is null or p_window is null or jsonb_typeof(p_parts) is distinct from 'array' then raise exception 'M9_INVALID_PAYMENT';end if;
 if jsonb_array_length(p_parts) not between 1 and 3 or exists(select 1 from jsonb_array_elements(p_parts) x where jsonb_typeof(x)<>'object') or exists(select 1 from jsonb_array_elements(p_parts) x group by x->>'method_code' having count(*)>1) then raise exception 'M9_INVALID_PAYMENT';end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('account',p_account,'session',p_session,'parts',p_parts,'window',p_window)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 select * into old from app.m9_legacy_cash_receipts where id=p_request;
 if found then
  if old.actor_user_id<>actor or old.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 perform app.m9_legacy_window_guard(p_window,p_account,p_session,coalesce(current_setting('app.m9_operating_rehearsal',true)='on',false));
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
 prior_trial_flag:=current_setting('app.m9_operating_write',true);
 perform set_config('app.m9_operating_write','on',true);
 allocation:=app.m9_legacy_allocate_operating(p_request,p_account,total);
 allocation:=allocation||jsonb_build_object('allocations',(select jsonb_agg(x.value||jsonb_build_object('source_folio',d.source_folio) order by x.ordinality) from jsonb_array_elements(allocation->'allocations') with ordinality x(value,ordinality) join app.m9_credit_documents d on d.document_key=x.value->>'document'));
 perform set_config('app.m9_operating_write',coalesce(prior_trial_flag,''),true);
 insert into public.folio_document_types(code,description) values('M9_LEGACY_PAYMENT','Abono de cliente heredado') on conflict(code) do nothing;
 insert into public.folios(location_id,document_type,next_number) values(cash_session.location_id,'M9_LEGACY_PAYMENT',2)
 on conflict(location_id,document_type) do update set next_number=public.folios.next_number+1 returning next_number-1 into folio;
 select code into strict location_code from public.locations where id=cash_session.location_id;
 select s.payload->>'source_display_name' into strict source_name from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key) where r.id=p_account;
 rec:=allocation||jsonb_build_object('id',p_request,'folio',location_code||'-AH-'||lpad(folio::text,6,'0'),'customer_name',source_name,'account',p_account,'session',p_session,'location',cash_session.location_id,'received_at',clock_timestamp(),'parts',normalized,'cash_delta_cents',cash,'change_cents',change,'window',p_window,'trial_only',false,'valid_payment_receipt',true,'replayed',false);
 insert into app.m9_legacy_cash_receipts values(p_request,p_account,p_session,cash_session.location_id,(allocation->>'payment')::uuid,actor,h,rec,now());
 prior_cash_flag:=current_setting('app.cash_write',true);
 perform set_config('app.cash_write','on',true);
 if cash>0 then
  insert into public.cash_movements(session_id,location_id,movement_type,amount_cents,reference_type,reference_id,user_id,metadata)
  values(p_session,cash_session.location_id,'CREDIT_PAYMENT',cash,'M9_LEGACY_PAYMENT',p_request::text,actor,jsonb_build_object('folio',rec->>'folio','registry_id',p_account,'trial_only',false));
 end if;
 perform set_config('app.cash_write',coalesce(prior_cash_flag,''),true);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,metadata) values(actor,'m9.legacy_cash.operating_received','m9_legacy_cash_receipts',p_request::text,cash_session.location_id,jsonb_build_object('total_cents',total,'cash_delta_cents',cash,'trial_only',false));
 return rec;
end$$;



create function app.m9_legacy_operating_api(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();c app.m9_legacy_operating_cuts;w app.m9_legacy_operating_windows;rid uuid;aid uuid;sid uuid;wid uuid;h text;old app.m9_legacy_cash_trials;rec jsonb;again jsonb;loc uuid;balance_before bigint;cash_before bigint;balance_after bigint;cash_after bigint;f_before jsonb;f_after jsonb;
begin
 if not app.has_perm('credit.collect') or p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>4000 then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if p_action='STATUS' then
  select * into c from app.m9_legacy_operating_cuts order by source_at desc,id limit 1;
  return jsonb_build_object('cut',case when c.id is null then null else jsonb_build_object('id',c.id,'source_at',c.source_at,'accounts',jsonb_array_length(c.payload->'accounts'),'documents',c.payload->'document_count','balance_cents',c.payload->'balance_cents','scope',c.payload->>'scope','fresh_for_rehearsal',c.source_at>clock_timestamp()-interval '24 hours','fresh_for_activation',c.source_at>clock_timestamp()-interval '30 minutes') end,
   'operating_windows',(select count(*) from app.m9_legacy_operating_windows ow where ow.kind='OPERATING' and ow.actor_user_id=actor and ow.expires_at>clock_timestamp() and not exists(select 1 from app.m9_legacy_operating_revocations rv where rv.window_id=ow.id)),
   'activation_requires','HUMAN_APPROVAL_AND_SINGLE_WRITER','production_allowed',false);
 elsif p_action='COLLECT' then
  wid:=(p_input->>'window')::uuid;aid:=(p_input->>'account')::uuid;sid:=(p_input->>'session')::uuid;
  if not exists(select 1 from app.m9_legacy_operating_windows where id=wid and kind='OPERATING' and actor_user_id=actor) then raise exception 'M9_OPERATING_WINDOW_CLOSED' using errcode='42501';end if;
  return app.m9_record_legacy_operating_payment((p_input->>'request')::uuid,aid,sid,p_input->'parts',wid);
 elsif p_action='RECEIPT' then
  select receipt into rec from app.m9_legacy_cash_receipts cr where cr.id=(p_input->>'request')::uuid and cr.actor_user_id=actor and app.can_access_location(cr.location_id) and cr.receipt->'trial_only'='false'::jsonb;
  if not found then raise exception 'M9_RECEIPT_NOT_FOUND' using errcode='42501';end if;
  return rec;
 elsif p_action='REHEARSE' then
  rid:=(p_input->>'request')::uuid;aid:=(p_input->>'account')::uuid;sid:=(p_input->>'session')::uuid;
  if rid is null or aid is null or sid is null then raise exception 'M9_INVALID_PAYMENT';end if;
  h:=encode(extensions.digest(convert_to(jsonb_build_object('mode','OPERATING_REHEARSAL','cut',p_input->>'cut','account',aid,'session',sid,'parts',p_input->'parts')::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
  select * into old from app.m9_legacy_cash_trials where id=rid;
  if found then if old.actor_user_id<>actor or old.request_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT';end if;return old.receipt||'{"replayed":true}'::jsonb;end if;
  select * into c from app.m9_legacy_operating_cuts where id=(p_input->>'cut')::uuid;
  if not found or c.source_at not between clock_timestamp()-interval '24 hours' and clock_timestamp() then raise exception 'M9_OPERATING_SOURCE_STALE';end if;
  select location_id into loc from public.cash_sessions where id=sid and status='OPEN' and cashier_user_id=actor and app.can_access_location(location_id) for update;
  if not found then raise exception 'M9_SESSION_FORBIDDEN' using errcode='42501';end if;
  select coalesce(sum(amount_cents),0) into balance_before from app.m9_legacy_finance_ledger where registry_id=aid;
  select coalesce(sum(amount_cents),0) into cash_before from public.cash_movements where session_id=sid;
  select to_jsonb(f) into f_before from public.folios f where location_id=loc and document_type='M9_LEGACY_PAYMENT';
  begin
   wid:=extensions.gen_random_uuid();
   insert into app.m9_legacy_operating_windows(id,cut_id,kind,actor_user_id,location_id,expires_at,approval) values(wid,c.id,'REHEARSAL',actor,loc,now()+interval '15 minutes','{"rehearsal_only":true,"human_approval_granted":false}');
   perform set_config('app.m9_operating_rehearsal','on',true);
   rec:=app.m9_record_legacy_operating_payment(rid,aid,sid,p_input->'parts',wid);
   again:=app.m9_record_legacy_operating_payment(rid,aid,sid,p_input->'parts',wid);
   select coalesce(sum(amount_cents),0) into cash_after from public.cash_movements where session_id=sid;
   if again-'replayed' is distinct from rec-'replayed' or again->'replayed'<>'true'::jsonb or cash_after-cash_before<>(rec->>'cash_delta_cents')::bigint then raise exception 'M9_OPERATING_REPLAY_FAILED';end if;
   raise exception 'M9_OPERATING_ROLLBACK' using errcode='PT907';
  exception when sqlstate 'PT907' then null;end;
  select coalesce(sum(amount_cents),0) into balance_after from app.m9_legacy_finance_ledger where registry_id=aid;
  select coalesce(sum(amount_cents),0) into cash_after from public.cash_movements where session_id=sid;
  select to_jsonb(f) into f_after from public.folios f where location_id=loc and document_type='M9_LEGACY_PAYMENT';
  if balance_before<>balance_after or cash_before<>cash_after or f_before is distinct from f_after or exists(select 1 from app.m9_legacy_operating_windows where id=wid) or exists(select 1 from app.m9_legacy_finance_ledger where request_id=rid) or exists(select 1 from app.m9_legacy_cash_receipts where id=rid) then raise exception 'M9_OPERATING_ROLLBACK_FAILED';end if;
  rec:=rec||jsonb_build_object('folio','ENSAYO-'||(rec->>'folio'),'request',rid,'source_cut_id',c.id,'operating_engine',true,'trial_only',true,'valid_payment_receipt',false,'rolled_back',true,'replay_verified',true,'cash_delta_verified',true,'retained_balance_cents',balance_after);
  insert into app.m9_legacy_cash_trials values(rid,actor,loc,h,rec,now());
  return rec;
 else raise exception 'M9_ACTION_NOT_ALLOWED';end if;
end$$;
create function public.m9_legacy_operating(p_action text,p_input jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select app.m9_legacy_operating_api(p_action,p_input)$$;
revoke all on function app.m9_register_operating_cut(uuid,jsonb),app.m9_legacy_window_guard(uuid,uuid,uuid,boolean),app.m9_activate_legacy_window(uuid,uuid,jsonb),app.m9_revoke_legacy_window(uuid,text),app.m9_legacy_allocate_operating(uuid,uuid,bigint),app.m9_record_legacy_operating_payment(uuid,uuid,uuid,jsonb,uuid),app.m9_legacy_operating_api(text,jsonb),public.m9_legacy_operating(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app.m9_legacy_operating_api(text,jsonb),public.m9_legacy_operating(text,jsonb) to authenticated;
commit;
