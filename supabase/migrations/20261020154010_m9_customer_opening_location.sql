begin;
-- Explicit reviewed Default -> store mapping; preserve it on compensation.
create or replace function app.m9_open_customer_credit(p_event uuid,p_source text,p_target uuid,p_evidence jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid; s app.m9_customer_sources; c public.customers; old app.m9_customer_events; d app.m9_credit_documents; h text; lid uuid; ids jsonb:='[]'; receipt jsonb; amount bigint:=0; location uuid;
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
 if p_evidence->'warehouse_confirmed' is distinct from 'true'::jsonb or p_evidence->>'source_warehouse' is distinct from 'Default' or p_evidence->'cut_confirmed' is distinct from 'true'::jsonb then raise exception 'M9_SOURCE_CUT_LOCATION_REQUIRED';end if;
 location:=(p_evidence->>'location_id')::uuid;
 if not exists(select 1 from public.locations l where l.id=location and l.is_active and l.type='STORE' and app.can_access_location(l.id)) then raise exception 'M9_SOURCE_CUT_LOCATION_REQUIRED';end if;
 if not exists(select 1 from app.m9_customer_batches b where b.plan_sha256=s.batch_sha256 and b.source_at between clock_timestamp()-interval '24 hours' and clock_timestamp()) then raise exception 'M9_SOURCE_CUT_STALE';end if;
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
  values(p_target,'CHARGE',d.balance_cents,d.due_date,location,actor,'LEGACY_SICAR_OPENING',d.document_key,jsonb_build_object('source_document_key',d.document_key,'source_folio',d.source_folio,'source_customer_key',p_source,'batch_sha256',s.batch_sha256,'opening_event_id',p_event,'historical_payments_not_replayed',true,'technical_only',(select source_scope='SYNTHETIC_QA_NOT_SICAR' from app.m9_customer_batches where plan_sha256=s.batch_sha256))) returning id into lid;
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

create or replace function app.m9_reverse_customer_credit(p_event uuid,p_open_event uuid,p_reason text) returns jsonb
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
  insert into public.customer_credit_ledger(customer_id,entry_type,amount_cents,location_id,actor_user_id,reference_type,reference_id,metadata)
  values(s.target_customer_id,'CANCELLATION',-charge.amount_cents,charge.location_id,actor,'M9_OPENING_REVERSAL',d.document_key,jsonb_build_object('opening_ledger_id',charge.id,'opening_event_id',p_open_event,'reversal_event_id',p_event)) returning id into lid;
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


revoke all on function app.m9_open_customer_credit(uuid,text,uuid,jsonb),app.m9_reverse_customer_credit(uuid,uuid,text) from public,anon,authenticated,service_role;
commit;
