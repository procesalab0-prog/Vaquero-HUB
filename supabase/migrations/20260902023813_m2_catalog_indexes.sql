begin;

-- Índices de llaves foráneas señalados por el asesor de rendimiento de
-- Supabase. Evitan escaneos completos al validar cambios en catálogos y
-- usuarios relacionados.
create index categories_default_size_scale_code_idx
  on public.categories (default_size_scale_code);
create index attribute_values_scale_code_idx
  on public.attribute_values (scale_code);
create index products_created_by_idx on public.products (created_by);
create index products_updated_by_idx on public.products (updated_by);
create index variants_created_by_idx on public.variants (created_by);
create index variants_updated_by_idx on public.variants (updated_by);
create index variant_attributes_type_code_idx
  on public.variant_attributes (type_code);

commit;
