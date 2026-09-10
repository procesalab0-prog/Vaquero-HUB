begin;

-- M7.1 · Autorización y cartera de crédito. Esta entrega no crea ventas ni
-- recibe abonos todavía: prepara el límite global y el libro inmutable que
-- usarán las siguientes entregas sin exponer tablas al cliente.
insert into public.permissions (code, category, description) values
  ('credit.sell', 'Clientes', 'Registrar ventas a crédito autorizadas'),
  ('credit.collect', 'Clientes', 'Recibir abonos de crédito'),
  ('credit.override', 'Clientes', 'Autorizar excepciones de crédito vencido')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code in ('credit.sell', 'credit.collect', 'credit.override')
where r.code = 'ADMIN'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code in ('credit.sell', 'credit.collect')
where r.code = 'MANAGER'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code in ('credit.sell', 'credit.collect')
where r.code = 'CASHIER'
on conflict do nothing;

create table public.customer_credit_accounts (
  customer_id uuid primary key references public.customers(id),
  is_authorized boolean not null default false,
  limit_cents bigint not null default 0 check (limit_cents between 0 and 100000000),
  authorized_by uuid references public.app_users(id),
  authorized_at timestamptz,
  updated_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_credit_authorization_complete check (
    (is_authorized and limit_cents > 0 and authorized_by is not null and authorized_at is not null)
    or
    (not is_authorized and limit_cents = 0 and authorized_by is null and authorized_at is null)
  )
);

create table public.customer_credit_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  entry_type text not null check (entry_type in ('CHARGE', 'PAYMENT', 'RETURN', 'CANCELLATION', 'ADJUSTMENT')),
  amount_cents bigint not null check (amount_cents <> 0),
  occurred_at timestamptz not null default now(),
  due_date date,
  location_id uuid not null references public.locations(id),
  actor_user_id uuid not null references public.app_users(id),
  reference_type text not null check (btrim(reference_type) <> ''),
  reference_id text not null check (btrim(reference_id) <> ''),
  reason text check (reason is null or length(btrim(reason)) between 3 and 500),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  constraint credit_charge_due_date check (
    (entry_type = 'CHARGE' and amount_cents > 0 and due_date is not null)
    or (entry_type <> 'CHARGE' and due_date is null)
  ),
  unique (entry_type, reference_type, reference_id)
);

create index customer_credit_ledger_customer_date_idx
  on public.customer_credit_ledger (customer_id, occurred_at desc, id);
create index customer_credit_ledger_open_due_idx
  on public.customer_credit_ledger (customer_id, due_date)
  where entry_type = 'CHARGE';
create index customer_credit_accounts_authorized_idx
  on public.customer_credit_accounts (is_authorized, updated_at desc);

create trigger customer_credit_accounts_touch_updated_at
before update on public.customer_credit_accounts
for each row execute function app.touch_updated_at();

create or replace function app.guard_credit_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'CREDIT_LEDGER_IMMUTABLE' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.credit_write', true), 'off') <> 'on' then
    raise exception 'DIRECT_CREDIT_LEDGER_WRITE_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger customer_credit_ledger_guard
before insert or update or delete on public.customer_credit_ledger
for each row execute function app.guard_credit_ledger();

create or replace function app.credit_balance(p_customer_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.amount_cents), 0)::bigint
  from public.customer_credit_ledger l
  where l.customer_id = p_customer_id
$$;

create or replace function public.set_customer_credit(
  p_customer_id uuid,
  p_is_authorized boolean,
  p_limit_cents bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_before public.customer_credit_accounts;
  v_after public.customer_credit_accounts;
  v_balance bigint;
begin
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not (select app.has_perm('customers.credit')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_customer_id is null
     or p_is_authorized is null
     or p_limit_cents is null
     or p_limit_cents < 0
     or p_limit_cents > 100000000
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'INVALID_CREDIT_SETTINGS' using errcode = '22023';
  end if;
  if p_is_authorized and p_limit_cents <= 0 then
    raise exception 'CREDIT_LIMIT_REQUIRED' using errcode = '22023';
  end if;
  if not p_is_authorized and p_limit_cents <> 0 then
    raise exception 'DISABLED_CREDIT_LIMIT_MUST_BE_ZERO' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and not c.is_anonymized
  ) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer-credit:' || p_customer_id::text, 0));
  select * into v_before
  from public.customer_credit_accounts
  where customer_id = p_customer_id
  for update;
  v_balance := (select app.credit_balance(p_customer_id));

  if not p_is_authorized and v_balance <> 0 then
    raise exception 'CREDIT_BALANCE_REMAINS' using errcode = '23514';
  end if;
  if p_is_authorized and p_limit_cents < v_balance then
    raise exception 'CREDIT_LIMIT_BELOW_BALANCE' using errcode = '23514';
  end if;

  insert into public.customer_credit_accounts (
    customer_id, is_authorized, limit_cents, authorized_by, authorized_at, updated_by
  ) values (
    p_customer_id,
    p_is_authorized,
    case when p_is_authorized then p_limit_cents else 0 end,
    case when p_is_authorized then v_actor else null end,
    case when p_is_authorized then now() else null end,
    v_actor
  )
  on conflict (customer_id) do update set
    is_authorized = excluded.is_authorized,
    limit_cents = excluded.limit_cents,
    authorized_by = case
      when excluded.is_authorized and not public.customer_credit_accounts.is_authorized then excluded.authorized_by
      when excluded.is_authorized then public.customer_credit_accounts.authorized_by
      else null
    end,
    authorized_at = case
      when excluded.is_authorized and not public.customer_credit_accounts.is_authorized then excluded.authorized_at
      when excluded.is_authorized then public.customer_credit_accounts.authorized_at
      else null
    end,
    updated_by = excluded.updated_by
  returning * into v_after;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, before_data, after_data, metadata
  ) values (
    v_actor,
    'customer_credit.settings_changed',
    'customer_credit_accounts',
    p_customer_id::text,
    case when v_before.customer_id is null then null else jsonb_build_object(
      'is_authorized', v_before.is_authorized,
      'limit_cents', v_before.limit_cents
    ) end,
    jsonb_build_object('is_authorized', v_after.is_authorized, 'limit_cents', v_after.limit_cents),
    jsonb_build_object('reason', btrim(p_reason), 'balance_cents', v_balance)
  );

  return jsonb_build_object(
    'customer_id', p_customer_id,
    'is_authorized', v_after.is_authorized,
    'limit_cents', v_after.limit_cents,
    'balance_cents', v_balance,
    'available_cents', greatest(v_after.limit_cents - v_balance, 0),
    'updated_at', v_after.updated_at
  );
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
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not ((select app.has_perm('pos.sell')) or (select app.has_perm('customers.credit'))) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.customers c where c.id = p_customer_id and not c.is_anonymized
  ) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_account
  from public.customer_credit_accounts
  where customer_id = p_customer_id;
  v_balance := (select app.credit_balance(p_customer_id));
  select min(l.due_date) into v_oldest_due
  from public.customer_credit_ledger l
  where l.customer_id = p_customer_id and l.entry_type = 'CHARGE';

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
  p_query text default '',
  p_limit integer default 100
)
returns table (
  customer_id uuid,
  member_number text,
  full_name text,
  is_authorized boolean,
  limit_cents bigint,
  balance_cents bigint,
  available_cents bigint,
  oldest_due_date date,
  has_overdue boolean,
  updated_at timestamptz
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
  if v_actor is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not (select app.has_perm('customers.credit')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(v_query) > 100 or p_limit not between 1 and 200 then
    raise exception 'INVALID_CREDIT_QUERY' using errcode = '22023';
  end if;

  return query
  select
    c.id,
    c.member_number,
    c.full_name,
    coalesce(a.is_authorized, false),
    coalesce(a.limit_cents, 0),
    coalesce(b.balance_cents, 0),
    greatest(coalesce(a.limit_cents, 0) - coalesce(b.balance_cents, 0), 0),
    b.oldest_due_date,
    coalesce(b.oldest_due_date < current_date and b.balance_cents > 0, false),
    a.updated_at
  from public.customers c
  left join public.customer_credit_accounts a on a.customer_id = c.id
  left join lateral (
    select
      coalesce(sum(l.amount_cents), 0)::bigint as balance_cents,
      min(l.due_date) filter (where l.entry_type = 'CHARGE') as oldest_due_date
    from public.customer_credit_ledger l
    where l.customer_id = c.id
  ) b on true
  where not c.is_anonymized
    and (
      v_query = ''
      or c.search_name like '%' || v_query || '%'
      or c.member_number like '%' || v_query || '%'
      or (
        length(regexp_replace(v_query, '[^0-9]', '', 'g')) >= 3
        and coalesce(c.phone_e164, '') like '%' || regexp_replace(v_query, '[^0-9]', '', 'g') || '%'
      )
    )
  order by coalesce(a.is_authorized, false) desc, c.full_name, c.id
  limit p_limit;
end;
$$;

alter table public.customer_credit_accounts enable row level security;
alter table public.customer_credit_ledger enable row level security;

revoke all on public.customer_credit_accounts, public.customer_credit_ledger
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.customer_credit_accounts, public.customer_credit_ledger
  to service_role;

revoke execute on function app.guard_credit_ledger() from public, anon, authenticated, service_role;
revoke execute on function app.credit_balance(uuid) from public, anon, authenticated;
grant execute on function app.credit_balance(uuid) to service_role;

revoke execute on function public.set_customer_credit(uuid, boolean, bigint, text) from public, anon;
revoke execute on function public.get_customer_credit_summary(uuid) from public, anon;
revoke execute on function public.list_customer_credit_accounts(text, integer) from public, anon;
grant execute on function public.set_customer_credit(uuid, boolean, bigint, text) to authenticated, service_role;
grant execute on function public.get_customer_credit_summary(uuid) to authenticated, service_role;
grant execute on function public.list_customer_credit_accounts(text, integer) to authenticated, service_role;

commit;
