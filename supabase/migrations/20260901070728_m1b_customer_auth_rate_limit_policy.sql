begin;

drop policy if exists customer_auth_rate_limits_deny_all
on app.customer_auth_rate_limits;

create policy customer_auth_rate_limits_deny_all
on app.customer_auth_rate_limits
for all
to public
using (false)
with check (false);

commit;
