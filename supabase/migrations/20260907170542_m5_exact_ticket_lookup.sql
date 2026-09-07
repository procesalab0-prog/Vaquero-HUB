begin;

-- Un cajero no ve el historial completo de otros cajeros, pero sí necesita
-- recuperar un ticket exacto presentado por el cliente para M5.
create or replace function public.get_sale_ticket_by_folio(
  p_location_id uuid,
  p_folio text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := (select app.current_user_id()); v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('returns.create'))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_folio, ''))) not between 3 and 100 then
    raise exception 'INVALID_TICKET_QUERY' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'id', s.id, 'folio', s.folio, 'status', s.status, 'sold_at', s.sold_at,
    'subtotal_cents', s.subtotal_cents,
    'discount_cents', s.item_discount_cents + s.ticket_discount_cents,
    'total_cents', s.total_cents, 'notes', s.notes, 'cashier_name', u.full_name,
    'register_name', r.name, 'cash_session_status', cs.status,
    'customer_id', s.customer_id, 'cancelled_at', s.cancelled_at,
    'cancellation_reason', s.cancellation_reason,
    'location', jsonb_build_object('id', l.id, 'code', l.code, 'name', l.name,
      'address', l.address, 'phone', l.phone, 'legal_name', l.legal_name, 'tax_id', l.tax_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'line_number', i.line_number, 'product_name', i.product_name, 'sku', i.sku,
      'variant_description', i.variant_description, 'quantity', i.quantity,
      'unit_price_cents', i.unit_price_cents,
      'discount_cents', i.item_discount_cents + i.ticket_discount_cents,
      'line_total_cents', i.line_total_cents - i.ticket_discount_cents,
      'gift_receipt', i.gift_receipt) order by i.line_number), '[]'::jsonb)
      from public.sale_items i where i.sale_id = s.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
      'method_code', p.method_code, 'method_name', m.name,
      'amount_cents', p.amount_cents, 'tendered_cents', p.tendered_cents,
      'change_cents', p.change_cents, 'reference', p.reference) order by m.sort_order), '[]'::jsonb)
      from public.sale_payments p join public.payment_methods m on m.code = p.method_code
      where p.sale_id = s.id)
  ) into v_result
  from public.sales s
  join public.app_users u on u.id = s.cashier_user_id
  join public.cash_sessions cs on cs.id = s.cash_session_id
  join public.cash_registers r on r.id = cs.register_id
  join public.locations l on l.id = s.location_id
  where s.location_id = p_location_id and upper(s.folio) = upper(btrim(p_folio));
  if v_result is null then raise exception 'SALE_NOT_FOUND' using errcode = '22023'; end if;
  return v_result;
end;
$$;

revoke execute on function public.get_sale_ticket_by_folio(uuid, text) from public, anon;
grant execute on function public.get_sale_ticket_by_folio(uuid, text) to authenticated, service_role;

commit;
