begin;

create index label_templates_created_by_idx
  on public.label_templates (created_by);
create index label_templates_updated_by_idx
  on public.label_templates (updated_by);

commit;
