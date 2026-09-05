begin;

create or replace function public.list_sale_tickets(
  p_location_id uuid,
  p_query text default '',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_can_report boolean;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not (select app.has_perm('pos.sell'))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_location_id is null
     or length(coalesce(p_query, '')) > 100
     or coalesce(p_limit, 0) not between 1 and 200
     or (p_from is not null and p_to is not null and p_from >= p_to) then
    raise exception 'INVALID_TICKET_QUERY' using errcode = '22023';
  end if;

  v_can_report := (select app.has_perm('reports.sales'));

  select coalesce(jsonb_agg(ticket order by sold_at desc), '[]'::jsonb)
    into v_result
  from (
    select s.sold_at, jsonb_build_object(
      'id', s.id,
      'folio', s.folio,
      'status', s.status,
      'sold_at', s.sold_at,
      'subtotal_cents', s.subtotal_cents,
      'discount_cents', s.item_discount_cents + s.ticket_discount_cents,
      'total_cents', s.total_cents,
      'notes', s.notes,
      'cashier_name', u.full_name,
      'register_name', r.name,
      'cash_session_status', cs.status,
      'customer_id', s.customer_id,
      'cancelled_at', s.cancelled_at,
      'cancellation_reason', s.cancellation_reason,
      'location', jsonb_build_object(
        'id', l.id, 'code', l.code, 'name', l.name,
        'address', l.address, 'phone', l.phone,
        'legal_name', l.legal_name, 'tax_id', l.tax_id
      ),
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'line_number', i.line_number,
          'product_name', i.product_name,
          'sku', i.sku,
          'variant_description', i.variant_description,
          'quantity', i.quantity,
          'unit_price_cents', i.unit_price_cents,
          'discount_cents', i.item_discount_cents + i.ticket_discount_cents,
          'line_total_cents', i.line_total_cents - i.ticket_discount_cents,
          'gift_receipt', i.gift_receipt
        ) order by i.line_number), '[]'::jsonb)
        from public.sale_items i where i.sale_id = s.id
      ),
      'payments', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'method_code', p.method_code,
          'method_name', m.name,
          'amount_cents', p.amount_cents,
          'tendered_cents', p.tendered_cents,
          'change_cents', p.change_cents,
          'reference', p.reference
        ) order by m.sort_order), '[]'::jsonb)
        from public.sale_payments p
        join public.payment_methods m on m.code = p.method_code
        where p.sale_id = s.id
      )
    ) as ticket
    from public.sales s
    join public.app_users u on u.id = s.cashier_user_id
    join public.cash_sessions cs on cs.id = s.cash_session_id
    join public.cash_registers r on r.id = cs.register_id
    join public.locations l on l.id = s.location_id
    where s.location_id = p_location_id
      and (v_can_report or s.cashier_user_id = v_actor)
      and (p_from is null or s.sold_at >= p_from)
      and (p_to is null or s.sold_at < p_to)
      and (
        btrim(coalesce(p_query, '')) = ''
        or position(lower(btrim(p_query)) in lower(s.folio)) > 0
        or exists (
          select 1 from public.sale_items si
          where si.sale_id = s.id
            and (
              position(lower(btrim(p_query)) in lower(si.sku)) > 0
              or position(lower(btrim(p_query)) in lower(si.product_name)) > 0
            )
        )
      )
    order by s.sold_at desc
    limit p_limit
  ) listed;

  return v_result;
end;
$$;

revoke execute on function public.list_sale_tickets(uuid, text, timestamptz, timestamptz, integer)
  from public, anon;
grant execute on function public.list_sale_tickets(uuid, text, timestamptz, timestamptz, integer)
  to authenticated, service_role;

commit;
