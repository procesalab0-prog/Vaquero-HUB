-- SELECT ONLY. Run only against staging zsezjtswqeijboezvado.
-- No customer, buyer, reference, cash amount or operational source data.
select n.nspname as schema_name, p.proname as function_name,
 p.prosecdef as security_definer,p.proconfig,
 encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') as definition_sha256,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='app' and p.proname in
 ('m9_woo_native_finance','m9_woo_assert_finance_sale','m9_woo_block_retail_return')
order by p.proname;

select c.relname as table_name,c.relrowsecurity as rls_enabled,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_any_data,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_any_data,
 has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') as service_role_any_data
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='app' and c.relname in
 ('m9_woo_finance_pilot_control','m9_woo_finance_test_evidence','m9_woo_finance_postings','m9_woo_finance_receipts','m9_woo_finance_ticket_outbox')
order by c.relname;

select 'finance' as gate,enabled,expires_at is null as expiry_clear
from app.m9_woo_finance_pilot_control
union all
select 'stock_pilot',enabled,expires_at is null from app.m9_woo_pilot_control;
