begin;

create table app.customer_auth_rate_limits (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  last_requested_at timestamptz not null default now()
);

alter table app.customer_auth_rate_limits enable row level security;

create policy customer_auth_rate_limits_deny_all
on app.customer_auth_rate_limits
for all
to public
using (false)
with check (false);

revoke all on app.customer_auth_rate_limits from public, anon, authenticated;
grant select, insert, update on app.customer_auth_rate_limits to service_role;

create or replace function public.reserve_customer_auth_request(
  p_customer_id uuid,
  p_min_interval_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserved uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_min_interval_seconds < 30 or p_min_interval_seconds > 3600 then
    raise exception 'INVALID_RATE_LIMIT' using errcode = '22023';
  end if;

  insert into app.customer_auth_rate_limits (customer_id, last_requested_at)
  values (p_customer_id, now())
  on conflict (customer_id) do update
    set last_requested_at = excluded.last_requested_at
    where app.customer_auth_rate_limits.last_requested_at
      <= now() - make_interval(secs => p_min_interval_seconds)
  returning customer_id into v_reserved;

  return v_reserved is not null;
end;
$$;

create or replace function public.get_my_customer_card()
returns table (
  customer_id uuid,
  member_number text,
  full_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.member_number, c.full_name
  from public.customers c
  where c.auth_user_id = (select auth.uid())
    and not c.is_anonymized
  limit 1;
$$;

revoke execute on function public.reserve_customer_auth_request(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_customer_auth_request(uuid, integer)
  to service_role;

revoke execute on function public.get_my_customer_card()
  from public, anon;
grant execute on function public.get_my_customer_card()
  to authenticated;

commit;
