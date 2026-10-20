begin;
create or replace function app.m9_record_legacy_cash_trial(p_request uuid,p_account uuid,p_session uuid,p_parts jsonb) returns jsonb
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
 insert into public.folio_document_types(code,description) values('M9_LEGACY_PAYMENT_TRIAL','Ensayo reversible de abono heredado') on conflict(code) do nothing;
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


commit;
