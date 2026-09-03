begin;

-- M4: ventas y caja. Todo importe monetario se guarda en centavos enteros.
create table public.payment_methods (
  code text primary key check (code = upper(btrim(code)) and btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('CASH', 'CARD', 'TRANSFER', 'OTHER')),
  requires_reference boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

insert into public.payment_methods (code, name, kind, requires_reference, sort_order) values
  ('CASH', 'Efectivo', 'CASH', false, 10),
  ('CARD', 'Tarjeta', 'CARD', true, 20),
  ('TRANSFER', 'Transferencia', 'TRANSFER', true, 30);

create table public.cash_registers (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  code text not null check (code = upper(btrim(code)) and btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, code)
);
create index cash_registers_location_active_idx
  on public.cash_registers (location_id, name) where is_active;

insert into public.cash_registers (location_id, code, name)
select id, 'CAJA01', 'Caja 01'
from public.locations
where type = 'STORE'
on conflict (location_id, code) do nothing;

create table public.cash_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  register_id uuid not null references public.cash_registers(id),
  location_id uuid not null references public.locations(id),
  cashier_user_id uuid not null references public.app_users(id),
  opened_by uuid not null references public.app_users(id),
  closed_by uuid references public.app_users(id),
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  opening_amount_cents bigint not null check (opening_amount_cents >= 0),
  counted_amount_cents bigint check (counted_amount_cents >= 0),
  expected_amount_cents bigint check (expected_amount_cents >= 0),
  difference_cents bigint,
  difference_reason text check (difference_reason is null or length(btrim(difference_reason)) between 3 and 500),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint cash_session_close_complete check (
    (status = 'OPEN' and closed_by is null and closed_at is null and counted_amount_cents is null and expected_amount_cents is null and difference_cents is null)
    or
    (status = 'CLOSED' and closed_by is not null and closed_at is not null and counted_amount_cents is not null and expected_amount_cents is not null and difference_cents = counted_amount_cents - expected_amount_cents)
  )
);
create unique index cash_sessions_one_open_register_idx
  on public.cash_sessions (register_id) where status = 'OPEN';
create unique index cash_sessions_one_open_cashier_idx
  on public.cash_sessions (cashier_user_id) where status = 'OPEN';
create index cash_sessions_location_opened_idx
  on public.cash_sessions (location_id, opened_at desc);
create index cash_sessions_cashier_opened_idx
  on public.cash_sessions (cashier_user_id, opened_at desc);

create table public.cash_movements (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.cash_sessions(id),
  location_id uuid not null references public.locations(id),
  movement_type text not null check (movement_type in ('OPENING', 'SALE', 'DEPOSIT', 'WITHDRAWAL', 'CLOSING')),
  amount_cents bigint not null check (amount_cents <> 0 or movement_type = 'OPENING'),
  reason text,
  reference_type text not null check (btrim(reference_type) <> ''),
  reference_id text not null check (btrim(reference_id) <> ''),
  user_id uuid not null references public.app_users(id),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  constraint cash_manual_reason_required check (
    movement_type not in ('DEPOSIT', 'WITHDRAWAL') or length(btrim(coalesce(reason, ''))) between 3 and 500
  ),
  unique (movement_type, reference_type, reference_id, session_id)
);
create index cash_movements_session_occurred_idx
  on public.cash_movements (session_id, occurred_at desc, id desc);
create index cash_movements_location_occurred_idx
  on public.cash_movements (location_id, occurred_at desc, id desc);
create index cash_movements_user_idx on public.cash_movements (user_id, occurred_at desc);

create table public.folios (
  location_id uuid not null references public.locations(id),
  document_type text not null check (document_type in ('SALE')),
  next_number bigint not null default 1 check (next_number > 0),
  primary key (location_id, document_type)
);

create table public.sales (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  cash_session_id uuid not null references public.cash_sessions(id),
  cashier_user_id uuid not null references public.app_users(id),
  customer_id uuid references public.customers(id),
  folio_number bigint not null check (folio_number > 0),
  folio text not null check (btrim(folio) <> ''),
  status text not null default 'COMPLETED' check (status in ('COMPLETED', 'CANCELLED')),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  item_discount_cents bigint not null default 0 check (item_discount_cents >= 0),
  ticket_discount_cents bigint not null default 0 check (ticket_discount_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  notes text check (notes is null or length(notes) <= 500),
  sold_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.app_users(id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  unique (location_id, folio_number),
  unique (folio),
  constraint sales_totals_balance check (total_cents = subtotal_cents - item_discount_cents - ticket_discount_cents),
  constraint sales_cancellation_complete check (
    (status = 'COMPLETED' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or
    (status = 'CANCELLED' and cancelled_at is not null and cancelled_by is not null and length(btrim(cancellation_reason)) >= 3)
  )
);
create index sales_location_sold_idx on public.sales (location_id, sold_at desc, id);
create index sales_session_sold_idx on public.sales (cash_session_id, sold_at desc, id);
create index sales_cashier_sold_idx on public.sales (cashier_user_id, sold_at desc, id);
create index sales_customer_sold_idx on public.sales (customer_id, sold_at desc) where customer_id is not null;

create table public.sale_items (
  id uuid primary key default extensions.gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  line_number integer not null check (line_number > 0),
  variant_id uuid not null references public.variants(id),
  product_name text not null check (btrim(product_name) <> ''),
  sku text not null check (btrim(sku) <> ''),
  variant_description text not null default '',
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  unit_cost_cents bigint not null check (unit_cost_cents >= 0),
  gross_cents bigint not null check (gross_cents >= 0),
  item_discount_cents bigint not null default 0 check (item_discount_cents >= 0),
  ticket_discount_cents bigint not null default 0 check (ticket_discount_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  gift_receipt boolean not null default false,
  unique (sale_id, line_number),
  constraint sale_item_total_balance check (
    gross_cents = round(quantity * unit_price_cents)::bigint
    and line_total_cents = gross_cents - item_discount_cents
    and ticket_discount_cents <= line_total_cents
  )
);
create index sale_items_sale_idx on public.sale_items (sale_id, line_number);
create index sale_items_variant_idx on public.sale_items (variant_id, sale_id);

create table public.sale_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  method_code text not null references public.payment_methods(code),
  amount_cents bigint not null check (amount_cents > 0),
  tendered_cents bigint check (tendered_cents is null or tendered_cents >= amount_cents),
  change_cents bigint not null default 0 check (change_cents >= 0),
  reference text,
  created_at timestamptz not null default now(),
  constraint sale_payment_cash_fields check (
    (method_code = 'CASH' and tendered_cents is not null and change_cents = tendered_cents - amount_cents)
    or
    (method_code <> 'CASH' and tendered_cents is null and change_cents = 0)
  )
);
create index sale_payments_sale_idx on public.sale_payments (sale_id);
create index sale_payments_method_created_idx on public.sale_payments (method_code, created_at desc);

create table public.applied_discounts (
  id uuid primary key default extensions.gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  sale_item_id uuid references public.sale_items(id),
  scope text not null check (scope in ('ITEM', 'TICKET')),
  discount_type text not null check (discount_type in ('AMOUNT', 'PERCENT')),
  requested_value numeric(12,3) not null check (requested_value > 0),
  amount_cents bigint not null check (amount_cents > 0),
  authorized_by uuid not null references public.app_users(id),
  authorization_id uuid not null,
  reason text check (reason is null or length(reason) <= 300),
  created_at timestamptz not null default now(),
  constraint discount_scope_item check (
    (scope = 'ITEM' and sale_item_id is not null) or (scope = 'TICKET' and sale_item_id is null)
  )
);
create index applied_discounts_sale_idx on public.applied_discounts (sale_id);
create index applied_discounts_authorizer_idx on public.applied_discounts (authorized_by, created_at desc);

create table public.idempotency_keys (
  key uuid primary key,
  actor_user_id uuid not null references public.app_users(id),
  operation text not null check (operation in ('CREATE_SALE')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  resource_id uuid,
  created_at timestamptz not null default now()
);
create index idempotency_actor_created_idx on public.idempotency_keys (actor_user_id, created_at desc);

create table app.supervisor_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid not null references public.app_users(id),
  supervisor_user_id uuid not null references public.app_users(id),
  permission_code text not null references public.permissions(code),
  expires_at timestamptz not null,
  used_at timestamptz,
  resource_id uuid,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
alter table public.applied_discounts
  add constraint applied_discounts_authorization_fkey
  foreign key (authorization_id) references app.supervisor_authorizations(id);
create index supervisor_authorizations_actor_active_idx
  on app.supervisor_authorizations (actor_user_id, permission_code, expires_at)
  where used_at is null;

create table public.print_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  requested_by uuid not null references public.app_users(id),
  document_type text not null check (document_type in ('SALE_RECEIPT', 'GIFT_RECEIPT')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PRINTED', 'FAILED')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  last_error text,
  requested_at timestamptz not null default now(),
  printed_at timestamptz
);
create index print_jobs_sale_requested_idx on public.print_jobs (sale_id, requested_at desc);
create index print_jobs_pending_idx on public.print_jobs (requested_at) where status = 'PENDING';

create or replace function app.guard_sales_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('app.sales_write', true) is distinct from 'on' then
    raise exception 'SALES_LEDGER_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app.guard_cash_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('app.cash_write', true) is distinct from 'on' then
    raise exception 'CASH_LEDGER_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger sales_guard before insert or update or delete on public.sales
for each row execute function app.guard_sales_ledger();
create trigger sale_items_guard before insert or update or delete on public.sale_items
for each row execute function app.guard_sales_ledger();
create trigger sale_payments_guard before insert or update or delete on public.sale_payments
for each row execute function app.guard_sales_ledger();
create trigger discounts_guard before insert or update or delete on public.applied_discounts
for each row execute function app.guard_sales_ledger();
create trigger cash_sessions_guard before insert or update or delete on public.cash_sessions
for each row execute function app.guard_cash_ledger();
create trigger cash_movements_guard before insert or update or delete on public.cash_movements
for each row execute function app.guard_cash_ledger();

create or replace function app.check_sale_payment_balance()
returns trigger language plpgsql set search_path = '' as $$
declare v_sale_id uuid := coalesce(new.sale_id, old.sale_id); v_total bigint; v_paid bigint;
begin
  select total_cents into v_total from public.sales where id = v_sale_id;
  select coalesce(sum(amount_cents), 0) into v_paid from public.sale_payments where sale_id = v_sale_id;
  if v_total is not null and v_paid <> v_total then
    raise exception 'PAYMENT_TOTAL_MISMATCH' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create constraint trigger sale_payments_balance
after insert or update or delete on public.sale_payments
deferrable initially deferred for each row execute function app.check_sale_payment_balance();

create trigger cash_registers_touch_updated_at before update on public.cash_registers
for each row execute function app.touch_updated_at();

-- El PIN genera una capacidad corta, ligada al cajero y consumible una sola vez.
create or replace function public.verify_supervisor_pin(
  p_employee_code text,
  p_pin text,
  p_permission text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_user public.app_users;
  v_locked_until timestamptz;
  v_authorization_id uuid;
begin
  if v_actor is null then return jsonb_build_object('status', 'NOT_AUTHENTICATED'); end if;
  if p_permission is null or not exists (select 1 from public.permissions where code = p_permission) then
    return jsonb_build_object('status', 'INVALID_PERMISSION');
  end if;
  select * into v_user from public.app_users
  where employee_code = upper(btrim(p_employee_code)) and is_active for update;
  if not found then perform pg_sleep(0.5); return jsonb_build_object('status', 'INVALID_CREDENTIALS'); end if;
  if v_user.pin_locked_until is not null and v_user.pin_locked_until > now() then
    perform pg_sleep(0.5);
    return jsonb_build_object('status', 'PIN_LOCKED', 'locked_until', v_user.pin_locked_until);
  end if;
  if v_user.supervisor_pin_hash is null or extensions.crypt(p_pin, v_user.supervisor_pin_hash) <> v_user.supervisor_pin_hash then
    perform pg_sleep(0.5);
    v_locked_until := case when v_user.pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes' end;
    update public.app_users set pin_failed_attempts = pin_failed_attempts + 1, pin_locked_until = v_locked_until where id = v_user.id;
    insert into public.audit_log (actor_user_id, action, entity_type, entity_id, metadata)
    values (v_actor, 'supervisor_pin.failed', 'app_users', v_user.id::text, jsonb_build_object('permission', p_permission, 'locked', v_locked_until is not null));
    return jsonb_build_object('status', 'INVALID_CREDENTIALS');
  end if;
  if not exists (select 1 from public.role_permissions where role_id = v_user.role_id and permission_code = p_permission)
     or not exists (
       select 1 from public.user_locations actor_location
       join public.user_locations supervisor_location using (location_id)
       where actor_location.user_id = v_actor and supervisor_location.user_id = v_user.id
     ) then
    insert into public.audit_log (actor_user_id, action, entity_type, entity_id, metadata)
    values (v_actor, 'supervisor_pin.denied', 'app_users', v_user.id::text, jsonb_build_object('permission', p_permission));
    return jsonb_build_object('status', 'INSUFFICIENT_PERMISSION');
  end if;
  update public.app_users set pin_failed_attempts = 0, pin_locked_until = null where id = v_user.id;
  insert into app.supervisor_authorizations (actor_user_id, supervisor_user_id, permission_code, expires_at)
  values (v_actor, v_user.id, p_permission, now() + interval '5 minutes') returning id into v_authorization_id;
  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'supervisor_pin.authorized', 'app_users', v_user.id::text,
    jsonb_build_object('permission', p_permission, 'authorization_id', v_authorization_id));
  return jsonb_build_object('status', 'AUTHORIZED', 'supervisor_user_id', v_user.id,
    'authorization_token', v_authorization_id, 'expires_at', now() + interval '5 minutes');
end;
$$;

create or replace function public.list_cash_registers(p_location_id uuid)
returns table (id uuid, code text, name text, is_active boolean, open_session_id uuid, cashier_name text, opened_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if (select app.current_user_id()) is null or not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  return query select r.id, r.code, r.name, r.is_active, s.id, u.full_name, s.opened_at
  from public.cash_registers r
  left join public.cash_sessions s on s.register_id = r.id and s.status = 'OPEN'
  left join public.app_users u on u.id = s.cashier_user_id
  where r.location_id = p_location_id order by r.name;
end;
$$;

create or replace function public.create_cash_register(p_location_id uuid, p_code text, p_name text)
returns public.cash_registers
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_row public.cash_registers;
begin
  if v_actor is null or not (select app.has_perm('locations.manage')) or not (select app.can_access_location(p_location_id)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_code,'')), '') is null or length(p_code) > 30
     or nullif(btrim(coalesce(p_name,'')), '') is null or length(p_name) > 80 then
    raise exception 'INVALID_REGISTER' using errcode = '22023';
  end if;
  insert into public.cash_registers(location_id, code, name, created_by)
  values (p_location_id, upper(btrim(p_code)), btrim(p_name), v_actor) returning * into v_row;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, after_data)
  values (v_actor, 'cash_register.created', 'cash_registers', v_row.id::text, p_location_id, to_jsonb(v_row));
  return v_row;
end;
$$;

create or replace function public.open_cash_session(p_register_id uuid, p_opening_amount_cents bigint)
returns public.cash_sessions
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_register public.cash_registers; v_session public.cash_sessions;
begin
  if v_actor is null or not (select app.has_perm('cash.open')) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_opening_amount_cents is null or p_opening_amount_cents < 0 or p_opening_amount_cents > 100000000 then
    raise exception 'INVALID_OPENING_AMOUNT' using errcode = '22023';
  end if;
  select * into v_register from public.cash_registers where id = p_register_id and is_active for update;
  if not found or not (select app.can_access_location(v_register.location_id)) then raise exception 'REGISTER_FORBIDDEN' using errcode = '42501'; end if;
  perform set_config('app.cash_write', 'on', true);
  insert into public.cash_sessions(register_id, location_id, cashier_user_id, opened_by, opening_amount_cents)
  values (v_register.id, v_register.location_id, v_actor, v_actor, p_opening_amount_cents) returning * into v_session;
  insert into public.cash_movements(session_id, location_id, movement_type, amount_cents, reference_type, reference_id, user_id)
  values (v_session.id, v_session.location_id, 'OPENING', p_opening_amount_cents, 'CASH_SESSION', v_session.id::text, v_actor);
  perform set_config('app.cash_write', 'off', true);
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, location_id, after_data)
  values (v_actor, 'cash_session.opened', 'cash_sessions', v_session.id::text, v_session.location_id,
    jsonb_build_object('register_id', v_register.id, 'opening_amount_cents', p_opening_amount_cents));
  return v_session;
exception when unique_violation then
  raise exception 'REGISTER_OR_CASHIER_ALREADY_OPEN' using errcode = '23505';
end;
$$;

create or replace function public.get_my_cash_session()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_result jsonb;
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  select jsonb_build_object(
    'id', s.id, 'register_id', r.id, 'register_code', r.code, 'register_name', r.name,
    'location_id', s.location_id, 'status', s.status, 'opening_amount_cents', s.opening_amount_cents,
    'opened_at', s.opened_at,
    'sales_count', (select count(*) from public.sales x where x.cash_session_id = s.id and x.status = 'COMPLETED'),
    'sales_total_cents', (select coalesce(sum(x.total_cents),0) from public.sales x where x.cash_session_id = s.id and x.status = 'COMPLETED'),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('method_code', q.method_code, 'count', q.qty, 'amount_cents', q.amount)), '[]'::jsonb)
      from (select p.method_code, count(*) qty, sum(p.amount_cents) amount from public.sale_payments p join public.sales x on x.id=p.sale_id where x.cash_session_id=s.id and x.status='COMPLETED' group by p.method_code) q),
    'manual_movements', (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'type',m.movement_type,'amount_cents',m.amount_cents,'reason',m.reason,'occurred_at',m.occurred_at) order by m.occurred_at desc), '[]'::jsonb)
      from public.cash_movements m where m.session_id=s.id and m.movement_type in ('DEPOSIT','WITHDRAWAL'))
  ) into v_result
  from public.cash_sessions s join public.cash_registers r on r.id=s.register_id
  where s.cashier_user_id=v_actor and s.status='OPEN';
  return v_result;
end;
$$;

create or replace function public.record_cash_movement(p_session_id uuid, p_type text, p_amount_cents bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_session public.cash_sessions; v_id bigint; v_expected bigint;
begin
  if v_actor is null or not (select app.has_perm('cash.movement')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if p_type not in ('DEPOSIT','WITHDRAWAL') or p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000
     or length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_CASH_MOVEMENT' using errcode='22023'; end if;
  select * into v_session from public.cash_sessions where id=p_session_id and status='OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor or not (select app.can_access_location(v_session.location_id)) then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
  select coalesce(sum(amount_cents),0) into v_expected from public.cash_movements where session_id=p_session_id;
  if p_type='WITHDRAWAL' and p_amount_cents>v_expected then raise exception 'INSUFFICIENT_CASH' using errcode='P0001'; end if;
  perform set_config('app.cash_write','on',true);
  insert into public.cash_movements(session_id,location_id,movement_type,amount_cents,reason,reference_type,reference_id,user_id)
  values(v_session.id,v_session.location_id,p_type,case when p_type='WITHDRAWAL' then -p_amount_cents else p_amount_cents end,btrim(p_reason),'MANUAL',extensions.gen_random_uuid()::text,v_actor)
  returning id into v_id;
  perform set_config('app.cash_write','off',true);
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,metadata)
  values(v_actor,'cash_movement.created','cash_movements',v_id::text,v_session.location_id,jsonb_build_object('type',p_type,'amount_cents',p_amount_cents,'reason',btrim(p_reason)));
  return v_id;
end;
$$;

create or replace function public.close_cash_session(p_session_id uuid, p_counted_amount_cents bigint, p_difference_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_session public.cash_sessions; v_expected bigint; v_difference bigint;
begin
  if v_actor is null or not (select app.has_perm('cash.close')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if p_counted_amount_cents is null or p_counted_amount_cents < 0 or p_counted_amount_cents > 100000000 then raise exception 'INVALID_COUNTED_AMOUNT' using errcode='22023'; end if;
  select * into v_session from public.cash_sessions where id=p_session_id and status='OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor or not (select app.can_access_location(v_session.location_id)) then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
  select coalesce(sum(amount_cents),0) into v_expected from public.cash_movements where session_id=p_session_id;
  v_difference := p_counted_amount_cents - v_expected;
  if v_difference <> 0 and length(btrim(coalesce(p_difference_reason,''))) not between 3 and 500 then raise exception 'DIFFERENCE_REASON_REQUIRED' using errcode='22023'; end if;
  perform set_config('app.cash_write','on',true);
  update public.cash_sessions set status='CLOSED',closed_by=v_actor,closed_at=now(),counted_amount_cents=p_counted_amount_cents,
    expected_amount_cents=v_expected,difference_cents=v_difference,difference_reason=nullif(btrim(coalesce(p_difference_reason,'')),'') where id=p_session_id;
  perform set_config('app.cash_write','off',true);
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,metadata)
  values(v_actor,'cash_session.closed','cash_sessions',p_session_id::text,v_session.location_id,jsonb_build_object('expected_amount_cents',v_expected,'counted_amount_cents',p_counted_amount_cents,'difference_cents',v_difference,'reason',p_difference_reason));
  return jsonb_build_object('status','CLOSED','expected_amount_cents',v_expected,'counted_amount_cents',p_counted_amount_cents,'difference_cents',v_difference);
end;
$$;

create or replace function public.create_sale(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid default null,
  p_discounts jsonb default '[]'::jsonb,
  p_notes text default null
)
returns public.sales
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select app.current_user_id()); v_session public.cash_sessions; v_sale public.sales;
  v_hash text; v_existing public.idempotency_keys; v_item jsonb; v_payment jsonb; v_discount jsonb;
  v_variant public.variants; v_product public.products; v_line integer := 0; v_qty numeric(12,3); v_gross bigint;
  v_item_discount bigint; v_subtotal bigint := 0; v_item_discounts bigint := 0; v_ticket_discount bigint := 0;
  v_after_items bigint; v_paid bigint := 0; v_folio bigint; v_method public.payment_methods;
  v_authorization app.supervisor_authorizations; v_authorization_token uuid; v_has_discount boolean := false;
  v_sale_item_id uuid; v_discount_type text; v_discount_value numeric; v_amount bigint;
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode='28000'; end if;
  if not (select app.has_perm('pos.sell')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  if p_idempotency_key is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100
     or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) not between 1 and 10
     or jsonb_typeof(coalesce(p_discounts,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_discounts,'[]'::jsonb)) > 101
     or length(coalesce(p_notes,'')) > 500 then raise exception 'INVALID_SALE_REQUEST' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) i group by i->>'variant_id' having count(*)>1) then raise exception 'DUPLICATE_VARIANT' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_payments) i group by i->>'method_code' having count(*)>1) then raise exception 'DUPLICATE_PAYMENT_METHOD' using errcode='22023'; end if;

  v_hash := encode(extensions.digest(convert_to(jsonb_build_object('session',p_cash_session_id,'items',p_items,'payments',p_payments,'customer',p_customer_id,'discounts',coalesce(p_discounts,'[]'::jsonb),'notes',p_notes)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('create_sale:'||p_idempotency_key::text,0));
  select * into v_existing from public.idempotency_keys where key=p_idempotency_key;
  if found then
    if v_existing.actor_user_id <> v_actor or v_existing.request_hash <> v_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    if v_existing.resource_id is null then raise exception 'IDEMPOTENCY_IN_PROGRESS' using errcode='40001'; end if;
    select * into v_sale from public.sales where id=v_existing.resource_id; return v_sale;
  end if;
  insert into public.idempotency_keys(key,actor_user_id,operation,request_hash) values(p_idempotency_key,v_actor,'CREATE_SALE',v_hash);

  select * into v_session from public.cash_sessions where id=p_cash_session_id and status='OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor or not (select app.can_access_location(v_session.location_id)) then raise exception 'SESSION_FORBIDDEN' using errcode='42501'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and not is_anonymized) then raise exception 'CUSTOMER_NOT_FOUND' using errcode='22023'; end if;

  v_has_discount := jsonb_array_length(coalesce(p_discounts,'[]'::jsonb)) > 0;
  if v_has_discount then
    begin v_authorization_token := (p_discounts->0->>'authorization_token')::uuid; exception when others then raise exception 'DISCOUNT_AUTHORIZATION_REQUIRED' using errcode='42501'; end;
    select * into v_authorization from app.supervisor_authorizations
    where id=v_authorization_token and actor_user_id=v_actor and permission_code='sales.discount' and used_at is null and expires_at>now() for update;
    if not found then raise exception 'DISCOUNT_AUTHORIZATION_INVALID' using errcode='42501'; end if;
  end if;

  -- Orden estable para que dos cajas que venden las mismas variantes no entren en deadlock.
  perform pg_advisory_xact_lock(hashtextextended('sale-stock:'||(i->>'variant_id'),0))
  from jsonb_array_elements(p_items) i order by i->>'variant_id';

  insert into public.folios(location_id,document_type,next_number) values(v_session.location_id,'SALE',2)
  on conflict(location_id,document_type) do update set next_number=public.folios.next_number+1
  returning next_number-1 into v_folio;

  perform set_config('app.sales_write','on',true);
  insert into public.sales(location_id,cash_session_id,cashier_user_id,customer_id,folio_number,folio,subtotal_cents,item_discount_cents,ticket_discount_cents,total_cents,notes)
  values(v_session.location_id,v_session.id,v_actor,p_customer_id,v_folio,
    (select code from public.locations where id=v_session.location_id)||'-V-'||lpad(v_folio::text,6,'0'),0,0,0,0,nullif(btrim(coalesce(p_notes,'')),'')) returning * into v_sale;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line+1;
    begin v_qty := (v_item->>'quantity')::numeric; exception when others then raise exception 'INVALID_ITEM' using errcode='22023'; end;
    if v_qty is null or v_qty<=0 or v_qty>999999999.999 then raise exception 'INVALID_ITEM' using errcode='22023'; end if;
    select v.* into v_variant from public.variants v join public.products p on p.id=v.product_id
    where v.id=(v_item->>'variant_id')::uuid and v.is_active and p.is_active for update of v;
    if not found then raise exception 'VARIANT_NOT_SELLABLE' using errcode='22023'; end if;
    select * into v_product from public.products where id=v_variant.product_id;
    v_gross := round(v_qty*v_variant.price_cents)::bigint; v_item_discount:=0;
    select d into v_discount from jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d
    where d->>'scope'='ITEM' and (d->>'line_number')::integer=v_line limit 1;
    if found then
      v_discount_type:=v_discount->>'type'; begin v_discount_value:=(v_discount->>'value')::numeric; exception when others then raise exception 'INVALID_DISCOUNT' using errcode='22023'; end;
      if v_discount_type='AMOUNT' then v_item_discount:=round(v_discount_value)::bigint;
      elsif v_discount_type='PERCENT' and v_discount_value>0 and v_discount_value<=100 then v_item_discount:=round(v_gross*v_discount_value/100)::bigint;
      else raise exception 'INVALID_DISCOUNT' using errcode='22023'; end if;
      if v_item_discount<=0 or v_item_discount>v_gross then raise exception 'INVALID_DISCOUNT' using errcode='22023'; end if;
    end if;
    insert into public.sale_items(sale_id,line_number,variant_id,product_name,sku,variant_description,quantity,unit_price_cents,unit_cost_cents,gross_cents,item_discount_cents,line_total_cents,gift_receipt)
    values(v_sale.id,v_line,v_variant.id,v_product.name,v_variant.sku,'',v_qty,v_variant.price_cents,v_variant.cost_cents,v_gross,v_item_discount,v_gross-v_item_discount,coalesce((v_item->>'gift_receipt')::boolean,false)) returning id into v_sale_item_id;
    if v_item_discount>0 then
      insert into public.applied_discounts(sale_id,sale_item_id,scope,discount_type,requested_value,amount_cents,authorized_by,authorization_id,reason)
      values(v_sale.id,v_sale_item_id,'ITEM',v_discount_type,v_discount_value,v_item_discount,v_authorization.supervisor_user_id,v_authorization.id,v_discount->>'reason');
    end if;
    v_subtotal:=v_subtotal+v_gross; v_item_discounts:=v_item_discounts+v_item_discount;
  end loop;

  v_after_items:=v_subtotal-v_item_discounts;
  if (select count(*) from jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d where d->>'scope'='TICKET') > 1 then raise exception 'MULTIPLE_TICKET_DISCOUNTS_NOT_SUPPORTED' using errcode='22023'; end if;
  select d into v_discount from jsonb_array_elements(coalesce(p_discounts,'[]'::jsonb)) d where d->>'scope'='TICKET' limit 1;
  if found then
    v_discount_type:=v_discount->>'type'; begin v_discount_value:=(v_discount->>'value')::numeric; exception when others then raise exception 'INVALID_DISCOUNT' using errcode='22023'; end;
    if v_discount_type='AMOUNT' then v_ticket_discount:=round(v_discount_value)::bigint;
    elsif v_discount_type='PERCENT' and v_discount_value>0 and v_discount_value<=100 then v_ticket_discount:=round(v_after_items*v_discount_value/100)::bigint;
    else raise exception 'INVALID_DISCOUNT' using errcode='22023'; end if;
    if v_ticket_discount<=0 or v_ticket_discount>v_after_items then raise exception 'INVALID_DISCOUNT' using errcode='22023'; end if;
    insert into public.applied_discounts(sale_id,scope,discount_type,requested_value,amount_cents,authorized_by,authorization_id,reason)
    values(v_sale.id,'TICKET',v_discount_type,v_discount_value,v_ticket_discount,v_authorization.supervisor_user_id,v_authorization.id,v_discount->>'reason');
    -- Largest remainder: reparte cada centavo exactamente y de forma determinista.
    with shares as (
      select id,line_number,line_total_cents,
        floor(line_total_cents::numeric*v_ticket_discount/nullif(v_after_items,0))::bigint base,
        (line_total_cents::numeric*v_ticket_discount/nullif(v_after_items,0))-floor(line_total_cents::numeric*v_ticket_discount/nullif(v_after_items,0)) fraction
      from public.sale_items where sale_id=v_sale.id
    ), ranked as (
      select *,row_number() over(order by fraction desc,line_number) rn,
        v_ticket_discount-sum(base) over() remaining from shares
    )
    update public.sale_items si set ticket_discount_cents=r.base+case when r.rn<=r.remaining then 1 else 0 end
    from ranked r where si.id=r.id;
  end if;
  if v_after_items-v_ticket_discount<=0 then raise exception 'SALE_TOTAL_MUST_BE_POSITIVE' using errcode='22023'; end if;

  update public.sales set subtotal_cents=v_subtotal,item_discount_cents=v_item_discounts,ticket_discount_cents=v_ticket_discount,total_cents=v_after_items-v_ticket_discount where id=v_sale.id returning * into v_sale;

  for v_payment in select value from jsonb_array_elements(p_payments) loop
    begin v_amount:=(v_payment->>'amount_cents')::bigint; exception when others then raise exception 'INVALID_PAYMENT' using errcode='22023'; end;
    select * into v_method from public.payment_methods where code=upper(v_payment->>'method_code') and is_active;
    if not found or v_amount is null or v_amount<=0 then raise exception 'INVALID_PAYMENT' using errcode='22023'; end if;
    if v_method.requires_reference and length(btrim(coalesce(v_payment->>'reference',''))) < 3 then raise exception 'PAYMENT_REFERENCE_REQUIRED' using errcode='22023'; end if;
    if v_method.kind='CASH' then
      if coalesce((v_payment->>'tendered_cents')::bigint,-1)<v_amount then raise exception 'INSUFFICIENT_CASH_TENDERED' using errcode='22023'; end if;
      insert into public.sale_payments(sale_id,method_code,amount_cents,tendered_cents,change_cents,reference)
      values(v_sale.id,v_method.code,v_amount,(v_payment->>'tendered_cents')::bigint,(v_payment->>'tendered_cents')::bigint-v_amount,null);
    else
      insert into public.sale_payments(sale_id,method_code,amount_cents,reference) values(v_sale.id,v_method.code,v_amount,btrim(v_payment->>'reference'));
    end if;
    v_paid:=v_paid+v_amount;
  end loop;
  if v_paid<>v_sale.total_cents then raise exception 'PAYMENT_TOTAL_MISMATCH' using errcode='23514'; end if;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'variant_id' loop
    perform app.apply_movement((v_item->>'variant_id')::uuid,v_session.location_id,'SALE',-((v_item->>'quantity')::numeric),'SALE',v_sale.id::text,jsonb_build_object('folio',v_sale.folio));
  end loop;

  perform set_config('app.cash_write','on',true);
  insert into public.cash_movements(session_id,location_id,movement_type,amount_cents,reference_type,reference_id,user_id,metadata)
  select v_session.id,v_session.location_id,'SALE',sum(p.amount_cents),'SALE',v_sale.id::text,v_actor,jsonb_build_object('folio',v_sale.folio)
  from public.sale_payments p join public.payment_methods m on m.code=p.method_code where p.sale_id=v_sale.id and m.kind='CASH' having sum(p.amount_cents)>0;
  perform set_config('app.cash_write','off',true);
  if v_has_discount then update app.supervisor_authorizations set used_at=now(),resource_id=v_sale.id where id=v_authorization.id; end if;
  update public.idempotency_keys set resource_id=v_sale.id where key=p_idempotency_key;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,location_id,after_data,metadata)
  values(v_actor,'sale.created','sales',v_sale.id::text,v_session.location_id,to_jsonb(v_sale),jsonb_build_object('item_count',jsonb_array_length(p_items),'payment_count',jsonb_array_length(p_payments)));
  perform set_config('app.sales_write','off',true);
  return v_sale;
end;
$$;

create or replace function public.get_sale_receipt(p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select app.current_user_id()); v_result jsonb;
begin
  if v_actor is null or not (select app.has_perm('pos.sell')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
  select jsonb_build_object(
    'id',s.id,'folio',s.folio,'status',s.status,'sold_at',s.sold_at,'subtotal_cents',s.subtotal_cents,
    'discount_cents',s.item_discount_cents+s.ticket_discount_cents,'total_cents',s.total_cents,'notes',s.notes,
    'cashier_name',u.full_name,'customer_id',s.customer_id,
    'location',jsonb_build_object('name',l.name,'address',l.address,'phone',l.phone,'legal_name',l.legal_name,'tax_id',l.tax_id),
    'items',(select jsonb_agg(jsonb_build_object('line_number',i.line_number,'product_name',i.product_name,'sku',i.sku,'variant_description',i.variant_description,'quantity',i.quantity,'unit_price_cents',i.unit_price_cents,'discount_cents',i.item_discount_cents+i.ticket_discount_cents,'line_total_cents',i.line_total_cents-i.ticket_discount_cents,'gift_receipt',i.gift_receipt) order by i.line_number) from public.sale_items i where i.sale_id=s.id),
    'payments',(select jsonb_agg(jsonb_build_object('method_code',p.method_code,'method_name',m.name,'amount_cents',p.amount_cents,'tendered_cents',p.tendered_cents,'change_cents',p.change_cents,'reference',p.reference) order by m.sort_order) from public.sale_payments p join public.payment_methods m on m.code=p.method_code where p.sale_id=s.id)
  ) into v_result
  from public.sales s join public.app_users u on u.id=s.cashier_user_id join public.locations l on l.id=s.location_id
  where s.id=p_sale_id and (select app.can_access_location(s.location_id));
  if v_result is null then raise exception 'SALE_NOT_FOUND' using errcode='22023'; end if;
  return v_result;
end;
$$;

alter table public.payment_methods enable row level security;
alter table public.cash_registers enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.folios enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.applied_discounts enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.print_jobs enable row level security;

create policy payment_methods_read on public.payment_methods for select to authenticated using (is_active);
create policy cash_registers_read on public.cash_registers for select to authenticated using ((select app.can_access_location(location_id)));
create policy cash_sessions_read on public.cash_sessions for select to authenticated using ((select app.can_access_location(location_id)) and ((select app.has_perm('cash.close')) or cashier_user_id=(select app.current_user_id())));
create policy cash_movements_read on public.cash_movements for select to authenticated using ((select app.can_access_location(location_id)) and ((select app.has_perm('cash.close')) or user_id=(select app.current_user_id())));
create policy sales_read on public.sales for select to authenticated using ((select app.can_access_location(location_id)) and ((select app.has_perm('reports.sales')) or cashier_user_id=(select app.current_user_id())));
create policy print_jobs_read on public.print_jobs for select to authenticated using (requested_by=(select app.current_user_id()));

revoke all on public.payment_methods,public.cash_registers,public.cash_sessions,public.cash_movements,public.folios,public.sales,public.sale_items,public.sale_payments,public.applied_discounts,public.idempotency_keys,public.print_jobs from public,anon,authenticated,service_role;
grant select on public.payment_methods,public.cash_registers,public.cash_sessions,public.cash_movements,public.sales,public.print_jobs to authenticated,service_role;
grant select,insert,update,delete on public.payment_methods,public.cash_registers,public.cash_sessions,public.cash_movements,public.folios,public.sales,public.sale_items,public.sale_payments,public.applied_discounts,public.idempotency_keys,public.print_jobs to service_role;
grant usage,select on sequence public.cash_movements_id_seq to service_role;

revoke execute on function app.guard_sales_ledger() from public,anon,authenticated,service_role;
revoke execute on function app.guard_cash_ledger() from public,anon,authenticated,service_role;
revoke execute on function app.check_sale_payment_balance() from public,anon,authenticated,service_role;
revoke all on table app.supervisor_authorizations from public,anon,authenticated,service_role;

revoke execute on function public.verify_supervisor_pin(text,text,text) from public,anon;
revoke execute on function public.list_cash_registers(uuid) from public,anon;
revoke execute on function public.create_cash_register(uuid,text,text) from public,anon;
revoke execute on function public.open_cash_session(uuid,bigint) from public,anon;
revoke execute on function public.get_my_cash_session() from public,anon;
revoke execute on function public.record_cash_movement(uuid,text,bigint,text) from public,anon;
revoke execute on function public.close_cash_session(uuid,bigint,text) from public,anon;
revoke execute on function public.create_sale(uuid,uuid,jsonb,jsonb,uuid,jsonb,text) from public,anon;
revoke execute on function public.get_sale_receipt(uuid) from public,anon;
grant execute on function public.verify_supervisor_pin(text,text,text),public.list_cash_registers(uuid),public.create_cash_register(uuid,text,text),public.open_cash_session(uuid,bigint),public.get_my_cash_session(),public.record_cash_movement(uuid,text,bigint,text),public.close_cash_session(uuid,bigint,text),public.create_sale(uuid,uuid,jsonb,jsonb,uuid,jsonb,text),public.get_sale_receipt(uuid) to authenticated,service_role;

commit;
