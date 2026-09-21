begin;

-- La versión original usaba 23505 para PHONE_ALREADY_REGISTERED y después
-- capturaba todos los 23505 en el bloque EXCEPTION de la misma función. Por
-- eso su propio error terminaba convertido en CUSTOMER_ALREADY_EXISTS. Este
-- error es una decisión de conciliación, no una violación cruda de índice, y
-- usa P0001 para conservar su nombre hasta la aplicación.
create or replace function public.complete_customer_self_registration(
  p_auth_user_id uuid,
  p_full_name text,
  p_phone text,
  p_birthdate date default null,
  p_privacy_notice_version text default null,
  p_marketing_consent boolean default false
)
returns table (
  customer_id uuid,
  member_number text,
  full_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := p_auth_user_id;
  v_email text;
  v_phone text := app.normalize_mexico_phone(p_phone);
  v_customer public.customers;
begin
  if v_auth_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.app_users u where u.id = v_auth_user_id
  ) then
    raise exception 'STAFF_ACCOUNT_NOT_ALLOWED' using errcode = '42501';
  end if;

  select lower(btrim(u.email))
    into v_email
  from auth.users u
  where u.id = v_auth_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null;

  if v_email is null then
    raise exception 'VERIFIED_EMAIL_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_full_name), '') is null
     or length(btrim(p_full_name)) < 2
     or length(btrim(p_full_name)) > 120
     or v_phone is null then
    raise exception 'INVALID_CUSTOMER_DATA' using errcode = '22023';
  end if;
  if p_birthdate is not null
     and (p_birthdate < date '1900-01-01' or p_birthdate > current_date) then
    raise exception 'INVALID_BIRTHDATE' using errcode = '22023';
  end if;
  if nullif(btrim(p_privacy_notice_version), '') is null then
    raise exception 'PRIVACY_NOTICE_REQUIRED' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(least(v_email, v_phone), 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(greatest(v_email, v_phone), 0)
  );

  select c.* into v_customer
  from public.customers c
  where c.auth_user_id = v_auth_user_id
    and not c.is_anonymized
  for update;

  if found then
    return query
      select v_customer.id, v_customer.member_number, v_customer.full_name;
    return;
  end if;

  select c.* into v_customer
  from public.customers c
  where c.email = v_email
    and not c.is_anonymized
  for update;

  if found then
    if v_customer.auth_user_id is not null
       and v_customer.auth_user_id <> v_auth_user_id then
      raise exception 'CUSTOMER_ACCOUNT_ALREADY_LINKED' using errcode = 'P0001';
    end if;

    update public.customers
       set auth_user_id = v_auth_user_id,
           privacy_consent_at = now(),
           privacy_notice_version = btrim(p_privacy_notice_version),
           marketing_consent = marketing_consent or p_marketing_consent,
           marketing_consent_at = case
             when marketing_consent then marketing_consent_at
             when p_marketing_consent then now()
             else null
           end,
           updated_by = null
     where id = v_customer.id
     returning * into v_customer;

    insert into public.audit_log (
      action, entity_type, entity_id, metadata
    ) values (
      'customers.self_registration_linked',
      'customers',
      v_customer.id::text,
      jsonb_build_object(
        'member_number', v_customer.member_number,
        'source', 'customer_pwa'
      )
    );

    return query
      select v_customer.id, v_customer.member_number, v_customer.full_name;
    return;
  end if;

  if exists (
    select 1
    from public.customers c
    where c.phone_e164 = v_phone
      and not c.is_anonymized
  ) then
    raise exception 'PHONE_ALREADY_REGISTERED' using errcode = 'P0001';
  end if;

  insert into public.customers (
    full_name,
    phone_e164,
    email,
    birthdate,
    auth_user_id,
    privacy_consent_at,
    privacy_notice_version,
    marketing_consent,
    marketing_consent_at
  ) values (
    btrim(p_full_name),
    v_phone,
    v_email,
    p_birthdate,
    v_auth_user_id,
    now(),
    btrim(p_privacy_notice_version),
    p_marketing_consent,
    case when p_marketing_consent then now() else null end
  )
  returning * into v_customer;

  insert into public.audit_log (
    action, entity_type, entity_id, metadata
  ) values (
    'customers.self_registered',
    'customers',
    v_customer.id::text,
    jsonb_build_object(
      'member_number', v_customer.member_number,
      'marketing_consent', p_marketing_consent,
      'privacy_notice_version', btrim(p_privacy_notice_version),
      'source', 'customer_pwa'
    )
  );

  return query
    select v_customer.id, v_customer.member_number, v_customer.full_name;
exception
  when unique_violation then
    raise exception 'CUSTOMER_ALREADY_EXISTS' using errcode = '23505';
end;
$$;

commit;
