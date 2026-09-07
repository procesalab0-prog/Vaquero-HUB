-- Keep the already-applied staging schema aligned with the final M4 draft
-- migration and cover both foreign keys used during register/location cleanup.
create index if not exists pos_drafts_location_idx
  on public.pos_drafts (location_id);

create index if not exists pos_drafts_register_idx
  on public.pos_drafts (register_id);
