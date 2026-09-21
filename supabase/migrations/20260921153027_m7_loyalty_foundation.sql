begin;

-- M7.4 · Fundación del programa de lealtad.
--
-- La fecha de lanzamiento es una compuerta explícita. Crear las tablas no
-- otorga puntos a ventas históricas ni a las pruebas que ya existen.
create table public.loyalty_program_config (
  singleton boolean primary key default true check (singleton),
  is_enabled boolean not null default false,
  launched_at timestamptz,
  regular_earn_unit_cents integer not null default 10000
    check (regular_earn_unit_cents between 100 and 1000000),
  discounted_earn_unit_cents integer not null default 20000
    check (discounted_earn_unit_cents >= regular_earn_unit_cents),
  point_value_cents integer not null default 100
    check (point_value_cents between 1 and 10000),
  expiry_months integer not null default 12
    check (expiry_months between 1 and 60),
  redemption_code_minutes integer not null default 5
    check (redemption_code_minutes between 1 and 30),
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now(),
  constraint loyalty_launch_complete check (
    (not is_enabled) or launched_at is not null
  )
);

insert into public.loyalty_program_config(singleton) values (true);

create table public.loyalty_accounts (
  customer_id uuid primary key references public.customers(id),
  available_points integer not null default 0 check (available_points >= 0),
  points_debt integer not null default 0 check (points_debt >= 0),
  lifetime_earned integer not null default 0 check (lifetime_earned >= 0),
  lifetime_redeemed integer not null default 0 check (lifetime_redeemed >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.loyalty_point_lots (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.loyalty_accounts(customer_id),
  source_sale_id uuid not null references public.sales(id),
  source_return_item_id uuid references public.return_items(id),
  points_issued integer not null check (points_issued > 0),
  points_reversed integer not null default 0 check (points_reversed >= 0),
  points_remaining integer not null check (points_remaining >= 0),
  regular_eligible_cents bigint not null default 0
    check (regular_eligible_cents >= 0),
  discounted_eligible_cents bigint not null default 0
    check (discounted_eligible_cents >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint loyalty_lot_points_balance check (
    points_reversed <= points_issued
    and points_remaining <= points_issued - points_reversed
  ),
  unique (source_return_item_id)
);
create unique index loyalty_one_base_lot_per_sale_idx
  on public.loyalty_point_lots(source_sale_id)
  where source_return_item_id is null;
create index loyalty_lots_customer_expiry_idx
  on public.loyalty_point_lots(customer_id, expires_at, created_at, id)
  where points_remaining > 0;
create index loyalty_lots_sale_idx
  on public.loyalty_point_lots(source_sale_id, created_at, id);

create table public.loyalty_transactions (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.loyalty_accounts(customer_id),
  entry_type text not null check (entry_type in (
    'EARN', 'REDEEM', 'EXPIRE', 'RETURN_REVERSAL',
    'DEBT_SETTLEMENT', 'ADJUSTMENT'
  )),
  points_delta integer not null check (points_delta <> 0),
  balance_after integer not null,
  debt_after integer not null check (debt_after >= 0),
  reference_type text not null,
  reference_id text not null,
  location_id uuid references public.locations(id),
  actor_user_id uuid references public.app_users(id),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint loyalty_earn_expiry check (
    (entry_type = 'EARN' and expires_at is not null and points_delta > 0)
    or (entry_type <> 'EARN' and expires_at is null)
  )
);
create index loyalty_transactions_customer_date_idx
  on public.loyalty_transactions(customer_id, created_at desc, id);
create index loyalty_transactions_reference_idx
  on public.loyalty_transactions(reference_type, reference_id, created_at, id);

create table public.loyalty_redemption_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.loyalty_accounts(customer_id),
  code_hash text not null,
  requested_points integer not null check (requested_points > 0),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'CONSUMED', 'CANCELLED', 'EXPIRED')),
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references public.app_users(id),
  sale_id uuid references public.sales(id),
  created_at timestamptz not null default now(),
  constraint loyalty_code_consumption check (
    (status = 'CONSUMED' and consumed_at is not null and consumed_by is not null)
    or (status <> 'CONSUMED' and consumed_at is null and consumed_by is null and sale_id is null)
  )
);
create unique index loyalty_one_active_code_per_customer_idx
  on public.loyalty_redemption_codes(customer_id)
  where status = 'ACTIVE';
create index loyalty_codes_expiry_idx
  on public.loyalty_redemption_codes(expires_at)
  where status = 'ACTIVE';

alter table public.loyalty_program_config enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_point_lots enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.loyalty_redemption_codes enable row level security;

revoke all on table public.loyalty_program_config from public, anon, authenticated;
revoke all on table public.loyalty_accounts from public, anon, authenticated;
revoke all on table public.loyalty_point_lots from public, anon, authenticated;
revoke all on table public.loyalty_transactions from public, anon, authenticated;
revoke all on table public.loyalty_redemption_codes from public, anon, authenticated;
grant select on table public.loyalty_program_config to service_role;
grant select on table public.loyalty_accounts to service_role;
grant select on table public.loyalty_point_lots to service_role;
grant select on table public.loyalty_transactions to service_role;
grant select on table public.loyalty_redemption_codes to service_role;

insert into public.permissions(code, category, description) values
  ('loyalty.view', 'Clientes', 'Consultar saldo e historial de lealtad'),
  ('loyalty.redeem', 'Punto de venta', 'Aplicar un canje autorizado de puntos'),
  ('loyalty.manage', 'Administración', 'Configurar y ajustar el programa de lealtad')
on conflict (code) do update set
  category = excluded.category,
  description = excluded.description;

insert into public.role_permissions(role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on
  (p.code = 'loyalty.view' and r.code in ('ADMIN', 'MANAGER', 'CASHIER'))
  or (p.code = 'loyalty.redeem' and r.code in ('ADMIN', 'MANAGER', 'CASHIER'))
  or (p.code = 'loyalty.manage' and r.code in ('ADMIN', 'MANAGER'))
on conflict do nothing;

create or replace function app.guard_loyalty_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.loyalty_write', true), 'off') <> 'on' then
    raise exception 'DIRECT_LOYALTY_WRITE_FORBIDDEN' using errcode = '42501';
  end if;
  if tg_table_name = 'loyalty_transactions' and tg_op <> 'INSERT' then
    raise exception 'LOYALTY_LEDGER_IMMUTABLE' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger loyalty_accounts_guard
before insert or update or delete on public.loyalty_accounts
for each row execute function app.guard_loyalty_write();
create trigger loyalty_lots_guard
before insert or update or delete on public.loyalty_point_lots
for each row execute function app.guard_loyalty_write();
create trigger loyalty_transactions_guard
before insert or update or delete on public.loyalty_transactions
for each row execute function app.guard_loyalty_write();
create trigger loyalty_codes_guard
before insert or update or delete on public.loyalty_redemption_codes
for each row execute function app.guard_loyalty_write();

create or replace function app.ensure_loyalty_account(p_customer_id uuid)
returns public.loyalty_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.loyalty_accounts;
begin
  if p_customer_id is null or not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and not c.is_anonymized
  ) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform set_config('app.loyalty_write', 'on', true);
  insert into public.loyalty_accounts(customer_id)
  values (p_customer_id)
  on conflict (customer_id) do nothing;
  select * into v_account
  from public.loyalty_accounts
  where customer_id = p_customer_id
  for update;
  return v_account;
end;
$$;

create or replace function app.expire_loyalty_points(p_customer_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.loyalty_accounts;
  v_lot public.loyalty_point_lots;
  v_expired integer := 0;
begin
  v_account := app.ensure_loyalty_account(p_customer_id);
  perform set_config('app.loyalty_write', 'on', true);
  for v_lot in
    select * from public.loyalty_point_lots
    where customer_id = p_customer_id
      and points_remaining > 0
      and expires_at <= now()
    order by expires_at, created_at, id
    for update
  loop
    update public.loyalty_point_lots
    set points_remaining = 0
    where id = v_lot.id;
    v_expired := v_expired + v_lot.points_remaining;
    update public.loyalty_accounts
    set available_points = available_points - v_lot.points_remaining,
        updated_at = now()
    where customer_id = p_customer_id
    returning * into v_account;
    insert into public.loyalty_transactions(
      customer_id, entry_type, points_delta, balance_after, debt_after,
      reference_type, reference_id, location_id, expires_at, metadata
    ) values (
      p_customer_id, 'EXPIRE', -v_lot.points_remaining,
      v_account.available_points - v_account.points_debt,
      v_account.points_debt, 'LOYALTY_LOT', v_lot.id::text,
      (select s.location_id from public.sales s where s.id = v_lot.source_sale_id),
      null,
      jsonb_build_object('source_sale_id', v_lot.source_sale_id,
        'source_return_item_id', v_lot.source_return_item_id)
    );
  end loop;
  return v_expired;
end;
$$;

create or replace function app.award_loyalty_lot(
  p_customer_id uuid,
  p_sale_id uuid,
  p_return_item_id uuid,
  p_points integer,
  p_regular_eligible_cents bigint,
  p_discounted_eligible_cents bigint,
  p_location_id uuid,
  p_reference_type text,
  p_reference_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.loyalty_program_config;
  v_account public.loyalty_accounts;
  v_lot_id uuid;
  v_settle integer;
  v_available integer;
begin
  if p_points is null or p_points <= 0 then return null; end if;
  select * into v_config from public.loyalty_program_config where singleton;
  v_account := app.ensure_loyalty_account(p_customer_id);
  perform app.expire_loyalty_points(p_customer_id);
  select * into v_account from public.loyalty_accounts
  where customer_id = p_customer_id for update;
  v_settle := least(v_account.points_debt, p_points);
  v_available := p_points - v_settle;
  perform set_config('app.loyalty_write', 'on', true);
  -- Aunque toda la ganancia salde una deuda anterior, conservamos un lote
  -- sin puntos disponibles para que la venta siga siendo idempotente.
  insert into public.loyalty_point_lots(
    customer_id, source_sale_id, source_return_item_id,
    points_issued, points_remaining, regular_eligible_cents,
    discounted_eligible_cents, expires_at
  ) values (
    p_customer_id, p_sale_id, p_return_item_id,
    p_points, v_available, p_regular_eligible_cents,
    p_discounted_eligible_cents,
    now() + make_interval(months => v_config.expiry_months)
  ) returning id into v_lot_id;
  update public.loyalty_accounts
  set available_points = available_points + v_available,
      points_debt = points_debt - v_settle,
      lifetime_earned = lifetime_earned + p_points,
      updated_at = now()
  where customer_id = p_customer_id
  returning * into v_account;
  insert into public.loyalty_transactions(
    customer_id, entry_type, points_delta, balance_after, debt_after,
    reference_type, reference_id, location_id, expires_at, metadata
  ) values (
    p_customer_id, 'EARN', p_points,
    v_account.available_points - v_account.points_debt,
    v_account.points_debt, p_reference_type, p_reference_id, p_location_id,
    now() + make_interval(months => v_config.expiry_months),
    jsonb_build_object('lot_id', v_lot_id,
      'regular_eligible_cents', p_regular_eligible_cents,
      'discounted_eligible_cents', p_discounted_eligible_cents)
  );
  if v_settle > 0 then
    insert into public.loyalty_transactions(
      customer_id, entry_type, points_delta, balance_after, debt_after,
      reference_type, reference_id, location_id, metadata
    ) values (
      p_customer_id, 'DEBT_SETTLEMENT', -v_settle,
      v_account.available_points - v_account.points_debt,
      v_account.points_debt, p_reference_type, p_reference_id, p_location_id,
      jsonb_build_object('lot_id', v_lot_id)
    );
  end if;
  return v_lot_id;
end;
$$;

create or replace function app.reverse_loyalty_lot(
  p_lot_id uuid,
  p_target_reversed integer,
  p_location_id uuid,
  p_reference_type text,
  p_reference_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.loyalty_point_lots;
  v_account public.loyalty_accounts;
  v_other public.loyalty_point_lots;
  v_delta integer;
  v_take integer;
  v_remaining integer;
  v_consumed integer := 0;
begin
  select * into v_lot from public.loyalty_point_lots
  where id = p_lot_id for update;
  if not found then raise exception 'LOYALTY_LOT_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_target_reversed < v_lot.points_reversed
     or p_target_reversed > v_lot.points_issued then
    raise exception 'INVALID_LOYALTY_REVERSAL' using errcode = '22023';
  end if;
  v_delta := p_target_reversed - v_lot.points_reversed;
  if v_delta = 0 then return 0; end if;
  perform app.expire_loyalty_points(v_lot.customer_id);
  select * into v_lot from public.loyalty_point_lots
  where id = p_lot_id for update;
  select * into v_account from public.loyalty_accounts
  where customer_id = v_lot.customer_id for update;
  perform set_config('app.loyalty_write', 'on', true);

  -- Primero retiramos los puntos que todavía quedan del mismo renglón.
  v_take := least(v_delta, v_lot.points_remaining);
  if v_take > 0 then
    update public.loyalty_point_lots
    set points_remaining = points_remaining - v_take
    where id = v_lot.id;
    v_consumed := v_consumed + v_take;
  end if;
  v_remaining := v_delta - v_take;

  -- Si esos puntos ya se canjearon, el reverso consume otros lotes FIFO. Si
  -- tampoco alcanzan, queda una deuda que las ganancias futuras saldarán.
  for v_other in
    select * from public.loyalty_point_lots
    where customer_id = v_lot.customer_id
      and id <> v_lot.id
      and points_remaining > 0
      and expires_at > now()
    order by expires_at, created_at, id
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_remaining, v_other.points_remaining);
    update public.loyalty_point_lots
    set points_remaining = points_remaining - v_take
    where id = v_other.id;
    v_consumed := v_consumed + v_take;
    v_remaining := v_remaining - v_take;
  end loop;
  update public.loyalty_point_lots
  set points_reversed = p_target_reversed
  where id = v_lot.id;
  update public.loyalty_accounts
  set available_points = available_points - v_consumed,
      points_debt = points_debt + v_remaining,
      updated_at = now()
  where customer_id = v_lot.customer_id
  returning * into v_account;
  insert into public.loyalty_transactions(
    customer_id, entry_type, points_delta, balance_after, debt_after,
    reference_type, reference_id, location_id, metadata
  ) values (
    v_lot.customer_id, 'RETURN_REVERSAL', -v_delta,
    v_account.available_points - v_account.points_debt,
    v_account.points_debt, p_reference_type, p_reference_id, p_location_id,
    jsonb_build_object('lot_id', v_lot.id, 'consumed_points', v_consumed,
      'debt_points', v_remaining, 'target_reversed', p_target_reversed)
  );
  return v_delta;
end;
$$;

create or replace function app.sync_sale_loyalty(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.loyalty_program_config;
  v_sale public.sales;
  v_lot public.loyalty_point_lots;
  v_points integer;
  v_target_reversed integer;
  v_regular_cents bigint;
  v_discounted_cents bigint;
begin
  select * into v_config from public.loyalty_program_config where singleton;
  select * into v_sale from public.sales where id = p_sale_id;
  if not found or not v_config.is_enabled or v_config.launched_at is null
     or v_sale.customer_id is null or v_sale.sold_at < v_config.launched_at then
    return;
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('loyalty-sale:' || p_sale_id::text, 0)
  );
  -- Crédito acumula sólo cuando el cargo específico quedó completamente pagado.
  if v_sale.credit_amount_cents > 0 and exists (
    select 1 from public.customer_credit_ledger l
    where l.entry_type = 'CHARGE'
      and l.reference_type = 'SALE'
      and l.reference_id = p_sale_id::text
      and app.credit_charge_outstanding(l.id) > 0
  ) then
    return;
  end if;

  select
    coalesce(sum(case when q.is_discounted then 0 else q.remaining_cents end), 0)::bigint,
    coalesce(sum(case when q.is_discounted then q.remaining_cents else 0 end), 0)::bigint
  into v_regular_cents, v_discounted_cents
  from (
    select si.item_discount_cents + si.ticket_discount_cents > 0 as is_discounted,
      greatest(0, (si.line_total_cents - si.ticket_discount_cents)
        - coalesce((select sum(ri.line_total_cents)
          from public.return_items ri
          where ri.sale_item_id = si.id and ri.direction = 'IN'), 0))::bigint
        as remaining_cents
    from public.sale_items si
    where si.sale_id = p_sale_id
  ) q;
  v_points := case when v_sale.status = 'COMPLETED' then
    floor(v_regular_cents::numeric / v_config.regular_earn_unit_cents)::integer
    + floor(v_discounted_cents::numeric / v_config.discounted_earn_unit_cents)::integer
    else 0 end;
  select * into v_lot from public.loyalty_point_lots
  where source_sale_id = v_sale.id and source_return_item_id is null for update;
  if not found then
    if v_points > 0 then
      perform app.award_loyalty_lot(
        v_sale.customer_id, v_sale.id, null, v_points,
        v_regular_cents, v_discounted_cents,
        v_sale.location_id, 'SALE', v_sale.id::text
      );
    end if;
  else
    v_target_reversed := v_lot.points_issued - least(v_lot.points_issued, v_points);
    if v_target_reversed > v_lot.points_reversed then
      perform app.reverse_loyalty_lot(
        v_lot.id, v_target_reversed, v_sale.location_id,
        case when v_sale.status = 'CANCELLED' then 'SALE_CANCELLATION' else 'SALE_RETURN' end,
        v_sale.id::text
      );
    end if;
  end if;
end;
$$;

create or replace function app.sync_return_loyalty(p_return_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.loyalty_program_config;
  v_return public.returns;
  v_item record;
  v_points integer;
begin
  select * into v_config from public.loyalty_program_config where singleton;
  select * into v_return from public.returns where id = p_return_id;
  if not found then return; end if;
  perform app.sync_sale_loyalty(v_return.original_sale_id);
  if not v_config.is_enabled or v_return.type <> 'EXCHANGE'
     or v_return.customer_id is null then return; end if;
  -- Lo que sale en un cambio vuelve a acumular con la tarifa normal. Los
  -- renglones IN ya redujeron los puntos del artículo original arriba.
  for v_item in
    select ri.* from public.return_items ri
    where ri.return_id = p_return_id and ri.direction = 'OUT'
    order by ri.id
  loop
    if not exists (select 1 from public.loyalty_point_lots
      where source_return_item_id = v_item.id) then
      v_points := floor(v_item.line_total_cents::numeric
        / v_config.regular_earn_unit_cents)::integer;
      if v_points > 0 then
        perform app.award_loyalty_lot(
          v_return.customer_id, v_return.original_sale_id, v_item.id,
          v_points, v_item.line_total_cents, 0, v_return.location_id,
          'EXCHANGE_ITEM', v_item.id::text
        );
      end if;
    end if;
  end loop;
end;
$$;

create or replace function app.loyalty_sale_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.sync_sale_loyalty(
    case when tg_table_name = 'sales' then coalesce(new.id, old.id)
      else coalesce(new.sale_id, old.sale_id) end
  );
  return null;
end;
$$;

create constraint trigger loyalty_sync_from_sale
after insert or update on public.sales
deferrable initially deferred for each row execute function app.loyalty_sale_trigger();
create constraint trigger loyalty_sync_from_sale_item
after insert or update on public.sale_items
deferrable initially deferred for each row execute function app.loyalty_sale_trigger();

create or replace function app.loyalty_credit_allocation_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_sale_id uuid;
begin
  select l.reference_id::uuid into v_sale_id
  from public.customer_credit_ledger l
  where l.id = coalesce(new.charge_ledger_id, old.charge_ledger_id)
    and l.entry_type = 'CHARGE' and l.reference_type = 'SALE';
  if v_sale_id is not null then perform app.sync_sale_loyalty(v_sale_id); end if;
  return null;
end;
$$;
create constraint trigger loyalty_sync_from_credit_allocation
after insert on public.customer_credit_allocations
deferrable initially deferred for each row
execute function app.loyalty_credit_allocation_trigger();

create or replace function app.loyalty_return_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.sync_return_loyalty(
    case when tg_table_name = 'returns' then coalesce(new.id, old.id)
      else coalesce(new.return_id, old.return_id) end
  );
  return null;
end;
$$;
create constraint trigger loyalty_sync_from_return
after insert on public.returns
deferrable initially deferred for each row execute function app.loyalty_return_trigger();
create constraint trigger loyalty_sync_from_return_item
after insert on public.return_items
deferrable initially deferred for each row execute function app.loyalty_return_trigger();

create or replace function public.get_my_loyalty_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_account public.loyalty_accounts;
  v_config public.loyalty_program_config;
  v_history jsonb;
begin
  select * into v_customer from public.customers
  where auth_user_id = (select auth.uid()) and not is_anonymized limit 1;
  if not found or exists (select 1 from public.app_users where id = (select auth.uid())) then
    raise exception 'CUSTOMER_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  select * into v_config from public.loyalty_program_config where singleton;
  v_account := app.ensure_loyalty_account(v_customer.id);
  perform app.expire_loyalty_points(v_customer.id);
  select * into v_account from public.loyalty_accounts where customer_id = v_customer.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'type', t.entry_type, 'points', t.points_delta,
    'balance_after', t.balance_after, 'created_at', t.created_at,
    'expires_at', t.expires_at, 'reference_type', t.reference_type
  ) order by t.created_at desc, t.id desc), '[]'::jsonb)
  into v_history
  from (select * from public.loyalty_transactions
    where customer_id = v_customer.id
    order by created_at desc, id desc limit 30) t;
  return jsonb_build_object(
    'enabled', v_config.is_enabled,
    'launched_at', v_config.launched_at,
    'available_points', v_account.available_points,
    'points_debt', v_account.points_debt,
    'lifetime_earned', v_account.lifetime_earned,
    'lifetime_redeemed', v_account.lifetime_redeemed,
    'point_value_cents', v_config.point_value_cents,
    'expiry_months', v_config.expiry_months,
    'history', v_history
  );
end;
$$;

create or replace function public.create_my_loyalty_redemption_code(p_points integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers;
  v_account public.loyalty_accounts;
  v_config public.loyalty_program_config;
  v_code text;
  v_expires timestamptz;
begin
  select * into v_customer from public.customers
  where auth_user_id = (select auth.uid()) and not is_anonymized limit 1;
  if not found or exists (select 1 from public.app_users where id = (select auth.uid())) then
    raise exception 'CUSTOMER_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  select * into v_config from public.loyalty_program_config where singleton;
  if not v_config.is_enabled then
    raise exception 'LOYALTY_NOT_ACTIVE' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('loyalty-code:' || v_customer.id::text, 0)
  );
  perform app.expire_loyalty_points(v_customer.id);
  select * into v_account from public.loyalty_accounts
  where customer_id = v_customer.id for update;
  if p_points is null or p_points <= 0
     or p_points > v_account.available_points then
    raise exception 'INSUFFICIENT_LOYALTY_POINTS' using errcode = '23514';
  end if;
  v_code := lpad((pg_catalog.floor(pg_catalog.random() * 1000000))::integer::text, 6, '0');
  v_expires := now() + make_interval(mins => v_config.redemption_code_minutes);
  perform set_config('app.loyalty_write', 'on', true);
  update public.loyalty_redemption_codes
  set status = case when expires_at <= now() then 'EXPIRED' else 'CANCELLED' end
  where customer_id = v_customer.id and status = 'ACTIVE';
  insert into public.loyalty_redemption_codes(
    customer_id, code_hash, requested_points, expires_at
  ) values (
    v_customer.id, extensions.crypt(v_code, extensions.gen_salt('bf', 10)),
    p_points, v_expires
  );
  return jsonb_build_object(
    'code', v_code,
    'points', p_points,
    'value_cents', p_points * v_config.point_value_cents,
    'expires_at', v_expires
  );
end;
$$;

create or replace function public.update_loyalty_program(
  p_is_enabled boolean,
  p_launched_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select app.current_user_id()); v_config public.loyalty_program_config;
begin
  if v_actor is null or not (select app.has_perm('loyalty.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_is_enabled and p_launched_at is null then
    raise exception 'LOYALTY_LAUNCH_DATE_REQUIRED' using errcode = '22023';
  end if;
  update public.loyalty_program_config
  set is_enabled = p_is_enabled,
      launched_at = case when p_is_enabled then p_launched_at else launched_at end,
      updated_by = v_actor,
      updated_at = now()
  where singleton returning * into v_config;
  insert into public.audit_log(actor_user_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'loyalty.program_updated', 'loyalty_program', 'default',
    jsonb_build_object('enabled', v_config.is_enabled,
      'launched_at', v_config.launched_at,
      'regular_earn_unit_cents', v_config.regular_earn_unit_cents,
      'discounted_earn_unit_cents', v_config.discounted_earn_unit_cents,
      'point_value_cents', v_config.point_value_cents,
      'expiry_months', v_config.expiry_months));
  return to_jsonb(v_config);
end;
$$;

revoke execute on function app.guard_loyalty_write() from public;
revoke execute on function app.ensure_loyalty_account(uuid) from public;
revoke execute on function app.expire_loyalty_points(uuid) from public;
revoke execute on function app.award_loyalty_lot(uuid, uuid, uuid, integer, bigint, bigint, uuid, text, text) from public;
revoke execute on function app.reverse_loyalty_lot(uuid, integer, uuid, text, text) from public;
revoke execute on function app.sync_sale_loyalty(uuid) from public;
revoke execute on function app.sync_return_loyalty(uuid) from public;
revoke execute on function app.loyalty_sale_trigger() from public;
revoke execute on function app.loyalty_credit_allocation_trigger() from public;
revoke execute on function app.loyalty_return_trigger() from public;

revoke execute on function public.get_my_loyalty_summary() from public, anon;
grant execute on function public.get_my_loyalty_summary() to authenticated;
revoke execute on function public.create_my_loyalty_redemption_code(integer) from public, anon;
grant execute on function public.create_my_loyalty_redemption_code(integer) to authenticated;
revoke execute on function public.update_loyalty_program(boolean, timestamptz)
  from public, anon;
grant execute on function public.update_loyalty_program(boolean, timestamptz)
  to authenticated;

comment on table public.loyalty_transactions is
'Libro inmutable de puntos. El saldo operativo se modifica sólo mediante funciones protegidas.';
comment on table public.loyalty_point_lots is
'Lotes FIFO con vencimiento individual. Los puntos caducan doce meses después de ganarse.';
comment on function public.create_my_loyalty_redemption_code(integer) is
'Genera un código temporal; no descuenta puntos hasta que el POS lo consuma atómicamente en una venta.';

commit;
