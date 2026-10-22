begin;
select app.assert_sicar_staging_enabled();

-- An archived source is not an operating cut and cannot use the APARTADO writers.
alter table app.m9_customer_batches drop constraint m9_customer_batches_source_scope_check;
alter table app.m9_customer_batches add constraint m9_customer_batches_source_scope_check check(source_scope in
 ('APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS','SYNTHETIC_QA_NOT_SICAR','GENERAL_ARCHIVED_INDEBTED_SUBSET'));
create table app.m9_general_customer_registrations(
 request_id uuid primary key,
 action text not null check(action in('REGISTER','RETIRE')),
 archive_sha256 text not null references app.m9_credit_detail_archives(source_plan_sha256),
 registered_request_id uuid references app.m9_general_customer_registrations(request_id),
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 actor_user_id uuid not null references public.app_users(id),
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 check((action='REGISTER' and registered_request_id is null) or(action='RETIRE' and registered_request_id is not null))
);
create unique index m9_general_registration_archive_once on app.m9_general_customer_registrations(archive_sha256) where action='REGISTER';
create unique index m9_general_registration_retire_once on app.m9_general_customer_registrations(registered_request_id) where action='RETIRE';
create index m9_general_registration_actor_idx on app.m9_general_customer_registrations(actor_user_id);
create index m9_general_registration_archive_idx on app.m9_general_customer_registrations(archive_sha256);
create index m9_general_registration_registered_request_idx on app.m9_general_customer_registrations(registered_request_id);
alter table app.m9_general_customer_registrations enable row level security;
revoke all on app.m9_general_customer_registrations from public,anon,authenticated,service_role;
create trigger m9_general_registration_immutable before update or delete on app.m9_general_customer_registrations
 for each row execute function app.m9_legacy_event_immutable();

-- Same multiset hash as the existing M9 before/after audits. No PII is returned.
create function app.m9_general_registration_snapshot() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;relation text;parts text[];r jsonb;rows jsonb:='[]';
begin
 if current_user<>'postgres' then raise exception 'GENERAL_MAINTENANCE_ONLY' using errcode='42501';end if;
 actor:=app.m9_legacy_actor();
 foreach relation in array array['app.m9_credit_detail_archives','app.m9_credit_documents','app.m9_credit_source_lines',
 'app.m9_credit_source_payments','app.m9_customer_batches','app.m9_customer_events','app.m9_customer_sources',
 'app.m9_legacy_cash_receipts','app.m9_legacy_finance_allocations','app.m9_legacy_finance_events','app.m9_legacy_finance_ledger',
 'app.m9_legacy_registry','public.customer_credit_allocations','public.customer_credit_ledger','public.customers'] loop
  parts:=string_to_array(relation,'.');
  execute format('select jsonb_build_object(''name'',%L,''rows'',count(*),''md5'',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),''''))) from %I.%I t',relation,parts[1],parts[2]) into r;
  rows:=rows||jsonb_build_array(r);
 end loop;
 return rows;
end $$;
revoke all on function app.m9_general_registration_snapshot() from public,anon,authenticated,service_role;

-- Guard both native and inherited financial paths, including direct maintenance
-- calls accidentally directed at the registered archive. Another reviewed plan
-- must explicitly replace these guards before this batch can ever be operated.
create function app.m9_general_registration_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare batch text;
begin
 if tg_table_name='customer_credit_ledger' then
  if new.reference_type='LEGACY_SICAR_OPENING' and exists(select 1 from app.m9_credit_documents d join app.m9_customer_sources s using(customer_key) join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256 where d.document_key=new.reference_id and b.source_scope='GENERAL_ARCHIVED_INDEBTED_SUBSET') then raise exception 'GENERAL_ARCHIVE_FINANCE_DISABLED';end if;
  return new;
 elsif tg_table_name='m9_legacy_finance_ledger' then
  if exists(select 1 from app.m9_legacy_registry r join app.m9_customer_batches b on b.plan_sha256=r.batch_sha256 where r.id=new.registry_id and b.source_scope='GENERAL_ARCHIVED_INDEBTED_SUBSET') then raise exception 'GENERAL_ARCHIVE_FINANCE_DISABLED';end if;
  return new;
 elsif tg_table_name='m9_customer_batches' then
  batch:=old.plan_sha256;
 elsif tg_table_name='m9_customer_sources' then batch:=old.batch_sha256;
 elsif tg_table_name='m9_legacy_registry' then batch:=old.batch_sha256;
 elsif tg_table_name='m9_credit_documents' then
  select s.batch_sha256 into batch from app.m9_customer_sources s where s.customer_key=old.customer_key;
 else
  select s.batch_sha256 into batch from app.m9_credit_documents d join app.m9_customer_sources s using(customer_key) where d.document_key=old.document_key;
 end if;
 if exists(select 1 from app.m9_customer_batches where plan_sha256=batch and source_scope='GENERAL_ARCHIVED_INDEBTED_SUBSET') then
  raise exception 'GENERAL_ARCHIVED_SOURCE_IMMUTABLE';
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function app.m9_general_registration_guard() from public,anon,authenticated,service_role;
create trigger a_m9_general_native_finance_guard before insert on public.customer_credit_ledger for each row execute function app.m9_general_registration_guard();
create trigger a_m9_general_legacy_finance_guard before insert on app.m9_legacy_finance_ledger for each row execute function app.m9_general_registration_guard();
create trigger a_m9_general_batch_guard before update or delete on app.m9_customer_batches for each row execute function app.m9_general_registration_guard();
create trigger a_m9_general_source_guard before update or delete on app.m9_customer_sources for each row execute function app.m9_general_registration_guard();
create trigger a_m9_general_document_guard before update or delete on app.m9_credit_documents for each row execute function app.m9_general_registration_guard();
create trigger a_m9_general_payment_guard before update or delete on app.m9_credit_source_payments for each row execute function app.m9_general_registration_guard();
create trigger a_m9_general_line_guard before update or delete on app.m9_credit_source_lines for each row execute function app.m9_general_registration_guard();
-- Existing registry immutable trigger also needs to allow the explicit retirement.
create trigger a_m9_general_registry_guard before update or delete on app.m9_legacy_registry for each row execute function app.m9_general_registration_guard();

create function app.m9_register_general_customer_archive(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;req uuid;src text;h text;archive app.m9_credit_detail_archives;old app.m9_general_customer_registrations;
 a jsonb;d jsonb;l jsonb;pay jsonb;source_row app.m9_customer_sources;doc app.m9_credit_documents;
 cp jsonb;dp jsonb;pp jsonb;lp jsonb;rec jsonb;expected jsonb;actual jsonb;added_keys jsonb:='[]';added_docs jsonb:='[]';held jsonb:='[]';reasons jsonb;
 accounts int:=0;documents int:=0;payments int:=0;lines int:=0;skipped int:=0;paid_archived int:=0;balance bigint:=0;
 doc_total bigint;active bigint;row_total bigint;variant uuid;rid uuid;existing_docs jsonb;archive_docs jsonb;existing_pay jsonb;archive_pay jsonb;
begin
 if current_user<>'postgres' then raise exception 'GENERAL_MAINTENANCE_ONLY' using errcode='42501';end if;
 actor:=app.m9_legacy_actor();
 if not app.m9_detail_shape(p,array['protocol','project_id','request_id','archive_sha256','archive_payload_hash','expected_snapshot','expected_additions','operational_import_allowed']) or
 p->>'protocol' is distinct from 'm9-general-customer-registration-1' or p->>'project_id' is distinct from 'zsezjtswqeijboezvado' or p->'operational_import_allowed' is distinct from 'false'::jsonb or
 coalesce(p->>'request_id','')!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or coalesce(p->>'archive_sha256','')!~'^[a-f0-9]{64}$' or coalesce(p->>'archive_payload_hash','')!~'^[a-f0-9]{64}$' or jsonb_typeof(p->'expected_snapshot') is distinct from 'array' or octet_length(p::text)>100000 then raise exception 'GENERAL_PLAN_INVALID';end if;
 req:=(p->>'request_id')::uuid;src:=p->>'archive_sha256';h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-customer-source-import',0));
 perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 lock table app.m9_customer_batches,app.m9_customer_sources,app.m9_credit_documents,app.m9_credit_source_payments,app.m9_credit_source_lines,app.m9_legacy_registry,app.m9_legacy_finance_ledger,public.customer_credit_ledger in share row exclusive mode;
 select * into strict archive from app.m9_credit_detail_archives where source_plan_sha256=src;
 if archive.payload_hash<>p->>'archive_payload_hash' or archive.payload_hash<>encode(extensions.digest(convert_to(archive.payload::text,'UTF8'),'sha256'),'hex') or archive.payload->>'source_plan_sha256'<>src or archive.payload->'operational_import_allowed'<>'false'::jsonb then raise exception 'GENERAL_ARCHIVE_CHANGED';end if;
 select * into old from app.m9_general_customer_registrations where request_id=req;
 if found then
  if old.action<>'REGISTER' or old.actor_user_id<>actor or old.request_hash<>h then raise exception 'GENERAL_IDEMPOTENCY_CONFLICT';end if;
  if exists(select 1 from app.m9_general_customer_registrations where registered_request_id=req and action='RETIRE') then raise exception 'GENERAL_REGISTRATION_RETIRED';end if;
  return old.receipt||'{"replayed":true}'::jsonb;
 end if;
 if exists(select 1 from app.m9_general_customer_registrations where archive_sha256=src and action='REGISTER') or exists(select 1 from app.m9_customer_batches where plan_sha256=src) then raise exception 'GENERAL_ARCHIVE_ALREADY_REGISTERED';end if;
 actual:=app.m9_general_registration_snapshot();
 if p->'expected_snapshot' is distinct from actual then raise exception 'GENERAL_DESTINATION_SNAPSHOT_CHANGED';end if;
 expected:=p->'expected_additions';
 if not app.m9_detail_shape(expected,array['accounts','documents','payments','lines','balance_cents']) then raise exception 'GENERAL_EXPECTED_ADDITIONS_INVALID';end if;
 -- Private source metadata preserves archive times; it is never a fresh cut.
 insert into app.m9_customer_batches(plan_sha256,payload_hash,source_scope,source_at,actor_user_id,receipt)
 values(src,archive.payload_hash,'GENERAL_ARCHIVED_INDEBTED_SUBSET',archive.source_from,actor,jsonb_build_object('registration_only',true,'request_id',req,'archive_sha256',src,'source_from',archive.source_from,'source_until',archive.source_until,'operational_import_allowed',false));
 for a in select value from jsonb_array_elements(archive.payload->'accounts') loop
  if app.m9_detail_amount(a->'balance_cents')=0 then paid_archived:=paid_archived+jsonb_array_length(a->'documents');continue;end if;
  select * into source_row from app.m9_customer_sources where customer_key=a->>'key';
  if found then
   skipped:=skipped+1;reasons:='[]';
   if source_row.source_ref<>a->>'ref' or source_row.payload->>'source_display_name'<>a->>'name' then reasons:=reasons||'"EXISTING_SOURCE_IDENTITY_DIFFERS"'::jsonb;end if;
   if source_row.used_cents<>app.m9_detail_amount(a->'balance_cents') then reasons:=reasons||'"EXISTING_SOURCE_BALANCE_DIFFERS"'::jsonb;end if;
   if source_row.target_customer_id is not null or source_row.opening_event_id is not null or source_row.reversed_event_id is not null then reasons:=reasons||'"EXISTING_NATIVE_LINK_OR_OPENING"'::jsonb;end if;
   select coalesce(jsonb_agg(jsonb_build_object('key',x.document_key,'folio',x.source_folio,'source_id',x.payload->>'source_document_id','total',x.total_cents,'paid',x.paid_cents,'balance',x.balance_cents,'due',x.due_date) order by x.document_key),'[]') into existing_docs from app.m9_credit_documents x where x.customer_key=a->>'key' and x.financial_status='OPEN';
   select coalesce(jsonb_agg(jsonb_build_object('key',x->>'key','folio',x->>'folio','source_id',x->>'source_id','total',x->'total_cents','paid',x->'paid_cents','balance',x->'balance_cents','due',x->'due_date') order by x->>'key'),'[]') into archive_docs from jsonb_array_elements(a->'documents') x where app.m9_detail_amount(x->'balance_cents')>0;
   if existing_docs<>archive_docs then reasons:=reasons||'"EXISTING_DOCUMENT_FINANCES_DIFFER"'::jsonb;end if;
   select coalesce(jsonb_agg(jsonb_build_object('key',x.payment_key,'document',x.document_key,'ref',x.source_ref,'amount',x.amount_cents,'cancelled',x.cancelled) order by x.payment_key),'[]') into existing_pay from app.m9_credit_source_payments x join app.m9_credit_documents dx using(document_key) where dx.customer_key=a->>'key' and dx.financial_status='OPEN';
   select coalesce(jsonb_agg(jsonb_build_object('key',x->>'key','document',dx->>'key','ref',x->>'ref','amount',x->'amount_cents','cancelled',x->'cancelled') order by x->>'key'),'[]') into archive_pay from jsonb_array_elements(a->'documents') dx cross join lateral jsonb_array_elements(dx->'payments') x where app.m9_detail_amount(dx->'balance_cents')>0;
   if existing_pay<>archive_pay then reasons:=reasons||'"EXISTING_ACTIVE_CANCELLED_PAYMENTS_DIFFER"'::jsonb;end if;
   if exists(select 1 from app.m9_legacy_registry r join app.m9_legacy_finance_ledger z on z.registry_id=r.id where r.customer_key=a->>'key') then reasons:=reasons||'"EXISTING_OPENING_PRESERVED"'::jsonb;end if;
   held:=held||jsonb_build_array(jsonb_build_object('customer_key',a->>'key','reasons',reasons));continue;
  end if;
  if exists(select 1 from app.m9_customer_sources where source_ref=a->>'ref') or exists(select 1 from app.m9_credit_documents x where x.document_key in(select d0->>'key' from jsonb_array_elements(a->'documents')d0)) then raise exception 'GENERAL_SOURCE_IDENTITY_COLLISION';end if;
  cp:=jsonb_build_object('customer_key',a->>'key','source_ref',a->>'ref','source_display_name',a->>'name','phone_candidate',null,'phone_raw',null,'email',null,'privacy_consent_at',null,'marketing_consent',null,'auth_user_id',null,'target_customer_id',null,'used_cents',a->'balance_cents','source_at',a->'source_at','operational_import_allowed',false,'archive_sha256',src,'registration_only',true);
  insert into app.m9_customer_sources(customer_key,source_ref,batch_sha256,payload,used_cents)values(a->>'key',a->>'ref',src,cp,app.m9_detail_amount(a->'balance_cents'));
  insert into app.m9_legacy_registry(customer_key,batch_sha256,source_hash,created_by)values(a->>'key',src,encode(extensions.digest(convert_to(cp::text,'UTF8'),'sha256'),'hex'),actor) returning id into rid;
  accounts:=accounts+1;added_keys:=added_keys||jsonb_build_array(a->>'key');row_total:=0;
  for d in select value from jsonb_array_elements(a->'documents') loop
   if app.m9_detail_amount(d->'balance_cents')=0 then paid_archived:=paid_archived+1;continue;end if;
   doc_total:=app.m9_detail_amount(d->'total_cents');active:=0;
   if doc_total<>app.m9_detail_amount(d->'balance_cents')+app.m9_detail_amount(d->'paid_cents') or d->'due_date'='null'::jsonb then raise exception 'GENERAL_DOCUMENT_TOTALS_INVALID';end if;
   dp:=jsonb_build_object('document_key',d->>'key','customer_key',a->>'key','source_folio',d->>'folio','source_document_id',d->>'source_id','total_cents',d->'total_cents','balance_cents',d->'balance_cents','paid_to_date_cents',d->'paid_cents','due_date',d->'due_date','financial_status','OPEN','source_at',d->'source_at','source_evidence_sha256',d->'evidence_sha256','holds',d->'holds','linked_history_complete',d->'linked_history_complete','delivery_status','UNKNOWN','operational_import_allowed',false,'opening_candidate_cents',null,'archive_sha256',src);
   insert into app.m9_credit_documents(document_key,customer_key,payload,source_folio,total_cents,balance_cents,paid_cents,due_date,financial_status)values(d->>'key',a->>'key',dp,d->>'folio',doc_total,app.m9_detail_amount(d->'balance_cents'),app.m9_detail_amount(d->'paid_cents'),(d->>'due_date')::date,'OPEN');
   for pay in select value from jsonb_array_elements(d->'payments') loop
    pp:=jsonb_build_object('payment_key',pay->>'key','document_key',d->>'key','source_ref',pay->>'ref','amount_cents',pay->'amount_cents','cancelled',pay->'cancelled','occurred_label',pay->'occurred_label','evidence_sha256',pay->'evidence_sha256','replay_as_cash',false,'archive_sha256',src);
    insert into app.m9_credit_source_payments values(pay->>'key',d->>'key',pay->>'ref',app.m9_detail_amount(pay->'amount_cents'),(pay->>'cancelled')::boolean,pp);
    if not(pay->>'cancelled')::boolean then active:=active+app.m9_detail_amount(pay->'amount_cents');end if;payments:=payments+1;
   end loop;
   if active<>app.m9_detail_amount(d->'paid_cents') then raise exception 'GENERAL_ACTIVE_PAYMENTS_DIFFER';end if;
   for l in select value from jsonb_array_elements(d->'lines') loop
    if l->>'delivery_status' is distinct from 'UNKNOWN' or l->'reserved_qty' is distinct from 'null'::jsonb or l->'stock_deduction' is distinct from 'null'::jsonb then raise exception 'GENERAL_PHYSICAL_EFFECT_FORBIDDEN';end if;
    if l->'variant_id'<>'null'::jsonb then
     variant:=(l->>'variant_id')::uuid;
     if (select count(distinct b.variant_id) from public.barcodes b where b.code=l->>'barcode')<>1 or not exists(select 1 from public.barcodes b join public.variants v on v.id=b.variant_id where b.code=l->>'barcode' and v.id=variant) then raise exception 'GENERAL_LITERAL_MAPPING_CHANGED';end if;
    end if;
    lp:=jsonb_build_object('document_key',d->>'key','line_index',l->'index','barcode',l->'barcode','quantity',l->'quantity','source_description',l->'description','variant_id',l->'variant_id','holds',l->'holds','delivery_status','UNKNOWN','reserved_qty',null,'additional_stock_deduction',null,'stock_deduction',null,'archive_sha256',src,'operational_import_allowed',false);
    insert into app.m9_credit_source_lines values(d->>'key',(l->>'index')::int,l->>'barcode',(l->>'quantity')::numeric,(l->>'variant_id')::uuid,lp);lines:=lines+1;
   end loop;
   documents:=documents+1;row_total:=row_total+app.m9_detail_amount(d->'balance_cents');added_docs:=added_docs||jsonb_build_array(d->>'key');
  end loop;
  if row_total<>app.m9_detail_amount(a->'balance_cents') then raise exception 'GENERAL_ACCOUNT_TOTALS_DIFFER';end if;balance:=balance+row_total;
 end loop;
 actual:=jsonb_build_object('accounts',accounts,'documents',documents,'payments',payments,'lines',lines,'balance_cents',balance);
 if actual is distinct from expected or accounts=0 then raise exception 'GENERAL_ADDITION_COUNTS_DIFFER';end if;
 rec:=jsonb_build_object('registration',req,'archive_sha256',src,'source_from',archive.source_from,'source_until',archive.source_until,'source_is_historical',true,'added',actual,'account_keys',added_keys,'document_keys',added_docs,'preserved_accounts',skipped,'preserved_review',held,'paid_documents_archived_only',paid_archived,'native_customers_created',0,'debt_opened_cents',0,'historical_payments_replayed',false,'cash_effect_cents',0,'inventory_effect',0,'operational_import_allowed',false,'replayed',false);
 insert into app.m9_general_customer_registrations(request_id,action,archive_sha256,request_hash,actor_user_id,receipt)values(req,'REGISTER',src,h,actor,rec);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)values(actor,'m9.general_customer_archive.register','m9_general_customer_registrations',req::text,rec-'account_keys'-'document_keys'-'preserved_review');
 return rec;
end $$;
revoke all on function app.m9_register_general_customer_archive(jsonb) from public,anon,authenticated,service_role;

create function app.m9_retire_general_customer_registration(p_request uuid,p_registration uuid,p_reason text)returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid;original app.m9_general_customer_registrations;old app.m9_general_customer_registrations;src text;h text;rec jsonb;expected jsonb;actual jsonb;
begin
 if current_user<>'postgres' then raise exception 'GENERAL_MAINTENANCE_ONLY'using errcode='42501';end if;actor:=app.m9_legacy_actor();
 if p_request is null or p_registration is null or length(coalesce(p_reason,''))not between 10 and 500 then raise exception 'GENERAL_RETIRE_REASON_REQUIRED';end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('registration',p_registration,'reason',p_reason)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('m9-customer-source-import',0));perform pg_advisory_xact_lock(hashtextextended('m9-legacy-finance',0));
 lock table app.m9_customer_batches,app.m9_customer_sources,app.m9_credit_documents,app.m9_credit_source_payments,app.m9_credit_source_lines,app.m9_legacy_registry,app.m9_legacy_finance_ledger,public.customer_credit_ledger in share row exclusive mode;
 select*into old from app.m9_general_customer_registrations where request_id=p_request;
 if found then if old.action<>'RETIRE'or old.actor_user_id<>actor or old.request_hash<>h then raise exception 'GENERAL_IDEMPOTENCY_CONFLICT';end if;return old.receipt||'{"replayed":true}'::jsonb;end if;
 select*into strict original from app.m9_general_customer_registrations where request_id=p_registration and action='REGISTER';src:=original.archive_sha256;
 if exists(select 1 from app.m9_general_customer_registrations where registered_request_id=p_registration and action='RETIRE')then raise exception 'GENERAL_ALREADY_RETIRED';end if;
 if not exists(select 1 from app.m9_customer_batches where plan_sha256=src and source_scope='GENERAL_ARCHIVED_INDEBTED_SUBSET')then raise exception 'GENERAL_REGISTRATION_CHANGED';end if;
 if exists(select 1 from app.m9_customer_sources s where s.batch_sha256=src and(s.target_customer_id is not null or s.opening_event_id is not null or s.reversed_event_id is not null)) or
 exists(select 1 from app.m9_legacy_registry r join app.m9_legacy_finance_ledger z on z.registry_id=r.id where r.batch_sha256=src) or
 exists(select 1 from app.m9_credit_documents d join app.m9_customer_sources s using(customer_key) where s.batch_sha256=src and(d.opening_ledger_id is not null or d.reversal_ledger_id is not null)) or
 exists(select 1 from public.customer_credit_ledger z where z.reference_id in(select jsonb_array_elements_text(original.receipt->'document_keys')))then raise exception 'GENERAL_RETIRE_HAS_OPERATIONS';end if;
 expected:=original.receipt->'added';
 select jsonb_build_object('accounts',(select count(*)from app.m9_customer_sources where batch_sha256=src),'documents',count(*),'payments',(select count(*)from app.m9_credit_source_payments x join app.m9_credit_documents dx using(document_key)join app.m9_customer_sources sx using(customer_key)where sx.batch_sha256=src),'lines',(select count(*)from app.m9_credit_source_lines x join app.m9_credit_documents dx using(document_key)join app.m9_customer_sources sx using(customer_key)where sx.batch_sha256=src),'balance_cents',coalesce(sum(d.balance_cents),0))into actual from app.m9_credit_documents d join app.m9_customer_sources s using(customer_key)where s.batch_sha256=src;
 if actual<>expected or (select count(*)from app.m9_legacy_registry where batch_sha256=src)<>(expected->>'accounts')::int then raise exception 'GENERAL_REGISTRATION_CHANGED';end if;
 -- Immutable registry entries are preserved. Retirement is a logical, auditable
 -- disabling event rather than deletion of identity/history or financial data.
 rec:=jsonb_build_object('registration',p_registration,'archive_sha256',src,'retired',true,'physical_rows_deleted',0,'identities_preserved',true,'reason',p_reason,'operational_import_allowed',false,'replayed',false);
 insert into app.m9_general_customer_registrations(request_id,action,archive_sha256,registered_request_id,request_hash,actor_user_id,receipt)values(p_request,'RETIRE',src,p_registration,h,actor,rec);
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata)values(actor,'m9.general_customer_archive.retire','m9_general_customer_registrations',p_request::text,rec);
 return rec;
end $$;
revoke all on function app.m9_retire_general_customer_registration(uuid,uuid,text) from public,anon,authenticated,service_role;
commit;
