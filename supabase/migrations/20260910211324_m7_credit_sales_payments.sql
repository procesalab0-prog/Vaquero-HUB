begin;

-- M7.2 · Venta a crédito, abonos y estado de cuenta.
-- La deuda se registra como un libro inmutable y jamás como dinero recibido.

insert into public.payment_methods (code, name, kind, requires_reference, sort_order)
values ('CREDIT', 'Crédito', 'OTHER', false, 40)
on conflict (code) do update set
  name = excluded.name,
  kind = excluded.kind,
  requires_reference = excluded.requires_reference,
  sort_order = excluded.sort_order,
  is_active = true;

insert into public.folio_document_types (code, description)
values ('CREDIT_PAYMENT', 'Abono de crédito')
on conflict (code) do nothing;

alter table public.sales
  add column credit_amount_cents bigint not null default 0
    check (credit_amount_cents >= 0),
  add column credit_due_date date,
  add constraint sales_credit_complete check (
    (credit_amount_cents = 0 and credit_due_date is null)
    or (credit_amount_cents > 0 and credit_due_date is not null)
  );

alter table public.cash_movements
  drop constraint cash_movements_movement_type_check;
alter table public.cash_movements
  add constraint cash_movements_movement_type_check
  check (movement_type in (
    'OPENING', 'SALE', 'DEPOSIT', 'WITHDRAWAL', 'CLOSING',
    'CANCELLATION', 'RETURN', 'CREDIT_PAYMENT'
  ));

create table public.customer_credit_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  cash_session_id uuid not null references public.cash_sessions(id),
  location_id uuid not null references public.locations(id),
  actor_user_id uuid not null references public.app_users(id),
  folio_number bigint not null check (folio_number > 0),
  folio text not null unique check (btrim(folio) <> ''),
  total_cents bigint not null check (total_cents > 0),
  idempotency_key uuid not null unique,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  note text check (note is null or length(btrim(note)) between 3 and 500),
  received_at timestamptz not null default now(),
  unique (location_id, folio_number)
);
create index customer_credit_payments_customer_date_idx
  on public.customer_credit_payments (customer_id, received_at desc, id);
create index customer_credit_payments_session_date_idx
  on public.customer_credit_payments (cash_session_id, received_at desc, id);

create table public.customer_credit_payment_parts (
  id uuid primary key default extensions.gen_random_uuid(),
  credit_payment_id uuid not null references public.customer_credit_payments(id),
  method_code text not null references public.payment_methods(code)
    check (method_code <> 'CREDIT'),
  amount_cents bigint not null check (amount_cents > 0),
  tendered_cents bigint,
  change_cents bigint not null default 0 check (change_cents >= 0),
  reference text,
  created_at timestamptz not null default now(),
  unique (credit_payment_id, method_code),
  constraint credit_payment_part_cash_fields check (
    (method_code = 'CASH' and tendered_cents is not null
      and tendered_cents >= amount_cents
      and change_cents = tendered_cents - amount_cents)
    or
    (method_code <> 'CASH' and tendered_cents is null and change_cents = 0)
  )
);
create index customer_credit_payment_parts_payment_idx
  on public.customer_credit_payment_parts (credit_payment_id);
create index customer_credit_payment_parts_method_date_idx
  on public.customer_credit_payment_parts (method_code, created_at desc);

create table public.customer_credit_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  payment_ledger_id uuid not null references public.customer_credit_ledger(id),
  charge_ledger_id uuid not null references public.customer_credit_ledger(id),
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (payment_ledger_id, charge_ledger_id),
  check (payment_ledger_id <> charge_ledger_id)
);
create index customer_credit_allocations_charge_idx
  on public.customer_credit_allocations (charge_ledger_id);

create or replace function app.guard_credit_payment_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'CREDIT_PAYMENT_IMMUTABLE' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.credit_write', true), 'off') <> 'on' then
    raise exception 'DIRECT_CREDIT_PAYMENT_WRITE_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger customer_credit_payments_guard
before insert or update or delete on public.customer_credit_payments
for each row execute function app.guard_credit_payment_ledger();
create trigger customer_credit_payment_parts_guard
before insert or update or delete on public.customer_credit_payment_parts
for each row execute function app.guard_credit_payment_ledger();
create trigger customer_credit_allocations_guard
before insert or update or delete on public.customer_credit_allocations
for each row execute function app.guard_credit_payment_ledger();

create or replace function app.guard_credit_sale_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.method_code = 'CREDIT'
     and coalesce(current_setting('app.credit_sale_write', true), 'off') <> 'on' then
    raise exception 'USE_CREATE_CREDIT_SALE' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger sale_payments_credit_guard
before insert on public.sale_payments
for each row execute function app.guard_credit_sale_payment();

create or replace function app.credit_charge_outstanding(p_charge_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select amount_cents from public.customer_credit_ledger
      where id = p_charge_id and entry_type = 'CHARGE'), 0)
    - coalesce((select sum(amount_cents) from public.customer_credit_allocations
      where charge_ledger_id = p_charge_id), 0),
    0
  )::bigint
$$;

create or replace function app.credit_oldest_due(p_customer_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select min(l.due_date)
  from public.customer_credit_ledger l
  where l.customer_id = p_customer_id
    and l.entry_type = 'CHARGE'
    and (select app.credit_charge_outstanding(l.id)) > 0
$$;

create or replace function app.check_credit_sale_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale_id uuid := case
    when tg_table_name = 'sales' then coalesce(new.id, old.id)
    else coalesce(new.sale_id, old.sale_id)
  end;
  v_sale public.sales;
  v_credit bigint;
  v_charge public.customer_credit_ledger;
begin
  select * into v_sale from public.sales where id = v_sale_id;
  if not found then return coalesce(new, old); end if;
  select coalesce(sum(amount_cents), 0)::bigint into v_credit
  from public.sale_payments where sale_id = v_sale_id and method_code = 'CREDIT';
  select * into v_charge
  from public.customer_credit_ledger
  where entry_type = 'CHARGE' and reference_type = 'SALE' and reference_id = v_sale_id::text;

  if v_credit <> v_sale.credit_amount_cents
     or (v_credit > 0 and (
       v_sale.customer_id is null
       or v_sale.credit_due_date is null
       or v_charge.id is null
       or v_charge.customer_id <> v_sale.customer_id
       or v_charge.amount_cents <> v_credit
       or v_charge.due_date <> v_sale.credit_due_date
     ))
     or (v_credit = 0 and (v_sale.credit_due_date is not null or v_charge.id is not null)) then
    raise exception 'CREDIT_SALE_LEDGER_MISMATCH' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create constraint trigger sale_credit_integrity_from_payment
after insert or update or delete on public.sale_payments
deferrable initially deferred for each row execute function app.check_credit_sale_integrity();
create constraint trigger sale_credit_integrity_from_sale
after insert or update on public.sales
deferrable initially deferred for each row execute function app.check_credit_sale_integrity();

create or replace function public.create_credit_sale(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid,
  p_due_date date,
  p_discounts jsonb default '[]'::jsonb,
  p_notes text default null
)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_sale public.sales;
  v_account public.customer_credit_accounts;
  v_existing_charge public.customer_credit_ledger;
  v_credit_cents bigint;
  v_balance bigint;
  v_oldest_due date;
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not (select app.has_perm('pos.sell')) or not (select app.has_perm('credit.sell')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_customer_id is null or p_due_date is null or p_due_date < current_date
     or jsonb_typeof(p_payments) <> 'array'
     or jsonb_array_length(p_payments) not between 1 and 10
     or (select count(*) from jsonb_array_elements(p_payments) p
         where upper(p->>'method_code') = 'CREDIT') <> 1 then
    raise exception 'INVALID_CREDIT_SALE' using errcode = '22023';
  end if;
  begin
    select (p->>'amount_cents')::bigint into v_credit_cents
    from jsonb_array_elements(p_payments) p
    where upper(p->>'method_code') = 'CREDIT';
  exception when others then
    raise exception 'INVALID_CREDIT_SALE' using errcode = '22023';
  end;
  if v_credit_cents is null or v_credit_cents <= 0 then
    raise exception 'INVALID_CREDIT_SALE' using errcode = '22023';
  end if;

  -- Una sola cola por cliente: dos cajas no pueden consumir juntas más límite.
  perform pg_advisory_xact_lock(hashtextextended('customer-credit:' || p_customer_id::text, 0));

  perform set_config('app.credit_sale_write', 'on', true);
  v_sale := public.create_sale(
    p_idempotency_key, p_cash_session_id, p_items, p_payments,
    p_customer_id, p_discounts, p_notes
  );
  perform set_config('app.credit_sale_write', 'off', true);

  select * into v_existing_charge
  from public.customer_credit_ledger
  where entry_type = 'CHARGE' and reference_type = 'SALE' and reference_id = v_sale.id::text;
  if found then
    if v_existing_charge.customer_id <> p_customer_id
       or v_existing_charge.amount_cents <> v_credit_cents
       or v_existing_charge.due_date <> p_due_date then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_sale;
  end if;

  select * into v_account from public.customer_credit_accounts
  where customer_id = p_customer_id for update;
  if not found or not v_account.is_authorized then
    raise exception 'CREDIT_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  v_balance := (select app.credit_balance(p_customer_id));
  v_oldest_due := (select app.credit_oldest_due(p_customer_id));
  if v_oldest_due < current_date then
    raise exception 'CREDIT_OVERDUE' using errcode = '23514';
  end if;
  if v_balance + v_credit_cents > v_account.limit_cents then
    raise exception 'CREDIT_LIMIT_EXCEEDED' using errcode = '23514';
  end if;

  perform set_config('app.sales_write', 'on', true);
  update public.sales set
    credit_amount_cents = v_credit_cents,
    credit_due_date = p_due_date
  where id = v_sale.id
  returning * into v_sale;
  perform set_config('app.sales_write', 'off', true);

  perform set_config('app.credit_write', 'on', true);
  insert into public.customer_credit_ledger (
    customer_id, entry_type, amount_cents, due_date, location_id,
    actor_user_id, reference_type, reference_id, metadata
  ) values (
    p_customer_id, 'CHARGE', v_credit_cents, p_due_date, v_sale.location_id,
    v_actor, 'SALE', v_sale.id::text,
    jsonb_build_object('folio', v_sale.folio, 'sale_total_cents', v_sale.total_cents)
  );
  perform set_config('app.credit_write', 'off', true);

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    v_actor, 'customer_credit.sale_created', 'sales', v_sale.id::text,
    v_sale.location_id,
    jsonb_build_object('customer_id', p_customer_id, 'credit_cents', v_credit_cents,
      'due_date', p_due_date, 'balance_before_cents', v_balance,
      'balance_after_cents', v_balance + v_credit_cents)
  );
  return v_sale;
end;
$$;

create or replace function public.record_customer_credit_payment(
  p_idempotency_key uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_payments jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_hash text;
  v_existing public.customer_credit_payments;
  v_session public.cash_sessions;
  v_payment public.customer_credit_payments;
  v_part jsonb;
  v_method public.payment_methods;
  v_amount bigint;
  v_total bigint := 0;
  v_balance bigint;
  v_folio bigint;
  v_ledger_id uuid;
  v_remaining bigint;
  v_outstanding bigint;
  v_allocate bigint;
  v_charge record;
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not (select app.has_perm('credit.collect')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_cash_session_id is null or p_customer_id is null
     or jsonb_typeof(p_payments) <> 'array'
     or jsonb_array_length(p_payments) not between 1 and 3
     or length(coalesce(p_note, '')) > 500
     or exists (select 1 from jsonb_array_elements(p_payments) p
       group by upper(p->>'method_code') having count(*) > 1) then
    raise exception 'INVALID_CREDIT_PAYMENT' using errcode = '22023';
  end if;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'session', p_cash_session_id, 'customer', p_customer_id,
    'payments', p_payments, 'note', nullif(btrim(coalesce(p_note, '')), '')
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('credit-payment:' || p_idempotency_key::text, 0));
  select * into v_existing from public.customer_credit_payments
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.actor_user_id <> v_actor or v_existing.request_hash <> v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return jsonb_build_object('id', v_existing.id, 'folio', v_existing.folio,
      'total_cents', v_existing.total_cents,
      'balance_cents', (select app.credit_balance(v_existing.customer_id)));
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer-credit:' || p_customer_id::text, 0));
  select * into v_session from public.cash_sessions
  where id = p_cash_session_id and status = 'OPEN' for update;
  if not found or v_session.cashier_user_id <> v_actor
     or not (select app.can_access_location(v_session.location_id)) then
    raise exception 'SESSION_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers
      where id = p_customer_id and not is_anonymized) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  for v_part in select value from jsonb_array_elements(p_payments) loop
    begin v_amount := (v_part->>'amount_cents')::bigint;
    exception when others then raise exception 'INVALID_CREDIT_PAYMENT' using errcode = '22023'; end;
    select * into v_method from public.payment_methods
    where code = upper(v_part->>'method_code') and is_active and code <> 'CREDIT';
    if not found or v_amount is null or v_amount <= 0 then
      raise exception 'INVALID_CREDIT_PAYMENT' using errcode = '22023';
    end if;
    if v_method.requires_reference
       and length(btrim(coalesce(v_part->>'reference', ''))) < 3 then
      raise exception 'PAYMENT_REFERENCE_REQUIRED' using errcode = '22023';
    end if;
    if v_method.kind = 'CASH'
       and coalesce((v_part->>'tendered_cents')::bigint, -1) < v_amount then
      raise exception 'INSUFFICIENT_CASH_TENDERED' using errcode = '22023';
    end if;
    v_total := v_total + v_amount;
  end loop;
  v_balance := (select app.credit_balance(p_customer_id));
  if v_balance <= 0 then raise exception 'CREDIT_BALANCE_EMPTY' using errcode = '23514'; end if;
  if v_total > v_balance then raise exception 'CREDIT_OVERPAYMENT' using errcode = '23514'; end if;

  insert into public.folios(location_id, document_type, next_number)
  values(v_session.location_id, 'CREDIT_PAYMENT', 2)
  on conflict(location_id, document_type) do update
    set next_number = public.folios.next_number + 1
  returning next_number - 1 into v_folio;

  perform set_config('app.credit_write', 'on', true);
  insert into public.customer_credit_payments (
    customer_id, cash_session_id, location_id, actor_user_id,
    folio_number, folio, total_cents, idempotency_key, request_hash, note
  ) values (
    p_customer_id, v_session.id, v_session.location_id, v_actor,
    v_folio, (select code from public.locations where id = v_session.location_id)
      || '-A-' || lpad(v_folio::text, 6, '0'),
    v_total, p_idempotency_key, v_hash, nullif(btrim(coalesce(p_note, '')), '')
  ) returning * into v_payment;

  for v_part in select value from jsonb_array_elements(p_payments) loop
    v_amount := (v_part->>'amount_cents')::bigint;
    select * into v_method from public.payment_methods
    where code = upper(v_part->>'method_code');
    if v_method.kind = 'CASH' then
      insert into public.customer_credit_payment_parts (
        credit_payment_id, method_code, amount_cents, tendered_cents, change_cents
      ) values (
        v_payment.id, v_method.code, v_amount,
        (v_part->>'tendered_cents')::bigint,
        (v_part->>'tendered_cents')::bigint - v_amount
      );
    else
      insert into public.customer_credit_payment_parts (
        credit_payment_id, method_code, amount_cents, reference
      ) values (v_payment.id, v_method.code, v_amount, btrim(v_part->>'reference'));
    end if;
  end loop;

  insert into public.customer_credit_ledger (
    customer_id, entry_type, amount_cents, location_id, actor_user_id,
    reference_type, reference_id, metadata
  ) values (
    p_customer_id, 'PAYMENT', -v_total, v_session.location_id, v_actor,
    'CREDIT_PAYMENT', v_payment.id::text, jsonb_build_object('folio', v_payment.folio)
  ) returning id into v_ledger_id;

  v_remaining := v_total;
  for v_charge in
    select l.id, l.amount_cents,
      l.amount_cents - coalesce(sum(a.amount_cents), 0)::bigint as outstanding
    from public.customer_credit_ledger l
    left join public.customer_credit_allocations a on a.charge_ledger_id = l.id
    where l.customer_id = p_customer_id and l.entry_type = 'CHARGE'
    group by l.id, l.amount_cents, l.due_date, l.occurred_at
    having l.amount_cents - coalesce(sum(a.amount_cents), 0)::bigint > 0
    order by l.due_date, l.occurred_at, l.id
  loop
    exit when v_remaining = 0;
    v_outstanding := v_charge.outstanding;
    v_allocate := least(v_remaining, v_outstanding);
    insert into public.customer_credit_allocations (
      payment_ledger_id, charge_ledger_id, amount_cents
    ) values (v_ledger_id, v_charge.id, v_allocate);
    v_remaining := v_remaining - v_allocate;
  end loop;
  if v_remaining <> 0 then
    raise exception 'CREDIT_ALLOCATION_MISMATCH' using errcode = '23514';
  end if;
  perform set_config('app.credit_write', 'off', true);

  perform set_config('app.cash_write', 'on', true);
  insert into public.cash_movements (
    session_id, location_id, movement_type, amount_cents, reference_type,
    reference_id, user_id, metadata
  )
  select v_session.id, v_session.location_id, 'CREDIT_PAYMENT', sum(pp.amount_cents),
    'CREDIT_PAYMENT', v_payment.id::text, v_actor,
    jsonb_build_object('folio', v_payment.folio, 'customer_id', p_customer_id)
  from public.customer_credit_payment_parts pp
  join public.payment_methods pm on pm.code = pp.method_code
  where pp.credit_payment_id = v_payment.id and pm.kind = 'CASH'
  having sum(pp.amount_cents) > 0;
  perform set_config('app.cash_write', 'off', true);

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id, metadata
  ) values (
    v_actor, 'customer_credit.payment_received', 'customer_credit_payments',
    v_payment.id::text, v_session.location_id,
    jsonb_build_object('customer_id', p_customer_id, 'total_cents', v_total,
      'balance_before_cents', v_balance, 'balance_after_cents', v_balance - v_total,
      'payment_count', jsonb_array_length(p_payments))
  );
  return jsonb_build_object('id', v_payment.id, 'folio', v_payment.folio,
    'total_cents', v_total, 'balance_before_cents', v_balance,
    'balance_cents', v_balance - v_total, 'received_at', v_payment.received_at);
end;
$$;

create or replace function public.get_customer_credit_summary(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_account public.customer_credit_accounts;
  v_balance bigint;
  v_oldest_due date;
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not ((select app.has_perm('pos.sell')) or (select app.has_perm('customers.credit'))
      or (select app.has_perm('credit.collect'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c
      where c.id = p_customer_id and not c.is_anonymized) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_account from public.customer_credit_accounts where customer_id = p_customer_id;
  v_balance := (select app.credit_balance(p_customer_id));
  v_oldest_due := (select app.credit_oldest_due(p_customer_id));
  return jsonb_build_object(
    'customer_id', p_customer_id,
    'is_authorized', coalesce(v_account.is_authorized, false),
    'limit_cents', coalesce(v_account.limit_cents, 0),
    'balance_cents', v_balance,
    'available_cents', greatest(coalesce(v_account.limit_cents, 0) - v_balance, 0),
    'oldest_due_date', v_oldest_due,
    'has_overdue', coalesce(v_oldest_due < current_date and v_balance > 0, false)
  );
end;
$$;

create or replace function public.list_customer_credit_accounts(
  p_query text default '', p_limit integer default 100
)
returns table (
  customer_id uuid, member_number text, full_name text, is_authorized boolean,
  limit_cents bigint, balance_cents bigint, available_cents bigint,
  oldest_due_date date, has_overdue boolean, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_query text := lower(btrim(coalesce(p_query, '')));
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not ((select app.has_perm('customers.credit'))
      or (select app.has_perm('credit.collect'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(v_query) > 100 or p_limit not between 1 and 200 then
    raise exception 'INVALID_CREDIT_QUERY' using errcode = '22023';
  end if;
  return query
  select c.id, c.member_number, c.full_name,
    coalesce(a.is_authorized, false), coalesce(a.limit_cents, 0),
    coalesce(b.balance_cents, 0),
    greatest(coalesce(a.limit_cents, 0) - coalesce(b.balance_cents, 0), 0),
    b.oldest_due_date,
    coalesce(b.oldest_due_date < current_date and b.balance_cents > 0, false),
    a.updated_at
  from public.customers c
  left join public.customer_credit_accounts a on a.customer_id = c.id
  left join lateral (
    select (select app.credit_balance(c.id)) as balance_cents,
      (select app.credit_oldest_due(c.id)) as oldest_due_date
  ) b on true
  where not c.is_anonymized and (
    v_query = '' or c.search_name like '%' || v_query || '%'
    or c.member_number like '%' || v_query || '%'
    or (length(regexp_replace(v_query, '[^0-9]', '', 'g')) >= 3
      and coalesce(c.phone_e164, '') like '%'
        || regexp_replace(v_query, '[^0-9]', '', 'g') || '%')
  )
  order by coalesce(a.is_authorized, false) desc, c.full_name, c.id
  limit p_limit;
end;
$$;

create or replace function public.get_customer_credit_statement(
  p_customer_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_result jsonb;
begin
  if v_actor is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not ((select app.has_perm('credit.collect'))
      or (select app.has_perm('customers.credit'))
      or (select app.has_perm('credit.sell'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'INVALID_STATEMENT_PERIOD' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'customer_id', c.id, 'member_number', c.member_number,
    'customer_name', c.full_name,
    'balance_cents', (select app.credit_balance(c.id)),
    'oldest_due_date', (select app.credit_oldest_due(c.id)),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'entry_type', l.entry_type, 'amount_cents', l.amount_cents,
        'occurred_at', l.occurred_at, 'due_date', l.due_date,
        'outstanding_cents', case when l.entry_type = 'CHARGE'
          then (select app.credit_charge_outstanding(l.id)) else null end,
        'reference_type', l.reference_type, 'reference_id', l.reference_id,
        'location_name', loc.name, 'actor_name', u.full_name,
        'metadata', l.metadata
      ) order by l.occurred_at desc, l.id desc)
      from public.customer_credit_ledger l
      join public.locations loc on loc.id = l.location_id
      join public.app_users u on u.id = l.actor_user_id
      where l.customer_id = c.id
        and (p_from is null or l.occurred_at >= p_from::timestamptz)
        and (p_to is null or l.occurred_at < (p_to + 1)::timestamptz)
    ), '[]'::jsonb)
  ) into v_result
  from public.customers c where c.id = p_customer_id and not c.is_anonymized;
  if v_result is null then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002'; end if;
  return v_result;
end;
$$;

alter table public.customer_credit_payments enable row level security;
alter table public.customer_credit_payment_parts enable row level security;
alter table public.customer_credit_allocations enable row level security;

revoke all on public.customer_credit_payments, public.customer_credit_payment_parts,
  public.customer_credit_allocations from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.customer_credit_payments,
  public.customer_credit_payment_parts, public.customer_credit_allocations to service_role;

revoke execute on function app.guard_credit_payment_ledger()
  from public, anon, authenticated, service_role;
revoke execute on function app.guard_credit_sale_payment()
  from public, anon, authenticated, service_role;
revoke execute on function app.credit_charge_outstanding(uuid)
  from public, anon, authenticated;
revoke execute on function app.credit_oldest_due(uuid)
  from public, anon, authenticated;
revoke execute on function app.check_credit_sale_integrity()
  from public, anon, authenticated, service_role;
grant execute on function app.credit_charge_outstanding(uuid), app.credit_oldest_due(uuid)
  to service_role;

revoke execute on function public.create_credit_sale(uuid, uuid, jsonb, jsonb, uuid, date, jsonb, text)
  from public, anon;
revoke execute on function public.record_customer_credit_payment(uuid, uuid, uuid, jsonb, text)
  from public, anon;
revoke execute on function public.get_customer_credit_statement(uuid, date, date)
  from public, anon;
grant execute on function public.create_credit_sale(uuid, uuid, jsonb, jsonb, uuid, date, jsonb, text),
  public.record_customer_credit_payment(uuid, uuid, uuid, jsonb, text),
  public.get_customer_credit_statement(uuid, date, date)
  to authenticated, service_role;

comment on table public.customer_credit_payments is
  'Comprobantes inmutables de abonos. El efectivo real se refleja en cash_movements; el crédito nunca se registra como cobro.';
comment on table public.customer_credit_allocations is
  'Aplicación FIFO de abonos a cargos. Permite conocer qué vencimientos siguen abiertos sin sobrescribir saldos.';

commit;
