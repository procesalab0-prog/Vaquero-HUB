begin;

create or replace function public.record_sale_ticket_delivery(
  p_sale_id uuid,
  p_channel text,
  p_status text,
  p_receipt_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_sale public.sales%rowtype;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_channel not in ('NATIVE_SHARE', 'DOWNLOAD')
     or p_status not in ('SHARED', 'DOWNLOADED', 'CANCELLED', 'FAILED')
     or p_receipt_kind not in ('SALE', 'GIFT') then
    raise exception 'INVALID_TICKET_DELIVERY' using errcode = '22023';
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found
     or not (select app.can_access_location(v_sale.location_id))
     or (v_sale.cashier_user_id <> v_actor and not (select app.has_perm('reports.sales'))) then
    raise exception 'SALE_NOT_FOUND' using errcode = '22023';
  end if;
  if p_receipt_kind = 'GIFT' and not exists (
    select 1 from public.sale_items
    where sale_id = p_sale_id and gift_receipt
  ) then
    raise exception 'GIFT_RECEIPT_EMPTY' using errcode = '22023';
  end if;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    v_actor,
    'sale_ticket.delivery_recorded',
    'sales',
    v_sale.id::text,
    v_sale.location_id,
    jsonb_build_object(
      'channel', p_channel,
      'status', p_status,
      'receipt_kind', p_receipt_kind
    )
  );
end;
$$;

revoke execute on function public.record_sale_ticket_delivery(uuid, text, text, text)
  from public, anon;
grant execute on function public.record_sale_ticket_delivery(uuid, text, text, text)
  to authenticated;

comment on function public.record_sale_ticket_delivery(uuid, text, text, text) is
  'Audita compartir o descargar un PDF sin guardar destinatario, archivo ni contenido.';

create or replace function public.get_my_customer_tickets(p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_result jsonb;
begin
  if (select auth.uid()) is null or coalesce(p_limit, 0) not between 1 and 50 then
    raise exception 'INVALID_CUSTOMER_TICKET_QUERY' using errcode = '22023';
  end if;

  select id into v_customer_id
  from public.customers
  where auth_user_id = (select auth.uid()) and not is_anonymized
  limit 1;
  if v_customer_id is null then
    raise exception 'CUSTOMER_NOT_LINKED' using errcode = '42501';
  end if;

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
      'register_name', r.name,
      'return_window_days', coalesce(rp.window_days, 15),
      'location', jsonb_build_object(
        'name', l.name, 'address', l.address, 'phone', l.phone
      ),
      'items', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'product_name', i.product_name,
          'variant_description', i.variant_description,
          'sku', i.sku,
          'quantity', i.quantity,
          'unit_price_cents', i.unit_price_cents,
          'gift_receipt', i.gift_receipt
        ) order by i.line_number), '[]'::jsonb)
        from public.sale_items i where i.sale_id = s.id
      ),
      'payments', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'method_name', m.name,
          'amount_cents', p.amount_cents
        ) order by m.sort_order), '[]'::jsonb)
        from public.sale_payments p
        join public.payment_methods m on m.code = p.method_code
        where p.sale_id = s.id
      )
    ) as ticket
    from public.sales s
    join public.cash_sessions cs on cs.id = s.cash_session_id
    join public.cash_registers r on r.id = cs.register_id
    join public.locations l on l.id = s.location_id
    left join public.return_policies rp on rp.location_id = s.location_id
    where s.customer_id = v_customer_id
    order by s.sold_at desc
    limit p_limit
  ) listed;
  return v_result;
end;
$$;

revoke execute on function public.get_my_customer_tickets(integer) from public, anon;
grant execute on function public.get_my_customer_tickets(integer) to authenticated;

comment on function public.get_my_customer_tickets(integer) is
  'Devuelve sólo las ventas del cliente ligado al auth.uid actual; nunca acepta otro customer_id.';

commit;
