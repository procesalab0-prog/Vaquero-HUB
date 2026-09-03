begin;
-- Estas tablas sólo se atraviesan mediante RPC autorizadas. Las políticas
-- negativas documentan y refuerzan esa decisión incluso si un GRANT cambia.
create policy folios_rpc_only on public.folios for all to authenticated using (false) with check (false);
create policy sale_items_rpc_only on public.sale_items for all to authenticated using (false) with check (false);
create policy sale_payments_rpc_only on public.sale_payments for all to authenticated using (false) with check (false);
create policy applied_discounts_rpc_only on public.applied_discounts for all to authenticated using (false) with check (false);
create policy idempotency_keys_rpc_only on public.idempotency_keys for all to authenticated using (false) with check (false);
commit;
