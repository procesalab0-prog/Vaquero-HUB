begin;

-- M8.2 · Cotizaciones. Una cotización conserva precios y cantidades, pero no
-- reserva inventario ni genera movimientos de caja hasta convertirse en venta.
insert into public.permissions (code, category, description) values
  ('quotes.manage', 'Punto de venta', 'Crear, enviar y convertir cotizaciones')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, 'quotes.manage'
from public.roles r
where r.code in ('ADMIN', 'MANAGER', 'CASHIER')
on conflict do nothing;

alter table public.folios drop constraint folios_document_type_check;
alter table public.folios add constraint folios_document_type_check
  check (document_type in ('SALE', 'QUOTE'));

create table public.quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  customer_id uuid references public.customers(id),
  created_by uuid not null references public.app_users(id),
  folio_number bigint not null check (folio_number > 0),
  folio text not null unique check (btrim(folio) <> ''),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SENT', 'CONVERTED', 'EXPIRED')),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  total_cents bigint not null check (total_cents = subtotal_cents and total_cents > 0),
  valid_until date,
  notes text check (notes is null or length(notes) <= 500),
  sent_at timestamptz,
  converted_at timestamptz,
  converted_sale_id uuid unique references public.sales(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, folio_number),
  constraint quote_status_complete check (
    (status = 'DRAFT' and sent_at is null and converted_at is null and converted_sale_id is null)
    or (status = 'SENT' and sent_at is not null and converted_at is null and converted_sale_id is null)
    or (status = 'EXPIRED' and converted_at is null and converted_sale_id is null)
    or (status = 'CONVERTED' and converted_at is not null and converted_sale_id is not null)
  )
);

create table public.quote_items (
  id uuid primary key default extensions.gen_random_uuid(),
  quote_id uuid not null references public.quotes(id),
  line_number integer not null check (line_number > 0),
  variant_id uuid not null references public.variants(id),
  product_name text not null check (btrim(product_name) <> ''),
  sku text not null check (btrim(sku) <> ''),
  variant_description text not null default '',
  quantity integer not null check (quantity between 1 and 999),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  line_total_cents bigint not null check (line_total_cents = quantity * unit_price_cents),
  unique (quote_id, line_number),
  unique (quote_id, variant_id)
);

create index quotes_location_created_idx on public.quotes (location_id, created_at desc);
create index quotes_customer_created_idx on public.quotes (customer_id, created_at desc) where customer_id is not null;
create index quotes_status_valid_idx on public.quotes (status, valid_until);
create index quote_items_quote_idx on public.quote_items (quote_id, line_number);
create index quote_items_variant_idx on public.quote_items (variant_id, quote_id);

alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
revoke all on public.quotes, public.quote_items from public, anon, authenticated;
grant select, insert, update, delete on public.quotes, public.quote_items to service_role;

alter table public.pos_drafts add column quote_id uuid references public.quotes(id);
create index pos_drafts_quote_idx on public.pos_drafts (quote_id) where quote_id is not null;

create or replace function app.assert_quote_items(p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_variant_id uuid;
  v_quantity integer;
begin
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) not between 1 and 100
     or pg_column_size(p_items) > 65536 then
    raise exception 'INVALID_QUOTE_ITEMS' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    group by item->>'variant_id' having count(*) > 1
  ) then
    raise exception 'DUPLICATE_QUOTE_VARIANT' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_variant_id := (v_item->>'variant_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'INVALID_QUOTE_ITEM' using errcode = '22023';
    end;
    if jsonb_typeof(v_item) <> 'object'
       or v_quantity not between 1 and 999
       or not exists (
         select 1 from public.variants v
         join public.products p on p.id = v.product_id
         where v.id = v_variant_id and v.is_active and p.is_active
       ) then
      raise exception 'INVALID_QUOTE_ITEM' using errcode = '22023';
    end if;
  end loop;
end;
$$;

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
    v_line_total := v_quantity * v_variant.price_cents;
    insert into public.quote_items (
      quote_id, line_number, variant_id, product_name, sku,
      variant_description, quantity, unit_price_cents, line_total_cents
    ) values (
      v_quote.id, v_line, v_variant.id, v_product.name, v_variant.sku,
      concat_ws(' · ', nullif(v_variant.attributes->>'COLOR', ''), nullif(v_variant.attributes->>'TALLA', '')),
      v_quantity, v_variant.price_cents, v_line_total
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

create or replace function public.list_quotes(
  p_location_id uuid,
  p_status text default null,
  p_query text default '',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('quotes.manage'))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('DRAFT', 'SENT', 'CONVERTED', 'EXPIRED') then
    raise exception 'INVALID_QUOTE_STATUS' using errcode = '22023';
  end if;
  update public.quotes set status = 'EXPIRED', updated_at = now()
  where location_id = p_location_id and status in ('DRAFT', 'SENT')
    and valid_until is not null and valid_until < current_date;

  select coalesce(jsonb_agg(row_data order by (row_data->>'created_at') desc), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', q.id, 'folio', q.folio, 'status', q.status,
      'subtotal_cents', q.subtotal_cents, 'total_cents', q.total_cents,
      'valid_until', q.valid_until, 'notes', q.notes, 'sent_at', q.sent_at,
      'converted_at', q.converted_at, 'converted_sale_id', q.converted_sale_id,
      'created_at', q.created_at, 'created_by_name', u.full_name,
      'customer', case when c.id is null then null else jsonb_build_object(
        'id', c.id, 'member_number', c.member_number, 'full_name', c.full_name,
        'phone_e164', c.phone_e164, 'email', c.email
      ) end,
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'variant_id', i.variant_id, 'product_name', i.product_name, 'sku', i.sku,
        'variant_description', i.variant_description, 'quantity', i.quantity,
        'unit_price_cents', i.unit_price_cents, 'line_total_cents', i.line_total_cents
      ) order by i.line_number), '[]'::jsonb) from public.quote_items i where i.quote_id = q.id)
    ) row_data
    from public.quotes q
    join public.app_users u on u.id = q.created_by
    left join public.customers c on c.id = q.customer_id and not c.is_anonymized
    where q.location_id = p_location_id
      and (p_status is null or q.status = p_status)
      and (coalesce(btrim(p_query), '') = '' or q.folio ilike '%' || btrim(p_query) || '%'
        or c.full_name ilike '%' || btrim(p_query) || '%'
        or exists (select 1 from public.quote_items qi where qi.quote_id = q.id
          and (qi.product_name ilike '%' || btrim(p_query) || '%' or qi.sku ilike '%' || btrim(p_query) || '%')))
    order by q.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  ) rows;
  return v_result;
end;
$$;

create or replace function public.send_quote(p_quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_quote public.quotes;
begin
  if v_actor is null or not (select app.has_perm('quotes.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or not (select app.can_access_location(v_quote.location_id)) then
    raise exception 'QUOTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_quote.valid_until is not null and v_quote.valid_until < current_date then
    update public.quotes set status = 'EXPIRED', updated_at = now() where id = v_quote.id;
    raise exception 'QUOTE_EXPIRED' using errcode = '22023';
  end if;
  if v_quote.status not in ('DRAFT', 'SENT') then
    raise exception 'QUOTE_NOT_SENDABLE' using errcode = '22023';
  end if;
  update public.quotes set status = 'SENT', sent_at = coalesce(sent_at, now()), updated_at = now()
  where id = v_quote.id returning * into v_quote;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, metadata)
  values (v_actor, 'quote.sent', 'quotes', v_quote.id::text, v_quote.location_id, '{}'::jsonb);
  return v_quote;
end;
$$;

create or replace function public.load_quote_into_pos(p_quote_id uuid, p_cash_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_quote public.quotes;
  v_session public.cash_sessions;
  v_draft_id uuid;
  v_items jsonb;
begin
  if v_actor is null or not (select app.has_perm('quotes.manage')) or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or not (select app.can_access_location(v_quote.location_id)) then
    raise exception 'QUOTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_quote.valid_until is not null and v_quote.valid_until < current_date then
    update public.quotes set status = 'EXPIRED', updated_at = now() where id = v_quote.id;
    raise exception 'QUOTE_EXPIRED' using errcode = '22023';
  end if;
  if v_quote.status not in ('DRAFT', 'SENT') then
    raise exception 'QUOTE_NOT_CONVERTIBLE' using errcode = '22023';
  end if;
  v_session := app.assert_owned_open_cash_session(p_cash_session_id, v_actor);
  if v_session.location_id <> v_quote.location_id then
    raise exception 'QUOTE_LOCATION_MISMATCH' using errcode = '22023';
  end if;
  if exists (select 1 from public.pos_drafts where cash_session_id = v_session.id and cashier_user_id = v_actor and status = 'CURRENT') then
    raise exception 'CURRENT_DRAFT_NOT_EMPTY' using errcode = '23505';
  end if;
  select jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'quantity', i.quantity, 'gift_receipt', false) order by i.line_number)
  into v_items from public.quote_items i where i.quote_id = v_quote.id;
  insert into public.pos_drafts (
    cash_session_id, register_id, location_id, cashier_user_id, status,
    customer_id, items, discount_percent, quote_id
  ) values (
    v_session.id, v_session.register_id, v_session.location_id, v_actor, 'CURRENT',
    v_quote.customer_id, v_items, 0, v_quote.id
  ) returning id into v_draft_id;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, metadata)
  values (v_actor, 'quote.loaded_into_pos', 'quotes', v_quote.id::text, v_quote.location_id,
    jsonb_build_object('draft_id', v_draft_id));
  return v_draft_id;
end;
$$;

create or replace function public.convert_quote_to_sale(
  p_quote_id uuid,
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_payments jsonb
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_quote public.quotes;
  v_session public.cash_sessions;
  v_sale public.sales;
  v_items jsonb;
begin
  if v_actor is null or not (select app.has_perm('quotes.manage')) or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or not (select app.can_access_location(v_quote.location_id)) then
    raise exception 'QUOTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_quote.status = 'CONVERTED' and v_quote.converted_sale_id is not null then
    select * into v_sale from public.sales where id = v_quote.converted_sale_id;
    return v_sale;
  end if;
  if v_quote.valid_until is not null and v_quote.valid_until < current_date then
    update public.quotes set status = 'EXPIRED', updated_at = now() where id = v_quote.id;
    raise exception 'QUOTE_EXPIRED' using errcode = '22023';
  end if;
  if v_quote.status not in ('DRAFT', 'SENT') then
    raise exception 'QUOTE_NOT_CONVERTIBLE' using errcode = '22023';
  end if;
  v_session := app.assert_owned_open_cash_session(p_cash_session_id, v_actor);
  if v_session.location_id <> v_quote.location_id then
    raise exception 'QUOTE_LOCATION_MISMATCH' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.quote_items i join public.variants v on v.id = i.variant_id
    join public.products p on p.id = v.product_id
    where i.quote_id = v_quote.id and (not v.is_active or not p.is_active or v.price_cents <> i.unit_price_cents)
  ) then
    raise exception 'QUOTE_PRICE_OR_PRODUCT_CHANGED' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'quantity', i.quantity, 'gift_receipt', false) order by i.line_number)
  into v_items from public.quote_items i where i.quote_id = v_quote.id;
  v_sale := public.create_sale(
    p_idempotency_key, p_cash_session_id, v_items, p_payments,
    v_quote.customer_id, '[]'::jsonb, 'Cotización ' || v_quote.folio
  );
  update public.quotes set status = 'CONVERTED', converted_at = now(),
    converted_sale_id = v_sale.id, updated_at = now()
  where id = v_quote.id returning * into v_quote;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, location_id, metadata)
  values (v_actor, 'quote.converted', 'quotes', v_quote.id::text, v_quote.location_id,
    jsonb_build_object('sale_id', v_sale.id, 'sale_folio', v_sale.folio));
  return v_sale;
end;
$$;

-- Las respuestas de borradores conservan el vínculo de la cotización para que
-- el POS use la conversión atómica en vez de registrar una venta independiente.
create or replace function public.list_my_pos_drafts(p_cash_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_session public.cash_sessions; v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  v_session := app.assert_owned_open_cash_session(p_cash_session_id,v_actor);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'status',d.status,'label',d.label,'items',d.items,'discount_percent',d.discount_percent,
    'quote_id',d.quote_id,'held_at',d.held_at,'updated_at',d.updated_at,
    'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'member_number',c.member_number,'full_name',c.full_name,'phone_e164',c.phone_e164,'email',c.email) end
  ) order by case when d.status='CURRENT' then 0 else 1 end,d.updated_at desc),'[]'::jsonb) into v_result
  from public.pos_drafts d left join public.customers c on c.id=d.customer_id and not c.is_anonymized
  where d.cash_session_id=v_session.id and d.cashier_user_id=v_actor;
  return v_result;
end;
$$;

revoke execute on function app.assert_quote_items(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.create_quote(uuid,jsonb,uuid,date,text) from public, anon;
revoke execute on function public.list_quotes(uuid,text,text,integer) from public, anon;
revoke execute on function public.send_quote(uuid) from public, anon;
revoke execute on function public.load_quote_into_pos(uuid,uuid) from public, anon;
revoke execute on function public.convert_quote_to_sale(uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.create_quote(uuid,jsonb,uuid,date,text), public.list_quotes(uuid,text,text,integer),
  public.send_quote(uuid), public.load_quote_into_pos(uuid,uuid), public.convert_quote_to_sale(uuid,uuid,uuid,jsonb)
  to authenticated, service_role;

commit;
