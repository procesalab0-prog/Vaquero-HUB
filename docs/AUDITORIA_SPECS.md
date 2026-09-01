# Auditoría de especificaciones y código

> Revisión adversarial de todo lo escrito hasta ahora, incluidas las
> propias especificaciones de Claude. La mayoría de estos hallazgos son
> errores míos, no de Codex.
>
> Fecha: 2026-09-01. Revisó: Claude Code.

## Cómo leer esto

- **🔴 Rompe** — el código no va a funcionar, o un control de seguridad no
  hace lo que dice.
- **🟠 Silencioso** — funciona, pero permite que entren datos malos o que
  un registro mienta.
- **🟡 Hueco** — falta especificar algo que Codex tendría que adivinar.

Cada hallazgo trae el archivo, el problema y la corrección concreta.
Cuando uno se resuelva, se marca aquí y se corrige en la especificación
que lo originó.

## Estado de resolución — 0.9.0

Los nueve hallazgos fueron revisados por Codex el 1 de septiembre de 2026.
A-1 se hizo explícito con una migración de mínimo privilegio y se verificó
contra staging con un usuario autenticado. A-2 ya estaba corregido en la
migración ejecutable y se alineó la especificación. A-3 a A-8 se
incorporaron a las especificaciones antes de implementar M2/M3. Los seis
huecos de A-9 quedaron especificados o, para identidad de cliente,
implementados mediante `member_number` y `get_my_customer_card()`.

---

## ✅ A-1. Permiso explícito del esquema `app`

**Dónde:** `supabase/migrations/20260901014401_m0_foundations.sql` (ya
aplicado) y `docs/specs/M1_IDENTIDAD.md` sección 5.

Ambos hacen:

```sql
revoke all on schema app from anon;
revoke all on schema app from authenticated;
```

**El problema.** PostgreSQL exige privilegio `USAGE` sobre un esquema para
poder referenciar cualquier objeto dentro de él por nombre calificado —
**incluida la llamada a una función, y sin importar que sea `SECURITY
DEFINER`.** `SECURITY DEFINER` cambia con qué privilegios corre el
*cuerpo* de la función, no quién puede *invocarla*.

Todas las políticas de M1 llaman `app.has_perm(...)` y
`app.can_access_location(...)` evaluándose como el rol `authenticated`.
Con `USAGE` revocado, cada consulta va a fallar con *permission denied for
schema app*. No es que niegue el acceso: es que revienta.

**Por qué me equivoqué.** Quise que el esquema `app` no quedara expuesto
en la API, y usé el mecanismo incorrecto. Lo que controla la exposición de
PostgREST es la lista de esquemas publicados en la configuración
(`db-schemas`), que por omisión en Supabase es `public` y `graphql_public`.
El esquema `app` **ya está fuera de la API sin necesidad de revocar
nada**.

**Corrección.** En la migración de M1:

```sql
grant usage on schema app to authenticated;
-- anon se queda sin nada: no tiene por qué llegar aquí.
```

Y quitar de M1 la línea `revoke all on schema app from anon, authenticated`,
dejando sólo la revocación a `anon`.

**Cómo se comprueba.** Un test de M1 en el que un usuario `CASHIER`
consulta `locations` y **obtiene cero filas en lugar de un error**. Hoy,
sin el ajuste explícito, podría depender del contexto de ejecución de la
política.

**Resolución 0.9.0.** Se agregó `grant usage on schema app to
authenticated` sin publicar el esquema en PostgREST. La consulta se
validó en staging bajo el rol `authenticated` y devolvió las ubicaciones
permitidas sin error.

---

## ✅ A-2. Bloqueo por intentos de PIN

**Dónde:** `docs/specs/M1_IDENTIDAD.md` sección 6,
`verify_supervisor_pin`.

Cuando el PIN es incorrecto, la función hace tres cosas en este orden:

1. `update app_users set pin_failed_attempts = pin_failed_attempts + 1 ...`
2. `insert into audit_log (...)` registrando el intento fallido
3. `raise exception 'INVALID_CREDENTIALS'`

**El problema.** `raise exception` aborta la transacción, y con ella
**revierte los pasos 1 y 2**. El contador de intentos vuelve a su valor
anterior y el intento fallido nunca queda en la bitácora.

Resultado: el bloqueo tras cinco intentos **no existe**, y un PIN de
cuatro dígitos —diez mil combinaciones— queda expuesto a fuerza bruta sin
freno ni rastro. Es un control de seguridad que parece estar y no está.

**Corrección.** La función no debe lanzar excepción en el caso de
credencial inválida: debe **devolver un resultado** para que los cambios
se confirmen.

```sql
create type app.pin_result as (
  authorized     boolean,
  supervisor_id  uuid,
  reason         text   -- 'OK','INVALID','LOCKED','NO_PERMISSION'
);
```

La función devuelve ese tipo; quien la llama decide qué hacer. Las
excepciones se reservan para errores verdaderos (no autenticado, argumento
inválido), no para el flujo normal de un PIN equivocado.

**Cómo se comprueba.** La prueba 11 de M1 ya dice «cinco PIN incorrectos
seguidos → cuenta bloqueada 15 minutos». Hoy fallaría. Que esa prueba
exista y pase es la verificación del diseño original; la implementación
actual ya usa estados controlados.

**Resolución 0.9.0.** La función ejecutable ya devuelve estados JSON sin
lanzar excepción en credenciales inválidas; contador y auditoría se
confirman. La especificación quedó alineada.

---

## ✅ A-3. Autor y ubicación en `apply_movement`

**Dónde:** `docs/specs/M3_INVENTARIO.md` sección 3.

La firma es:

```sql
app.apply_movement(..., p_user_id uuid, ...)
```

y la función es `SECURITY DEFINER`, así que **ignora la RLS** de
`inventory_by_location` y de `inventory_movements`.

Dos problemas juntos:

1. **El usuario viaja como argumento.** Quien llame a la función puede
   pasar el id de otra persona, y el movimiento quedaría firmado por
   quien no lo hizo. Un libro de inventario que puede mentir sobre el
   autor no sirve para lo que existe.
2. **No valida la ubicación.** Nada comprueba que quien ejecuta tenga
   acceso a `p_location_id`. La RLS que lo haría está siendo evitada por
   el propio `SECURITY DEFINER`.

Hoy está mitigado porque el esquema `app` no se expone en la API, así que
un cliente no puede invocarla directamente. Pero en cuanto M4 cree una
función pública que la envuelva, el hueco queda abierto.

**Corrección.** Dentro de la función, no como responsabilidad de quien
llama:

```sql
v_user := (select app.current_user_id());
if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;
if not (select app.can_access_location(p_location_id)) then
  raise exception 'LOCATION_FORBIDDEN';
end if;
```

Y **eliminar `p_user_id` de la firma**. El autor se deriva, no se recibe.

Regla general que conviene dejar escrita: **toda función `SECURITY
DEFINER` que escriba datos de negocio valida permisos explícitamente,
porque por definición se saltó la RLS que lo haría por ella.**

---

## ✅ A-4. `movement_type` restringido

**Dónde:** `docs/specs/M3_INVENTARIO.md` sección 2.2.

`movement_type text not null` — la lista de tipos válidos está en prosa,
no en el esquema. Un `'sale'` en minúsculas o un `'SALE '` con espacio se
guardan sin protestar y desaparecen de todo reporte que filtre por
`'SALE'`. Es de los errores que sólo se descubren cuando un reporte no
cuadra meses después.

**Corrección.**

```sql
constraint movement_type_valido check (movement_type in (
  'INITIAL_IMPORT','SALE','RETURN','PURCHASE',
  'TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT','CANCELLATION','COUNT'
))
```

Lo mismo aplica a los motivos de ajuste de la sección 4 y a los estados de
traspaso de la 6.

---

## ✅ A-5. Movimiento autoconsistente

**Dónde:** `docs/specs/M3_INVENTARIO.md` sección 2.2.

Existen `previous_qty`, `quantity` y `new_qty`, pero ninguna restricción
exige que `new_qty = previous_qty + quantity`. Hoy los tres salen del
mismo `UPDATE` y son correctos; el día que otro camino escriba en la tabla
—un import, un arreglo apurado— puede dejar renglones incoherentes y la
invariante del libro deja de detectarlo, porque suma `quantity` y no
compara contra los saldos guardados.

**Corrección.** Una línea que lo vuelve estructural:

```sql
constraint movimiento_cuadra check (new_qty = previous_qty + quantity)
```

---

## ✅ A-6. Unicidad de valores con nulos

**Dónde:** `docs/specs/M2_CATALOGO.md` sección 1.3.

```sql
unique (type_code, scale_code, value)
```

`scale_code` es nulo para atributos sin escala, como el color. Y en
PostgreSQL **los nulos se consideran distintos entre sí en un índice
único**, así que `('COLOR', null, 'Negro')` se puede insertar dos, tres o
cien veces. Terminaríamos con variantes apuntando a colores «distintos»
que son el mismo.

**Corrección**, disponible en PostgreSQL 15 y superior — el proyecto está
en 17:

```sql
unique nulls not distinct (type_code, scale_code, value)
```

---

## ✅ A-7. Una sola fuente para códigos de barras

**Dónde:** `docs/specs/M2_CATALOGO.md` secciones 1.1 y 1.5.

`variants.legacy_barcode` y la tabla `barcodes` guardan la misma
información. Además `legacy_barcode` **no tiene restricción de unicidad**,
mientras que `barcodes.code` sí.

Dos consecuencias: pueden divergir sin que nada avise, y el mismo código
físico puede repetirse entre variantes si sólo se escribe en la columna.
Justo el caso de prueba «código duplicado» que la sección 42 del plan
maestro exige detectar.

**Corrección.** La tabla `barcodes` es el único hogar de los códigos, con
`source = 'SICAR'` para los heredados. Se elimina
`variants.legacy_barcode`. `legacy_sicar_code` sí se queda en `variants`,
porque es el código interno del artículo en SICAR, no un código de barras.

---

## ✅ A-8. Fórmula atómica unificada

**Dónde:** `docs/PLAN_CODEX.md` sección 4.1 contra
`docs/specs/M3_INVENTARIO.md` sección 3.

El plan dice `set qty = qty - p_qty ... and qty >= p_qty`, suponiendo que
la cantidad llega en positivo. La especificación dice
`set qty = qty + p_qty ... and qty + p_qty >= reserved_qty`, con cantidad
con signo.

Son incompatibles, y Codex va a leer los dos. La correcta es la de M3
—con signo, y comparando contra lo apartado y no contra cero—; el plan
tiene que alinearse a ella.

---

## ✅ A-9. Huecos especificados

| # | Dónde | Qué falta |
|---|---|---|
| A-9.1 | M2 §1.2 | Se define la función `fn_protect_legacy_codes()` pero nunca se manda crear el disparador que la usa |
| A-9.2 | M1 §8 | `update_my_profile` tiene que ser `SECURITY DEFINER`; si no, la propia RLS le impide escribir |
| A-9.3 | M3 §7 | «Aprobar y recibir no pueden ser la misma persona» no dice con qué mecanismo se impone |
| A-9.4 | IDENTIDAD_CLIENTE §1 | El esquema de `customers` no incluye `member_number`, que el resto del documento usa todo el tiempo |
| A-9.5 | IDENTIDAD_CLIENTE §4 | Se dice que el cliente accede por funciones `SECURITY DEFINER` dedicadas, pero no se define ninguna |
| A-9.6 | M2 §7 | Las consultas de disponibilidad deben usar `left join` con `coalesce(qty, 0)`: una sucursal creada después deja variantes sin renglón de inventario |

---

## Resumen para atacar

| Orden | Hallazgo | Milestone | Por qué primero |
|---|---|---|---|
| 1 | A-1 | M1 | Ya está en una migración aplicada. Sin esto, M1 no arranca |
| 2 | A-3 | M3 | Regla de diseño que afecta a toda función que escriba |
| 3 | A-2 | M1 | Control de seguridad que hoy no existe |
| 4 | A-8 | M3 | Dos documentos en contradicción, se lee antes de implementar |
| 5 | A-4, A-5, A-6, A-7 | M2, M3 | Restricciones baratas, caras de retrofitear con datos dentro |
| 6 | A-9 | varios | Al escribir cada milestone |

Los hallazgos A-1 y A-8 tocan documentos que Codex tiene en su PR. Para no
editar en dos ramas a la vez, conviene resolverlos después de que el PR #1
se fusione, junto con lo de los issues #3 y #4.
