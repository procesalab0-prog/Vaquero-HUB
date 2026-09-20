begin;

-- Medida confirmada físicamente en la tienda el 19 de septiembre de 2026.
-- La plantilla anterior medía 50 × 30 mm; sus 30 mm de alto rebasaban el
-- troquel real de 25 mm y repartían una impresión entre dos etiquetas.
update public.label_templates
set width_mm = 51,
    height_mm = 25,
    name = case
      when lower(btrim(name)) = lower('Vaquero 50 × 30 mm')
       and not exists (
         select 1
         from public.label_templates existing
         where existing.id <> label_templates.id
           and lower(btrim(existing.name)) = lower('Vaquero 51 × 25 mm')
       )
      then 'Vaquero 51 × 25 mm'
      else name
    end
where is_default
  and is_active;

commit;
