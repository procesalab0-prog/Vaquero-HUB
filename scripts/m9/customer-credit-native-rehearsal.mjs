import { digest } from "./acceleration.mjs";
import { quoteDoText } from "./sql-literal.mjs";

// Compatibility proof only, not an opening importer. Uses one existing staging
// customer as a QA fixture, never as a mapping for any SICAR identity.
export function customerCreditNativeRehearsal(snapshot) {
  const fixture = "afbb18d6-a2bc-4da7-a261-47a5905bf28c";
  const required = [
    "public.customers",
    "public.customer_credit_ledger",
    "public.customer_credit_allocations",
    "public.customer_credit_payments",
    "public.customer_credit_payment_parts",
    "public.sales",
    "public.inventory_movements",
    "public.cash_movements",
    "public.folios",
    "public.audit_log",
  ];
  if (
    snapshot.project_id !== "zsezjtswqeijboezvado" ||
    !Number.isFinite(Date.parse(snapshot.captured_at)) ||
    Object.keys(snapshot.audit ?? {}).length !== 120 ||
    required.some(
      (t) =>
        !Number.isSafeInteger(snapshot.audit[t]?.count) ||
        !/^[a-f0-9]{32}$/.test(snapshot.audit[t]?.md5 ?? ""),
    )
  )
    throw Error("FULL_STAGING_BASELINE_REQUIRED");
  const q = (s) => quoteDoText(s, "$native$");
  const verify = (t) =>
    `if (select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(row::text,'' order by row::text),''))) from (select to_jsonb(t) row from ${t} t) x) is distinct from ${q(JSON.stringify(snapshot.audit[t]))}::jsonb then raise exception 'NATIVE_BASELINE_CHANGED: ${t}';end if;`;
  if (
    Object.keys(snapshot.audit).some(
      (t) => !/^(public|app)\.[a-z][a-z0-9_]*$/.test(t),
    )
  )
    throw Error("UNSAFE_AUDIT_TABLE");
  if (
    Object.values(snapshot.audit).some(
      (v) =>
        !Number.isSafeInteger(v?.count) ||
        v.count < 0 ||
        !/^[a-f0-9]{32}$/.test(v?.md5 ?? ""),
    )
  )
    throw Error("INVALID_AUDIT_FINGERPRINT");
  const changed = new Set([
    "public.customer_credit_ledger",
    "public.customer_credit_allocations",
    "public.customer_credit_payments",
    "public.customer_credit_payment_parts",
    "public.cash_movements",
    "public.folios",
    "public.audit_log",
  ]);
  const ref = "M9-QA-NATIVE-" + digest(snapshot);
  return `-- SYNTHETIC compatibility QA only: $3.00 debt, two $1.50 payments.
-- No real customer is imported, mapped or given new credit authorization.
begin;
set local standard_conforming_strings=on;
set local statement_timeout='120s';
set local lock_timeout='5s';
lock table public.customer_credit_ledger,public.customer_credit_allocations,public.customer_credit_payments,public.customer_credit_payment_parts,public.cash_movements,public.folios in share row exclusive mode;
create temporary table m9_native_credit_result(result jsonb) on commit drop;
create function pg_temp.m9_qa_opening(p_ref text,p_amount bigint,p_due date) returns uuid
language plpgsql security invoker set search_path='' as $qa$
declare actor uuid; entry public.customer_credit_ledger; session public.cash_sessions;
begin
 perform app.assert_sicar_staging_enabled();
 actor:=(select app.current_user_id());
 if not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=actor and u.is_active and r.code='ADMIN') then raise exception 'QA_ADMIN_REQUIRED';end if;
 if p_ref not in ('first','second') or (p_ref='first' and (p_amount<>100 or p_due<>'2026-10-19'::date)) or (p_ref='second' and (p_amount<>200 or p_due<>'2026-11-19'::date)) then raise exception 'FIXED_QA_ONLY';end if;
 if not exists(select 1 from public.customers where id='${fixture}' and not is_anonymized and privacy_consent_at is not null) then raise exception 'EXISTING_QA_CUSTOMER_REQUIRED';end if;
 select * into strict session from public.cash_sessions where cashier_user_id=actor and status='OPEN' and location_id='467765fe-d18e-43bb-be68-326adbf05ce1';
 perform pg_advisory_xact_lock(hashtextextended('customer-credit:${fixture}',0));
 select * into entry from public.customer_credit_ledger where entry_type='CHARGE' and reference_type='LEGACY_CREDIT_OPENING_QA' and reference_id='${ref}:'||p_ref;
 if found then
  if entry.customer_id<>'${fixture}'::uuid or entry.amount_cents<>p_amount or entry.due_date<>p_due or entry.metadata<>jsonb_build_object('technical_only',true,'real_sicar_identity_mapping',false) then raise exception 'OPENING_REPLAY_CONFLICT';end if;
  return entry.id;
 end if;
 perform set_config('app.credit_write','on',true);
 insert into public.customer_credit_ledger(customer_id,entry_type,amount_cents,due_date,location_id,actor_user_id,reference_type,reference_id,metadata)
 values('${fixture}','CHARGE',p_amount,p_due,session.location_id,actor,'LEGACY_CREDIT_OPENING_QA','${ref}:'||p_ref,jsonb_build_object('technical_only',true,'real_sicar_identity_mapping',false)) returning * into entry;
 perform set_config('app.credit_write','off',true);
 return entry.id;
end $qa$;
revoke all on function pg_temp.m9_qa_opening(text,bigint,date) from public,anon,authenticated,service_role;
do $native$
declare actor uuid; session_id uuid; first_charge uuid; second_charge uuid; first_payment jsonb; second_payment jsonb; replay jsonb; key1 uuid:='f12ab3f5-ec5a-44ab-b85b-782d8a1e78b4'; key2 uuid:='715beb54-11f6-4618-89c3-903f213b9f26'; failures int:=0;before_cash bigint;
begin
 perform app.assert_sicar_staging_enabled();
 if clock_timestamp()<${q(snapshot.captured_at)}::timestamptz or clock_timestamp()>${q(snapshot.captured_at)}::timestamptz+interval '1 hour' then raise exception 'QA_SNAPSHOT_STALE';end if;
 ${Object.keys(snapshot.audit).map(verify).join("\n")}
 if (select app.credit_balance('${fixture}'))<>0 or exists(select 1 from public.customer_credit_ledger where customer_id='${fixture}') then raise exception 'EMPTY_CUSTOMER_LEDGER_REQUIRED';end if;
 select cashier_user_id,id into strict actor,session_id from public.cash_sessions where status='OPEN' and location_id='467765fe-d18e-43bb-be68-326adbf05ce1';
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select coalesce(sum(amount_cents),0) into before_cash from public.cash_movements;
 first_charge:=pg_temp.m9_qa_opening('first',100,'2026-10-19');
 second_charge:=pg_temp.m9_qa_opening('second',200,'2026-11-19');
 if pg_temp.m9_qa_opening('first',100,'2026-10-19')<>first_charge or app.credit_balance('${fixture}')<>300 then raise exception 'OPENING_IDEMPOTENCE_FAILED';end if;
 begin perform pg_temp.m9_qa_opening('first',101,'2026-10-19');raise exception 'CHANGED_OPENING_ACCEPTED';exception when others then if sqlerrm<>'FIXED_QA_ONLY' then raise;end if;failures:=failures+1;end;
 begin
  insert into public.customer_credit_ledger(customer_id,entry_type,amount_cents,due_date,location_id,actor_user_id,reference_type,reference_id) values('${fixture}','CHARGE',1,'2026-10-19','467765fe-d18e-43bb-be68-326adbf05ce1',actor,'FORBIDDEN_QA','x');
  raise exception 'DIRECT_WRITE_ACCEPTED';
 exception when insufficient_privilege then failures:=failures+1;end;
 first_payment:=public.record_customer_credit_payment(key1,session_id,'${fixture}','[{"method_code":"CASH","amount_cents":150,"tendered_cents":150}]','M9 synthetic rollback QA');
 if app.credit_balance('${fixture}')<>150 or app.credit_charge_outstanding(first_charge)<>0 or app.credit_charge_outstanding(second_charge)<>150 then raise exception 'FIFO_OPENING_ALLOCATION_FAILED';end if;
 replay:=public.record_customer_credit_payment(key1,session_id,'${fixture}','[{"method_code":"CASH","amount_cents":150,"tendered_cents":150}]','M9 synthetic rollback QA');
 if replay->>'id'<>first_payment->>'id' or app.credit_balance('${fixture}')<>150 then raise exception 'PAYMENT_REPLAY_DUPLICATED';end if;
 begin perform public.record_customer_credit_payment(key1,session_id,'${fixture}','[{"method_code":"CASH","amount_cents":151,"tendered_cents":151}]','M9 synthetic rollback QA');raise exception 'CONFLICT_ACCEPTED';exception when invalid_parameter_value then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise;end if;failures:=failures+1;end;
 begin perform public.record_customer_credit_payment(key2,session_id,'${fixture}','[{"method_code":"CASH","amount_cents":151,"tendered_cents":151}]','M9 synthetic rollback QA');raise exception 'OVERPAYMENT_ACCEPTED';exception when check_violation then if sqlerrm<>'CREDIT_OVERPAYMENT' then raise;end if;failures:=failures+1;end;
 second_payment:=public.record_customer_credit_payment(key2,session_id,'${fixture}','[{"method_code":"CASH","amount_cents":150,"tendered_cents":150}]','M9 synthetic rollback QA');
 if app.credit_balance('${fixture}')<>0 or app.credit_charge_outstanding(second_charge)<>0 or (select count(*) from public.customer_credit_payments where idempotency_key in (key1,key2))<>2 then raise exception 'FINAL_DEBT_NOT_ZERO';end if;
 if (select coalesce(sum(amount_cents),0) from public.cash_movements)<>before_cash+300 then raise exception 'QA_CASH_TOTAL_MISMATCH';end if;
 begin update public.customer_credit_ledger set amount_cents=101 where id=first_charge;raise exception 'LEDGER_UPDATE_ACCEPTED';exception when insufficient_privilege then failures:=failures+1;end;
 ${Object.keys(snapshot.audit)
   .filter((t) => !changed.has(t))
   .map(verify)
   .join("\n")}
 set constraints all immediate;
 insert into m9_native_credit_result values(jsonb_build_object('mode','NATIVE_COMPATIBILITY_SYNTHETIC_ROLLBACK','opening_charges',2,'opening_replay_without_duplicate',true,'native_payments',2,'payment_replay_without_duplicate',true,'fifo_allocation',true,'negative_checks',failures,'final_fixture_debt_cents',0,'qa_cash_cents',300,'real_customers_imported',0,'real_source_debt_imported',0,'new_sales',0,'new_stock_movements',0,'new_loyalty_points',0,'auth_postgrest_acceptance',false));
end $native$;
select * from m9_native_credit_result;
rollback;
`;
}
