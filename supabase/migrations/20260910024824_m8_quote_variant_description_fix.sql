begin;

-- Corrección incremental: variants no almacena los atributos como una columna;
-- la descripción se deriva del modelo normalizado sin reescribir la migración
-- M8.2 que ya fue ejecutada en staging.
create or replace function public.create_quote(
  p_location_id uuid,
  p_items jsonb,
  p_customer_id uuid default null,
  p_valid_until date default null,
  p_notes text default null
)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_quote public.quotes;
  v_item jsonb;
  v_variant public.variants;
  v_product public.products;
  v_line integer := 0;
  v_quantity integer;
  v_subtotal bigint := 0;
  v_folio bigint;
  v_line_total bigint;
  v_description text;
begin
  if v_actor is null or not (select app.has_perm('quotes.manage'))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  perform app.assert_quote_items(p_items);
  if p_valid_until is not null and p_valid_until < current_date then
    raise exception 'QUOTE_DATE_IN_PAST' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'INVALID_QUOTE_NOTES' using errcode = '22023';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers where id = p_customer_id and not is_anonymized
  ) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = '22023';
  end if;

  insert into public.folios (location_id, document_type, next_number)
  values (p_location_id, 'QUOTE', 2)
  on conflict (location_id, document_type)
  do update set next_number = public.folios.next_number + 1
  returning next_number - 1 into v_folio;

  insert into public.quotes (
    location_id, customer_id, created_by, folio_number, folio,
    subtotal_cents, total_cents, valid_until, notes
  ) values (
    p_location_id, p_customer_id, v_actor, v_folio,
    (select code from public.locations where id = p_location_id) || '-COT-' || lpad(v_folio::text, 6, '0'),
    1, 1, p_valid_until, nullif(btrim(coalesce(p_notes, '')), '')
  ) returning * into v_quote;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    v_quantity := (v_item->>'quantity')::integer;
    select v.* into v_variant
    from public.variants v join public.products p on p.id = v.product_id
    where v.id = (v_item->>'variant_id')::uuid and v.is_active and p.is_active
    for share of v;
    if not found then raise exception 'VARIANT_NOT_SELLABLE' using errcode = '22023'; end if;
    select * into v_product from public.products where id = v_variant.product_id;
    select coalesce(string_agg(av.value, ' · ' order by at.display_order, av.display_order), '')
    into v_description
    from public.variant_attributes va
    join public.attribute_values av on av.id = va.value_id
    join public.attribute_types at on at.code = va.type_code
    where va.variant_id = v_variant.id;
    v_line_total := v_quantity * v_variant.price_cents;
    insert into public.quote_items (
      quote_id, line_number, variant_id, product_name, sku,
      variant_description, quantity, unit_price_cents, line_total_cents
    ) values (
      v_quote.id, v_line, v_variant.id, v_product.name, v_variant.sku,
      v_description, v_quantity, v_variant.price_cents, v_line_total
    );
    v_subtotal := v_subtotal + v_line_total;
  end loop;
  update public.quotes set subtotal_cents = v_subtotal, total_cents = v_subtotal
  where id = v_quote.id returning * into v_quote;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, after_data, metadata)
  values (v_actor, 'quote.created', 'quotes', v_quote.id::text, p_location_id, to_jsonb(v_quote),
    jsonb_build_object('item_count', jsonb_array_length(p_items)));
  return v_quote;
end;
$$;

revoke execute on function public.create_quote(uuid,jsonb,uuid,date,text) from public, anon;
grant execute on function public.create_quote(uuid,jsonb,uuid,date,text) to authenticated, service_role;

commit;
