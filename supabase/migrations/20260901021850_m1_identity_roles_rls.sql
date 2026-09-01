begin;

create table public.locations (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code = upper(btrim(code)) and btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  type text not null check (type in ('STORE', 'WAREHOUSE', 'TRANSIT')),
  legal_name text,
  tax_id text,
  address text,
  phone text,
  timezone text not null default 'America/Mexico_City',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code = upper(btrim(code)) and btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.permissions (
  code text primary key check (code = lower(btrim(code)) and btrim(code) <> ''),
  category text not null check (btrim(category) <> ''),
  description text not null check (btrim(description) <> '')
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create index role_permissions_permission_code_idx
  on public.role_permissions (permission_code);

create table public.app_users (
  id uuid primary key references auth.users(id) on delete restrict,
  employee_code text not null unique
    check (employee_code = upper(btrim(employee_code)) and btrim(employee_code) <> ''),
  full_name text not null check (btrim(full_name) <> ''),
  email text,
  role_id uuid not null references public.roles(id),
  supervisor_pin_hash text,
  pin_failed_attempts int not null default 0 check (pin_failed_attempts >= 0),
  pin_locked_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index app_users_role_id_idx on public.app_users (role_id);

create table public.user_locations (
  user_id uuid not null references public.app_users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  primary key (user_id, location_id)
);

create index user_locations_location_id_idx
  on public.user_locations (location_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references public.app_users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  location_id uuid references public.locations(id),
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  ip_address inet,
  user_agent text
);

create index audit_log_occurred_at_idx
  on public.audit_log (occurred_at desc);
create index audit_log_entity_idx
  on public.audit_log (entity_type, entity_id);
create index audit_log_actor_occurred_at_idx
  on public.audit_log (actor_user_id, occurred_at desc);
create index audit_log_location_occurred_at_idx
  on public.audit_log (location_id, occurred_at desc);

insert into public.locations (code, name, type, is_active)
values ('TRANSIT', 'Mercancía en tránsito', 'TRANSIT', true);

insert into public.roles (code, name, is_system) values
  ('ADMIN', 'Administrador', true),
  ('MANAGER', 'Gerente', true),
  ('CASHIER', 'Cajero', true),
  ('WAREHOUSE', 'Almacén', true);

insert into public.permissions (code, category, description) values
  ('users.manage', 'Administración', 'Crear, editar y desactivar empleados'),
  ('roles.manage', 'Administración', 'Editar roles y sus permisos'),
  ('locations.manage', 'Administración', 'Crear y editar sucursales'),
  ('audit.read', 'Administración', 'Consultar la bitácora'),
  ('products.read', 'Catálogo', 'Consultar productos'),
  ('products.create', 'Catálogo', 'Dar de alta productos y variantes'),
  ('products.update', 'Catálogo', 'Editar datos de productos'),
  ('products.price_update', 'Catálogo', 'Cambiar precios'),
  ('inventory.read', 'Inventario', 'Consultar existencias'),
  ('inventory.adjust', 'Inventario', 'Ajustar existencias'),
  ('inventory.count', 'Inventario', 'Realizar conteos'),
  ('transfers.create', 'Inventario', 'Solicitar traspasos'),
  ('transfers.approve', 'Inventario', 'Autorizar traspasos'),
  ('transfers.receive', 'Inventario', 'Recibir traspasos'),
  ('pos.sell', 'Punto de venta', 'Registrar ventas'),
  ('sales.discount', 'Punto de venta', 'Autorizar descuentos'),
  ('sales.cancel', 'Punto de venta', 'Cancelar ventas'),
  ('returns.create', 'Punto de venta', 'Registrar devoluciones y cambios'),
  ('layaways.manage', 'Punto de venta', 'Administrar apartados'),
  ('cash.open', 'Caja', 'Abrir caja'),
  ('cash.close', 'Caja', 'Cerrar caja y hacer corte'),
  ('cash.movement', 'Caja', 'Registrar entradas y salidas de efectivo'),
  ('purchases.manage', 'Compras', 'Crear y editar compras'),
  ('purchases.receive', 'Compras', 'Recibir mercancía'),
  ('customers.manage', 'Clientes', 'Administrar clientes'),
  ('customers.credit', 'Clientes', 'Autorizar y administrar crédito'),
  ('reports.sales', 'Reportes', 'Ver reportes de ventas'),
  ('reports.inventory', 'Reportes', 'Ver reportes de inventario'),
  ('reports.discounts', 'Reportes', 'Ver reportes de descuentos');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
cross join public.permissions p
where r.code = 'ADMIN';

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
cross join public.permissions p
where r.code = 'MANAGER'
  and p.code not in ('users.manage', 'roles.manage', 'locations.manage');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code = any (array[
  'products.read', 'inventory.read', 'pos.sell', 'returns.create',
  'layaways.manage', 'cash.open', 'cash.close', 'cash.movement',
  'customers.manage'
])
where r.code = 'CASHIER';

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.code = any (array[
  'products.read', 'products.create', 'inventory.read', 'inventory.count',
  'transfers.create', 'transfers.receive', 'purchases.receive'
])
where r.code = 'WAREHOUSE';

create or replace function app.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.app_users u
  where u.id = (select auth.uid())
    and u.is_active
$$;

create or replace function app.has_perm(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users u
    join public.role_permissions rp on rp.role_id = u.role_id
    where u.id = (select auth.uid())
      and u.is_active
      and rp.permission_code = p_code
  )
$$;

create or replace function app.can_access_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_locations ul
    join public.app_users u on u.id = ul.user_id
    where ul.user_id = (select auth.uid())
      and ul.location_id = p_location_id
      and u.is_active
  )
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger locations_touch_updated_at
before update on public.locations
for each row execute function app.touch_updated_at();

create trigger app_users_touch_updated_at
before update on public.app_users
for each row execute function app.touch_updated_at();

create or replace function app.protect_system_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'SYSTEM_ROLE_IMMUTABLE' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.is_system
     and (new.code <> old.code or not new.is_system) then
    raise exception 'SYSTEM_ROLE_IMMUTABLE' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger roles_protect_system
before update or delete on public.roles
for each row execute function app.protect_system_role();

create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_record jsonb;
  v_entity_id text;
  v_location_id uuid;
begin
  v_before := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after := case when tg_op = 'DELETE' then null else to_jsonb(new) end;

  if tg_table_name = 'app_users' then
    v_before := v_before - 'supervisor_pin_hash';
    v_after := v_after - 'supervisor_pin_hash';
  end if;

  v_record := coalesce(v_after, v_before);
  v_entity_id := coalesce(
    v_record ->> 'id',
    v_record ->> 'code',
    nullif(concat_ws(':', v_record ->> 'role_id', v_record ->> 'permission_code'), ''),
    nullif(concat_ws(':', v_record ->> 'user_id', v_record ->> 'location_id'), '')
  );

  if nullif(v_record ->> 'location_id', '') is not null then
    v_location_id := (v_record ->> 'location_id')::uuid;
  elsif tg_table_name = 'locations' then
    v_location_id := (v_record ->> 'id')::uuid;
  end if;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, location_id,
    before_data, after_data, metadata
  ) values (
    (select app.current_user_id()),
    lower(tg_table_name || '.' || tg_op),
    tg_table_name,
    v_entity_id,
    v_location_id,
    v_before,
    v_after,
    jsonb_build_object('source', 'database_trigger')
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger locations_audit
after insert or update or delete on public.locations
for each row execute function app.audit_row_change();
create trigger roles_audit
after insert or update or delete on public.roles
for each row execute function app.audit_row_change();
create trigger permissions_audit
after insert or update or delete on public.permissions
for each row execute function app.audit_row_change();
create trigger role_permissions_audit
after insert or update or delete on public.role_permissions
for each row execute function app.audit_row_change();
create trigger app_users_audit
after insert or update on public.app_users
for each row execute function app.audit_row_change();
create trigger user_locations_audit
after insert or update or delete on public.user_locations
for each row execute function app.audit_row_change();

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
  v_actor uuid;
  v_user public.app_users;
  v_locked_until timestamptz;
begin
  v_actor := (select app.current_user_id());
  if v_actor is null then
    return jsonb_build_object('status', 'NOT_AUTHENTICATED');
  end if;

  select * into v_user
  from public.app_users
  where employee_code = upper(btrim(p_employee_code)) and is_active
  for update;

  if not found then
    perform pg_sleep(0.5);
    return jsonb_build_object('status', 'INVALID_CREDENTIALS');
  end if;

  if v_user.pin_locked_until is not null and v_user.pin_locked_until > now() then
    perform pg_sleep(0.5);
    return jsonb_build_object(
      'status', 'PIN_LOCKED',
      'locked_until', v_user.pin_locked_until
    );
  end if;

  if v_user.supervisor_pin_hash is null
     or extensions.crypt(p_pin, v_user.supervisor_pin_hash) <> v_user.supervisor_pin_hash
  then
    perform pg_sleep(0.5);
    v_locked_until := case
      when v_user.pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes'
      else null
    end;

    update public.app_users
    set pin_failed_attempts = pin_failed_attempts + 1,
        pin_locked_until = v_locked_until
    where id = v_user.id;

    insert into public.audit_log (
      actor_user_id, action, entity_type, entity_id, metadata
    ) values (
      v_actor, 'supervisor_pin.failed', 'app_users', v_user.id::text,
      jsonb_build_object('permission', p_permission, 'locked', v_locked_until is not null)
    );

    return jsonb_build_object('status', 'INVALID_CREDENTIALS');
  end if;

  if not exists (
    select 1
    from public.role_permissions rp
    where rp.role_id = v_user.role_id
      and rp.permission_code = p_permission
  ) then
    insert into public.audit_log (
      actor_user_id, action, entity_type, entity_id, metadata
    ) values (
      v_actor, 'supervisor_pin.denied', 'app_users', v_user.id::text,
      jsonb_build_object('permission', p_permission)
    );

    return jsonb_build_object('status', 'INSUFFICIENT_PERMISSION');
  end if;

  update public.app_users
  set pin_failed_attempts = 0,
      pin_locked_until = null
  where id = v_user.id;

  insert into public.audit_log (
    actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    v_actor, 'supervisor_pin.authorized', 'app_users', v_user.id::text,
    jsonb_build_object('permission', p_permission)
  );

  return jsonb_build_object(
    'status', 'AUTHORIZED',
    'supervisor_user_id', v_user.id
  );
end;
$$;

create or replace function public.update_my_profile(
  p_full_name text default null,
  p_new_pin text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := (select app.current_user_id());
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if p_full_name is not null and btrim(p_full_name) = '' then
    raise exception 'INVALID_FULL_NAME' using errcode = '22023';
  end if;

  if p_new_pin is not null and p_new_pin !~ '^[0-9]{4,8}$' then
    raise exception 'INVALID_PIN_FORMAT' using errcode = '22023';
  end if;

  update public.app_users
  set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
      supervisor_pin_hash = case
        when p_new_pin is null then supervisor_pin_hash
        else extensions.crypt(p_new_pin, extensions.gen_salt('bf'))
      end
  where id = v_user_id;
end;
$$;

alter table public.locations enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.app_users enable row level security;
alter table public.user_locations enable row level security;
alter table public.audit_log enable row level security;

create policy locations_select on public.locations
for select to authenticated
using (
  (select app.can_access_location(id))
  or (select app.has_perm('locations.manage'))
);
create policy locations_insert on public.locations
for insert to authenticated
with check ((select app.has_perm('locations.manage')));
create policy locations_update on public.locations
for update to authenticated
using ((select app.has_perm('locations.manage')))
with check ((select app.has_perm('locations.manage')));

create policy roles_select on public.roles
for select to authenticated
using ((select app.current_user_id()) is not null);
create policy roles_insert on public.roles
for insert to authenticated
with check ((select app.has_perm('roles.manage')));
create policy roles_update on public.roles
for update to authenticated
using ((select app.has_perm('roles.manage')))
with check ((select app.has_perm('roles.manage')));
create policy roles_delete on public.roles
for delete to authenticated
using ((select app.has_perm('roles.manage')));

create policy permissions_select on public.permissions
for select to authenticated
using ((select app.current_user_id()) is not null);
create policy permissions_insert on public.permissions
for insert to authenticated
with check ((select app.has_perm('roles.manage')));
create policy permissions_update on public.permissions
for update to authenticated
using ((select app.has_perm('roles.manage')))
with check ((select app.has_perm('roles.manage')));
create policy permissions_delete on public.permissions
for delete to authenticated
using ((select app.has_perm('roles.manage')));

create policy role_permissions_select on public.role_permissions
for select to authenticated
using ((select app.current_user_id()) is not null);
create policy role_permissions_insert on public.role_permissions
for insert to authenticated
with check ((select app.has_perm('roles.manage')));
create policy role_permissions_delete on public.role_permissions
for delete to authenticated
using ((select app.has_perm('roles.manage')));

create policy app_users_select on public.app_users
for select to authenticated
using (
  id = (select app.current_user_id())
  or (select app.has_perm('users.manage'))
);
create policy app_users_insert on public.app_users
for insert to authenticated
with check (
  (select app.has_perm('users.manage'))
  and id <> (select app.current_user_id())
);
create policy app_users_update on public.app_users
for update to authenticated
using (
  (select app.has_perm('users.manage'))
  and id <> (select app.current_user_id())
)
with check (
  (select app.has_perm('users.manage'))
  and id <> (select app.current_user_id())
);

create policy user_locations_select on public.user_locations
for select to authenticated
using (
  user_id = (select app.current_user_id())
  or (select app.has_perm('users.manage'))
);
create policy user_locations_insert on public.user_locations
for insert to authenticated
with check (
  (select app.has_perm('users.manage'))
  and user_id <> (select app.current_user_id())
);
create policy user_locations_delete on public.user_locations
for delete to authenticated
using (
  (select app.has_perm('users.manage'))
  and user_id <> (select app.current_user_id())
);

create policy audit_log_select on public.audit_log
for select to authenticated
using ((select app.has_perm('audit.read')));

revoke all on public.locations from anon, authenticated;
revoke all on public.roles from anon, authenticated;
revoke all on public.permissions from anon, authenticated;
revoke all on public.role_permissions from anon, authenticated;
revoke all on public.app_users from anon, authenticated;
revoke all on public.user_locations from anon, authenticated;
revoke all on public.audit_log from anon, authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

grant select, insert, update on public.locations to authenticated;
grant select, insert, update, delete on public.roles to authenticated;
grant select, insert, update, delete on public.permissions to authenticated;
grant select, insert, delete on public.role_permissions to authenticated;
grant select, insert, update on public.app_users to authenticated;
grant select, insert, delete on public.user_locations to authenticated;
grant select on public.audit_log to authenticated;

revoke execute on function app.current_user_id() from public, anon;
revoke execute on function app.has_perm(text) from public, anon;
revoke execute on function app.can_access_location(uuid) from public, anon;
revoke execute on function app.touch_updated_at() from public, anon, authenticated;
revoke execute on function app.protect_system_role() from public, anon, authenticated;
revoke execute on function app.audit_row_change() from public, anon, authenticated;

grant execute on function app.current_user_id() to authenticated;
grant execute on function app.has_perm(text) to authenticated;
grant execute on function app.can_access_location(uuid) to authenticated;

revoke execute on function public.verify_supervisor_pin(text, text, text)
  from public, anon;
revoke execute on function public.update_my_profile(text, text)
  from public, anon;
grant execute on function public.verify_supervisor_pin(text, text, text)
  to authenticated;
grant execute on function public.update_my_profile(text, text)
  to authenticated;

commit;
