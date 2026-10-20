begin;
-- No new data tables or write path. Same administrative boundary as review.
create function app.m9_customer_reconciliation_api() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_result jsonb;
begin
 perform app.assert_sicar_staging_enabled();
 if v_actor is null or not exists(select 1 from public.app_users u join public.roles r on r.id=u.role_id where u.id=v_actor and u.is_active and r.code='ADMIN') or not app.has_perm('customers.manage') then raise exception 'NOT_AUTHORIZED' using errcode='42501';end if;
 with sources as (
  select s.*,b.source_at from app.m9_customer_sources s join app.m9_customer_batches b on b.plan_sha256=s.batch_sha256 where b.source_scope='APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS'
 ), docs as (select d.* from app.m9_credit_documents d join sources s using(customer_key))
 select jsonb_build_object('generated_at',statement_timestamp(),'scope','APARTADO_SEARCH_ONLY_NOT_ALL_CUSTOMERS','source_at',(select min(source_at) from sources),
 'accounts',coalesce((select jsonb_agg(jsonb_build_object('key',s.customer_key,'name',s.payload->>'source_display_name','used_cents',s.used_cents,'phone_present',s.payload->>'phone_candidate' is not null,'linked',s.target_customer_id is not null,'candidates',(select count(*) from public.customers c where c.phone_e164=s.payload->>'phone_candidate' and not c.is_anonymized and c.privacy_consent_at is not null)) order by s.customer_key) from sources s),'[]'),
 'documents',coalesce((select jsonb_agg(jsonb_build_object('key',d.document_key,'account',d.customer_key,'folio',d.source_folio,'status',d.financial_status,'total_cents',d.total_cents,'paid_cents',d.paid_cents,'balance_cents',d.balance_cents,'payment_evidence',d.payload->>'payment_evidence','active_payment_cents',coalesce((select sum(p.amount_cents) from app.m9_credit_source_payments p where p.document_key=d.document_key and not p.cancelled),0),'cancelled_payment_cents',coalesce((select sum(p.amount_cents) from app.m9_credit_source_payments p where p.document_key=d.document_key and p.cancelled),0),'payment_count',(select count(*) from app.m9_credit_source_payments p where p.document_key=d.document_key)) order by d.document_key) from docs d),'[]'),
 'lines',coalesce((select jsonb_agg(jsonb_build_object('document',l.document_key,'index',l.line_index,'barcode',l.barcode,'quantity',l.quantity::text,'variant',l.variant_id,'exact_variant',l.variant_id is not null and (select count(distinct b.variant_id)=1 and bool_and(b.variant_id=l.variant_id) from public.barcodes b where b.code=l.barcode)) order by l.document_key,l.line_index) from app.m9_credit_source_lines l join docs d using(document_key)),'[]')) into v_result;
 return v_result;
end $$;
create function public.m9_customer_reconciliation() returns jsonb
language sql stable security invoker set search_path='' as $$select app.m9_customer_reconciliation_api()$$;
revoke all on function app.m9_customer_reconciliation_api(),public.m9_customer_reconciliation() from public,anon,authenticated,service_role;
grant execute on function app.m9_customer_reconciliation_api(),public.m9_customer_reconciliation() to authenticated;
commit;
