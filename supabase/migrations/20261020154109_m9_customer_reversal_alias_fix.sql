begin;
-- Disambiguate the SQL table alias from the PL/pgSQL document row.
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
 if exists(select 1 from app.m9_credit_documents doc join public.customer_credit_allocations a on a.charge_ledger_id=doc.opening_ledger_id where doc.customer_key=s.customer_key) then raise exception 'M9_OPENING_HAS_PAYMENTS';end if;
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


revoke all on function app.m9_reverse_customer_credit(uuid,uuid,text) from public,anon,authenticated,service_role;
commit;
