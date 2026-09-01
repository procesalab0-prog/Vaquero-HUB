begin;

create sequence public.customer_member_number_seq
  as bigint
  start with 1000000
  minvalue 1000000
  maxvalue 9999999
  no cycle;

create or replace function app.normalize_mexico_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if left(v_digits, 4) = '0052' then
    v_digits := substr(v_digits, 5);
  elsif length(v_digits) = 12 and left(v_digits, 2) = '01' then
    v_digits := substr(v_digits, 3);
  end if;

  if length(v_digits) = 12 and left(v_digits, 2) = '52' then
    v_digits := substr(v_digits, 3);
  end if;

  if length(v_digits) <> 10 then
    return null;
  end if;

  return '+52' || v_digits;
end;
$$;

create or replace function app.member_check_digit(p_payload text)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_sum integer := 0;
  v_digit integer;
  v_position integer := 1;
begin
  if p_payload !~ '^[0-9]{7}$' then
    return null;
  end if;

  for v_position in reverse length(p_payload)..1 loop
    v_digit := substr(p_payload, v_position, 1)::integer *
      case when (length(p_payload) - v_position) % 2 = 0 then 2 else 1 end;
    if v_digit > 9 then
      v_digit := v_digit - 9;
    end if;
    v_sum := v_sum + v_digit;
  end loop;

  return (10 - (v_sum % 10)) % 10;
end;
$$;

create or replace function app.is_valid_member_number(p_member_number text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_member_number ~ '^[0-9]{8}$'
    and right(p_member_number, 1)::integer = app.member_check_digit(left(p_member_number, 7))
$$;

create or replace function app.next_member_number()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_payload text := lpad(nextval('public.customer_member_number_seq')::text, 7, '0');
begin
  return v_payload || app.member_check_digit(v_payload)::text;
end;
$$;

create table public.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  member_number text not null unique default app.next_member_number()
    check (app.is_valid_member_number(member_number)),
  phone_e164 text,
  email text,
  full_name text not null check (btrim(full_name) <> ''),
  search_name text generated always as (
    lower(translate(full_name,
      'ÁÉÍÓÚÜÑáéíóúüñ',
      'AEIOUUNaeiouun'))
  ) stored,
  birthdate date,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  woocommerce_customer_id bigint unique,
  privacy_consent_at timestamptz,
  privacy_notice_version text,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  is_anonymized boolean not null default false,
  created_at_location_id uuid references public.locations(id),
  created_by uuid references public.app_users(id),
  updated_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_phone_format check (
    (is_anonymized and phone_e164 is null)
    or (not is_anonymized and phone_e164 is not null and phone_e164 ~ '^\+52[0-9]{10}$')
  ),
  constraint customers_email_format check (
    email is null or (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  constraint customers_privacy_consent check (
    is_anonymized
    or (privacy_consent_at is not null and nullif(btrim(privacy_notice_version), '') is not null)
  ),
  constraint customers_marketing_consent check (
    (marketing_consent and marketing_consent_at is not null)
    or (not marketing_consent and marketing_consent_at is null)
  ),
  constraint customers_anonymized_fields check (
    not is_anonymized
    or (phone_e164 is null and email is null and birthdate is null and full_name = 'Cliente anonimizado')
  )
);

create unique index customers_phone_e164_unique_idx
  on public.customers (phone_e164)
  where phone_e164 is not null;
create unique index customers_email_unique_idx
  on public.customers (email)
  where email is not null and not is_anonymized;
create index customers_search_name_idx on public.customers (search_name);
create index customers_created_at_idx on public.customers (created_at desc);
create index customers_birthdate_idx on public.customers (birthdate)
  where birthdate is not null and not is_anonymized;
create index customers_auth_user_id_idx on public.customers (auth_user_id)
  where auth_user_id is not null;
create index customers_created_at_location_id_idx on public.customers (created_at_location_id);
create index customers_created_by_idx on public.customers (created_by);
create index customers_updated_by_idx on public.customers (updated_by);

create trigger customers_touch_updated_at
before update on public.customers
for each row execute function app.touch_updated_at();

create or replace function app.audit_customer_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed_fields text[] := array[]::text[];
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(key order by key), array[]::text[])
      into v_changed_fields
    from jsonb_each(to_jsonb(new) - array['updated_at', 'updated_by']) current_value
    where (to_jsonb(old) - array['updated_at', 'updated_by']) -> current_value.key
      is distinct from current_value.value;
  end if;

  insert into public.audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    location_id,
    metadata
  ) values (
    (select app.current_user_id()),
    lower('customers.' || tg_op),
    'customers',
    coalesce(new.id, old.id)::text,
    coalesce(new.created_at_location_id, old.created_at_location_id),
    jsonb_build_object(
      'source', 'database_trigger',
      'member_number', coalesce(new.member_number, old.member_number),
      'changed_fields', to_jsonb(v_changed_fields)
    )
  );

  return coalesce(new, old);
end;
$$;

create trigger customers_audit
after insert or update on public.customers
for each row execute function app.audit_customer_change();

create or replace function public.create_customer(
  p_full_name text,
  p_phone text,
  p_email text default null,
  p_birthdate date default null,
  p_location_id uuid default null,
  p_privacy_notice_version text default null,
  p_marketing_consent boolean default false
)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_phone text := app.normalize_mexico_phone(p_phone);
  v_email text := nullif(lower(btrim(p_email)), '');
  v_customer public.customers;
begin
  if v_actor is null or not (select app.has_perm('customers.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null or v_phone is null then
    raise exception 'INVALID_CUSTOMER_DATA' using errcode = '22023';
  end if;
  if nullif(btrim(p_privacy_notice_version), '') is null then
    raise exception 'PRIVACY_NOTICE_REQUIRED' using errcode = '22023';
  end if;
  if p_location_id is not null and not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_NOT_ALLOWED' using errcode = '42501';
  end if;

  insert into public.customers (
    full_name,
    phone_e164,
    email,
    birthdate,
    created_at_location_id,
    created_by,
    updated_by,
    privacy_consent_at,
    privacy_notice_version,
    marketing_consent,
    marketing_consent_at
  ) values (
    btrim(p_full_name),
    v_phone,
    v_email,
    p_birthdate,
    p_location_id,
    v_actor,
    v_actor,
    now(),
    btrim(p_privacy_notice_version),
    p_marketing_consent,
    case when p_marketing_consent then now() else null end
  )
  returning * into v_customer;

  return v_customer;
exception
  when unique_violation then
    raise exception 'CUSTOMER_ALREADY_EXISTS' using errcode = '23505';
end;
$$;

create or replace function public.update_customer(
  p_customer_id uuid,
  p_full_name text,
  p_phone text,
  p_email text default null,
  p_birthdate date default null,
  p_marketing_consent boolean default false
)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_phone text := app.normalize_mexico_phone(p_phone);
  v_email text := nullif(lower(btrim(p_email)), '');
  v_customer public.customers;
begin
  if v_actor is null or not (select app.has_perm('customers.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null or v_phone is null then
    raise exception 'INVALID_CUSTOMER_DATA' using errcode = '22023';
  end if;

  update public.customers
  set full_name = btrim(p_full_name),
      phone_e164 = v_phone,
      email = v_email,
      birthdate = p_birthdate,
      marketing_consent = p_marketing_consent,
      marketing_consent_at = case
        when p_marketing_consent and not marketing_consent then now()
        when p_marketing_consent then marketing_consent_at
        else null
      end,
      updated_by = v_actor
  where id = p_customer_id
    and not is_anonymized
  returning * into v_customer;

  if v_customer.id is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_customer;
exception
  when unique_violation then
    raise exception 'CUSTOMER_ALREADY_EXISTS' using errcode = '23505';
end;
$$;

create or replace function public.search_customers(
  p_query text,
  p_limit integer default 10
)
returns table (
  id uuid,
  member_number text,
  full_name text,
  phone_e164 text,
  email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.current_user_id());
  v_term text := lower(translate(btrim(coalesce(p_query, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
  v_digits text := regexp_replace(coalesce(p_query, ''), '[^0-9]', '', 'g');
  v_phone text := app.normalize_mexico_phone(p_query);
  v_like text;
begin
  if v_actor is null or not (select app.has_perm('customers.manage')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if length(v_term) < 3 and length(v_digits) <> 4 and length(v_digits) <> 8 then
    return;
  end if;

  v_like := '%' || replace(replace(replace(v_term, '!', '!!'), '%', '!%'), '_', '!_') || '%';

  return query
  select c.id, c.member_number, c.full_name, c.phone_e164, c.email
  from public.customers c
  where not c.is_anonymized
    and (
      c.member_number = v_digits
      or (length(v_digits) = 4 and right(c.phone_e164, 4) = v_digits)
      or (v_phone is not null and c.phone_e164 = v_phone)
      or c.search_name like v_like escape '!'
      or lower(coalesce(c.email, '')) like v_like escape '!'
    )
  order by
    case
      when c.member_number = v_digits then 0
      when v_phone is not null and c.phone_e164 = v_phone then 1
      when length(v_digits) = 4 and right(c.phone_e164, 4) = v_digits then 2
      else 3
    end,
    c.full_name
  limit least(greatest(coalesce(p_limit, 10), 1), 20);
end;
$$;

insert into public.permissions (code, category, description)
values ('customers.export', 'Clientes', 'Exportar la base completa de clientes');

insert into public.role_permissions (role_id, permission_code)
select id, 'customers.export'
from public.roles
where code = 'ADMIN';

alter table public.customers enable row level security;

create policy customers_select on public.customers
for select to authenticated
using ((select app.has_perm('customers.manage')));

revoke all on public.customers from anon, authenticated;
revoke all on sequence public.customer_member_number_seq from anon, authenticated;
grant select on public.customers to authenticated;

revoke execute on function app.normalize_mexico_phone(text) from public, anon, authenticated;
revoke execute on function app.member_check_digit(text) from public, anon, authenticated;
revoke execute on function app.is_valid_member_number(text) from public, anon, authenticated;
revoke execute on function app.next_member_number() from public, anon, authenticated;
revoke execute on function app.audit_customer_change() from public, anon, authenticated;

revoke execute on function public.create_customer(text, text, text, date, uuid, text, boolean)
  from public, anon;
revoke execute on function public.update_customer(uuid, text, text, text, date, boolean)
  from public, anon;
revoke execute on function public.search_customers(text, integer)
  from public, anon;

grant execute on function public.create_customer(text, text, text, date, uuid, text, boolean)
  to authenticated;
grant execute on function public.update_customer(uuid, text, text, text, date, boolean)
  to authenticated;
grant execute on function public.search_customers(text, integer)
  to authenticated;

grant select, insert, update on public.customers to service_role;
grant usage, select on sequence public.customer_member_number_seq to service_role;
grant execute on function app.normalize_mexico_phone(text) to service_role;
grant execute on function app.member_check_digit(text) to service_role;
grant execute on function app.is_valid_member_number(text) to service_role;
grant execute on function app.next_member_number() to service_role;

commit;
