begin;
create table app.m9_customer_identity_reviews (
 customer_key text primary key references app.m9_customer_sources(customer_key),
 actor_user_id uuid not null references public.app_users(id),
 disposition text not null check(disposition in ('PENDING','NEEDS_CONTACT','CANDIDATE')),
 target_customer_id uuid references public.customers(id),
 note text not null check(length(note) between 5 and 500),
 source_hash text not null,
 updated_at timestamptz not null default now()
);
create index m9_customer_review_actor_idx on app.m9_customer_identity_reviews(actor_user_id);
create index m9_customer_review_target_idx on app.m9_customer_identity_reviews(target_customer_id);
create table app.m9_customer_preview_control (
 singleton boolean primary key default true check(singleton),
 actor_user_id uuid not null references public.app_users(id),
 customer_key text not null references app.m9_customer_sources(customer_key),
 target_customer_id uuid not null references public.customers(id),
 expires_at timestamptz not null,
 enabled boolean not null default false
);
create index m9_customer_preview_control_actor_idx on app.m9_customer_preview_control(actor_user_id);
create index m9_customer_preview_control_source_idx on app.m9_customer_preview_control(customer_key);
create index m9_customer_preview_control_target_idx on app.m9_customer_preview_control(target_customer_id);
create table app.m9_customer_preview_runs (
 id uuid primary key,
 actor_user_id uuid not null references public.app_users(id),
 customer_key text not null references app.m9_customer_sources(customer_key),
 target_customer_id uuid not null references public.customers(id),
 requests jsonb not null default '{}',
 payments jsonb not null default '[]',
 result jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index m9_customer_preview_runs_actor_idx on app.m9_customer_preview_runs(actor_user_id);
create index m9_customer_preview_runs_source_idx on app.m9_customer_preview_runs(customer_key);
create index m9_customer_preview_runs_target_idx on app.m9_customer_preview_runs(target_customer_id);

-- Definer belongs in the unexposed schema. JWT/role/staging checks occur on
-- every action; no importer grants or arbitrary customer/debt activation.
create function app.m9_customer_review_api(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());v_query text;v_page integer;v_key text;
 v_source app.m9_customer_sources;v_control app.m9_customer_preview_control;
 v_run app.m9_customer_preview_runs;v_id uuid;v_request uuid;v_amount bigint;
 v_request_hash text;v_old jsonb;v_result jsonb;v_link jsonb;v_payment jsonb;
 v_part jsonb;v_session uuid;v_evidence jsonb;v_target uuid;v_note text;v_disposition text;
begin
 perform app.assert_sicar_staging_enabled();
 if v_actor is null or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=v_actor and u.is_active and r.code='ADMIN') or not app.has_perm('customers.manage') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>6000 then raise exception 'M9_REVIEW_INPUT_INVALID';end if;
 if p_action='LIST' then
  v_query:=left(btrim(coalesce(p_input->>'q','')),100);
  v_page:=greatest(1,least(1000,coalesce((p_input->>'page')::integer,1)));
  return jsonb_build_object('summary',(select jsonb_build_object('accounts',count(*),'pending_cents',coalesce(sum(s.used_cents),0),'missing_contact',count(*) filter(where s.payload->>'phone_candidate' is null),'reviewed',count(r.customer_key)) from app.m9_customer_sources s join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256 left join app.m9_customer_identity_reviews r using(customer_key) where b.source_scope='APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS'),
   'total',(select count(*) from app.m9_customer_sources s join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256 where b.source_scope='APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS' and (v_query='' or position(lower(v_query) in lower(s.payload->>'source_display_name'))>0 or position(v_query in coalesce(s.payload->>'phone_candidate',''))>0)),
   'rows',coalesce((select jsonb_agg(x.row) from (select jsonb_build_object('key',s.customer_key,'name',s.payload->>'source_display_name','phone',s.payload->>'phone_candidate','balance_cents',s.used_cents,'holds',s.payload->'holds','review',r.disposition) row from app.m9_customer_sources s join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256 left join app.m9_customer_identity_reviews r using(customer_key) where b.source_scope='APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS' and (v_query='' or position(lower(v_query) in lower(s.payload->>'source_display_name'))>0 or position(v_query in coalesce(s.payload->>'phone_candidate',''))>0) order by (s.used_cents>0) desc,s.payload->>'source_display_name',s.customer_key limit 20 offset (v_page-1)*20)x),'[]'::jsonb),
   'qa_available',exists(select 1 from app.m9_customer_preview_control where singleton and enabled and actor_user_id=v_actor and expires_at>clock_timestamp()));
 elsif p_action in ('DETAIL','SAVE_REVIEW') then
  v_key:=p_input->>'key';
  select s.* into strict v_source from app.m9_customer_sources s join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256 where s.customer_key=v_key and b.source_scope='APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS';
  if p_action='SAVE_REVIEW' then
   v_disposition:=p_input->>'disposition';v_note:=btrim(coalesce(p_input->>'note',''));v_target:=nullif(p_input->>'target','')::uuid;
   if v_disposition is null or v_disposition not in ('PENDING','NEEDS_CONTACT','CANDIDATE') or length(v_note) not between 5 and 500 then raise exception 'M9_REVIEW_FIELDS_REQUIRED';end if;
   if v_disposition='CANDIDATE' and not exists(select 1 from public.customers c where c.id=v_target and c.phone_e164=v_source.payload->>'phone_candidate' and not c.is_anonymized and c.privacy_consent_at is not null) then raise exception 'M9_TARGET_IDENTITY_REVIEW';end if;
   if v_disposition<>'CANDIDATE' then v_target:=null;end if;
   insert into app.m9_customer_identity_reviews values(v_key,v_actor,v_disposition,v_target,v_note,encode(extensions.digest(convert_to(v_source.payload::text,'UTF8'),'sha256'),'hex'),now()) on conflict(customer_key) do update set actor_user_id=excluded.actor_user_id,disposition=excluded.disposition,target_customer_id=excluded.target_customer_id,note=excluded.note,source_hash=excluded.source_hash,updated_at=now();
   return jsonb_build_object('saved',true,'activated',false);
  end if;
  return jsonb_build_object('key',v_key,'name',v_source.payload->>'source_display_name','phone',v_source.payload->>'phone_candidate','balance_cents',v_source.used_cents,'holds',v_source.payload->'holds',
   'source_at',(select source_at from app.m9_customer_batches where plan_sha256=v_source.batch_sha256),
   'review',(select jsonb_build_object('disposition',disposition,'target',target_customer_id,'note',note) from app.m9_customer_identity_reviews where customer_key=v_key),
   'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',full_name,'phone',phone_e164)) from public.customers where phone_e164=v_source.payload->>'phone_candidate' and not is_anonymized and privacy_consent_at is not null),'[]'::jsonb),
   'documents',coalesce((select jsonb_agg(jsonb_build_object('key',d.document_key,'folio',d.source_folio,'status',d.financial_status,'total_cents',d.total_cents,'paid_cents',d.paid_cents,'balance_cents',d.balance_cents,'due_date',d.due_date,'payments',(select coalesce(jsonb_agg(jsonb_build_object('reference',p.source_ref,'amount_cents',p.amount_cents,'cancelled',p.cancelled)),'[]') from app.m9_credit_source_payments p where p.document_key=d.document_key),'lines',(select coalesce(jsonb_agg(jsonb_build_object('barcode',l.barcode,'quantity',l.quantity,'mapped',l.variant_id is not null) order by l.line_index),'[]') from app.m9_credit_source_lines l where l.document_key=d.document_key)) order by d.financial_status,d.source_folio) from app.m9_credit_documents d where d.customer_key=v_key),'[]'::jsonb));
 elsif p_action='QA_STATE' then
  select * into v_run from app.m9_customer_preview_runs where id=(p_input->>'run')::uuid and actor_user_id=v_actor;
  if not found then raise exception 'M9_QA_RUN_NOT_FOUND';end if;
  return v_run.result||jsonb_build_object('run',v_run.id,'payment_count',jsonb_array_length(v_run.payments));
 elsif p_action in ('QA_LINK','QA_PAY') then
  if not app.has_perm('credit.collect') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
  select * into strict v_control from app.m9_customer_preview_control where singleton and enabled and actor_user_id=v_actor and expires_at>clock_timestamp();
  if not exists(select 1 from app.m9_customer_sources s join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256 where s.customer_key=v_control.customer_key and b.source_scope='SYNTHETIC_QA_NOT_SICAR' and s.used_cents=1000) then raise exception 'M9_QA_SOURCE_REQUIRED';end if;
  v_id:=(p_input->>'run')::uuid;v_request:=(p_input->>'request')::uuid;
  if v_id is null or v_request is null then raise exception 'M9_QA_REQUEST_REQUIRED';end if;
  v_amount:=case when p_action='QA_PAY' then (p_input->>'amount_cents')::bigint else 0 end;
  if p_action='QA_PAY' and (v_amount is null or v_amount<=0) then raise exception 'INVALID_CREDIT_PAYMENT';end if;
  v_request_hash:=encode(extensions.digest(convert_to(jsonb_build_object('action',p_action,'run',v_id,'amount',v_amount)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('m9-preview-run:'||v_id::text,0));
  select * into v_run from app.m9_customer_preview_runs where id=v_id for update;
  if found then
   if v_run.actor_user_id<>v_actor or v_run.customer_key<>v_control.customer_key or v_run.target_customer_id<>v_control.target_customer_id then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
   v_old:=v_run.requests->v_request::text;
   if v_old is not null then
    if v_old->>'hash'<>v_request_hash then raise exception 'IDEMPOTENCY_CONFLICT';end if;
    return v_old->'result'||jsonb_build_object('replayed',true);
   end if;
   if p_action='QA_LINK' then raise exception 'M9_QA_ALREADY_LINKED';end if;
  else
   if p_action<>'QA_LINK' then raise exception 'M9_QA_LINK_REQUIRED';end if;
   v_run.payments:='[]';v_run.requests:='{}';
  end if;
  if jsonb_array_length(v_run.payments)>=10 then raise exception 'M9_QA_SCOPE_LIMIT';end if;
  select id into strict v_session from public.cash_sessions where cashier_user_id=v_actor and status='OPEN' and location_id in(select id from public.locations where is_active and type='STORE');
  v_evidence:=jsonb_build_object('identity_confirmed',true,'warehouse_confirmed',true,'source_warehouse','Default','cut_confirmed',true,'location_id',(select location_id from public.cash_sessions where id=v_session),'evidence_sha256',repeat('a',64),'reason','Ensayo QA desde Preview con Auth real; sin identidad SICAR real');
  -- Native side effects never escape this subtransaction. Only trial state is saved.
  begin
   v_link:=app.m9_open_customer_credit(v_id,v_control.customer_key,v_control.target_customer_id,v_evidence);
   for v_part in select value from jsonb_array_elements(v_run.payments) loop
    perform public.record_customer_credit_payment((v_part->>'id')::uuid,v_session,v_control.target_customer_id,jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',(v_part->>'amount_cents')::bigint,'tendered_cents',(v_part->>'amount_cents')::bigint)),'M9 Preview QA rollback');
   end loop;
   if p_action='QA_PAY' then
    v_payment:=public.record_customer_credit_payment(v_request,v_session,v_control.target_customer_id,jsonb_build_array(jsonb_build_object('method_code','CASH','amount_cents',v_amount,'tendered_cents',v_amount)),'M9 Preview QA rollback');
   end if;
   set constraints all immediate;
   v_result:=jsonb_build_object('mode','AUTH_PREVIEW_NATIVE_ROLLBACK','balance_cents',app.credit_balance(v_control.target_customer_id),'last_amount_cents',v_amount,'native_rollback',true,'valid_payment_receipt',false,'replayed',false,'actor_id',v_actor);
   raise exception 'M9_QA_NATIVE_ROLLBACK' using errcode='PT002';
  exception when sqlstate 'PT002' then null;end;
  if p_action='QA_PAY' then v_run.payments:=v_run.payments||jsonb_build_array(jsonb_build_object('id',v_request,'amount_cents',v_amount));end if;
  v_result:=v_result||jsonb_build_object('run',v_id,'payment_count',jsonb_array_length(v_run.payments));
  v_run.requests:=v_run.requests||jsonb_build_object(v_request::text,jsonb_build_object('hash',v_request_hash,'result',v_result));
  insert into app.m9_customer_preview_runs(id,actor_user_id,customer_key,target_customer_id,requests,payments,result) values(v_id,v_actor,v_control.customer_key,v_control.target_customer_id,v_run.requests,v_run.payments,v_result) on conflict(id) do update set requests=excluded.requests,payments=excluded.payments,result=excluded.result,updated_at=now();
  return v_result;
 end if;
 raise exception 'M9_REVIEW_ACTION_INVALID';
end $$;

create function public.m9_customer_review(p_action text,p_input jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select app.m9_customer_review_api(p_action,p_input)$$;
alter table app.m9_customer_identity_reviews enable row level security;
alter table app.m9_customer_preview_control enable row level security;
alter table app.m9_customer_preview_runs enable row level security;
revoke all on app.m9_customer_identity_reviews,app.m9_customer_preview_control,app.m9_customer_preview_runs from public,anon,authenticated,service_role;
revoke all on function app.m9_customer_review_api(text,jsonb),public.m9_customer_review(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app.m9_customer_review_api(text,jsonb),public.m9_customer_review(text,jsonb) to authenticated;
commit;
