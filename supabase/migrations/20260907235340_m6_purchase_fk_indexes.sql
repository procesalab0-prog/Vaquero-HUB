-- Indices para las llaves de actor detectadas por Supabase Advisor.
create index suppliers_created_by_idx on public.suppliers (created_by);
create index suppliers_updated_by_idx on public.suppliers (updated_by);
create index purchase_orders_created_by_idx on public.purchase_orders (created_by);
create index purchase_orders_cancelled_by_idx on public.purchase_orders (cancelled_by)
  where cancelled_by is not null;
create index receipts_received_by_idx on public.receipts (received_by);
