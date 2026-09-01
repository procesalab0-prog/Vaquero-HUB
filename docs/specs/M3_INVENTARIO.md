# M3 — Inventario, movimientos y traspasos

> Especificación para Codex. Ver [`../PLAN_CODEX.md`](../PLAN_CODEX.md)
> sección 4 para la arquitectura de la lógica crítica.
>
> Éste es el milestone de mayor riesgo técnico del proyecto. Un error aquí
> no se ve: se manifiesta meses después como un inventario que no cuadra y
> que nadie sabe explicar.

## 1. La regla que gobierna todo

**El libro de movimientos es la verdad. El saldo es una conveniencia.**

`inventory_movements` es un registro de sólo inserción. `inventory_by_location`
guarda el saldo corriente para no tener que sumar el histórico en cada
consulta. Ambos se escriben **en la misma transacción**, siempre, y la
invariante que los amarra es:

```
SUM(inventory_movements.quantity) por variante y ubicación
  ==
inventory_by_location.qty
```

Esa igualdad es la prueba de salud del sistema. Debe correrse como test
en CI y como verificación periódica en producción.

## 2. Tablas

### 2.1 Saldo por ubicación

```sql
create table public.inventory_by_location (
  variant_id   uuid not null references public.variants(id),
  location_id  uuid not null references public.locations(id),
  qty          numeric(12,3) not null default 0,
  reserved_qty numeric(12,3) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (variant_id, location_id),
  constraint qty_no_negativo      check (qty >= 0),
  constraint reserved_no_negativo check (reserved_qty >= 0),
  constraint reserved_no_excede   check (reserved_qty <= qty)
);
```

**Disponible = `qty - reserved_qty`.** El POS vende contra *disponible*,
nunca contra `qty`. `reserved_qty` lo usarán los apartados en M7; se crea
desde ahora porque agregarlo después obliga a revisar cada consulta de
disponibilidad.

Una reserva **no genera movimiento de inventario**: nada se movió
físicamente, la mercancía sigue en la tienda, sólo está comprometida. Su
trazabilidad vive en el documento de apartado. La invariante de la
sección 1 cubre `qty`, no `reserved_qty`.

### 2.2 Libro de movimientos

```sql
create table public.inventory_movements (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  variant_id     uuid not null references public.variants(id),
  location_id    uuid not null references public.locations(id),
  movement_type  text not null check (movement_type in (
    'INITIAL_IMPORT','SALE','RETURN','PURCHASE','TRANSFER_OUT',
    'TRANSFER_IN','ADJUSTMENT','CANCELLATION','COUNT'
  )),
  quantity       numeric(12,3) not null check (quantity <> 0),
  previous_qty   numeric(12,3) not null,
  new_qty        numeric(12,3) not null,
  reference_type text,
  reference_id   text,
  user_id        uuid references public.app_users(id),
  metadata       jsonb not null default '{}'::jsonb,
  constraint movement_balances check (new_qty = previous_qty + quantity)
);

create index on public.inventory_movements (variant_id, location_id, id);
create index on public.inventory_movements (reference_type, reference_id);
create index on public.inventory_movements (occurred_at desc);
```

**`quantity` va con signo.** Negativo saca, positivo mete. No hay tabla de
"qué tipos suman y cuáles restan": el signo lo dice. Gracias a eso la
invariante de la sección 1 es una suma simple y no una expresión con
casos.

Tipos: `INITIAL_IMPORT`, `SALE`, `RETURN`, `PURCHASE`, `TRANSFER_OUT`,
`TRANSFER_IN`, `ADJUSTMENT`, `CANCELLATION`, `COUNT`.

### 2.3 El libro no se toca

Tres capas, porque una sola no basta:

```sql
-- 1. Sin política de RLS para update/delete: RLS deniega por omisión.
-- 2. Revocación explícita de permisos.
revoke update, delete on public.inventory_movements from authenticated, anon;

-- 3. Disparador que detiene incluso a funciones SECURITY DEFINER.
create trigger movements_inmutables
before update or delete on public.inventory_movements
for each row execute function app.fn_deny_mutation();
```

La tercera capa importa: las funciones `SECURITY DEFINER` corren como
dueño de la tabla y se saltarían las dos primeras. Una corrección de
inventario se hace **con un movimiento compensatorio**, nunca editando el
pasado.

## 3. La función de movimiento

Es el único camino por el que cambia una existencia. No existe ningún
`UPDATE` a `inventory_by_location` fuera de aquí.

```sql
create or replace function app.apply_movement(
  p_variant_id     uuid,
  p_location_id    uuid,
  p_type           text,
  p_qty            numeric,      -- con signo
  p_reference_type text,
  p_reference_id   text,
  p_metadata       jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev numeric(12,3);
  v_new  numeric(12,3);
  v_id   bigint;
  v_user uuid;
  v_permission text;
begin
  v_user := (select app.current_user_id());
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if not (select app.can_access_location(p_location_id)) then
    raise exception 'LOCATION_FORBIDDEN' using errcode = '42501';
  end if;
  v_permission := case p_type
    when 'SALE' then 'pos.sell'
    when 'RETURN' then 'returns.create'
    when 'CANCELLATION' then 'sales.cancel'
    when 'PURCHASE' then 'purchases.receive'
    when 'TRANSFER_OUT' then 'transfers.create'
    when 'TRANSFER_IN' then 'transfers.receive'
    when 'COUNT' then 'inventory.count'
    when 'ADJUSTMENT' then 'inventory.adjust'
    when 'INITIAL_IMPORT' then 'inventory.adjust'
  end;
  if v_permission is null or not (select app.has_perm(v_permission)) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  -- Red de seguridad: la fila normalmente ya existe desde M2.
  insert into public.inventory_by_location (variant_id, location_id, qty)
  values (p_variant_id, p_location_id, 0)
  on conflict (variant_id, location_id) do nothing;

  update public.inventory_by_location
     set qty = qty + p_qty,
         updated_at = now()
   where variant_id  = p_variant_id
     and location_id = p_location_id
     and qty + p_qty >= reserved_qty
  returning qty - p_qty, qty into v_prev, v_new;

  if not found then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  insert into public.inventory_movements (
    variant_id, location_id, movement_type, quantity,
    previous_qty, new_qty, reference_type, reference_id, user_id, metadata
  ) values (
    p_variant_id, p_location_id, p_type, p_qty,
    v_prev, v_new, p_reference_type, p_reference_id, v_user, p_metadata
  ) returning id into v_id;

  return v_id;
end;
$$;
```

Tres cosas que hacen que esto sea correcto y que conviene no "mejorar":

**El `UPDATE` condicional es la sección crítica.** No se lee el saldo, se
decide en TypeScript y se escribe. La condición viaja dentro del propio
`UPDATE`, que PostgreSQL resuelve tomando el candado de la fila. Dos cajas
vendiendo la última pieza al mismo tiempo se serializan solas: una gana y
la otra recibe `INSUFFICIENT_STOCK`.

**`previous_qty` y `new_qty` salen del mismo `UPDATE`.** No se consultan
antes ni después. Así el movimiento nunca miente sobre el saldo, ni
siquiera bajo concurrencia.

**La condición es `>= reserved_qty`, no `>= 0`.** Una venta no puede
consumir mercancía apartada de otro cliente.

**El autor se deriva de la sesión y la ubicación se valida dentro de la
función.** Una función `SECURITY DEFINER` nunca recibe `user_id` como dato
confiable ni delega la autorización a la interfaz, porque se salta la RLS
de las tablas que escribe.

## 4. Ajustes

Todo ajuste exige `inventory.adjust` y **motivo de una lista controlada**,
no texto libre:

`MERMA`, `ROBO`, `DAÑO`, `ERROR_CAPTURA`, `CONTEO_FISICO`, `MUESTRA`,
`DEVOLUCION_PROVEEDOR`.

Con texto libre, a los seis meses hay cuatrocientos ajustes que dicen
"ajuste" y ninguna forma de saber cuánto se está perdiendo por robo y
cuánto por error de captura. El motivo va en `metadata` y, además, en la
bitácora de auditoría.

**Nunca se permite saldo negativo**, ni siquiera por ajuste. Si el sistema
dice 2 y en el anaquel hay 0, el ajuste es de −2 y termina en 0. No hay
caso legítimo que requiera un negativo.

## 5. Conteos

```sql
inventory_counts       -- id, folio, location_id, status, alcance, quién, fechas
inventory_count_items  -- count_id, variant_id, system_qty, counted_qty, difference
```

Estados: `OPEN` → `COUNTING` → `CLOSED`, más `CANCELLED`.

**Detalle que decide si el conteo sirve:** `system_qty` se captura **al
cerrar el conteo**, no al abrirlo. Si se capturara al abrir, cualquier
venta ocurrida durante el conteo aparecería como diferencia y se ajustaría
como si fuera merma.

Aun así queda una ventana entre contar físicamente y cerrar. Se maneja
mostrándola, no escondiéndola: al cerrar, el sistema **señala qué
variantes tuvieron movimientos desde que se capturó su conteo** para que
quien cierra decida. Lo ideal sigue siendo contar con la tienda cerrada.

Al cerrar, cada diferencia genera un movimiento `COUNT` con referencia al
conteo. Nada se ajusta en silencio.

### 5.1 Contar con el teléfono

El conteo se hace escaneando con la cámara del teléfono, andando el
pasillo. Ver [`ESCANEO.md`](ESCANEO.md) para el componente y sus
requisitos — en particular el *beep* de confirmación, que es lo que
permite contar mirando el anaquel y no la pantalla.

Requisito propio de este milestone: **al abrir un conteo se precargan en
el dispositivo las variantes de su alcance**, y las cantidades contadas se
encolan si se cae la señal. El conteo es justamente lo que más se hace en
la bodega y al fondo de la tienda, donde peor llega el wifi.

## 6. Traspasos

```sql
transfers       -- id, folio, from_location_id, to_location_id, status,
                -- requested_by/approved_by/sent_by/received_by + fechas
transfer_items  -- transfer_id, variant_id, qty_requested, qty_sent, qty_received
```

Estados: `REQUESTED` → `APPROVED` → `PREPARED` → `IN_TRANSIT` →
`RECEIVED`, más `CANCELLED`.

### 6.1 La mercancía en tránsito vive en una ubicación real

Al enviar (`PREPARED` → `IN_TRANSIT`), por cada renglón:

- `TRANSFER_OUT` negativo en la sucursal origen
- `TRANSFER_IN` positivo en la ubicación de sistema `TRANSITO`

Al recibir:

- `TRANSFER_OUT` negativo en `TRANSITO`
- `TRANSFER_IN` positivo en la sucursal destino

Cuatro movimientos por renglón a lo largo del ciclo. El total global de
existencias **nunca cambia** por un traspaso, y la mercancía jamás aparece
disponible en dos lugares a la vez. La ubicación `TRANSITO` se excluye
siempre de las consultas de disponibilidad para venta.

### 6.2 Diferencias al recibir

Si se enviaron 5 y llegaron 4, esa pieza **se queda en `TRANSITO`**. No se
absorbe automáticamente.

Es deliberado: dar de baja la diferencia sola esconde robos y extravíos.
Queda visible como saldo en tránsito hasta que alguien con
`inventory.adjust` la resuelva con un ajuste y su motivo. Un reporte de
"mercancía en tránsito con más de N días" hace que eso no se olvide.

## 7. RLS

- `inventory_by_location`: lectura sólo de las ubicaciones asignadas al
  usuario, vía `app.can_access_location(location_id)`.
- `inventory_movements`: lectura igual, por ubicación. Inserción sólo a
  través de `app.apply_movement`. Sin update ni delete para nadie.
- `transfers`: visible para origen o destino. Crear exige
  `transfers.create`; aprobar, `transfers.approve`; recibir,
  `transfers.receive`.
- **Aprobar y recibir no pueden ser la misma persona en la misma
  operación** cuando el traspaso es entre sucursales distintas. Es
  separación de funciones básica.

Las transiciones se ejecutan mediante una RPC transaccional, no con
`UPDATE` directo. Al recibir, la RPC deriva `received_by` de `auth.uid()`
y rechaza la operación si coincide con `approved_by`; las columnas de
actor tampoco se aceptan como parámetros del cliente.

## 8. Pruebas obligatorias

Las tres primeras son las pruebas bandera del proyecto.

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | **Dos ventas concurrentes sobre existencia 1**, en conexiones paralelas | Exactamente una tiene éxito; la otra recibe `INSUFFICIENT_STOCK` |
| 2 | **Invariante del libro**, tras una batería aleatoria de operaciones | `SUM(quantity)` == `qty` para toda variante y ubicación |
| 3 | **Traspaso en tránsito** | No disponible ni en origen ni en destino; total global sin cambio |
| 4 | Venta que dejaría el saldo bajo lo apartado | Rechazada |
| 5 | Intento de `UPDATE` sobre un movimiento, como dueño de la tabla | Rechazado por el disparador |
| 6 | Intento de `DELETE` sobre un movimiento | Rechazado |
| 7 | Ajuste que dejaría saldo negativo | Rechazado |
| 8 | Ajuste sin motivo de la lista | Rechazado |
| 9 | Recepción parcial de traspaso | La diferencia permanece en `TRANSITO` |
| 10 | Cancelar un traspaso ya `IN_TRANSIT` | Rechazado, o exige recepción previa |
| 11 | `CASHIER` consulta existencias de otra sucursal | Cero filas |
| 12 | `CASHIER` intenta un ajuste | Rechazado |
| 13 | Conteo cerrado con movimientos posteriores a la captura | Señalados antes de aplicar |
| 14 | 200 movimientos concurrentes sobre la misma variante | La invariante se sostiene |

La prueba 1 se implementa con dos conexiones reales en paralelo, no
llamadas secuenciales. Si se corre en serie, no prueba nada.

## 9. Criterios de aceptación

- [ ] Las 14 pruebas pasan en CI.
- [ ] No existe ni un `UPDATE` a `inventory_by_location` fuera de
      `app.apply_movement` en todo el código.
- [ ] Las tres capas de inmutabilidad del libro están activas.
- [ ] Existe una consulta de verificación de la invariante, documentada,
      para correrse contra producción cuando se sospeche un descuadre.
- [ ] La ubicación `TRANSITO` está excluida de toda consulta de
      disponibilidad para venta.

## 10. Preguntas abiertas

1. ¿Quién autoriza un traspaso hoy? ¿La sucursal que pide o la que manda?
2. ¿Cuántos días de tolerancia antes de que un tránsito se considere
   problema?
3. ¿Hacen conteos completos, o por sección o categoría?
4. ¿Con la tienda abierta o cerrada?
5. ¿Qué motivos de ajuste usan hoy en SICAR? Conviene igualar la lista
   para que los reportes históricos sean comparables.
