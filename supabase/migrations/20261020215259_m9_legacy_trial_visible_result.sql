begin;
create or replace function app.m9_legacy_finance_api(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.m9_legacy_actor();rid uuid;aid uuid;amount bigint;h text;old app.m9_legacy_finance_events;result jsonb;replay jsonb;before_balance bigint;after_balance bigint;rows jsonb;
begin
 if octet_length(coalesce(p_input,'{}'::jsonb)::text)>2000 then raise exception 'M9_INPUT_TOO_LARGE';end if;
 if p_action='LIST' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',s.payload->>'source_display_name','balance_cents',q.balance,'documents',q.documents,'entries',(select jsonb_agg(jsonb_build_object('folio',d.source_folio,'amount_cents',l.amount_cents,'due',l.due_date) order by l.due_date nulls last,l.document_key) from app.m9_legacy_finance_ledger l join app.m9_credit_documents d using(document_key) where l.registry_id=r.id and l.kind='OPEN')) order by r.id),'[]'::jsonb) into rows
  from app.m9_legacy_registry r join app.m9_customer_sources s using(customer_key) join lateral(select sum(amount_cents) balance,count(*) filter(where kind='OPEN') documents from app.m9_legacy_finance_ledger where registry_id=r.id) q on q.documents>0;
  return jsonb_build_object('accounts',rows,'last_trial',(select e.receipt from app.m9_legacy_finance_events e where e.kind='TRIAL' and e.actor_user_id=actor order by e.created_at desc,e.id limit 1),'trial_count',(select count(*) from app.m9_legacy_finance_events where kind='TRIAL'),'cash_collection_enabled',false,'staging_only',true);
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

commit;
