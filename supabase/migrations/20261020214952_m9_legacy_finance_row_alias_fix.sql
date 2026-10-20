begin;
create or replace function app.m9_open_legacy_finance(p_request uuid,p_batch text,p_location uuid,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();h text;old app.m9_legacy_finance_events;actual jsonb;v_document record;lid uuid;ids jsonb:='[]';rec jsonb;
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
 for v_document in select d.*,r.id registry_id from app.m9_credit_documents d join app.m9_legacy_registry r on r.customer_key=d.customer_key where r.batch_sha256=p_batch and d.financial_status='OPEN' order by r.id,d.document_key loop
  insert into app.m9_legacy_finance_ledger(registry_id,document_key,opening_event,request_id,kind,amount_cents,due_date,actor_user_id) values(v_document.registry_id,v_document.document_key,p_request,p_request,'OPEN',v_document.balance_cents,v_document.due_date,actor);
 end loop;
 return rec;
end$$;

create or replace function app.m9_reverse_legacy_finance(p_request uuid,p_opening uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();h text;old app.m9_legacy_finance_events;rec jsonb;v_ledger app.m9_legacy_finance_ledger;rid uuid;
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
 for v_ledger in select * from app.m9_legacy_finance_ledger where opening_event=p_opening and kind='OPEN' order by id loop
  insert into app.m9_legacy_finance_ledger(registry_id,document_key,opening_event,request_id,kind,amount_cents,actor_user_id) values(v_ledger.registry_id,v_ledger.document_key,p_opening,p_request,'REVERSE',-v_ledger.amount_cents,actor) returning id into rid;
  insert into app.m9_legacy_finance_allocations values(v_ledger.id,rid,v_ledger.amount_cents);
 end loop;
 return rec;
end$$;


commit;
