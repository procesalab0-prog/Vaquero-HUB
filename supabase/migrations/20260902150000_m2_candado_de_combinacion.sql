begin;

-- Cierra la carrera del control de combinaciones repetidas en una migración
-- nueva. La migración que creó el disparador ya puede haberse aplicado en una
-- base alojada y editar ese archivo no volvería a ejecutarla.
create or replace function app.check_variant_attribute_uniqueness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant_id uuid;
  v_product_id uuid;
begin
  if tg_table_name = 'variants' then
    v_variant_id := new.id;
  elsif tg_op = 'DELETE' then
    v_variant_id := old.variant_id;
  else
    v_variant_id := new.variant_id;
  end if;

  select product_id into v_product_id
  from public.variants where id = v_variant_id;

  if v_product_id is null then
    return null;
  end if;

  -- El candado de transacción hace que dos altas del mismo producto se
  -- revisen en orden y la segunda vea lo confirmado por la primera.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('variant-combination:' || v_product_id::text, 0)
  );

  if exists (
    select 1
    from (
      select app.variant_attribute_signature(sibling.id) as signature
      from public.variants sibling
      where sibling.product_id = v_product_id
    ) firmas
    group by firmas.signature
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_VARIANT_ATTRIBUTES'
      using errcode = '23505',
            detail = 'Dos variantes del mismo producto comparten talla y color.',
            hint = 'Si la variante existía y se dio de baja, reactívala en vez de crear otra.';
  end if;

  return null;
end;
$$;

revoke execute on function app.check_variant_attribute_uniqueness()
  from public, anon, authenticated;

commit;
