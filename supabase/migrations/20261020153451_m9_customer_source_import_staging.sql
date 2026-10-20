begin;

-- Private maintenance adapter. No change to customer consent/phone rules.
create table app.m9_customer_batches (
 plan_sha256 text primary key check(plan_sha256 ~ '^[a-f0-9]{64}$'),
 payload_hash text not null,
 source_scope text not null check(source_scope in ('APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS','SYNTHETIC_QA_NOT_SICAR')),
 source_at timestamptz not null,
 actor_user_id uuid not null references public.app_users(id),
 receipt jsonb not null,
 created_at timestamptz not null default now()
);
create table app.m9_customer_sources (
 customer_key text primary key check(customer_key ~ '^[a-f0-9]{64}$'),
 source_ref text not null unique check(length(source_ref) between 1 and 100 and source_ref=btrim(source_ref)),
 batch_sha256 text not null references app.m9_customer_batches(plan_sha256),
 payload jsonb not null,
 used_cents bigint not null check(used_cents between 0 and 9007199254740991),
 target_customer_id uuid unique references public.customers(id),
 opening_event_id uuid,
 reversed_event_id uuid
);
create index m9_customer_sources_batch_idx on app.m9_customer_sources(batch_sha256);
create index m9_customer_sources_opening_idx on app.m9_customer_sources(opening_event_id);
create index m9_customer_sources_reversed_idx on app.m9_customer_sources(reversed_event_id);
create table app.m9_credit_documents (
 document_key text primary key check(document_key ~ '^[a-f0-9]{64}$'),
 customer_key text not null references app.m9_customer_sources(customer_key),
 payload jsonb not null,
 source_folio text not null check(length(source_folio) between 1 and 100),
 total_cents bigint not null check(total_cents between 1 and 9007199254740991),
 balance_cents bigint not null check(balance_cents between 0 and total_cents),
 paid_cents bigint not null check(paid_cents>=0),
 due_date date,
 financial_status text not null check(financial_status in ('OPEN','PAID')),
 opening_ledger_id uuid unique references public.customer_credit_ledger(id),
 reversal_ledger_id uuid unique references public.customer_credit_ledger(id),
 unique(customer_key,source_folio),
 check(total_cents=paid_cents+balance_cents),
 check((financial_status='PAID' and balance_cents=0) or (financial_status='OPEN' and balance_cents>0 and due_date is not null))
);
create table app.m9_credit_source_payments (
 payment_key text primary key check(payment_key ~ '^[a-f0-9]{64}$'),
 document_key text not null references app.m9_credit_documents(document_key),
 source_ref text not null unique,
 amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
 cancelled boolean not null,
 payload jsonb not null
);
create index m9_credit_source_payments_doc_idx on app.m9_credit_source_payments(document_key);
create table app.m9_credit_source_lines (
 document_key text not null references app.m9_credit_documents(document_key),
 line_index integer not null check(line_index>=0),
 barcode text not null check(length(barcode) between 1 and 100 and barcode=btrim(barcode)),
 quantity numeric not null check(quantity>0 and quantity=trunc(quantity)),
 variant_id uuid references public.variants(id),
 payload jsonb not null,
 primary key(document_key,line_index)
);
create index m9_credit_source_lines_variant_idx on app.m9_credit_source_lines(variant_id);
create table app.m9_customer_events (
 id uuid primary key,
 customer_key text not null references app.m9_customer_sources(customer_key),
 target_customer_id uuid not null references public.customers(id),
 action text not null check(action in ('OPEN','REVERSE')),
 request_hash text not null,
 receipt jsonb not null,
 evidence jsonb not null,
 actor_user_id uuid not null references public.app_users(id),
 created_at timestamptz not null default now()
);
create index m9_customer_events_source_idx on app.m9_customer_events(customer_key);
create index m9_customer_events_target_idx on app.m9_customer_events(target_customer_id);
create index m9_customer_events_actor_idx on app.m9_customer_events(actor_user_id);
create index m9_customer_batches_actor_idx on app.m9_customer_batches(actor_user_id);
alter table app.m9_customer_sources add foreign key(opening_event_id) references app.m9_customer_events(id);
alter table app.m9_customer_sources add foreign key(reversed_event_id) references app.m9_customer_events(id);

create function app.m9_customer_operator() returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid;
begin
 if current_user<>'postgres' then raise exception 'M9_CUSTOMER_OPERATOR_ONLY' using errcode='42501';end if;
 perform app.assert_sicar_staging_enabled();
 actor:=(select app.current_user_id());
 if not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'M9_CUSTOMER_ADMIN_REQUIRED' using errcode='42501';end if;
 return actor;
end $$;

create function app.m9_import_customer_sources(p_sha text,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid; h text; previous app.m9_customer_batches; c jsonb; d jsonb; p jsonb; l jsonb; receipt jsonb; n bigint;
begin
 actor:=app.m9_customer_operator();
 if p_sha is null or p_sha !~ '^[a-f0-9]{64}$' or octet_length(p_plan::text)>2000000
 or p_plan->>'version' is distinct from 'm9-customer-credit-1'
 or p_plan->>'project_id' is distinct from 'zsezjtswqeijboezvado'
 or p_plan->'production_allowed' is distinct from 'false'::jsonb
 or p_plan->'operational_import_allowed' is distinct from 'false'::jsonb
 or p_plan->'inventory_import_allowed' is distinct from 'false'::jsonb
 or coalesce(p_plan->>'scope','') not in ('APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS','SYNTHETIC_QA_NOT_SICAR')
 or jsonb_typeof(p_plan->'customers') is distinct from 'array'
 or jsonb_typeof(p_plan->'documents') is distinct from 'array'
 or jsonb_typeof(p_plan->'payments') is distinct from 'array'
 or jsonb_typeof(p_plan->'lines') is distinct from 'array'
 then raise exception 'M9_CUSTOMER_PLAN_INVALID';end if;
 if jsonb_array_length(p_plan->'customers') not between 1 and 1000 or jsonb_array_length(p_plan->'documents') not between 1 and 5000 or jsonb_array_length(p_plan->'payments')>10000 or jsonb_array_length(p_plan->'lines')>10000 then raise exception 'M9_CUSTOMER_SCOPE_LIMIT';end if;
 h:=encode(extensions.digest(convert_to(p_plan::text,'UTF8'),'sha256'),'hex');
 -- One lock covers cross-batch identity collisions; it does not lock native sales.
 perform pg_advisory_xact_lock(hashtextextended('m9-customer-source-import',0));
 select * into previous from app.m9_customer_batches where plan_sha256=p_sha;
 if found then
  if previous.payload_hash<>h then raise exception 'M9_CUSTOMER_REPLAY_CONFLICT';end if;
  return previous.receipt||jsonb_build_object('replayed',true);
 end if;
 if (p_plan->>'assessed_at')::timestamptz is null or (p_plan->>'assessed_at')::timestamptz>clock_timestamp() or (p_plan->>'assessed_at')::timestamptz<clock_timestamp()-interval '24 hours' then raise exception 'M9_CUSTOMER_CUT_STALE';end if;
 insert into app.m9_customer_batches values(p_sha,h,p_plan->>'scope',(p_plan->>'assessed_at')::timestamptz,actor,'{}',now());
 for c in select value from jsonb_array_elements(p_plan->'customers') loop
  if c->'privacy_consent_at' is distinct from 'null'::jsonb or c->'marketing_consent' is distinct from 'null'::jsonb or c->'auth_user_id' is distinct from 'null'::jsonb or c->'target_customer_id' is distinct from 'null'::jsonb or c->'email' is distinct from 'null'::jsonb or c->'operational_import_allowed' is distinct from 'false'::jsonb or nullif(btrim(c->>'source_display_name'),'') is null or (c->>'phone_candidate' is not null and c->>'phone_candidate' !~ '^\+52[0-9]{10}$') then raise exception 'M9_CUSTOMER_IDENTITY_UNREVIEWED';end if;
  insert into app.m9_customer_sources(customer_key,source_ref,batch_sha256,payload,used_cents) values(c->>'customer_key',c->>'source_ref',p_sha,c,(c->>'used_cents')::bigint);
 end loop;
 for d in select value from jsonb_array_elements(p_plan->'documents') loop
  if not exists(select 1 from app.m9_customer_sources where customer_key=d->>'customer_key' and batch_sha256=p_sha) or d->>'delivery_status' is distinct from 'UNKNOWN' or d->'operational_import_allowed' is distinct from 'false'::jsonb or d->'opening_candidate_cents' is distinct from d->'balance_cents' then raise exception 'M9_CUSTOMER_DOCUMENT_INVALID';end if;
  insert into app.m9_credit_documents(document_key,customer_key,payload,source_folio,total_cents,balance_cents,paid_cents,due_date,financial_status) values(d->>'document_key',d->>'customer_key',d,d->>'source_folio',(d->>'total_cents')::bigint,(d->>'balance_cents')::bigint,(d->>'paid_to_date_cents')::bigint,(d->>'due_date')::date,d->>'financial_status');
 end loop;
 for p in select value from jsonb_array_elements(p_plan->'payments') loop
  if p->'replay_as_cash' is distinct from 'false'::jsonb or not exists(select 1 from app.m9_credit_documents d join app.m9_customer_sources c using(customer_key) where d.document_key=p->>'document_key' and c.batch_sha256=p_sha and d.financial_status='OPEN') then raise exception 'M9_CUSTOMER_PAYMENT_INVALID';end if;
  insert into app.m9_credit_source_payments values(p->>'payment_key',p->>'document_key',p->>'source_ref',(p->>'amount_cents')::bigint,(p->>'cancelled')::boolean,p);
 end loop;
 for l in select value from jsonb_array_elements(p_plan->'lines') loop
  if l->>'delivery_status' is distinct from 'UNKNOWN' or l->'reserved_qty' is distinct from 'null'::jsonb or l->'additional_stock_deduction' is distinct from 'null'::jsonb or l->>'quantity' !~ '^[1-9][0-9]{0,8}$' or not exists(select 1 from app.m9_credit_documents d join app.m9_customer_sources c using(customer_key) where d.document_key=l->>'document_key' and c.batch_sha256=p_sha) then raise exception 'M9_CUSTOMER_LINE_INVALID';end if;
  if l->>'variant_id' is not null and (not exists(select 1 from public.barcodes b where b.variant_id=(l->>'variant_id')::uuid and b.code=l->>'barcode') or (select count(distinct b.variant_id) from public.barcodes b where b.code=l->>'barcode')<>1) then raise exception 'M9_CUSTOMER_VARIANT_CHANGED';end if;
  insert into app.m9_credit_source_lines values(l->>'document_key',(l->>'line_index')::integer,l->>'barcode',(l->>'quantity')::numeric,(l->>'variant_id')::uuid,l);
 end loop;
 if exists(select 1 from app.m9_customer_sources c left join app.m9_credit_documents d using(customer_key) where c.batch_sha256=p_sha group by c.customer_key,c.used_cents having c.used_cents<>coalesce(sum(d.balance_cents),0)) then raise exception 'M9_CUSTOMER_DEBT_MISMATCH';end if;
 if exists(select 1 from app.m9_credit_documents d join app.m9_customer_sources c using(customer_key) left join app.m9_credit_source_payments p on p.document_key=d.document_key and not p.cancelled where c.batch_sha256=p_sha and d.financial_status='OPEN' group by d.document_key,d.paid_cents having d.paid_cents<>coalesce(sum(p.amount_cents),0)) then raise exception 'M9_CUSTOMER_ABONO_MISMATCH';end if;
 if exists(select 1 from app.m9_credit_documents d join app.m9_customer_sources c using(customer_key) where c.batch_sha256=p_sha and not exists(select 1 from app.m9_credit_source_lines l where l.document_key=d.document_key)) then raise exception 'M9_CUSTOMER_LINES_MISSING';end if;
 select coalesce(sum(used_cents),0) into n from app.m9_customer_sources where batch_sha256=p_sha;
 receipt:=jsonb_build_object('plan_sha256',p_sha,'scope',p_plan->>'scope','source_accounts',jsonb_array_length(p_plan->'customers'),'source_documents',jsonb_array_length(p_plan->'documents'),'source_payment_records',jsonb_array_length(p_plan->'payments'),'source_lines',jsonb_array_length(p_plan->'lines'),'pending_source_cents',n,'native_customers_created',0,'native_openings_created',0,'stock_movements_created',0,'replayed',false);
 update app.m9_customer_batches set receipt=m9_import_customer_sources.receipt where plan_sha256=p_sha;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata) values(actor,'m9.customer_sources.import','m9_customer_batches',p_sha,receipt);
 return receipt;
end $$;

create function app.m9_open_customer_credit(p_event uuid,p_source text,p_target uuid,p_evidence jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid; s app.m9_customer_sources; c public.customers; old app.m9_customer_events; d app.m9_credit_documents; h text; lid uuid; ids jsonb:='[]'; receipt jsonb; amount bigint:=0;
begin
 actor:=app.m9_customer_operator();
 if p_event is null or p_source is null or p_target is null or p_evidence->'identity_confirmed' is distinct from 'true'::jsonb or p_evidence->>'evidence_sha256' is null or p_evidence->>'evidence_sha256' !~ '^[a-f0-9]{64}$' or length(coalesce(p_evidence->>'reason','')) not between 10 and 500 or octet_length(p_evidence::text)>4000 then raise exception 'M9_CUSTOMER_LINK_REVIEW_REQUIRED';end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('source',p_source,'target',p_target,'evidence',p_evidence)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-customer-source-import',0));
 select * into old from app.m9_customer_events where id=p_event;
 if found then
  if old.request_hash<>h or old.action<>'OPEN' then raise exception 'M9_OPENING_REPLAY_CONFLICT';end if;
  return old.receipt||jsonb_build_object('replayed',true);
 end if;
 select * into strict s from app.m9_customer_sources where customer_key=p_source for update;
 if s.target_customer_id is not null or s.opening_event_id is not null or s.reversed_event_id is not null then raise exception 'M9_CUSTOMER_ALREADY_LINKED';end if;
 select * into strict c from public.customers where id=p_target and not is_anonymized for update;
 if c.privacy_consent_at is null or nullif(btrim(c.privacy_notice_version),'') is null or c.phone_e164 is null then raise exception 'M9_TARGET_CONSENT_REQUIRED';end if;
 if s.payload->>'phone_candidate' is null or s.payload->>'phone_candidate'<>c.phone_e164 then raise exception 'M9_TARGET_IDENTITY_REVIEW';end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-credit:'||p_target::text,0));
 if exists(select 1 from public.customer_credit_ledger where customer_id=p_target) then raise exception 'M9_TARGET_LEDGER_NOT_EMPTY';end if;
 if not exists(select 1 from app.m9_credit_documents where customer_key=p_source and financial_status='OPEN') then raise exception 'M9_NO_OPEN_DEBT';end if;
 perform set_config('app.credit_write','on',true);
 for d in select * from app.m9_credit_documents where customer_key=p_source and financial_status='OPEN' order by due_date,document_key loop
  if d.opening_ledger_id is not null or d.reversal_ledger_id is not null then raise exception 'M9_OPENING_ALREADY_EXISTS';end if;
  insert into public.customer_credit_ledger(customer_id,entry_type,amount_cents,due_date,location_id,actor_user_id,reference_type,reference_id,metadata)
  values(p_target,'CHARGE',d.balance_cents,d.due_date,null,actor,'LEGACY_SICAR_OPENING',d.document_key,jsonb_build_object('source_document_key',d.document_key,'source_folio',d.source_folio,'source_customer_key',p_source,'batch_sha256',s.batch_sha256,'opening_event_id',p_event,'historical_payments_not_replayed',true,'technical_only',(select source_scope='SYNTHETIC_QA_NOT_SICAR' from app.m9_customer_batches where plan_sha256=s.batch_sha256))) returning id into lid;
  update app.m9_credit_documents set opening_ledger_id=lid where document_key=d.document_key;
  ids:=ids||jsonb_build_array(jsonb_build_object('document_key',d.document_key,'ledger_id',lid,'amount_cents',d.balance_cents));amount:=amount+d.balance_cents;
 end loop;
 perform set_config('app.credit_write','off',true);
 receipt:=jsonb_build_object('event_id',p_event,'source_key',p_source,'target_customer_id',p_target,'amount_cents',amount,'charges',ids,'replayed',false);
 insert into app.m9_customer_events values(p_event,p_source,p_target,'OPEN',h,receipt,p_evidence,actor,now());
 update app.m9_customer_sources set target_customer_id=p_target,opening_event_id=p_event where customer_key=p_source;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata) values(actor,'m9.customer_credit.opening','m9_customer_events',p_event::text,receipt);
 return receipt;
end $$;

create function app.m9_reverse_customer_credit(p_event uuid,p_open_event uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid; opening app.m9_customer_events; old app.m9_customer_events; s app.m9_customer_sources; d app.m9_credit_documents; charge public.customer_credit_ledger; lid uuid; h text; receipt jsonb; ids jsonb:='[]'; amount bigint:=0;
begin
 actor:=app.m9_customer_operator();
 if p_event is null or p_open_event is null or length(coalesce(p_reason,'')) not between 10 and 500 then raise exception 'M9_REVERSAL_REASON_REQUIRED';end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('opening',p_open_event,'reason',p_reason)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-customer-source-import',0));
 select * into old from app.m9_customer_events where id=p_event;
 if found then
  if old.request_hash<>h or old.action<>'REVERSE' then raise exception 'M9_REVERSAL_REPLAY_CONFLICT';end if;
  return old.receipt||jsonb_build_object('replayed',true);
 end if;
 select * into strict opening from app.m9_customer_events where id=p_open_event and action='OPEN';
 select * into strict s from app.m9_customer_sources where customer_key=opening.customer_key for update;
 if s.opening_event_id is distinct from p_open_event or s.reversed_event_id is not null then raise exception 'M9_OPENING_NOT_REVERSIBLE';end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-credit:'||s.target_customer_id::text,0));
 -- Reject even an already-settled/zero remainder: no rewriting payment history.
 if exists(select 1 from app.m9_credit_documents d join public.customer_credit_allocations a on a.charge_ledger_id=d.opening_ledger_id where d.customer_key=s.customer_key) then raise exception 'M9_OPENING_HAS_PAYMENTS';end if;
 perform set_config('app.credit_write','on',true);
 for d in select * from app.m9_credit_documents where customer_key=s.customer_key and opening_ledger_id is not null order by document_key loop
  select * into strict charge from public.customer_credit_ledger where id=d.opening_ledger_id and entry_type='CHARGE' and reference_type='LEGACY_SICAR_OPENING' and reference_id=d.document_key and customer_id=s.target_customer_id and amount_cents=d.balance_cents;
  insert into public.customer_credit_ledger(customer_id,entry_type,amount_cents,actor_user_id,reference_type,reference_id,metadata)
  values(s.target_customer_id,'CANCELLATION',-charge.amount_cents,actor,'M9_OPENING_REVERSAL',d.document_key,jsonb_build_object('opening_ledger_id',charge.id,'opening_event_id',p_open_event,'reversal_event_id',p_event)) returning id into lid;
  insert into public.customer_credit_allocations(payment_ledger_id,charge_ledger_id,amount_cents) values(lid,charge.id,charge.amount_cents);
  update app.m9_credit_documents set reversal_ledger_id=lid where document_key=d.document_key;
  ids:=ids||jsonb_build_array(jsonb_build_object('document_key',d.document_key,'reversal_ledger_id',lid));amount:=amount+charge.amount_cents;
 end loop;
 perform set_config('app.credit_write','off',true);
 receipt:=jsonb_build_object('event_id',p_event,'opening_event_id',p_open_event,'reversed_cents',amount,'entries',ids,'replayed',false);
 insert into app.m9_customer_events values(p_event,s.customer_key,s.target_customer_id,'REVERSE',h,receipt,jsonb_build_object('reason',p_reason),actor,now());
 update app.m9_customer_sources set reversed_event_id=p_event where customer_key=s.customer_key;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata) values(actor,'m9.customer_credit.reverse','m9_customer_events',p_event::text,receipt);
 return receipt;
end $$;

alter table app.m9_customer_batches enable row level security;
alter table app.m9_customer_sources enable row level security;
alter table app.m9_credit_documents enable row level security;
alter table app.m9_credit_source_payments enable row level security;
alter table app.m9_credit_source_lines enable row level security;
alter table app.m9_customer_events enable row level security;
revoke all on app.m9_customer_batches,app.m9_customer_sources,app.m9_credit_documents,app.m9_credit_source_payments,app.m9_credit_source_lines,app.m9_customer_events from public,anon,authenticated,service_role;
revoke all on function app.m9_customer_operator(),app.m9_import_customer_sources(text,jsonb),app.m9_open_customer_credit(uuid,text,uuid,jsonb),app.m9_reverse_customer_credit(uuid,uuid,text) from public,anon,authenticated,service_role;
comment on function app.m9_import_customer_sources(text,jsonb) is 'Private staging maintenance only. Imports source records, never customers, consent, cash or stock.';
comment on function app.m9_open_customer_credit(uuid,text,uuid,jsonb) is 'Staging only. Explicit reviewed identity, valid existing customer, empty native ledger; pending source debt only.';
comment on function app.m9_reverse_customer_credit(uuid,uuid,text) is 'Compensatory reversal before payments; original charges and source history remain immutable.';
commit;
