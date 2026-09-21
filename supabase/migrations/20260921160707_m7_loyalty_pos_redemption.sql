begin;

-- M7.4 · Canje de puntos en el punto de venta.
--
-- El código visible nunca se guarda ni viaja dentro de la venta. La caja lo
-- verifica primero y recibe un token opaco de un solo uso. El trigger consume
-- los puntos dentro de la misma transacción de create_sale: si falla la venta,
-- también se revierte el canje.
insert into public.payment_methods(code, name, kind, requires_reference, sort_order)
values ('LOYALTY', 'Puntos', 'OTHER', false, 35)
on conflict (code) do update set
  name = excluded.name,
  kind = excluded.kind,
  requires_reference = excluded.requires_reference,
  sort_order = excluded.sort_order;

alter table public.loyalty_redemption_codes
  add column checkout_token uuid,
  add column verified_at timestamptz,
  add column verified_by uuid references public.app_users(id);

create unique index loyalty_redemption_checkout_token_idx
  on public.loyalty_redemption_codes(checkout_token)
  where checkout_token is not null;

create table public.loyalty_redemption_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  redemption_code_id uuid not null references public.loyalty_redemption_codes(id),
  lot_id uuid not null references public.loyalty_point_lots(id),
  points_used integer not null check (points_used > 0),
  points_restored integer not null default 0
    check (points_restored >= 0 and points_restored <= points_used),
  created_at timestamptz not null default now(),
  unique (redemption_code_id, lot_id)
);
create index loyalty_redemption_allocations_lot_idx
  on public.loyalty_redemption_allocations(lot_id, redemption_code_id);

create table public.loyalty_redemption_refunds (
  return_payment_id uuid primary key references public.return_payments(id),
  redemption_code_id uuid not null references public.loyalty_redemption_codes(id),
  refund_cents bigint not null check (refund_cents > 0),
  points_restored integer not null default 0 check (points_restored >= 0),
  created_at timestamptz not null default now()
);
create index loyalty_redemption_refunds_code_idx
  on public.loyalty_redemption_refunds(redemption_code_id, created_at, return_payment_id);

alter table public.loyalty_redemption_allocations enable row level security;
alter table public.loyalty_redemption_refunds enable row level security;
revoke all on table public.loyalty_redemption_allocations
  from public, anon, authenticated;
revoke all on table public.loyalty_redemption_refunds
  from public, anon, authenticated;
grant select on table public.loyalty_redemption_allocations to service_role;
grant select on table public.loyalty_redemption_refunds to service_role;

create trigger loyalty_redemption_allocations_guard
before insert or update or delete on public.loyalty_redemption_allocations
for each row execute function app.guard_loyalty_write();
create trigger loyalty_redemption_refunds_guard
before insert or update or delete on public.loyalty_redemption_refunds
for each row execute function app.guard_loyalty_write();

alter table public.loyalty_transactions
  drop constraint loyalty_transactions_entry_type_check;
alter table public.loyalty_transactions
  add constraint loyalty_transactions_entry_type_check check (entry_type in (
    'EARN', 'REDEEM', 'RESTORE', 'EXPIRE', 'RETURN_REVERSAL',
    'DEBT_SETTLEMENT', 'ADJUSTMENT'
  ));

create or replace function public.verify_loyalty_redemption_code(
  p_customer_id uuid,
  p_code text,
  p_max_value_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_config public.loyalty_program_config;
  v_account public.loyalty_accounts;
  v_code public.loyalty_redemption_codes;
  v_token uuid;
  v_value bigint;
  v_attempts integer;
begin
  if v_actor is null or not (select app.has_perm('loyalty.redeem'))
     or not (select app.has_perm('pos.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_customer_id is null or p_code !~ '^[0-9]{6}$'
     or p_max_value_cents is null or p_max_value_cents <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE');
  end if;
  select * into v_config from public.loyalty_program_config where singleton;
  if not v_config.is_enabled then
    return jsonb_build_object('ok', false, 'code', 'NOT_ACTIVE');
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('loyalty-code:' || p_customer_id::text, 0)
  );
  perform app.expire_loyalty_points(p_customer_id);
  select * into v_account from public.loyalty_accounts
  where customer_id = p_customer_id for update;
  select * into v_code from public.loyalty_redemption_codes
  where customer_id = p_customer_id and status = 'ACTIVE'
  order by created_at desc limit 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  perform set_config('app.loyalty_write', 'on', true);
  if v_code.expires_at <= now() then
    update public.loyalty_redemption_codes
    set status = 'EXPIRED', checkout_token = null,
        verified_at = null, verified_by = null
    where id = v_code.id;
    return jsonb_build_object('ok', false, 'code', 'EXPIRED');
  end if;
  if extensions.crypt(p_code, v_code.code_hash) <> v_code.code_hash then
    v_attempts := least(5, v_code.failed_attempts + 1);
    update public.loyalty_redemption_codes
    set failed_attempts = v_attempts,
        status = case when v_attempts >= 5 then 'CANCELLED' else status end,
        checkout_token = null, verified_at = null, verified_by = null
    where id = v_code.id;
    return jsonb_build_object('ok', false,
      'code', case when v_attempts >= 5 then 'LOCKED' else 'INVALID_CODE' end,
      'attempts_remaining', greatest(0, 5 - v_attempts));
  end if;
  v_value := v_code.requested_points::bigint * v_config.point_value_cents;
  if v_code.requested_points > v_account.available_points then
    return jsonb_build_object('ok', false, 'code', 'POINTS_CHANGED',
      'available_points', v_account.available_points);
  end if;
  if v_value > p_max_value_cents then
    return jsonb_build_object('ok', false, 'code', 'VALUE_EXCEEDS_SALE',
      'value_cents', v_value);
  end if;
  v_token := extensions.gen_random_uuid();
  update public.loyalty_redemption_codes
  set checkout_token = v_token, verified_at = now(), verified_by = v_actor
  where id = v_code.id;
  return jsonb_build_object('ok', true, 'token', v_token,
    'points', v_code.requested_points, 'value_cents', v_value,
    'available_points', v_account.available_points,
    'expires_at', v_code.expires_at);
end;
$$;

create or replace function app.consume_loyalty_sale_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_sale public.sales;
  v_config public.loyalty_program_config;
  v_code public.loyalty_redemption_codes;
  v_account public.loyalty_accounts;
  v_lot public.loyalty_point_lots;
  v_token uuid;
  v_remaining integer;
  v_take integer;
begin
  if new.method_code <> 'LOYALTY' then return new; end if;
  if v_actor is null or not (select app.has_perm('loyalty.redeem')) then
    raise exception 'LOYALTY_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  begin v_token := btrim(new.reference)::uuid;
  exception when others then
    raise exception 'LOYALTY_CODE_REQUIRED' using errcode = '22023';
  end;
  select * into v_sale from public.sales where id = new.sale_id;
  if not found or v_sale.customer_id is null then
    raise exception 'LOYALTY_CUSTOMER_REQUIRED' using errcode = '22023';
  end if;
  select * into v_config from public.loyalty_program_config where singleton;
  if not v_config.is_enabled then
    raise exception 'LOYALTY_NOT_ACTIVE' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('loyalty-code:' || v_sale.customer_id::text, 0)
  );
  perform app.expire_loyalty_points(v_sale.customer_id);
  select * into v_account from public.loyalty_accounts
  where customer_id = v_sale.customer_id for update;
  select * into v_code from public.loyalty_redemption_codes
  where checkout_token = v_token and customer_id = v_sale.customer_id
    and status = 'ACTIVE'
  for update;
  if not found or v_code.verified_by <> v_actor or v_code.verified_at is null then
    raise exception 'LOYALTY_CODE_INVALID' using errcode = '22023';
  end if;
  if v_code.expires_at <= now() then
    raise exception 'LOYALTY_CODE_EXPIRED' using errcode = '22023';
  end if;
  if v_code.requested_points > v_account.available_points then
    raise exception 'LOYALTY_POINTS_CHANGED' using errcode = '23514';
  end if;
  if new.amount_cents <> v_code.requested_points::bigint * v_config.point_value_cents then
    raise exception 'LOYALTY_PAYMENT_MISMATCH' using errcode = '23514';
  end if;
  v_remaining := v_code.requested_points;
  perform set_config('app.loyalty_write', 'on', true);
  for v_lot in
    select * from public.loyalty_point_lots
    where customer_id = v_sale.customer_id and points_remaining > 0
      and expires_at > now()
    order by expires_at, created_at, id
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_remaining, v_lot.points_remaining);
    update public.loyalty_point_lots
    set points_remaining = points_remaining - v_take where id = v_lot.id;
    insert into public.loyalty_redemption_allocations(
      redemption_code_id, lot_id, points_used
    ) values (v_code.id, v_lot.id, v_take);
    v_remaining := v_remaining - v_take;
  end loop;
  if v_remaining <> 0 then
    raise exception 'LOYALTY_POINTS_CHANGED' using errcode = '23514';
  end if;
  update public.loyalty_accounts
  set available_points = available_points - v_code.requested_points,
      lifetime_redeemed = lifetime_redeemed + v_code.requested_points,
      updated_at = now()
  where customer_id = v_sale.customer_id returning * into v_account;
  update public.loyalty_redemption_codes
  set status = 'CONSUMED', consumed_at = now(), consumed_by = v_actor,
      sale_id = v_sale.id, checkout_token = null
  where id = v_code.id;
  insert into public.loyalty_transactions(
    customer_id, entry_type, points_delta, balance_after, debt_after,
    reference_type, reference_id, location_id, actor_user_id, metadata
  ) values (
    v_sale.customer_id, 'REDEEM', -v_code.requested_points,
    v_account.available_points - v_account.points_debt,
    v_account.points_debt, 'SALE', v_sale.id::text, v_sale.location_id,
    v_actor, jsonb_build_object('redemption_code_id', v_code.id,
      'value_cents', new.amount_cents)
  );
  new.reference := v_code.requested_points::text || ' puntos';
  return new;
end;
$$;

create trigger sale_payments_loyalty_consume
before insert on public.sale_payments
for each row execute function app.consume_loyalty_sale_payment();

create or replace function app.restore_loyalty_redemption(
  p_sale_id uuid,
  p_target_points integer,
  p_reference_type text,
  p_reference_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.loyalty_redemption_codes;
  v_sale public.sales;
  v_allocation record;
  v_account public.loyalty_accounts;
  v_already integer;
  v_needed integer;
  v_take integer;
  v_restored integer := 0;
  v_expired integer := 0;
begin
  select * into v_code from public.loyalty_redemption_codes
  where sale_id = p_sale_id and status = 'CONSUMED' for update;
  if not found then return 0; end if;
  select * into v_sale from public.sales where id = p_sale_id;
  select coalesce(sum(points_restored), 0) into v_already
  from public.loyalty_redemption_allocations
  where redemption_code_id = v_code.id;
  v_needed := least(greatest(coalesce(p_target_points, 0), 0),
    v_code.requested_points) - v_already;
  if v_needed <= 0 then return 0; end if;
  select * into v_account from public.loyalty_accounts
  where customer_id = v_code.customer_id for update;
  perform set_config('app.loyalty_write', 'on', true);
  for v_allocation in
    select a.*, l.expires_at
    from public.loyalty_redemption_allocations a
    join public.loyalty_point_lots l on l.id = a.lot_id
    where a.redemption_code_id = v_code.id
      and a.points_restored < a.points_used
    order by l.expires_at desc, a.created_at desc, a.id desc
    for update of a, l
  loop
    exit when v_needed = 0;
    v_take := least(v_needed,
      v_allocation.points_used - v_allocation.points_restored);
    update public.loyalty_redemption_allocations
    set points_restored = points_restored + v_take
    where id = v_allocation.id;
    if v_allocation.expires_at > now() then
      update public.loyalty_point_lots
      set points_remaining = points_remaining + v_take
      where id = v_allocation.lot_id;
      v_restored := v_restored + v_take;
    else
      v_expired := v_expired + v_take;
    end if;
    v_needed := v_needed - v_take;
  end loop;
  if v_restored > 0 then
    update public.loyalty_accounts
    set available_points = available_points + v_restored,
        lifetime_redeemed = greatest(0, lifetime_redeemed - v_restored),
        updated_at = now()
    where customer_id = v_code.customer_id returning * into v_account;
    insert into public.loyalty_transactions(
      customer_id, entry_type, points_delta, balance_after, debt_after,
      reference_type, reference_id, location_id, actor_user_id, metadata
    ) values (
      v_code.customer_id, 'RESTORE', v_restored,
      v_account.available_points - v_account.points_debt,
      v_account.points_debt, p_reference_type, p_reference_id,
      v_sale.location_id, (select app.current_user_id()),
      jsonb_build_object('redemption_code_id', v_code.id,
        'expired_points_not_restored', v_expired)
    );
  end if;
  return v_restored;
end;
$$;

create or replace function app.restore_cancelled_sale_loyalty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_points integer;
begin
  if old.status = 'COMPLETED' and new.status = 'CANCELLED' then
    select requested_points into v_points
    from public.loyalty_redemption_codes
    where sale_id = new.id and status = 'CONSUMED';
    if v_points is not null then
      perform app.restore_loyalty_redemption(
        new.id, v_points, 'SALE_CANCELLATION', new.id::text
      );
    end if;
  end if;
  return null;
end;
$$;
create constraint trigger loyalty_restore_from_sale_cancellation
after update of status on public.sales
deferrable initially deferred for each row
execute function app.restore_cancelled_sale_loyalty();

create or replace function app.restore_returned_loyalty_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id uuid;
  v_code public.loyalty_redemption_codes;
  v_config public.loyalty_program_config;
  v_total_refunded bigint;
  v_target integer;
  v_before integer;
  v_restored integer;
begin
  if new.direction <> 'REFUND' or new.method_code <> 'LOYALTY' then
    return null;
  end if;
  select r.original_sale_id into v_sale_id
  from public.returns r where r.id = new.return_id;
  select * into v_code from public.loyalty_redemption_codes
  where sale_id = v_sale_id and status = 'CONSUMED' for update;
  if not found then
    raise exception 'LOYALTY_REDEMPTION_NOT_FOUND' using errcode = '23514';
  end if;
  select * into v_config from public.loyalty_program_config where singleton;
  select coalesce(sum(rp.amount_cents), 0) into v_total_refunded
  from public.return_payments rp
  join public.returns r on r.id = rp.return_id
  where r.original_sale_id = v_sale_id
    and rp.direction = 'REFUND' and rp.method_code = 'LOYALTY';
  v_target := least(v_code.requested_points,
    floor(v_total_refunded::numeric / v_config.point_value_cents)::integer);
  select coalesce(sum(points_restored), 0) into v_before
  from public.loyalty_redemption_allocations
  where redemption_code_id = v_code.id;
  v_restored := app.restore_loyalty_redemption(
    v_sale_id, v_target, 'SALE_RETURN', new.return_id::text
  );
  perform set_config('app.loyalty_write', 'on', true);
  insert into public.loyalty_redemption_refunds(
    return_payment_id, redemption_code_id, refund_cents, points_restored
  ) values (new.id, v_code.id, new.amount_cents, v_restored);
  return null;
end;
$$;
create trigger return_payments_loyalty_restore
after insert on public.return_payments
for each row execute function app.restore_returned_loyalty_payment();

revoke execute on function public.verify_loyalty_redemption_code(uuid, text, bigint)
  from public, anon;
grant execute on function public.verify_loyalty_redemption_code(uuid, text, bigint)
  to authenticated;
revoke execute on function app.consume_loyalty_sale_payment() from public;
revoke execute on function app.restore_loyalty_redemption(uuid, integer, text, text)
  from public;
revoke execute on function app.restore_cancelled_sale_loyalty() from public;
revoke execute on function app.restore_returned_loyalty_payment() from public;

comment on table public.loyalty_redemption_allocations is
'Origen FIFO de cada punto canjeado; permite restaurarlo sin inventar saldo.';
comment on function public.verify_loyalty_redemption_code(uuid, text, bigint) is
'Valida el código temporal y entrega un token opaco; no descuenta puntos.';

commit;
