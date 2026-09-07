begin;

create index return_policies_updated_by_idx
  on public.return_policies(updated_by)
  where updated_by is not null;

commit;
