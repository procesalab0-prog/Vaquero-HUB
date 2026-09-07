begin;

-- M5 completo: la política se decide por sucursal y se aplica en el servidor.
create table public.return_policies (
  location_id uuid primary key references public.locations(id),
  window_days integer not null default 15 check (window_days between 0 and 365),
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now()
);

insert into public.return_policies(location_id)
select id from public.locations where type = 'STORE'
on conflict (location_id) do nothing;

alter table public.return_policies enable row level security;
create policy return_policies_read on public.return_policies for select to authenticated
using ((select app.can_access_location(location_id)));

revoke all on public.return_policies from public, anon, authenticated, service_role;
grant select on public.return_policies to authenticated, service_role;
grant select, insert, update, delete on public.return_policies to service_role;

insert into public.permissions(code, category, description) values
  ('returns.authorize', 'Punto de venta', 'Autorizar devoluciones y cambios'),
  ('returns.policy_manage', 'Punto de venta', 'Configurar el plazo de devoluciones')
on conflict (code) do update set
  category = excluded.category,
  description = excluded.description;

insert into public.role_permissions(role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code in ('returns.authorize', 'returns.policy_manage')
where r.code in ('ADMIN', 'MANAGER')
on conflict do nothing;

alter table public.cash_movements drop constraint cash_movements_movement_type_check;
alter table public.cash_movements add constraint cash_movements_movement_type_check
check (movement_type in (
  'OPENING', 'SALE', 'DEPOSIT', 'WITHDRAWAL', 'CLOSING', 'CANCELLATION', 'RETURN'
));

alter table public.idempotency_keys drop constraint idempotency_keys_operation_check;
alter table public.idempotency_keys add constraint idempotency_keys_operation_check
check (operation in ('CREATE_SALE', 'CREATE_EQUAL_EXCHANGE', 'CREATE_RETURN_EXCHANGE'));

create or replace function public.get_return_policy(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_days integer;
begin
  if (select app.current_user_id()) is null
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  select window_days into v_days
  from public.return_policies where location_id = p_location_id;
  return jsonb_build_object('location_id', p_location_id, 'window_days', coalesce(v_days, 15));
end;
$$;

create or replace function public.update_return_policy(
  p_location_id uuid,
  p_window_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select app.current_user_id());
begin
  if v_actor is null
     or not (select app.has_perm('returns.policy_manage'))
     or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_window_days is null or p_window_days not between 0 and 365 then
    raise exception 'INVALID_RETURN_WINDOW' using errcode = '22023';
  end if;
  insert into public.return_policies(location_id, window_days, updated_by)
  values (p_location_id, p_window_days, v_actor)
  on conflict (location_id) do update set
    window_days = excluded.window_days,
    updated_by = excluded.updated_by,
    updated_at = now();
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, after_data)
  values (v_actor, 'return_policy.updated', 'return_policies', p_location_id::text,
    p_location_id, jsonb_build_object('window_days', p_window_days));
  return jsonb_build_object('location_id', p_location_id, 'window_days', p_window_days);
end;
$$;

create or replace function public.reset_employee_supervisor_pin(
  p_user_id uuid,
  p_new_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select app.current_user_id());
begin
  if v_actor is null or not (select app.has_perm('users.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_user_id is null or p_new_pin !~ '^[0-9]{4,8}$'
     or not exists (select 1 from public.app_users where id = p_user_id and is_active) then
    raise exception 'INVALID_SUPERVISOR_PIN' using errcode = '22023';
  end if;
  update public.app_users set
    supervisor_pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 12)),
    pin_failed_attempts = 0,
    pin_locked_until = null
  where id = p_user_id;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'supervisor_pin.reset', 'app_users', p_user_id::text,
    jsonb_build_object('pin_length', length(p_new_pin)));
end;
$$;

-- Devuelve lo necesario para una devolución, incluidos plazo y formas originales.
create or replace function public.get_returnable_sale(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := (select app.current_user_id()); v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('returns.create')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', s.id, 'folio', s.folio, 'status', s.status, 'sold_at', s.sold_at,
    'total_cents', s.total_cents, 'location_id', s.location_id,
    'customer_id', s.customer_id,
    'window_days', coalesce(rp.window_days, 15),
    'return_deadline', s.sold_at + make_interval(days => coalesce(rp.window_days, 15)),
    'within_window', now() <= s.sold_at + make_interval(days => coalesce(rp.window_days, 15)),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
      'method_code', sp.method_code, 'method_name', pm.name,
      'amount_cents', sp.amount_cents, 'requires_reference', pm.requires_reference
    ) order by pm.sort_order), '[]'::jsonb)
      from public.sale_payments sp join public.payment_methods pm on pm.code = sp.method_code
      where sp.sale_id = s.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'sale_item_id', si.id, 'variant_id', si.variant_id,
      'product_name', si.product_name, 'variant_description', si.variant_description,
      'sku', si.sku, 'quantity', si.quantity,
      'remaining_quantity', si.quantity - coalesce(pr.returned_qty, 0),
      'paid_line_cents', si.line_total_cents - si.ticket_discount_cents,
      'already_returned_cents', coalesce(pr.returned_cents, 0)
    ) order by si.line_number), '[]'::jsonb)
      from public.sale_items si
      left join lateral (
        select sum(ri.quantity) returned_qty, sum(ri.line_total_cents) returned_cents
        from public.return_items ri where ri.sale_item_id = si.id and ri.direction = 'IN'
      ) pr on true where si.sale_id = s.id)
  ) into v_result
  from public.sales s
  left join public.return_policies rp on rp.location_id = s.location_id
  where s.id = p_sale_id and (select app.can_access_location(s.location_id));
  if v_result is null then raise exception 'SALE_NOT_FOUND' using errcode = '22023'; end if;
  return v_result;
end;
$$;

create or replace function public.search_exchange_variants(
  p_query text default '',
  p_exclude_variant_id uuid default null,
  p_limit integer default 50
)
returns table (
  variant_id uuid, product_name text, brand_name text, sku text,
  price_cents bigint, attributes jsonb, available_qty numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_location_id uuid;
  v_query text := lower(translate(btrim(coalesce(p_query, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
begin
  if v_actor is null or not (select app.has_perm('returns.create'))
     or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or length(v_query) > 120 then
    raise exception 'INVALID_EXCHANGE_SEARCH' using errcode = '22023';
  end if;
  select s.location_id into v_location_id from public.cash_sessions s
  where s.cashier_user_id = v_actor and s.status = 'OPEN';
  if v_location_id is null or not (select app.can_access_location(v_location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;
  return query
  select v.id, p.name, coalesce(b.name, 'Sin marca'), v.sku, v.price_cents,
    coalesce(attrs.values, '{}'::jsonb), i.qty - i.reserved_qty
  from public.variants v
  join public.products p on p.id = v.product_id
  left join public.brands b on b.id = p.brand_id
  join public.inventory_by_location i on i.variant_id = v.id and i.location_id = v_location_id
  left join lateral (
    select jsonb_object_agg(va.type_code, av.value order by va.type_code) values
    from public.variant_attributes va join public.attribute_values av on av.id = va.value_id
    where va.variant_id = v.id
  ) attrs on true
  where v.is_active and p.is_active and i.qty - i.reserved_qty > 0
    and (p_exclude_variant_id is null or v.id <> p_exclude_variant_id)
    and (v_query = '' or lower(translate(concat_ws(' ', p.name, b.name, v.sku,
      coalesce(attrs.values::text, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) like '%' || v_query || '%')
  order by p.name, v.sku limit p_limit;
end;
$$;

create or replace function public.create_return_exchange(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_original_sale_id uuid,
  p_items_in jsonb,
  p_items_out jsonb default '[]'::jsonb,
  p_charge_payments jsonb default '[]'::jsonb,
  p_refund_references jsonb default '[]'::jsonb,
  p_authorization_token uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_session public.cash_sessions; v_sale public.sales; v_return public.returns;
  v_authorization app.supervisor_authorizations; v_existing public.idempotency_keys;
  v_hash text; v_folio bigint; v_in record; v_out record; v_payment jsonb;
  v_previous_qty numeric; v_previous_cents bigint; v_line_cents bigint;
  v_returned bigint := 0; v_delivered bigint := 0; v_difference bigint;
  v_charge_total bigint := 0; v_refund_total bigint := 0; v_cash_net bigint := 0;
  v_method public.payment_methods; v_amount bigint; v_reference text; v_type text;
  v_policy_days integer;
begin
  if v_actor is null or not (select app.has_perm('returns.create'))
     or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_cash_session_id is null or p_original_sale_id is null
     or jsonb_typeof(p_items_in) <> 'array' or jsonb_array_length(p_items_in) not between 1 and 100
     or jsonb_typeof(coalesce(p_items_out, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items_out, '[]')) > 100
     or jsonb_typeof(coalesce(p_charge_payments, '[]')) <> 'array' or jsonb_array_length(coalesce(p_charge_payments, '[]')) > 10
     or jsonb_typeof(coalesce(p_refund_references, '[]')) <> 'array' or jsonb_array_length(coalesce(p_refund_references, '[]')) > 10
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'INVALID_RETURN_REQUEST' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items_in) x group by x->>'sale_item_id' having count(*) > 1)
     or exists(select 1 from jsonb_array_elements(coalesce(p_items_out, '[]')) x group by x->>'variant_id' having count(*) > 1)
     or exists(select 1 from jsonb_array_elements(coalesce(p_charge_payments, '[]')) x group by upper(x->>'method_code') having count(*) > 1)
     or exists(select 1 from jsonb_array_elements(coalesce(p_refund_references, '[]')) x group by upper(x->>'method_code') having count(*) > 1) then
    raise exception 'DUPLICATE_RETURN_ITEM' using errcode = '22023';
  end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'session', p_cash_session_id, 'sale', p_original_sale_id, 'in', p_items_in,
    'out', coalesce(p_items_out, '[]'), 'charges', coalesce(p_charge_payments, '[]'),
    'refund_refs', coalesce(p_refund_references, '[]'), 'authorization', p_authorization_token,
    'reason', btrim(p_reason))::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('create_return:' || p_idempotency_key::text, 0));
  select * into v_existing from public.idempotency_keys where key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id <> v_actor or v_existing.request_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    if v_existing.resource_id is null then raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode = '40001'; end if;
    select * into v_return from public.returns where id = v_existing.resource_id;
    return jsonb_build_object('id', v_return.id, 'folio', v_return.folio,
      'type', v_return.type, 'difference_cents', v_return.difference_cents);
  end if;
  insert into public.idempotency_keys(key, actor_user_id, operation, request_hash)
  values (p_idempotency_key, v_actor, 'CREATE_RETURN_EXCHANGE', v_hash);

  select * into v_sale from public.sales where id = p_original_sale_id for update;
  if not found then raise exception 'SALE_NOT_FOUND' using errcode = '22023'; end if;
  if v_sale.status <> 'COMPLETED' then raise exception 'SALE_NOT_RETURNABLE' using errcode = '22023'; end if;
  select coalesce(window_days, 15) into v_policy_days
  from public.return_policies where location_id = v_sale.location_id;
  v_policy_days := coalesce(v_policy_days, 15);
  if now() > v_sale.sold_at + make_interval(days => v_policy_days) then
    raise exception 'RETURN_WINDOW_EXPIRED' using errcode = '22023';
  end if;
  select * into v_session from public.cash_sessions where id = p_cash_session_id and status = 'OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor or v_session.location_id <> v_sale.location_id
     or not (select app.can_access_location(v_session.location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_authorization from app.supervisor_authorizations
  where id = p_authorization_token and actor_user_id = v_actor
    and permission_code = 'returns.authorize' and used_at is null and expires_at > now()
  for update;
  if not found then raise exception 'RETURN_AUTHORIZATION_REQUIRED' using errcode = '42501'; end if;

  perform si.id from public.sale_items si
  join jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
    on x.sale_item_id = si.id
  where si.sale_id = v_sale.id order by si.id for update;
  if (select count(*) from jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)) <>
     (select count(*) from public.sale_items si join jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
       on x.sale_item_id = si.id where si.sale_id = v_sale.id)
     or exists(select 1 from jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
       where x.quantity is null or x.quantity <= 0 or x.quantity <> trunc(x.quantity)
          or x.condition not in ('RESELLABLE', 'DAMAGED')) then
    raise exception 'SALE_ITEM_MISMATCH' using errcode = '22023';
  end if;

  for v_in in
    select si.id, si.variant_id, si.quantity,
      si.line_total_cents - si.ticket_discount_cents original_net,
      x.quantity requested, x.condition
    from public.sale_items si
    join jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
      on x.sale_item_id = si.id where si.sale_id = v_sale.id order by si.id
  loop
    select coalesce(sum(quantity), 0), coalesce(sum(line_total_cents), 0)
    into v_previous_qty, v_previous_cents from public.return_items
    where sale_item_id = v_in.id and direction = 'IN';
    if v_previous_qty + v_in.requested > v_in.quantity then
      raise exception 'RETURN_EXCEEDS_SOLD' using errcode = '22023';
    end if;
    if v_previous_qty + v_in.requested = v_in.quantity then
      v_line_cents := v_in.original_net - v_previous_cents;
    else
      v_line_cents := floor(v_in.original_net::numeric * v_in.requested / v_in.quantity)::bigint;
    end if;
    v_returned := v_returned + v_line_cents;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('sale-stock:' || x.variant_id::text, 0))
  from jsonb_to_recordset(coalesce(p_items_out, '[]')) x(variant_id uuid, quantity numeric)
  order by x.variant_id;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_items_out, '[]')) x(variant_id uuid, quantity numeric)
    left join public.variants v on v.id = x.variant_id left join public.products p on p.id = v.product_id
    where x.quantity is null or x.quantity <= 0 or x.quantity <> trunc(x.quantity)
       or v.id is null or p.id is null or not v.is_active or not p.is_active) then
    raise exception 'VARIANT_NOT_SELLABLE' using errcode = '22023';
  end if;
  select coalesce(sum(v.price_cents * x.quantity)::bigint, 0) into v_delivered
  from jsonb_to_recordset(coalesce(p_items_out, '[]')) x(variant_id uuid, quantity numeric)
  join public.variants v on v.id = x.variant_id;
  v_difference := v_delivered - v_returned;
  v_type := case when jsonb_array_length(coalesce(p_items_out, '[]')) = 0 then 'RETURN' else 'EXCHANGE' end;

  if v_difference > 0 then
    for v_payment in select value from jsonb_array_elements(coalesce(p_charge_payments, '[]')) loop
      begin v_amount := (v_payment->>'amount_cents')::bigint; exception when others then raise exception 'INVALID_PAYMENT' using errcode = '22023'; end;
      select * into v_method from public.payment_methods
      where code = upper(v_payment->>'method_code') and is_active;
      v_reference := nullif(btrim(v_payment->>'reference'), '');
      if not found or v_amount is null or v_amount <= 0
         or (v_method.requires_reference and length(coalesce(v_reference, '')) < 3) then
        raise exception 'INVALID_PAYMENT' using errcode = '22023';
      end if;
      v_charge_total := v_charge_total + v_amount;
    end loop;
    if v_charge_total <> v_difference then raise exception 'RETURN_PAYMENT_TOTAL_MISMATCH' using errcode = '23514'; end if;
  elsif jsonb_array_length(coalesce(p_charge_payments, '[]')) > 0 then
    raise exception 'UNEXPECTED_CHARGE_PAYMENT' using errcode = '22023';
  end if;

  if v_difference < 0 then
    v_refund_total := -v_difference;
    if (select coalesce(sum(sp.amount_cents), 0) - coalesce((select sum(rp.amount_cents)
          from public.return_payments rp join public.returns r on r.id = rp.return_id
          where r.original_sale_id = v_sale.id and rp.direction = 'REFUND'), 0)
        from public.sale_payments sp where sp.sale_id = v_sale.id) < v_refund_total then
      raise exception 'REFUND_EXCEEDS_ORIGINAL_PAYMENT' using errcode = '22023';
    end if;
    if exists (
      with available as (
        select sp.method_code, pm.requires_reference,
          sp.amount_cents - coalesce((select sum(rp.amount_cents)
            from public.return_payments rp join public.returns r on r.id = rp.return_id
            where r.original_sale_id = v_sale.id and rp.direction = 'REFUND'
              and rp.method_code = sp.method_code), 0) available_cents
        from public.sale_payments sp join public.payment_methods pm on pm.code = sp.method_code
        where sp.sale_id = v_sale.id
      )
      select 1 from available a where a.available_cents > 0 and a.requires_reference
        and length(coalesce((select nullif(btrim(x.reference), '')
          from jsonb_to_recordset(coalesce(p_refund_references, '[]')) x(method_code text, reference text)
          where upper(x.method_code) = a.method_code), '')) < 3
    ) then raise exception 'REFUND_REFERENCE_REQUIRED' using errcode = '22023'; end if;
  elsif jsonb_array_length(coalesce(p_refund_references, '[]')) > 0 then
    raise exception 'UNEXPECTED_REFUND_REFERENCE' using errcode = '22023';
  end if;

  insert into public.folios(location_id, document_type, next_number)
  values (v_session.location_id, 'RETURN', 2)
  on conflict(location_id, document_type) do update set next_number = public.folios.next_number + 1
  returning next_number - 1 into v_folio;
  perform set_config('app.returns_write', 'on', true);
  insert into public.returns(location_id, cash_session_id, original_sale_id, customer_id,
    folio_number, folio, type, returned_cents, delivered_cents, difference_cents,
    reason, authorized_by, created_by)
  values (v_session.location_id, v_session.id, v_sale.id, v_sale.customer_id, v_folio,
    (select code from public.locations where id = v_session.location_id) || '-D-' || lpad(v_folio::text, 6, '0'),
    v_type, v_returned, v_delivered, v_difference, btrim(p_reason),
    v_authorization.supervisor_user_id, v_actor) returning * into v_return;

  for v_in in
    select si.id, si.variant_id, si.quantity,
      si.line_total_cents - si.ticket_discount_cents original_net,
      x.quantity requested, x.condition
    from public.sale_items si
    join jsonb_to_recordset(p_items_in) x(sale_item_id uuid, quantity numeric, condition text)
      on x.sale_item_id = si.id where si.sale_id = v_sale.id order by si.id
  loop
    select coalesce(sum(quantity), 0), coalesce(sum(line_total_cents), 0)
    into v_previous_qty, v_previous_cents from public.return_items
    where sale_item_id = v_in.id and direction = 'IN';
    if v_previous_qty + v_in.requested = v_in.quantity then
      v_line_cents := v_in.original_net - v_previous_cents;
    else
      v_line_cents := floor(v_in.original_net::numeric * v_in.requested / v_in.quantity)::bigint;
    end if;
    insert into public.return_items(return_id, direction, sale_item_id, variant_id,
      quantity, unit_price_cents, line_total_cents, condition)
    values (v_return.id, 'IN', v_in.id, v_in.variant_id, v_in.requested,
      round(v_line_cents::numeric / v_in.requested)::bigint, v_line_cents, v_in.condition);
    perform app.apply_movement(v_in.variant_id, v_session.location_id, 'RETURN', v_in.requested,
      'RETURN', v_return.id::text, jsonb_build_object('folio', v_return.folio, 'original_sale_id', v_sale.id));
    if v_in.condition = 'DAMAGED' then
      perform app.apply_movement(v_in.variant_id, v_session.location_id, 'ADJUSTMENT', -v_in.requested,
        'DAMAGED_RETURN', v_return.id::text, jsonb_build_object('folio', v_return.folio, 'reason', btrim(p_reason)));
    end if;
  end loop;
  for v_out in
    select x.variant_id, x.quantity, v.price_cents
    from jsonb_to_recordset(coalesce(p_items_out, '[]')) x(variant_id uuid, quantity numeric)
    join public.variants v on v.id = x.variant_id order by x.variant_id
  loop
    v_line_cents := (v_out.price_cents * v_out.quantity)::bigint;
    insert into public.return_items(return_id, direction, variant_id, quantity, unit_price_cents, line_total_cents)
    values (v_return.id, 'OUT', v_out.variant_id, v_out.quantity, v_out.price_cents, v_line_cents);
    perform app.apply_movement(v_out.variant_id, v_session.location_id, 'SALE', -v_out.quantity,
      'EXCHANGE', v_return.id::text, jsonb_build_object('folio', v_return.folio, 'original_sale_id', v_sale.id));
  end loop;

  for v_payment in select value from jsonb_array_elements(coalesce(p_charge_payments, '[]')) loop
    v_amount := (v_payment->>'amount_cents')::bigint;
    v_reference := nullif(btrim(v_payment->>'reference'), '');
    insert into public.return_payments(return_id, direction, method_code, amount_cents, reference)
    values (v_return.id, 'CHARGE', upper(v_payment->>'method_code'), v_amount, v_reference);
  end loop;

  if v_refund_total > 0 then
    with available as (
      select sp.method_code, pm.sort_order,
        sp.amount_cents - coalesce((select sum(rp.amount_cents)
          from public.return_payments rp join public.returns r on r.id = rp.return_id
          where r.original_sale_id = v_sale.id and rp.direction = 'REFUND'
            and rp.method_code = sp.method_code), 0) available_cents
      from public.sale_payments sp join public.payment_methods pm on pm.code = sp.method_code
      where sp.sale_id = v_sale.id
    ), shares as (
      select *, floor(available_cents::numeric * v_refund_total / sum(available_cents) over())::bigint base,
        (available_cents::numeric * v_refund_total / sum(available_cents) over())
          - floor(available_cents::numeric * v_refund_total / sum(available_cents) over()) fraction
      from available where available_cents > 0
    ), ranked as (
      select *, row_number() over(order by fraction desc, sort_order, method_code) rn,
        v_refund_total - sum(base) over() remainder from shares
    )
    insert into public.return_payments(return_id, direction, method_code, amount_cents, reference)
    select v_return.id, 'REFUND', r.method_code,
      r.base + case when r.rn <= r.remainder then 1 else 0 end,
      (select nullif(btrim(x.reference), '')
        from jsonb_to_recordset(coalesce(p_refund_references, '[]')) x(method_code text, reference text)
        where upper(x.method_code) = r.method_code)
    from ranked r where r.base + case when r.rn <= r.remainder then 1 else 0 end > 0;
  end if;
  perform set_config('app.returns_write', 'off', true);

  select coalesce(sum(case when rp.direction = 'CHARGE' then rp.amount_cents else -rp.amount_cents end), 0)
  into v_cash_net from public.return_payments rp join public.payment_methods pm on pm.code = rp.method_code
  where rp.return_id = v_return.id and pm.kind = 'CASH';
  if v_cash_net <> 0 then
    perform set_config('app.cash_write', 'on', true);
    insert into public.cash_movements(session_id, location_id, movement_type, amount_cents,
      reason, reference_type, reference_id, user_id, metadata)
    values (v_session.id, v_session.location_id, 'RETURN', v_cash_net, btrim(p_reason),
      'RETURN', v_return.id::text, v_actor,
      jsonb_build_object('folio', v_return.folio, 'original_sale_id', v_sale.id));
    perform set_config('app.cash_write', 'off', true);
  end if;
  update app.supervisor_authorizations set used_at = now(), resource_id = v_return.id
  where id = v_authorization.id;
  update public.idempotency_keys set resource_id = v_return.id where key = p_idempotency_key;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, after_data, metadata)
  values (v_actor, case when v_type = 'RETURN' then 'return.created' else 'exchange.created' end,
    'returns', v_return.id::text, v_return.location_id, to_jsonb(v_return),
    jsonb_build_object('original_sale_id', v_sale.id, 'authorization_id', v_authorization.id,
      'refund_same_method', v_refund_total > 0, 'items_in', jsonb_array_length(p_items_in),
      'items_out', jsonb_array_length(coalesce(p_items_out, '[]'))));
  return jsonb_build_object('id', v_return.id, 'folio', v_return.folio, 'type', v_return.type,
    'returned_cents', v_return.returned_cents, 'delivered_cents', v_return.delivered_cents,
    'difference_cents', v_return.difference_cents,
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('direction', rp.direction,
      'method_code', rp.method_code, 'amount_cents', rp.amount_cents, 'reference', rp.reference)), '[]'::jsonb)
      from public.return_payments rp where rp.return_id = v_return.id));
end;
$$;

revoke execute on function public.get_return_policy(uuid), public.update_return_policy(uuid, integer),
  public.reset_employee_supervisor_pin(uuid, text),
  public.search_exchange_variants(text, uuid, integer),
  public.create_return_exchange(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid, text)
from public, anon;
grant execute on function public.get_return_policy(uuid), public.update_return_policy(uuid, integer),
  public.reset_employee_supervisor_pin(uuid, text),
  public.search_exchange_variants(text, uuid, integer),
  public.create_return_exchange(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid, text)
to authenticated, service_role;

commit;
