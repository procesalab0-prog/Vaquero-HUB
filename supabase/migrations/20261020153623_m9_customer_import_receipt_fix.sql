begin;
-- Preserve the previously applied migration; fix local/column name resolution.
create or replace function app.m9_import_customer_sources(p_sha text,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor uuid; h text; previous app.m9_customer_batches; c jsonb; d jsonb; p jsonb; l jsonb; v_receipt jsonb; n bigint;
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
 v_receipt:=jsonb_build_object('plan_sha256',p_sha,'scope',p_plan->>'scope','source_accounts',jsonb_array_length(p_plan->'customers'),'source_documents',jsonb_array_length(p_plan->'documents'),'source_payment_records',jsonb_array_length(p_plan->'payments'),'source_lines',jsonb_array_length(p_plan->'lines'),'pending_source_cents',n,'native_customers_created',0,'native_openings_created',0,'stock_movements_created',0,'replayed',false);
 update app.m9_customer_batches set receipt=v_receipt where plan_sha256=p_sha;
 insert into public.audit_log(actor_user_id,action,entity_type,entity_id,metadata) values(actor,'m9.customer_sources.import','m9_customer_batches',p_sha,v_receipt);
 return v_receipt;
end $$;


revoke all on function app.m9_import_customer_sources(text,jsonb) from public,anon,authenticated,service_role;
commit;
