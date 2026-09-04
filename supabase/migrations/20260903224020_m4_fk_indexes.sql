begin;
create index applied_discounts_authorization_idx on public.applied_discounts (authorization_id);
create index applied_discounts_sale_item_idx on public.applied_discounts (sale_item_id) where sale_item_id is not null;
create index cash_registers_created_by_idx on public.cash_registers (created_by) where created_by is not null;
create index cash_sessions_closed_by_idx on public.cash_sessions (closed_by) where closed_by is not null;
create index cash_sessions_opened_by_idx on public.cash_sessions (opened_by, opened_at desc);
create index print_jobs_requested_by_idx on public.print_jobs (requested_by, requested_at desc);
create index sales_cancelled_by_idx on public.sales (cancelled_by) where cancelled_by is not null;
commit;
