begin;

-- Cierra una carrera real en el control de combinaciones repetidas, y la
-- cierra en una migración propia en vez de editar la que ya está aplicada.
--
-- El hallazgo es correcto y no era teórico. La comprobación diferida corre al
-- cerrar la transacción y toma su propia instantánea, así que dos
-- transacciones que agregan la misma talla al mismo producto pueden
-- comprobar cada una sin ver a la otra y confirmar las dos. Reproducido
-- ensanchando esa ventana: sin candado quedan dos variantes con la misma
-- talla; con candado, una se rechaza.
--
-- Por qué va aquí y no dentro de `20260902041500`, que es donde se escribió
-- primero: esa migración ya está fusionada y puede estar aplicada. El
-- corredor de migraciones lleva cuenta de lo que ya corrió y no vuelve a
-- ejecutar un archivo por haber cambiado, así que editarlo deja el candado
-- en las bases nuevas y **no** en la que ya existe.
--
-- Y CI no lo detecta: corre `supabase db reset`, que reconstruye desde cero,
-- de modo que siempre ve el archivo editado y siempre pasa. La divergencia
-- sólo aparece en el proyecto real, en forma de duplicados que nadie explica.
-- Es el mismo patrón que ya salió cuatro veces aquí: un control que parece
-- estar puesto y no lo está donde importa.
--
-- `create or replace` deja el mismo estado final se haya aplicado o no la
-- versión anterior, que es justo lo que hace segura esta forma.

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

  -- Serializa la comprobación por producto. El candado es de transacción, así
  -- que quien lo espera lo obtiene cuando la otra ya confirmó, y entonces sí
  -- ve sus filas. Sin esto las dos comprueban a ciegas y las dos pasan.
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

commit;
