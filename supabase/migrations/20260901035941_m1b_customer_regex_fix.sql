begin;

alter table public.customers
  drop constraint customers_phone_format,
  drop constraint customers_email_format;

alter table public.customers
  add constraint customers_phone_format check (
    (is_anonymized and phone_e164 is null)
    or (not is_anonymized and phone_e164 is not null and phone_e164 ~ '^\+52[0-9]{10}$')
  ),
  add constraint customers_email_format check (
    email is null or (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  );

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

revoke execute on function public.search_customers(text, integer)
  from public, anon;
grant execute on function public.search_customers(text, integer)
  to authenticated;

commit;
