begin;

-- M8 added QUOTE folios after M5 had already added RETURN folios. Keep every
-- previously supported document type when extending this shared constraint.
alter table public.folios drop constraint folios_document_type_check;
alter table public.folios add constraint folios_document_type_check
  check (document_type in ('SALE', 'RETURN', 'QUOTE'));

commit;
