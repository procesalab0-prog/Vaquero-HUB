begin;

-- M2.2 — Una sola variante por combinación de atributos dentro de un producto.
--
-- Antes del generador, quien llamaba mandaba el código de barras, así que dos
-- variantes con la misma talla y el mismo color chocaban contra
-- `barcodes_code_key` y el alta se caía. Esa protección era accidental: al
-- generar ahora una identidad nueva para cada renglón, las dos variantes
-- duplicadas reciben SKU y código distintos y el alta pasa sin ruido.
--
-- El resultado es peor que un error visible: el mismo artículo físico queda
-- con dos identidades, la existencia se parte entre las dos y un escaneo cae
-- en una o en otra según qué etiqueta se pegó en la caja. El inventario por
-- talla —la razón de ser del proyecto— deja de cuadrar sin que nadie lo note.
--
-- La deduplicación de la interfaz no sirve como control: la carga masiva de
-- M2.4 y el importador de M9 entran por la misma función.

create or replace function app.variant_attribute_signature(p_variant_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    string_agg(va.type_code || '=' || va.value_id::text, '|' order by va.type_code),
    ''
  )
  from public.variant_attributes va
  where va.variant_id = p_variant_id
$$;

comment on function app.variant_attribute_signature(uuid) is
  'Firma canónica de los atributos de una variante. Cadena vacía = sin atributos, '
  'que es legítimo una sola vez por producto (un artículo sin variaciones).';

create or replace function app.check_variant_attribute_uniqueness()
returns trigger
language plpgsql
-- Definer a propósito: `variants` y `variant_attributes` tienen RLS activa sin
-- políticas, así que una función normal no vería las filas hermanas y el
-- control pasaría siempre sin detectar nada.
security definer
set search_path = ''
as $$
declare
  v_variant_id uuid;
  v_product_id uuid;
begin
  -- El mismo control cuelga de dos tablas con formas distintas, así que la
  -- variante se resuelve por tabla y por operación: en PL/pgSQL leer un campo
  -- que el registro no tiene, o leer OLD en un INSERT, es un error de
  -- ejecución, no un nulo.
  if tg_table_name = 'variants' then
    v_variant_id := new.id;
  elsif tg_op = 'DELETE' then
    v_variant_id := old.variant_id;
  else
    v_variant_id := new.variant_id;
  end if;

  select product_id into v_product_id
  from public.variants where id = v_variant_id;

  -- La variante desapareció en la misma transacción (borrado en cascada):
  -- no hay nada que comprobar.
  if v_product_id is null then
    return null;
  end if;

  -- Serializa la comprobacion por producto. Sin este candado, dos
  -- transacciones concurrentes podrian no verse entre si y confirmar la
  -- misma combinacion con identidades distintas.
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

-- Diferidos hasta el commit: durante el alta una variante pasa por estados
-- intermedios —ya existe, todavía sin todos sus atributos— que un control
-- inmediato leería como duplicados falsos.
create constraint trigger variants_unique_attributes
after insert or update of product_id on public.variants
deferrable initially deferred
for each row execute function app.check_variant_attribute_uniqueness();

create constraint trigger variant_attributes_unique_combination
after insert or update or delete on public.variant_attributes
deferrable initially deferred
for each row execute function app.check_variant_attribute_uniqueness();

revoke execute on function app.variant_attribute_signature(uuid)
  from public, anon, authenticated;
revoke execute on function app.check_variant_attribute_uniqueness()
  from public, anon, authenticated;
grant execute on function app.variant_attribute_signature(uuid) to service_role;

commit;
