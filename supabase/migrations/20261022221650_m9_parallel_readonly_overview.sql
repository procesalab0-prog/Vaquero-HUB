begin;
select app.assert_sicar_staging_enabled();
create function app.m9_parallel_readonly_overview()returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid:=app.m9_legacy_actor();c app.m9_customer_census_archives;d app.m9_credit_detail_archives;pilot jsonb;review jsonb;
begin
 select * into c from app.m9_customer_census_archives order by observed_until desc limit 1;
 select * into d from app.m9_credit_detail_archives order by source_until desc limit 1;
 select jsonb_build_object('codes',count(*),'pending_fields',count(*)filter(where physical_qty is null)+count(*)filter(where sold_waiting_qty is null)+count(*)filter(where separated_qty is null)) into pilot from app.m9_pilot_stock_drafts;
 select jsonb_build_object('enabled',enabled,'expires_at',expires_at,'window_current',enabled and expires_at>clock_timestamp())into review from app.m9_rehearsal_control where singleton;
 return jsonb_build_object(
 'protocol','m9-parallel-overview-1','read_only',true,'operational_authorization',false,'assembled_at',clock_timestamp(),
 'catalog',jsonb_build_object('loaded_codes',(select count(*)from app.m9_rows),'review_rows_on_file',(select count(*)from app.m9_rehearsal_allowlist),'review_window',review,'photo_evidence_rows',(select count(*)from app.web_variant_photo_evidence),'photo_storage_rows',(select count(*)from app.web_variant_photo_storage),'copied_photos_are_not_current_eligibility',true),
 'customers',jsonb_build_object('census_available',c.source_plan_sha256 is not null,'census_from',c.source_at,'census_until',c.observed_until,'census_older_than_24h',case when c.source_at is null then null else c.source_at<clock_timestamp()-interval '24 hours'end,'details_available',d.source_plan_sha256 is not null,'details_from',d.source_from,'details_until',d.source_until,'details_older_than_24h',case when d.source_from is null then null else d.source_from<clock_timestamp()-interval '24 hours'end,'accounts_reviewed',d.receipt->'accounts','documents_reviewed',d.receipt->'documents','historical_payments',d.receipt->'historical_payments','mapped_lines',d.receipt->'mapped_lines','unmapped_lines',d.receipt->'unmapped_lines','unconfirmed_deliveries',case when d.payload is null then null else(select count(*)from jsonb_array_elements(d.payload->'accounts')a cross join lateral jsonb_array_elements(a->'documents')doc cross join lateral jsonb_array_elements(doc->'lines')l where l->>'delivery_status' is distinct from 'CONFIRMED')end,'registered_legacy_accounts',(select count(*)from app.m9_legacy_registry),'historical_archive_is_not_opening',true),
 'inventory',pilot,
 'woo',jsonb_build_object('remote_connected_trials',(select count(*)from app.m9_woo_connected_trials),'native_rehearsals',(select count(*)from app.m9_woo_native_finance_rehearsals),'finance_enabled',(select enabled from app.m9_woo_finance_pilot_control where singleton),'stock_pilot_enabled',(select enabled from app.m9_woo_pilot_control where singleton),'worker_enabled',(select enabled from app.m9_woo_worker_control where singleton),'capture_enabled',(select enabled from app.m9_availability_control where singleton),'rehearsal_does_not_prove_gateway',true)
 );
end $$;
revoke all on function app.m9_parallel_readonly_overview()from public,anon,service_role;
grant execute on function app.m9_parallel_readonly_overview()to authenticated;
create function public.m9_parallel_readonly_overview()returns jsonb
language sql security invoker set search_path=''as $$select app.m9_parallel_readonly_overview();$$;
revoke all on function public.m9_parallel_readonly_overview()from public,anon,service_role;
grant execute on function public.m9_parallel_readonly_overview()to authenticated;
commit;
