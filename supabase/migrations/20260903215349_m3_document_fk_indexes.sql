-- Índices de soporte para las llaves foráneas de documentos M3.
-- Evitan escaneos completos al validar o mantener referencias.
create index inventory_count_items_counted_by_idx
  on public.inventory_count_items (counted_by);
create index inventory_count_items_movement_id_idx
  on public.inventory_count_items (movement_id)
  where movement_id is not null;
create index inventory_counts_created_by_idx
  on public.inventory_counts (created_by);
create index inventory_counts_closed_by_idx
  on public.inventory_counts (closed_by)
  where closed_by is not null;
create index inventory_counts_cancelled_by_idx
  on public.inventory_counts (cancelled_by)
  where cancelled_by is not null;
create index transfers_requested_by_idx
  on public.transfers (requested_by);
create index transfers_approved_by_idx
  on public.transfers (approved_by)
  where approved_by is not null;
create index transfers_prepared_by_idx
  on public.transfers (prepared_by)
  where prepared_by is not null;
create index transfers_sent_by_idx
  on public.transfers (sent_by)
  where sent_by is not null;
create index transfers_received_by_idx
  on public.transfers (received_by)
  where received_by is not null;
create index transfers_cancelled_by_idx
  on public.transfers (cancelled_by)
  where cancelled_by is not null;
