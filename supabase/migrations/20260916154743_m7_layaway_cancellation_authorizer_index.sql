begin;

-- La consulta de auditoría por supervisor no debe escanear todo el libro de
-- cancelaciones. `authorization_id` ya queda cubierto por su índice UNIQUE.
create index layaway_cancellations_authorized_by_created_idx
  on public.layaway_cancellations(authorized_by, created_at desc)
  where authorized_by is not null;

commit;
