begin;

-- El registro de códigos externos aceptaba códigos de nuestro propio rango.
--
-- `register_variant_barcode` valida que un EAN-13 tenga trece dígitos y buen
-- dígito de control, pero no mira el prefijo. Comprobado: registrar
-- `2000099999993` como SUPPLIER pasa y hasta queda como primario, y ese
-- código es idéntico en forma a uno que el generador emitirá cuando la
-- secuencia llegue al serial 9 999 999.
--
-- GS1 reserva `20`–`29` para circulación restringida dentro de una empresa.
-- Un código de proveedor en ese rango no es un código de fabricante: o es el
-- código interno de otra tienda —que no significa nada fuera de sus paredes—
-- o es un error de captura. En los dos casos adoptarlo es un error.
--
-- Trae dos consecuencias, y la segunda es la que más importa:
--
-- 1. El día que la secuencia alcance ese serial, el alta de un producto se
--    cae con violación de unicidad. Se recupera sola en el siguiente intento
--    —el serial ya avanzó—, así que es una molestia, no una pérdida.
-- 2. Ensucia la única compuerta que protege la migración de SICAR. Esa
--    comprobación pregunta si existe algún código de trece dígitos que empiece
--    con 20-29; si nosotros mismos metimos uno, el resultado deja de
--    distinguir entre un choque real y basura propia, justo en el momento en
--    que hay que decidir si se enciende la generación.

create or replace function public.register_variant_barcode(
  p_variant_id uuid,
  p_code text,
  p_symbology text,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_code text := btrim(p_code);
  v_symbology text := upper(btrim(p_symbology));
  v_source text := upper(btrim(p_source));
  v_barcode public.barcodes%rowtype;
  v_reused boolean := false;
begin
  if v_actor is null or not (select app.has_perm('products.update')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_variant_id is null or nullif(v_code, '') is null then
    raise exception 'INVALID_BARCODE' using errcode = '22023';
  end if;
  if v_source is null or v_source not in ('MANUAL', 'SUPPLIER') then
    -- GENERATED sólo lo usa el generador interno; SICAR y LEGACY llegan por
    -- el importador M9. La interfaz operativa no puede suplantar esos orígenes.
    raise exception 'BARCODE_SOURCE_NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_symbology is null or v_symbology not in ('EAN13', 'CODE128') then
    raise exception 'BARCODE_SYMBOLOGY_NOT_ALLOWED' using errcode = '22023';
  end if;
  if v_symbology = 'EAN13' and (
    v_code !~ '^[0-9]{13}$'
    or right(v_code, 1) is distinct from
      app.ean13_check_digit(left(v_code, 12))::text
  ) then
    raise exception 'INVALID_EAN13' using errcode = '22023';
  end if;
  -- El rango reservado es nuestro: aquí sólo escribe el generador interno.
  if v_symbology = 'EAN13' and v_code ~ '^2[0-9]' then
    raise exception 'RESERVED_INTERNAL_PREFIX' using errcode = '22023',
      detail = 'Los prefijos 20-29 son del generador interno, no de un proveedor.',
      hint = 'Si el proveedor imprime un código en ese rango, genera uno propio y reetiqueta.';
  end if;
  if v_symbology = 'CODE128' and (
    length(v_code) > 80
    or v_code !~ '^[ -~]+$'
  ) then
    raise exception 'INVALID_CODE128' using errcode = '22023';
  end if;

  perform 1
  from public.variants v
  join public.products p on p.id = v.product_id
  where v.id = p_variant_id
    and v.is_active
    and p.is_active
  for update of v;
  if not found then
    raise exception 'VARIANT_NOT_FOUND' using errcode = '22023';
  end if;

  select b.*
  into v_barcode
  from public.barcodes b
  where b.code = v_code
  for update;

  if found then
    if v_barcode.variant_id <> p_variant_id then
      raise exception 'BARCODE_ALREADY_ASSIGNED' using errcode = '23505';
    end if;
    if v_barcode.symbology <> v_symbology or v_barcode.source <> v_source then
      raise exception 'BARCODE_METADATA_MISMATCH' using errcode = '22023';
    end if;
    v_reused := true;
  else
    v_barcode.id := extensions.gen_random_uuid();
  end if;

  -- Bajar el primario no cambia ni elimina su identidad física. El trigger de
  -- auditoría registra tanto esta transición como la nueva alta/promoción.
  update public.barcodes
  set is_primary = false
  where variant_id = p_variant_id
    and is_primary
    and code <> v_code;

  if v_reused then
    update public.barcodes
    set is_primary = true
    where id = v_barcode.id;
  else
    insert into public.barcodes (
      id, variant_id, code, symbology, source, is_primary
    ) values (
      v_barcode.id, p_variant_id, v_code, v_symbology, v_source, true
    );
  end if;

  return jsonb_build_object(
    'barcode_id', v_barcode.id,
    'variant_id', p_variant_id,
    'code', v_code,
    'reused', v_reused
  );
exception
  when unique_violation then
    raise exception 'BARCODE_ALREADY_ASSIGNED' using errcode = '23505';
end;
$$;

commit;
