import { createHash } from "node:crypto";
import { digest } from "./acceleration.mjs";
import { quoteDoText } from "./sql-literal.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const q = (s) => quoteDoText(s, "$importqa$");
const uuid = (s) =>
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(s ?? "");
function context(snapshot, fixture) {
  if (
    snapshot.project_id !== "zsezjtswqeijboezvado" ||
    Object.keys(snapshot.audit ?? {}).length !== 126 ||
    !Number.isFinite(Date.parse(snapshot.captured_at)) ||
    !uuid(fixture.actor_id) ||
    !uuid(fixture.customer_id) ||
    !uuid(fixture.session_id) ||
    !uuid(fixture.location_id) ||
    fixture.native_balance_cents !== 0 ||
    fixture.privacy_recorded !== true ||
    !/^\+52\d{10}$/.test(fixture.phone_e164 ?? "")
  )
    throw Error("CUSTOMER_IMPORT_QA_CONTEXT_REQUIRED");
  for (const [t, v] of Object.entries(snapshot.audit))
    if (
      !/^(app|public)\.[a-z][a-z0-9_]*$/.test(t) ||
      !Number.isSafeInteger(v.count) ||
      v.count < 0 ||
      !/^[a-f0-9]{32}$/.test(v.md5 ?? "")
    )
      throw Error("CUSTOMER_IMPORT_AUDIT_INVALID");
  return `perform app.assert_sicar_staging_enabled();
 if clock_timestamp()<${q(snapshot.captured_at)}::timestamptz or clock_timestamp()>${q(snapshot.captured_at)}::timestamptz+interval '1 hour' then raise exception 'QA_BASELINE_STALE';end if;
 for tbl,expected in select key,value from jsonb_each(${q(JSON.stringify(snapshot.audit))}::jsonb) loop
  execute format('select jsonb_build_object(''count'',count(*),''md5'',md5(coalesce(string_agg(row::text,'''' order by row::text),''''))) from (select to_jsonb(t) row from %I.%I t) x',split_part(tbl,'.',1),split_part(tbl,'.',2)) into actual;
  if actual is distinct from expected then raise exception 'QA_BASELINE_CHANGED: %',tbl;end if;
 end loop;
 perform set_config('request.jwt.claim.sub',${q(fixture.actor_id)},true);`;
}
const prelude = `begin;\nset local standard_conforming_strings=on;\nset local statement_timeout='120s';\nset local lock_timeout='5s';\ncreate temporary table m9_import_qa_result(result jsonb) on commit drop;\n`;

export function sourceImporterRehearsal(planRaw, snapshot, fixture) {
  const plan = JSON.parse(planRaw),
    sha = hash(planRaw);
  if (
    plan.version !== "m9-customer-credit-1" ||
    plan.scope !== "APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS" ||
    !plan.payments.some((p) => !p.cancelled) ||
    plan.lines.length < 1
  )
    throw Error("REAL_SOURCE_TRIAL_REQUIRED");
  const baseline = context(snapshot, fixture);
  return `${prelude}
do $importqa$
declare p jsonb:=${q(planRaw)}::jsonb; bad jsonb; receipt jsonb; replay jsonb; tbl text; expected jsonb; actual jsonb; rejected int:=0; i int; code text; msg text; accounts_before int; docs_before int;
begin
 ${baseline}
 if exists(select 1 from app.m9_customer_batches where plan_sha256=${q(sha)}) then raise exception 'SOURCE_TRIAL_REQUIRES_UNLOADED_BATCH';end if;
 select count(*) into accounts_before from app.m9_customer_sources;
 select count(*) into docs_before from app.m9_credit_documents;
 for i in 1..6 loop
  bad:=case i
  when 1 then jsonb_set(p,'{customers,0,used_cents}',to_jsonb((p#>>'{customers,0,used_cents}')::bigint+1))
  when 2 then jsonb_set(p,'{customers,0,privacy_consent_at}','"2026-01-01T00:00:00Z"')
  when 3 then jsonb_set(p,'{inventory_import_allowed}','true')
  when 4 then jsonb_set(p,'{lines,0,delivery_status}','"DELIVERED"')
  when 5 then jsonb_set(p,'{payments,0,amount_cents}',to_jsonb((p#>>'{payments,0,amount_cents}')::bigint+1))
  when 6 then jsonb_set(p,'{documents,0,total_cents}',to_jsonb((p#>>'{documents,0,total_cents}')::bigint+1)) end;
  begin
   perform app.m9_import_customer_sources(${q(sha)},bad);raise exception 'INVALID_SOURCE_ACCEPTED';
  exception when others then
   get stacked diagnostics code=returned_sqlstate,msg=message_text;
   if (i=1 and msg<>'M9_CUSTOMER_DEBT_MISMATCH') or (i=2 and msg<>'M9_CUSTOMER_IDENTITY_UNREVIEWED') or (i=3 and msg<>'M9_CUSTOMER_PLAN_INVALID') or (i=4 and msg<>'M9_CUSTOMER_LINE_INVALID') or (i=5 and msg<>'M9_CUSTOMER_ABONO_MISMATCH') or (i=6 and code<>'23514') then raise;end if;
   rejected:=rejected+1;
  end;
  if exists(select 1 from app.m9_customer_batches where plan_sha256=${q(sha)}) or (select count(*) from app.m9_customer_sources)<>accounts_before or (select count(*) from app.m9_credit_documents)<>docs_before then raise exception 'PARTIAL_IMPORT_LEFT_BEHIND';end if;
 end loop;
 receipt:=app.m9_import_customer_sources(${q(sha)},p);
 replay:=app.m9_import_customer_sources(${q(sha)},p);
 if replay->'replayed' is distinct from 'true'::jsonb or (select count(*) from app.m9_customer_sources)<>accounts_before+${plan.customers.length} or (select count(*) from app.m9_credit_documents)<>docs_before+${plan.documents.length} or (receipt->>'pending_source_cents')::bigint<>${plan.summary.opening_candidate_cents} then raise exception 'IMPORT_REPLAY_DUPLICATED';end if;
 begin perform app.m9_import_customer_sources(${q(sha)},jsonb_set(p,'{summary,customers}','0'));raise exception 'REPLAY_CONFLICT_ACCEPTED';exception when others then if sqlerrm<>'M9_CUSTOMER_REPLAY_CONFLICT' then raise;end if;rejected:=rejected+1;end;
 begin perform app.m9_import_customer_sources(repeat('f',64),p);raise exception 'CROSS_CUT_COLLISION_ACCEPTED';exception when unique_violation then rejected:=rejected+1;end;
 begin perform set_config('request.jwt.claim.sub','',true);perform app.m9_import_customer_sources(${q(sha)},p);raise exception 'MISSING_ACTOR_ACCEPTED';exception when insufficient_privilege then rejected:=rejected+1;end;
 perform set_config('request.jwt.claim.sub',${q(fixture.actor_id)},true);
 begin execute 'set local role authenticated';perform app.m9_import_customer_sources(${q(sha)},p);raise exception 'APP_ROLE_IMPORT_ACCEPTED';exception when insufficient_privilege then rejected:=rejected+1;end;
 begin execute 'set local role anon';perform app.m9_import_customer_sources(${q(sha)},p);raise exception 'ANON_IMPORT_ACCEPTED';exception when insufficient_privilege then rejected:=rejected+1;end;
 begin execute 'set local role service_role';perform app.m9_import_customer_sources(${q(sha)},p);raise exception 'SERVICE_IMPORT_ACCEPTED';exception when insufficient_privilege then rejected:=rejected+1;end;
 if current_user<>'postgres' then raise exception 'QA_ROLE_NOT_RESTORED';end if;
 set constraints all immediate;
 insert into m9_import_qa_result values(receipt||jsonb_build_object('mode','REAL_SOURCE_IMPORT_ROLLBACK','identical_replay',true,'negative_checks',rejected,'rollback_after_trial',true));
end $importqa$;
select * from m9_import_qa_result;
rollback;
`;
}

export function nativeOpeningRehearsal(snapshot, fixture, variant) {
  const baseline = context(snapshot, fixture);
  if (
    !uuid(variant.variant_id) ||
    typeof variant.barcode !== "string" ||
    !variant.barcode.length
  )
    throw Error("QA_EXACT_VARIANT_REQUIRED");
  const customer_key = digest({
      qa: "M9_OPENING_FIXTURE_NOT_A_SICAR_CUSTOMER",
    }),
    keys = [digest({ qa: "first" }), digest({ qa: "second" })];
  const customer = {
    customer_key,
    source_ref: "QA-M9-OPENING-NOT-SICAR",
    source_display_name: "M9 QA SIN IDENTIDAD SICAR",
    phone_candidate: fixture.phone_e164,
    privacy_consent_at: null,
    marketing_consent: null,
    auth_user_id: null,
    target_customer_id: null,
    email: null,
    operational_import_allowed: false,
    used_cents: 1000,
  };
  const docs = keys.map((key, i) => ({
    document_key: key,
    customer_key,
    source_folio: "QA-" + (i + 1),
    total_cents: i ? 700 : 300,
    balance_cents: i ? 700 : 300,
    paid_to_date_cents: 0,
    opening_candidate_cents: i ? 700 : 300,
    due_date: i ? "2026-11-19" : "2026-10-19",
    financial_status: "OPEN",
    delivery_status: "UNKNOWN",
    operational_import_allowed: false,
  }));
  const plan = {
    version: "m9-customer-credit-1",
    project_id: "zsezjtswqeijboezvado",
    scope: "SYNTHETIC_QA_NOT_SICAR",
    assessed_at: snapshot.captured_at,
    production_allowed: false,
    operational_import_allowed: false,
    inventory_import_allowed: false,
    customers: [customer],
    documents: docs,
    payments: [],
    lines: keys.map((key) => ({
      document_key: key,
      line_index: 0,
      barcode: variant.barcode,
      quantity: "1",
      variant_id: variant.variant_id,
      delivery_status: "UNKNOWN",
      reserved_qty: null,
      additional_stock_deduction: null,
    })),
  };
  const raw = JSON.stringify(plan),
    sha = hash(raw),
    evidence = JSON.stringify({
      identity_confirmed: true,
      warehouse_confirmed: true,
      source_warehouse: "Default",
      cut_confirmed: true,
      location_id: fixture.location_id,
      evidence_sha256: digest({ qa: true }),
      reason: "Ensayo sintético; no vincula ningún cliente SICAR real",
    });
  return `${prelude}
do $importqa$
declare tbl text;expected jsonb;actual jsonb;r jsonb;rr jsonb;payment jsonb;charge1 uuid;charge2 uuid;negative_checks int:=0;evidence jsonb:=${q(evidence)}::jsonb;
begin
 ${baseline}
 if exists(select 1 from public.customer_credit_ledger where customer_id=${q(fixture.customer_id)}::uuid) then raise exception 'QA_NATIVE_LEDGER_NOT_EMPTY';end if;
 perform app.m9_import_customer_sources(${q(sha)},${q(raw)}::jsonb);
 begin perform app.m9_open_customer_credit('440794ee-6de5-49a7-bd81-67291c946721',${q(customer_key)},${q(fixture.customer_id)}::uuid,evidence-'location_id'-'warehouse_confirmed');raise exception 'UNREVIEWED_LOCATION_ACCEPTED';exception when others then if sqlerrm<>'M9_SOURCE_CUT_LOCATION_REQUIRED' then raise;end if;negative_checks:=negative_checks+1;end;
 begin
  update app.m9_customer_batches set source_at=clock_timestamp()-interval '25 hours' where plan_sha256=${q(sha)};
  perform app.m9_open_customer_credit('440794ee-6de5-49a7-bd81-67291c946721',${q(customer_key)},${q(fixture.customer_id)}::uuid,evidence);raise exception 'STALE_DEBT_OPENING_ACCEPTED';
 exception when others then if sqlerrm<>'M9_SOURCE_CUT_STALE' then raise;end if;negative_checks:=negative_checks+1;end;
 -- Scenario A lives in a subtransaction. Reversal must close original charges
 -- for FIFO, not only subtract their amounts from the overall account balance.
 begin
  r:=app.m9_open_customer_credit('440794ee-6de5-49a7-bd81-67291c946721',${q(customer_key)},${q(fixture.customer_id)}::uuid,evidence);
  rr:=app.m9_reverse_customer_credit('c7f68ca5-fb3a-4291-a8b4-ab0d3624523a','440794ee-6de5-49a7-bd81-67291c946721','Revertir ensayo antes de cualquier abono');
  if app.credit_balance(${q(fixture.customer_id)}::uuid)<>0 or exists(select 1 from app.m9_credit_documents where customer_key=${q(customer_key)} and app.credit_charge_outstanding(opening_ledger_id)<>0) then raise exception 'REVERSAL_LEFT_FIFO_DEBT';end if;
  rr:=app.m9_reverse_customer_credit('c7f68ca5-fb3a-4291-a8b4-ab0d3624523a','440794ee-6de5-49a7-bd81-67291c946721','Revertir ensayo antes de cualquier abono');
  if rr->'replayed' is distinct from 'true'::jsonb then raise exception 'REVERSAL_REPLAY_DUPLICATED';end if;
  set constraints all immediate;
  raise exception 'QA_ROLLBACK_REVERSAL_SCENARIO' using errcode='PT001';
 exception when sqlstate 'PT001' then null;end;
 if exists(select 1 from public.customer_credit_ledger where customer_id=${q(fixture.customer_id)}::uuid) then raise exception 'SCENARIO_NOT_ROLLED_BACK';end if;
 -- Scenario B: real native payment RPC, not replay of source historical abonos.
 begin perform app.m9_open_customer_credit('440794ee-6de5-49a7-bd81-67291c946721',${q(customer_key)},${q(fixture.customer_id)}::uuid,evidence||'{"identity_confirmed":false}'::jsonb);raise exception 'UNREVIEWED_IDENTITY_ACCEPTED';exception when others then if sqlerrm<>'M9_CUSTOMER_LINK_REVIEW_REQUIRED' then raise;end if;negative_checks:=negative_checks+1;end;
 r:=app.m9_open_customer_credit('440794ee-6de5-49a7-bd81-67291c946721',${q(customer_key)},${q(fixture.customer_id)}::uuid,evidence);
 rr:=app.m9_open_customer_credit('440794ee-6de5-49a7-bd81-67291c946721',${q(customer_key)},${q(fixture.customer_id)}::uuid,evidence);
 begin perform app.m9_open_customer_credit('b3fe281a-22b6-474b-a293-c1876782e882',${q(customer_key)},${q(fixture.customer_id)}::uuid,evidence);raise exception 'DUPLICATE_LINK_ACCEPTED';exception when others then if sqlerrm<>'M9_CUSTOMER_ALREADY_LINKED' then raise;end if;negative_checks:=negative_checks+1;end;
 if rr->'replayed' is distinct from 'true'::jsonb or app.credit_balance(${q(fixture.customer_id)}::uuid)<>1000 then raise exception 'OPENING_REPLAY_DUPLICATED';end if;
 begin perform app.m9_open_customer_credit('440794ee-6de5-49a7-bd81-67291c946721',${q(customer_key)},${q(fixture.customer_id)}::uuid,evidence||'{"reason":"Conflicting revised evidence"}'::jsonb);raise exception 'OPENING_CONFLICT_ACCEPTED';exception when others then if sqlerrm<>'M9_OPENING_REPLAY_CONFLICT' then raise;end if;negative_checks:=negative_checks+1;end;
 select opening_ledger_id into strict charge1 from app.m9_credit_documents where document_key=${q(keys[0])};
 select opening_ledger_id into strict charge2 from app.m9_credit_documents where document_key=${q(keys[1])};
 payment:=public.record_customer_credit_payment('6758c704-ce97-430a-a064-77f1865a0989',${q(fixture.session_id)}::uuid,${q(fixture.customer_id)}::uuid,'[{"method_code":"CASH","amount_cents":400,"tendered_cents":400}]','QA rollback de importador SICAR');
 rr:=public.record_customer_credit_payment('6758c704-ce97-430a-a064-77f1865a0989',${q(fixture.session_id)}::uuid,${q(fixture.customer_id)}::uuid,'[{"method_code":"CASH","amount_cents":400,"tendered_cents":400}]','QA rollback de importador SICAR');
 if payment->>'id'<>rr->>'id' or app.credit_balance(${q(fixture.customer_id)}::uuid)<>600 or app.credit_charge_outstanding(charge1)<>0 or app.credit_charge_outstanding(charge2)<>600 then raise exception 'NATIVE_OPENING_FIFO_FAILED';end if;
 begin perform app.m9_reverse_customer_credit('c7f68ca5-fb3a-4291-a8b4-ab0d3624523a','440794ee-6de5-49a7-bd81-67291c946721','No se debe revertir si ya recibió un abono');raise exception 'PAID_OPENING_REVERSAL_ACCEPTED';exception when others then if sqlerrm<>'M9_OPENING_HAS_PAYMENTS' then raise;end if;negative_checks:=negative_checks+1;end;
 begin perform public.record_customer_credit_payment('ca5dbce9-c468-4fca-b538-556c8dbb47c1',${q(fixture.session_id)}::uuid,${q(fixture.customer_id)}::uuid,'[{"method_code":"CASH","amount_cents":601,"tendered_cents":601}]','QA rollback de importador SICAR');raise exception 'OVERPAYMENT_ACCEPTED';exception when check_violation then if sqlerrm<>'CREDIT_OVERPAYMENT' then raise;end if;negative_checks:=negative_checks+1;end;
 perform public.record_customer_credit_payment('ca5dbce9-c468-4fca-b538-556c8dbb47c1',${q(fixture.session_id)}::uuid,${q(fixture.customer_id)}::uuid,'[{"method_code":"CASH","amount_cents":600,"tendered_cents":600}]','QA rollback de importador SICAR');
 if app.credit_balance(${q(fixture.customer_id)}::uuid)<>0 or app.credit_charge_outstanding(charge2)<>0 then raise exception 'NATIVE_FINAL_BALANCE_NOT_ZERO';end if;
 set constraints all immediate;
 insert into m9_import_qa_result values(jsonb_build_object('mode','NATIVE_SOURCE_BRIDGE_SYNTHETIC_ROLLBACK','opening_charges',2,'source_debt_fixture_cents',1000,'compensatory_reversal',true,'reversed_fifo_outstanding_zero',true,'opening_replay',true,'reversal_replay',true,'payment_replay',true,'native_payments',2,'fifo',true,'negative_checks',negative_checks,'final_native_debt_cents',0,'real_source_customers_linked',0,'auth_postgrest_acceptance',false));
end $importqa$;
select * from m9_import_qa_result;
rollback;
`;
}
