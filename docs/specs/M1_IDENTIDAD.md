# M1 — Identidad, roles, permisos y sucursales

> Especificación para Codex. El SQL de este documento es la decisión
> arquitectónica y se implementa tal cual, salvo que Codex encuentre un
> problema — en ese caso lo levanta antes de desviarse.
>
> Todas las tablas del sistema van a colgar de este modelo de permisos y
> ubicaciones. Es el milestone donde un error sale más caro.

## 1. Principios

1. **Deny by default.** RLS activo en todas las tablas. Sin política, no
   hay acceso.
2. **Un usuario ve sólo sus sucursales**, salvo que tenga un permiso
   explícito que lo amplíe.
3. **Nadie puede elevarse a sí mismo.** Un usuario no puede modificar su
   propio rol ni sus propias sucursales.
4. **La bitácora no se toca.** `audit_log` es de sólo inserción, para
   todos, incluido el administrador.
5. Los permisos se validan **también** en el servidor, no sólo con RLS.

### 1.1 Superficies de acceso: quién tiene cuenta y quién no

| Superficie | ¿Tiene cuenta? | Cómo se identifica | Dónde vive |
|---|---|---|---|
| Dueño / administración | Sí | Supabase Auth | `app_users`, rol `ADMIN` |
| Trabajadores | Sí, la crea el administrador | Supabase Auth | `app_users`, roles `MANAGER` / `CASHIER` / `WAREHOUSE` |
| Cliente con tarjeta de lealtad | **Opcional y perezosa** | Su teléfono, o el QR de su tarjeta | `customers` (M7); usuario de Auth sólo si algún día inicia sesión |

**Administración y trabajadores son el mismo sistema, no dos.** Una sola
aplicación, un solo inicio de sesión, una sola tabla de empleados. El rol
decide qué se ve. No se construyen dos aplicaciones separadas; sí se
construye una vista de POS propia, pensada para tocar en iPad, que no es
el panel de administración encogido.

**El cliente sí puede tener cuenta, pero nunca se le exige.** El registro
del cliente y su cuenta de acceso son cosas distintas: el registro existe
desde su primera compra, y la cuenta se crea sólo si algún día quiere
entrar a ver sus puntos. En la caja jamás se pide crear una cuenta — se
pide el teléfono.

El detalle importante para este milestone: **un cliente autenticado no
obtiene absolutamente ningún acceso por el simple hecho de estar
autenticado.** Como `app.current_user_id()`, `app.has_perm()` y
`app.can_access_location()` parten todas de un registro en `app_users`, y
un cliente no lo tiene, las políticas lo niegan por construcción.

De ahí una regla que no se rompe: **ninguna política se escribe sobre
`auth.uid() is not null`.** Estar autenticado no significa nada por sí
solo.

El modelo completo de identidad del cliente, la tarjeta en el teléfono y
el enlace con WooCommerce está en
[`IDENTIDAD_CLIENTE.md`](IDENTIDAD_CLIENTE.md).

## 2. Esquemas y convenciones

- Tablas de negocio en `public`.
- Funciones auxiliares en el esquema `app`, que **no** se expone por la
  API. Así no son invocables desde el navegador.
- Las funciones que sí deben llamarse desde la aplicación van en `public`
  y validan permisos explícitamente.
- Toda función `SECURITY DEFINER` lleva `SET search_path = ''` y nombres
  totalmente calificados. Sin esto, un esquema malicioso en el
  `search_path` puede secuestrar la función.

## 3. Tablas

### 3.1 `locations`

```sql
create table public.locations (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  name         text not null,
  type         text not null check (type in ('STORE','WAREHOUSE','TRANSIT')),
  legal_name   text,
  tax_id       text,
  address      text,
  phone        text,
  timezone     text not null default 'America/Mexico_City',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

`type = 'TRANSIT'` es la ubicación de sistema que usarán los traspasos en
M3. Existe desde ahora para que las consultas de disponibilidad la
excluyan desde el primer día. `legal_name`, `tax_id` y `address` los
necesita el ticket impreso en M4.

### 3.2 `roles`, `permissions`, `role_permissions`

```sql
create table public.roles (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  is_system  boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.permissions (
  code        text primary key,
  category    text not null,
  description text not null
);

create table public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);
```

El código del permiso es la llave primaria a propósito: aparece legible en
las políticas y en la bitácora, sin necesidad de un join para saber qué
es.

`is_system` marca los cuatro roles base para que la interfaz no permita
borrarlos.

### 3.3 `app_users`

```sql
create table public.app_users (
  id                  uuid primary key references auth.users(id) on delete restrict,
  employee_code       text not null unique,
  full_name           text not null,
  email               text,
  role_id             uuid not null references public.roles(id),
  supervisor_pin_hash text,
  pin_failed_attempts int not null default 0,
  pin_locked_until    timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
```

`on delete restrict` es deliberado: borrar un usuario de Auth **no** debe
poder arrastrarse hacia la bitácora ni las ventas. A los empleados se les
desactiva, nunca se les borra.

El PIN de supervisor **se guarda con hash**, nunca en claro, y su
verificación vive en la función de la sección 6.

### 3.4 `user_locations`

```sql
create table public.user_locations (
  user_id     uuid not null references public.app_users(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  primary key (user_id, location_id)
);
```

### 3.5 `audit_log`

```sql
create table public.audit_log (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_user_id uuid references public.app_users(id),
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  location_id   uuid references public.locations(id),
  before_data   jsonb,
  after_data    jsonb,
  metadata      jsonb,
  ip_address    inet,
  user_agent    text
);

create index on public.audit_log (occurred_at desc);
create index on public.audit_log (entity_type, entity_id);
create index on public.audit_log (actor_user_id, occurred_at desc);
```

`actor_user_id` es nulable a propósito: hay acciones de sistema sin
usuario detrás (una sincronización, un webhook).

## 4. Catálogo inicial de permisos

```sql
insert into public.permissions (code, category, description) values
  ('users.manage',        'Administración', 'Crear, editar y desactivar empleados'),
  ('roles.manage',        'Administración', 'Editar roles y sus permisos'),
  ('locations.manage',    'Administración', 'Crear y editar sucursales'),
  ('audit.read',          'Administración', 'Consultar la bitácora'),

  ('products.read',       'Catálogo',   'Consultar productos'),
  ('products.create',     'Catálogo',   'Dar de alta productos y variantes'),
  ('products.update',     'Catálogo',   'Editar datos de productos'),
  ('products.price_update','Catálogo',  'Cambiar precios'),

  ('inventory.read',      'Inventario', 'Consultar existencias'),
  ('inventory.adjust',    'Inventario', 'Ajustar existencias'),
  ('inventory.count',     'Inventario', 'Realizar conteos'),
  ('transfers.create',    'Inventario', 'Solicitar traspasos'),
  ('transfers.approve',   'Inventario', 'Autorizar traspasos'),
  ('transfers.receive',   'Inventario', 'Recibir traspasos'),

  ('pos.sell',            'Punto de venta', 'Registrar ventas'),
  ('sales.discount',      'Punto de venta', 'Autorizar descuentos'),
  ('sales.cancel',        'Punto de venta', 'Cancelar ventas'),
  ('returns.create',      'Punto de venta', 'Registrar devoluciones y cambios'),
  ('layaways.manage',     'Punto de venta', 'Administrar apartados'),

  ('cash.open',           'Caja', 'Abrir caja'),
  ('cash.close',          'Caja', 'Cerrar caja y hacer corte'),
  ('cash.movement',       'Caja', 'Registrar entradas y salidas de efectivo'),

  ('purchases.manage',    'Compras', 'Crear y editar compras'),
  ('purchases.receive',   'Compras', 'Recibir mercancía'),

  ('customers.manage',    'Clientes', 'Administrar clientes'),
  ('customers.credit',    'Clientes', 'Autorizar y administrar crédito'),

  ('reports.sales',       'Reportes', 'Ver reportes de ventas'),
  ('reports.inventory',   'Reportes', 'Ver reportes de inventario'),
  ('reports.discounts',   'Reportes', 'Ver reportes de descuentos');
```

Asignación inicial por rol:

| Rol | Permisos |
|---|---|
| `ADMIN` | Todos |
| `MANAGER` | Todos menos `users.manage`, `roles.manage`, `locations.manage` |
| `CASHIER` | `products.read`, `inventory.read`, `pos.sell`, `returns.create`, `layaways.manage`, `cash.open`, `cash.close`, `cash.movement`, `customers.manage` |
| `WAREHOUSE` | `products.read`, `products.create`, `inventory.read`, `inventory.count`, `transfers.create`, `transfers.receive`, `purchases.receive` |

Nótese que `CASHIER` **no** trae `sales.discount` ni `sales.cancel`: esas
operaciones las autoriza un supervisor con PIN (sección 6). Es el
comportamiento que el negocio espera y evita el abuso de descuentos que el
reporte de la sección 51.4 del contexto maestro busca vigilar.

## 5. Funciones auxiliares

```sql
create schema if not exists app;
revoke all on schema app from anon;
grant usage on schema app to authenticated;

create or replace function app.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.app_users u
  where u.id = auth.uid()
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
    where u.id = auth.uid()
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
    where ul.user_id = auth.uid()
      and ul.location_id = p_location_id
      and u.is_active
  )
$$;
```

> **Detalle de rendimiento que no es opcional.** En las políticas de RLS
> estas funciones se envuelven siempre en un subselect:
> `(select app.has_perm('pos.sell'))`, no `app.has_perm('pos.sell')`.
> Con el subselect, PostgreSQL la evalúa una vez por consulta; sin él, la
> evalúa **una vez por fila**. Sobre 15,000 variantes la diferencia es
> brutal.

## 6. Verificación de PIN de supervisor

Un cajero necesita que un supervisor autorice un descuento sin cerrar su
sesión. Esta función lo resuelve y devuelve el id del supervisor, para que
la venta registre quién autorizó.

```sql
create or replace function public.verify_supervisor_pin(
  p_employee_code text,
  p_pin           text,
  p_permission    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
begin
  if (select app.current_user_id()) is null then
    return jsonb_build_object('status', 'NOT_AUTHENTICATED');
  end if;

  select * into v_user
  from public.app_users
  where employee_code = p_employee_code and is_active;

  if not found then
    perform pg_sleep(0.5);
    return jsonb_build_object('status', 'INVALID_CREDENTIALS');
  end if;

  if v_user.pin_locked_until is not null and v_user.pin_locked_until > now() then
    return jsonb_build_object('status', 'PIN_LOCKED', 'locked_until', v_user.pin_locked_until);
  end if;

  if v_user.supervisor_pin_hash is null
     or extensions.crypt(p_pin, v_user.supervisor_pin_hash) <> v_user.supervisor_pin_hash
  then
    update public.app_users
       set pin_failed_attempts = pin_failed_attempts + 1,
           pin_locked_until = case
             when pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes'
             else null
           end
     where id = v_user.id;

    insert into public.audit_log (actor_user_id, action, entity_type, entity_id, metadata)
    values ((select app.current_user_id()), 'supervisor_pin.failed', 'app_users',
            v_user.id::text, jsonb_build_object('permission', p_permission));

    return jsonb_build_object('status', 'INVALID_CREDENTIALS');
  end if;

  if not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = v_user.role_id and rp.permission_code = p_permission
  ) then
    return jsonb_build_object('status', 'INSUFFICIENT_PERMISSION');
  end if;

  update public.app_users
     set pin_failed_attempts = 0, pin_locked_until = null
   where id = v_user.id;

  insert into public.audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  values ((select app.current_user_id()), 'supervisor_pin.authorized', 'app_users',
          v_user.id::text, jsonb_build_object('permission', p_permission));

  return jsonb_build_object('status', 'AUTHORIZED', 'supervisor_user_id', v_user.id);
end;
$$;
```

Tres detalles deliberados: el `pg_sleep` iguala el tiempo de respuesta
entre "empleado inexistente" y "PIN incorrecto" para no filtrar qué
códigos de empleado existen; el bloqueo tras cinco intentos evita que un
PIN de cuatro dígitos se pueda adivinar por fuerza bruta; y **tanto el
intento fallido como la autorización exitosa quedan en la bitácora**.
Los resultados inválidos se devuelven como estado, no como excepción:
una excepción revertiría el contador de intentos y su auditoría.

El PIN se guarda con `extensions.crypt(p_pin, extensions.gen_salt('bf'))`
y jamás viaja ni se almacena en claro.

## 7. Políticas de RLS

Se activa RLS en las cinco tablas. A continuación el patrón; Codex escribe
las políticas completas siguiéndolo.

```sql
alter table public.locations        enable row level security;
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.app_users        enable row level security;
alter table public.user_locations   enable row level security;
alter table public.audit_log        enable row level security;
```

| Tabla | Lectura | Escritura |
|---|---|---|
| `locations` | Las asignadas al usuario, o todas con `locations.manage` | `locations.manage` |
| `roles`, `permissions` | Cualquier usuario activo | `roles.manage` |
| `role_permissions` | Cualquier usuario activo | `roles.manage` |
| `app_users` | El propio registro, o todos con `users.manage` | `users.manage` |
| `user_locations` | El propio registro, o todos con `users.manage` | `users.manage` |
| `audit_log` | `audit.read` | **Sólo inserción. Nadie actualiza ni borra.** |

Ejemplo del patrón para `locations`:

```sql
create policy locations_select on public.locations
for select to authenticated
using (
  (select app.can_access_location(id))
  or (select app.has_perm('locations.manage'))
);

create policy locations_write on public.locations
for all to authenticated
using ((select app.has_perm('locations.manage')))
with check ((select app.has_perm('locations.manage')));
```

Para `audit_log`, se crea política de `insert` y de `select`, y **no se
crea ninguna de `update` ni `delete`** — sin política, RLS deniega. Además,
como defensa en profundidad:

```sql
revoke update, delete on public.audit_log from authenticated, anon;
```

Y en todas las tablas: `revoke all ... from anon;` — el rol anónimo no
tiene nada que hacer aquí.

## 8. Actualización del propio perfil

Como la escritura en `app_users` exige `users.manage`, un empleado no
puede ni cambiar su propio nombre. Eso se resuelve con una función
acotada, **no** aflojando la política:

```sql
create or replace function public.update_my_profile(
  p_full_name text default null,
  p_new_pin   text default null
) returns void
language plpgsql
security definer
set search_path = ''
```

Sólo toca `full_name` y `supervisor_pin_hash` del usuario autenticado.
**Nunca** `role_id`, `is_active` ni `employee_code`. Ésa es la barrera que
impide que alguien se eleve a sí mismo.

## 9. Arranque: el primer administrador

Es el punto donde Codex se va a atorar si no está advertido. Con RLS
activo y sin ningún registro en `app_users`, nadie tiene permisos y no hay
forma de crear al primero desde la aplicación.

- La migración de semilla crea roles, permisos y sus asignaciones, más la
  ubicación de sistema `TRANSIT`.
- El primer administrador se crea con un script documentado que usa la
  llave de servicio: crea el usuario en Auth y su registro en `app_users`
  con rol `ADMIN`.
- **El registro público debe estar deshabilitado** en la configuración de
  Auth de Supabase. Los empleados los da de alta un administrador; nadie
  se registra solo.
- No se instala el disparador típico de "crear perfil al registrarse",
  justamente porque aquí no hay auto-registro.

## 10. Interfaz mínima de este milestone

- Inicio de sesión y cierre de sesión.
- Pantalla de empleados: alta, edición, asignación de rol y sucursales,
  activar y desactivar.
- Pantalla de sucursales.
- Pantalla de roles con sus permisos marcables.
- Selector de sucursal activa para el usuario que tiene más de una.
- Visor de bitácora, filtrable, sólo para quien tenga `audit.read`.

## 11. Matriz de pruebas obligatoria

Éste es el entregable que hace real la Definition of Done. Cada renglón es
un test automatizado, no una revisión visual.

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | `CASHIER` consulta una sucursal que no tiene asignada | Cero filas |
| 2 | `CASHIER` intenta cambiar su propio `role_id` | Rechazado |
| 3 | `CASHIER` intenta cambiar su propio `is_active` | Rechazado |
| 4 | Usuario desactivado con sesión válida | Cero acceso a todo |
| 5 | `ADMIN` actualiza el rol de otro usuario | Permitido y registrado en bitácora |
| 6 | Cualquiera, incluido `ADMIN`, intenta actualizar `audit_log` | Rechazado |
| 7 | Cualquiera, incluido `ADMIN`, intenta borrar de `audit_log` | Rechazado |
| 8 | Rol `anon` sobre cualquier tabla | Cero acceso |
| 9 | PIN correcto con el permiso requerido | Devuelve el id del supervisor |
| 10 | PIN correcto pero sin el permiso requerido | `INSUFFICIENT_PERMISSION` |
| 11 | Cinco PIN incorrectos seguidos | Cuenta bloqueada 15 minutos |
| 12 | Código de empleado inexistente | Mismo error y tiempo similar que PIN incorrecto |
| 13 | `MANAGER` intenta crear un usuario | Rechazado (no tiene `users.manage`) |
| 14 | `update_my_profile` intentando colar `role_id` | Imposible por firma de la función |

## 12. Criterios de aceptación

- [ ] Las 14 pruebas de la sección 11 pasan en CI.
- [ ] RLS activo en las siete tablas, sin una sola política `using (true)`.
- [ ] Todas las funciones `SECURITY DEFINER` llevan `SET search_path = ''`.
- [ ] Todas las llamadas a funciones dentro de políticas van envueltas en
      subselect.
- [ ] El script del primer administrador está documentado y probado en
      una base limpia.
- [ ] El registro público de Auth está deshabilitado y documentado.
