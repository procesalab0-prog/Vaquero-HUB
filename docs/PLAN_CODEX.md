# PLAN DE EJECUCIÓN — CODEX

> Plan operativo para que Codex construya Mi Tienda SM a partir del día en
> que exista acceso a la base de datos. Complementa a
> [`PLAN_MAESTRO_VAQUERO_HUB.md`](PLAN_MAESTRO_VAQUERO_HUB.md), no lo sustituye: el
> contexto maestro dice **qué** se construye y por qué; este documento
> dice **cómo, en qué orden y con qué criterios de aceptación**.
>
> Última actualización: 2026-09-02.

## Estado de ejecución al 1 de septiembre de 2026

- M0, M1 y M1B están integrados en `main`.
- M2 comenzó con el esquema versionado de productos, variantes, atributos,
  escalas, categorías y códigos de barras.
- La primera entrega de M2 incluye alta transaccional de una matriz de tallas,
  búsqueda protegida por RPC, costos ocultos al cajero y la pantalla real de
  Productos conectada a Supabase.
- M2 ya permite agregar variantes a un producto existente y registrar códigos
  de proveedor o de reimpresión sin borrar los códigos físicos anteriores.
- Continúan dentro de M2: carga masiva con corrida en seco, acciones de precio
  en lote, plantillas de etiquetas y escaneo físico. La edición individual
  segura quedó terminada en 0.16.0.

## 0. Cómo usar este documento

- Codex trabaja **un milestone a la vez**, en el orden
  M0 → M1 → M1B → M2 → … → M9.
- Los milestones con especificación detallada la tienen en
  [`specs/`](specs/). Esa especificación manda sobre el resumen del
  milestone en la sección 5 de este documento:
  - [`specs/M0_FUNDACIONES.md`](specs/M0_FUNDACIONES.md)
  - [`specs/M1_IDENTIDAD.md`](specs/M1_IDENTIDAD.md)
  - [`specs/IDENTIDAD_CLIENTE.md`](specs/IDENTIDAD_CLIENTE.md) — cubre M1B
  - [`specs/M2_CATALOGO.md`](specs/M2_CATALOGO.md)
  - [`specs/M3_INVENTARIO.md`](specs/M3_INVENTARIO.md)
  - [`specs/M4_POS_Y_CAJA.md`](specs/M4_POS_Y_CAJA.md)
  - [`specs/M5_DEVOLUCIONES_Y_CAMBIOS.md`](specs/M5_DEVOLUCIONES_Y_CAMBIOS.md)
  - [`specs/CODIGOS_Y_SKU.md`](specs/CODIGOS_Y_SKU.md) — transversal, generación en M2
  - [`specs/ESCANEO.md`](specs/ESCANEO.md) — transversal, se introduce en M2
- Cada milestone se entrega en uno o más PRs pequeños y revisables.
- Un milestone no se considera terminado hasta que cumple sus **criterios
  de aceptación** y su **Definition of Done** (sección 3.3).
- Si algo de este plan choca con `PLAN_MAESTRO_VAQUERO_HUB.md`, **gana el contexto
  maestro** y se levanta la discrepancia antes de implementar.
- Si una regla de negocio necesaria no está confirmada (sección 8), Codex
  **no la inventa**: implementa lo que sí está definido y deja la parte
  pendiente fuera del PR, marcada como bloqueada.

## 1. Rol de Codex

Codex es el **implementador principal**. Claude Code actúa como
**arquitecto y revisor** (define esquema/criterios y revisa cada PR
buscando race conditions, fallas de RLS, errores monetarios, pérdida de
historial y problemas de idempotencia). El merge lo aprueba un humano
(ProcesaLab).

Esto invierte los roles descritos originalmente en la sección 38 del
contexto maestro, que ya fue actualizada.

## 2. Reglas innegociables

Estas reglas no se relajan para "hacer que funcione". Un PR que viole
cualquiera de ellas se rechaza sin discusión.

1. **Nunca modificar ni regenerar códigos heredados de SICAR.** Las
   columnas `legacy_*` son de sólo lectura una vez cargadas.
2. **Nunca modificar inventario sin un movimiento auditable.** No existe
   ningún `UPDATE` de stock fuera de las funciones de inventario.
3. **`inventory_movements`, `sales`, `sale_items` y `sale_payments` son
   append-only.** Se revoca `UPDATE`/`DELETE` a nivel de base de datos.
   Las correcciones se hacen con documentos compensatorios.
4. **Toda operación de venta/inventario/caja es atómica**: una sola
   transacción, dentro de una función de PostgreSQL.
5. **Dinero en enteros (centavos), nunca en punto flotante.** Prohibido
   `float`, `real`, `double precision` para importes.
6. **RLS activo en todas las tablas de negocio, con deny-by-default.**
   Prohibido `USING (true)` y prohibido desactivar RLS para depurar.
7. **`service_role` jamás llega al navegador.** Nunca en una variable
   `NEXT_PUBLIC_*`.
8. **Cambios de esquema sólo por migrations versionadas** en Git. Nada de
   cambios manuales desde el dashboard de Supabase.
9. **Nunca escribir en producción directamente.** Producción sólo se toca
   por deploy/migración aprobada.
10. **Todavía no se toca WooCommerce ni se importan datos reales de
    SICAR** (ver sección 6).
11. **Nunca borrar historial** para corregir contabilidad o inventario.
12. **Sin secretos en el repositorio.** Sólo `.env.example` con nombres.

## 3. Decisiones técnicas ya cerradas

Estas decisiones están tomadas para que Codex no improvise. Cambiarlas
requiere acuerdo explícito.

### 3.1 Stack

| Área                     | Decisión                                                |
| ------------------------ | ------------------------------------------------------- |
| Frontend                 | Next.js (App Router) + TypeScript + React               |
| Estilos                  | Tailwind CSS                                            |
| Backend/DB               | Supabase (PostgreSQL + Auth + RLS + Storage)            |
| Migrations               | Supabase CLI, archivos en `supabase/migrations/*.sql`   |
| Lógica crítica           | Funciones PL/pgSQL invocadas por RPC desde el servidor  |
| Hosting                  | Vercel                                                  |
| Tests unitarios          | Vitest                                                  |
| Tests de integración/RLS | Vitest contra Supabase local (`supabase start`)         |
| Tests e2e                | Playwright                                              |
| CI                       | GitHub Actions (lint + typecheck + tests + migraciones) |

### 3.2 Convenciones de datos

- **Dinero:** `bigint` en centavos, columnas con sufijo `_cents`
  (`total_cents`, `unit_price_cents`, `cost_cents`). El formateo a pesos
  ocurre sólo en la capa de presentación.
- **Reparto de descuentos porcentuales:** se reparte por líneas con método
  de mayor residuo, de modo que la suma de las líneas cuadre exactamente
  con el total. Nunca se pierde ni se inventa un centavo.
- **IDs:** `uuid` como llave primaria de todas las tablas.
- **Folios visibles:** consecutivo por sucursal y tipo de documento, en
  tabla `folios`, asignado con `UPDATE ... RETURNING` dentro de la misma
  transacción del documento. Formato `S01-V-000123`.
- **Tiempo:** todo `timestamptz` en UTC. Zona de negocio:
  `America/Mexico_City`. El "día operativo" para cortes y reportes lo
  define la **sesión de caja**, no la medianoche del calendario.
- **Cantidades:** `numeric(12,3)` (permite fracciones si algún día se
  vende por metro/par suelto); las validaciones de enteros van en la capa
  de negocio.
- **Borrado:** no se borra. `deleted_at`/`is_active` donde aplique.

### 3.3 Definition of Done (aplica a cada PR)

Un PR está listo cuando:

- [ ] Incluye su migración versionada y ésta aplica limpia sobre una base
      vacía **y** sobre la base de desarrollo actual.
- [ ] Toda tabla nueva tiene RLS activo y al menos un test que demuestra
      que un rol sin permiso **no** puede leer/escribir.
- [ ] La lógica crítica (dinero, inventario, caja) tiene tests.
- [ ] `lint`, `typecheck` y toda la suite pasan en CI.
- [ ] No hay secretos ni claves en el diff.
- [ ] La descripción del PR responde: **qué se modificó, por qué, riesgos,
      tests, migraciones e impacto** (exigido por la sección 39 del
      contexto maestro).

### 3.4 Convenciones de trabajo

- Ramas: `codex/<milestone>-<slug>` (ej. `codex/m2-catalogo-variantes`).
- Un PR no mezcla migración + funcionalidad nueva + refactor. Si hace
  falta refactorizar, va en su propio PR.
- PR pequeño: idealmente menos de ~400 líneas de diff útil.
- Claude revisa; un humano hace merge.
- Nadie trabaja sobre `main` directamente.

## 4. Arquitectura de la lógica crítica

Esto es lo que evita que el sistema se rompa en una tienda real. Codex lo
implementa así, no de otra forma.

### 4.1 Descuento de inventario atómico

Prohibido leer el stock, decidir en TypeScript y luego escribir. El
descuento se hace con un `UPDATE` condicional que es atómico por sí mismo:

```sql
UPDATE inventory_by_location
   SET qty = qty + p_qty
 WHERE variant_id = p_variant_id
   AND location_id = p_location_id
   AND qty + p_qty >= reserved_qty
RETURNING qty - p_qty AS previous_stock, qty AS new_stock;
-- Si no devuelve fila -> error 'INSUFFICIENT_STOCK'
```

`p_qty` siempre lleva signo: negativo saca y positivo ingresa. Comparar
contra `reserved_qty` impide vender mercancía comprometida en apartados.

Con `previous_stock` y `new_stock` devueltos por ese mismo `UPDATE` se
inserta el registro en `inventory_movements`. Así el movimiento nunca
miente sobre el saldo.

### 4.2 Venta como una sola función transaccional

Toda la venta ocurre dentro de `create_sale(...)`: validar sesión de caja
abierta → validar permisos → validar y descontar stock de cada línea →
insertar `sales`, `sale_items`, `sale_payments` → insertar movimientos →
asignar folio. Si algo falla, no queda nada a medias.

### 4.3 Idempotencia (doble toque en "Cobrar")

`create_sale` recibe un `idempotency_key` (UUID generado por el cliente
**antes** de tocar el botón). Existe una tabla `idempotency_keys` con la
llave como PK. Si la llave ya existe, la función devuelve la venta ya
creada en lugar de crear una segunda. Esto cubre el doble toque, el
reintento por red y —más adelante— la cola offline, sin rediseñar nada.

### 4.4 Pagos mixtos que cuadran

`sale_payments` es 1:N contra `sales`. Existe una restricción que obliga a
que `SUM(sale_payments.amount_cents) = sales.total_cents`. Un pago 30/70
que no cuadre por redondeo debe fallar, no ajustarse solo.

### 4.5 Mercancía en tránsito

Los traspasos mueven stock a una ubicación de sistema `EN_TRANSITO` al
salir, y de ahí a la sucursal destino al recibir. Nunca aparece disponible
en dos lugares a la vez y el inventario total siempre cuadra.

### 4.6 RLS

- `app_users` (perfil ligado a `auth.users`) + `roles` + `permissions` +
  `role_permissions` + `user_locations`.
- Funciones auxiliares `SECURITY DEFINER` con `SET search_path = ''` y
  nombres totalmente calificados: `app.current_user_id()`,
  `app.has_perm(text)`, `app.can_access_location(uuid)`.
- Las políticas se escriben sobre esas funciones. Un cajero sólo ve su
  sucursal; un almacenista no ve reportes de dinero; nadie ve otra
  sucursal salvo `ADMIN`/`MANAGER` con acceso explícito.
- Los permisos se validan **también** en el servidor, no sólo con RLS.

## 5. Milestones

Cada milestone es entregable y demostrable por separado. La estimación en
semanas es orientativa y encaja con el objetivo de 8–12 semanas a piloto
de la sección 37 del contexto maestro.

### M0 — Fundaciones del repositorio _(no requiere la base de datos)_

Codex puede empezar esto **hoy mismo**, antes de tener acceso a Supabase.

- Next.js + TypeScript + Tailwind, estructura de carpetas.
- Supabase CLI, `supabase/` con migración inicial vacía, entorno local.
- Vitest + Playwright configurados con un test trivial cada uno.
- GitHub Actions: lint, typecheck, tests, y verificación de que las
  migraciones aplican sobre base limpia.
- `.env.example` con los nombres de variables (sin valores) y separación
  clara entre variables de cliente y de servidor.
- `README` de desarrollo: cómo levantar el proyecto en local.

**Aceptación:** un desarrollador clona, ejecuta un comando y tiene la app
y la base local corriendo; CI en verde.

### M1 — Identidad, roles, permisos y sucursales _(semana 1)_

- Tablas: `locations`, `app_users`, `roles`, `permissions`,
  `role_permissions`, `user_locations`, `audit_log`.
- Roles iniciales: `ADMIN`, `MANAGER`, `CASHIER`, `WAREHOUSE`.
- Permisos granulares (sección 23 del contexto maestro): descuentos,
  cancelaciones, devoluciones, ajustes de inventario, cambios de precio,
  reportes, compras, traspasos, usuarios.
- Login con Supabase Auth + pantalla de administración de usuarios.
- **Autorización de supervisor:** verificación de PIN del lado servidor
  para operaciones sensibles (descuento, cancelación, devolución) sin
  cerrar la sesión del cajero.
- `audit_log` con disparadores para cambios sensibles: usuario, acción,
  entidad, id, valor anterior, valor nuevo, fecha, metadata.

**Aceptación:** matriz de tests de RLS por rol. Un `CASHIER` no puede leer
otra sucursal, no puede cambiar precios y no puede modificar permisos —
demostrado con tests, no con revisión visual.

### M1B — Clientes y PWA de cliente _(semana 2)_

Se adelanta respecto del plan original por dos razones: la tabla de
clientes la necesitan las ventas de M4 y los apartados de M7, y construir
la tarjeta temprano permite **probar el lector con una pantalla de
teléfono real en la semana 3, no en la 8**. Es el mismo argumento que con
la impresora: el riesgo de hardware se retira temprano o se paga caro.

Especificación completa en
[`specs/IDENTIDAD_CLIENTE.md`](specs/IDENTIDAD_CLIENTE.md).

**Se construye ahora:**

- Tabla `customers` con el modelo de identidad: `phone_e164` normalizado y
  único, `member_number` con dígito verificador, `email`, `birthdate`,
  `auth_user_id` nulable y `woocommerce_customer_id` nulable. Los dos
  últimos se crean desde ahora aunque se llenen mucho después.
- Alta, búsqueda y edición de clientes del lado del personal.
- **Búsqueda por teléfono en el POS**, que es el mecanismo universal.
- **Segunda PWA en subdominio propio**, del mismo código y despliegue:
  inicio de sesión por código SMS (sin contraseña) y pantalla de tarjeta
  con QR, código de barras y código numérico.
- La tarjeta se dibuja **sin conexión y sin sesión válida**, con el número
  de socio guardado en el dispositivo.

**No se construye todavía** (bloqueado por reglas de negocio, ver
sección 8): motor de puntos, redención, descuento de cumpleaños, niveles,
apartados y crédito. La tarjeta identifica al cliente; los puntos llegan
cuando el negocio defina cómo se ganan y cómo se gastan.

**Aceptación:**

- Dos clientes capturados con el mismo teléfono en formatos distintos
  (`3531234567` y `+52 353 123 4567`) son detectados como duplicado.
- Un número de socio con un dígito mal tecleado es rechazado por el
  verificador, no encuentra a otro cliente.
- La tarjeta se ve correctamente con el teléfono en modo avión y con la
  sesión caducada.
- **El lector Bluetooth de la tienda lee el QR desde la pantalla de un
  iPhone y de un Android.** Si falla, se escala de inmediato: cambia la
  decisión de hardware.

**Estado de ejecución 0.8.0:** la primera entrega de M1B implementa el
modelo `customers`, normalización mexicana de teléfono, número de socio
con dígito verificador, consentimiento versionado, auditoría sin duplicar
datos personales, RLS, alta/edición/búsqueda del personal y asociación
del cliente en el POS. La PWA del cliente, OTP, QR/1D offline y la prueba
con lectores quedan en la siguiente entrega de M1B; requieren aviso de
privacidad aprobado, dominio de cliente y configuración de SMS/correo.

**Estado de ejecución 0.9.0:** la segunda entrega de M1B incorpora **Mi
Vaquero**, una PWA de cliente preparada para operar en un subdominio
dedicado y disponible provisionalmente en `/mi`. El acceso sin contraseña
por correo queda implementado para clientes ya registrados; el acceso por
teléfono permanece cerrado por configuración hasta contratar y validar un
proveedor de SMS. La tarjeta muestra un QR y un CODE128 reales con el mismo
número de socio de ocho dígitos y conserva sin conexión únicamente ese
número, nunca nombre, teléfono ni correo. Una RPC `security definer`
limitada al cliente autenticado entrega sólo su propia tarjeta; el alta de
la identidad se realiza del lado servidor, con respuesta genérica y límite
de frecuencia para reducir enumeración y abuso. Continúan pendientes la
configuración de dominio/DNS y SMS, el aviso de privacidad definitivo y la
prueba física con los lectores de la tienda en iPhone y Android. Puntos,
recompensas e historial siguen expresamente fuera de alcance hasta definir
las reglas del negocio.

> Este milestone recorre las semanas siguientes aproximadamente una
> semana. El total sigue dentro del objetivo de 8–12 semanas de la
> sección 37 del contexto maestro.

### M2 — Catálogo: productos, variantes y códigos _(semana 2)_

- Tablas: `brands`, `categories`, `products` (padre), `variants`,
  `variant_attributes` (talla, color), `barcodes` (1..N por variante).
- **Desde ahora** las columnas de aterrizaje de la migración futura:
  `legacy_sicar_code`, `woocommerce_product_id`,
  `woocommerce_variation_id` (nulables, únicas cuando no son nulas).
  Se crean hoy aunque se llenen dentro de meses.
- Generador de variantes por matriz talla × color (sección 18).
- Carga masiva propia (CSV/XLSX con plantilla de Mi Tienda SM), con
  validación previa: códigos duplicados, códigos vacíos, ceros iniciales,
  espacios accidentales (sección 51.18).
- Selección múltiple en el listado para acciones en lote.
- Generación e impresión de etiquetas: diseño personalizable e impresión
  masiva (sección 51.19).

**Aceptación:** dar de alta una bota con 8 tallas en menos de un minuto;
imposible guardar dos variantes con el mismo código; la carga masiva
rechaza un archivo con duplicados explicando cuáles.

### M3 — Inventario, movimientos y traspasos _(semana 3)_

- Tablas: `inventory_by_location`, `inventory_movements`,
  `inventory_counts`, `transfers`, `transfer_items`.
- Función de movimiento atómico (sección 4.1) y tipos de movimiento:
  `INITIAL_IMPORT`, `SALE`, `RETURN`, `PURCHASE`, `TRANSFER_OUT`,
  `TRANSFER_IN`, `ADJUSTMENT`, `CANCELLATION`.
- Traspasos con estados `REQUESTED` → `APPROVED` → `PREPARED` →
  `IN_TRANSIT` → `RECEIVED` / `CANCELLED`, usando la ubicación
  `EN_TRANSITO`.
- Ajustes de inventario con motivo obligatorio y permiso.
- Revocar `UPDATE`/`DELETE` sobre `inventory_movements`.

**Aceptación (los tres tests bandera del proyecto):**

1. Dos ventas concurrentes sobre stock = 1: exactamente una tiene éxito.
2. `SUM(inventory_movements)` por variante/ubicación == saldo en
   `inventory_by_location`, siempre.
3. Un traspaso en tránsito no aparece disponible ni en origen ni en
   destino, y el total global no cambia.

### M4 — POS, ventas, pagos mixtos y caja _(semanas 4–5)_

- Tablas: `cash_registers`, `cash_sessions`, `cash_movements`, `sales`,
  `sale_items`, `sale_payments`, `payment_methods`, `applied_discounts`,
  `idempotency_keys`, `folios`.
- `create_sale()` con todo lo de la sección 4.2 a 4.4.
- Descuentos por **monto o porcentaje**, a nivel línea o ticket, con
  autorización de supervisor y registro en auditoría (sección 51.5).
- Apertura/cierre de caja, movimientos de caja, corte con
  `opening_amount`, `expected_amount`, `actual_amount`, `difference`.
- Interfaz **touch-first para iPad** (sección 15): botones grandes,
  carrito siempre visible, teclado numérico, prevención de doble toque,
  operación en horizontal y vertical. PWA instalable.
- Estado explícito y bloqueante cuando no hay conexión (V1 es en línea;
  la cola offline llega después, sección 7.3).
- Impresión de ticket y apertura de cajón.

**Aceptación:** cobrar 30% efectivo + 70% tarjeta y que la suma cuadre al
centavo; presionar "Cobrar" dos veces genera **una** venta; el corte de
caja cuadra contra los pagos en efectivo del turno.

### M5 — Devoluciones, cambios y cancelaciones _(semana 6)_

- Tablas: `returns`, `return_items`, `exchanges`.
- La venta original **nunca** se modifica ni se borra.
- **Cambio** (sección 51.14) como un solo documento: entra una variante,
  sale otra, y la diferencia se cobra o se devuelve en la misma
  operación.
- Todo genera movimientos inversos y conserva usuario, fecha y motivo.

**Aceptación:** después de una devolución, la venta original sigue intacta
y el inventario regresa exactamente a su valor previo; un cambio con
diferencia de precio queda trazado como una sola operación.

### M6 — Compras, proveedores y recepción _(semana 7)_

- Tablas: `suppliers`, `purchase_orders`, `purchase_items`, `receipts`,
  `receipt_items`.
- El stock **sólo** sube al registrar la recepción, nunca al crear la
  orden.
- Detección de diferencias entre lo pedido y lo recibido.
- Impresión de etiquetas directamente desde la recepción.

**Aceptación:** una orden de compra no mueve inventario; una recepción
parcial mueve exactamente lo recibido y deja el resto pendiente.

### M7 — Clientes, apartados, crédito y lealtad _(semana 8)_

La identidad del cliente y su tarjeta ya se construyeron en M1B. Aquí se
agrega lo que depende de que existan ventas y de que el negocio defina sus
reglas.

- `layaways`, `layaway_items`, `layaway_payments` con estados `OPEN`,
  `PARTIALLY_PAID`, `PAID`, `CANCELLED`, `EXPIRED`.
- Historial de compras del cliente, visible también en su PWA.
- **Bloqueados hasta tener reglas de negocio** (sección 8): motor de
  puntos, redención, crédito a clientes, descuento de cumpleaños y
  niveles. Se deja el modelo de datos preparado, no la regla.
- Recordatorio: un cliente sólo es usuario de Supabase Auth si de verdad
  inicia sesión en su PWA, y aun así no obtiene ningún permiso interno
  (sección 26 del contexto maestro y `specs/IDENTIDAD_CLIENTE.md`).

**Aceptación:** apartar mercancía reserva stock y no lo deja disponible
para venta; abonar reduce el saldo; cancelar libera el stock.

### M8 — Reportes, cotizaciones y tickets digitales _(semana 9)_

- Reportes de ventas, inventario y descuentos (secciones 51.2–51.4), como
  vistas SQL + interfaz, filtrables por fecha, sucursal, cajero, producto.
- `quotes`, `quote_items` con estados `DRAFT`, `SENT`, `CONVERTED`,
  `EXPIRED`; una cotización **no** mueve inventario ni caja.
- Ticket de regalo (mismo comprobante, sin precios).
- Ticket digital mediante enlace seguro, opaco y no enumerable, sin
  capacidad de modificar la venta ni consultar comprobantes ajenos.
- Compartir nativo y apertura de WhatsApp con mensaje y enlace preparados:
  **no requieren proveedor** y forman parte del alcance obligatorio.
- Envío automático por correo/SMS: **bloqueado** hasta elegir proveedor
  (sección 8). Se implementa desacoplado, de modo que una falla de cualquier
  canal jamás afecte una venta ya cobrada.
- El envío transaccional del ticket no concede consentimiento de marketing;
  ambos eventos se registran por separado.

**Aceptación:** los totales del reporte de ventas cuadran contra la suma
de `sale_payments` del periodo; convertir una cotización en venta genera
la venta por el flujo normal de `create_sale`.

### M9 — Importador de SICAR y reporte de reconciliación _(semana 10)_

Construir la **herramienta** de migración no es hacer la migración. Esta
herramienta se construye y se ensaya contra staging muchas veces antes de
que exista una noche de corte.

- Script de análisis (sólo lectura, se puede correr desde la semana 2):
  cuenta filas, códigos únicos, duplicados, vacíos, ceros iniciales, y
  deduce cómo SICAR codifica las variantes. **No escribe nada.** Su
  salida es la lista de limpieza que el cliente trabaja durante semanas.
- **Sincronizador re-ejecutable con dos modos** (ver `RUNBOOK_CORTE.md`
  sección 2.5), no un script de una sola vez:
  - _Modo catálogo:_ agrega lo nuevo, actualiza lo que cambió, no duplica
    y **no toca existencias**. Se corre cada semana o quincena durante
    meses. Respeta y nunca borra los productos creados directamente en
    Mi Tienda SM.
  - _Modo existencias y compromisos:_ ajusta existencias al valor real de
    SICAR y carga apartados, créditos y compras pendientes. Se corre una
    sola vez, la noche del cambio, y después se apaga para siempre.
- Escribe **sólo en staging** durante todo el desarrollo, y siempre dentro
  de una transacción.
- **Reporte de reconciliación automático** en cada corrida: filas leídas /
  importadas / rechazadas con motivo, suma de existencias origen vs.
  destino, valor a costo, duplicados, y excepciones que requieren
  decisión humana.
- Migración de compromisos abiertos, no sólo existencias: apartados con
  saldo, créditos, compras pendientes (ver `RUNBOOK_CORTE.md` sección 1).
- Los movimientos de la importación se registran como `INITIAL_IMPORT`,
  igual que cualquier otro movimiento auditable.

**Aceptación:** correr el sincronizador dos veces seguidas sobre la misma
exportación deja exactamente el mismo resultado, sin productos duplicados
ni movimientos de inventario inventados; una corrida en modo catálogo no
altera ni una existencia; un producto creado directamente en Mi Tienda SM
sobrevive intacto a la sincronización; el reporte sale con cero rechazos y
cero excepciones sin explicar; la suma de existencias cuadra al 100 %
contra el archivo de origen.

Por su naturaleza, este milestone conviene adelantarlo en cuanto exista el
catálogo (M2): mientras antes empiecen las corridas periódicas contra
datos reales, más tiempo tiene el cliente para limpiar SICAR.

## 6. Lo que Codex NO hace todavía

| Bloqueado                                  | Por qué                                                      | Cuándo                    |
| ------------------------------------------ | ------------------------------------------------------------ | ------------------------- |
| Importar el Excel real de SICAR            | El corte requiere tienda cerrada y datos finales             | Fase 7, al final          |
| Escribir en WooCommerce (stock, productos) | Mi Tienda SM no puede ser fuente de verdad sin catálogo real | Después del corte SICAR   |
| Webhooks de WooCommerce en producción      | Mismo motivo                                                 | Después del corte SICAR   |
| Cola offline / PWA offline completa        | Se diseña antes de implementarse (sección 31)                | Post-piloto               |
| CFDI / facturación                         | Se integra un PAC, no se construye                           | Cuando el cliente lo pida |
| Procesamiento de tarjetas                  | Terminal externa                                             | No aplica a V1            |

## 7. Secuencia de conexión con SICAR y WooCommerce

Esta sección responde directamente a la pregunta de negocio: **sí es
correcto construir todo primero y dejar SICAR al final**, con una
corrección sobre WooCommerce.

### 7.1 SICAR: el corte tiene que ser con tienda cerrada

Correcto tal como está planteado. Un POS con inventario no admite un corte
"en caliente": cualquier exportación tomada con la tienda abierta queda
obsoleta en el momento en que se vende una pieza más. El corte es:
cerrar → exportar → importar → validar → abrir al día siguiente ya con
Mi Tienda SM.

Conviene distinguir **tres contactos distintos con SICAR**, que no son la
misma cosa:

1. **Exportación de muestra para análisis** — sin riesgo, no es la
   migración. Sirve para diseñar el catálogo con la estructura real.
   **Debería conseguirse cuanto antes** (ver sección 7.4).
2. **Importación de una foto (snapshot) en staging** — para el piloto
   paralelo de la sección 7 del contexto maestro. No toca producción.
3. **Corte definitivo** — tienda cerrada, exportación final, importación a
   producción. Ésta es "la migración" y va al final.

Sólo el punto 3 es lo que se está posponiendo.

### 7.2 WooCommerce: no requiere cerrar la tienda, pero tampoco puede ir primero

Es cierto que WooCommerce no obliga a cerrar nada, porque se sincroniza en
vivo por API. Pero **no puede activarse antes del corte de SICAR**: hasta
que el catálogo real no esté cargado en Mi Tienda SM, el sistema no tiene
existencias válidas que publicar, y encendería la sincronización enviando
stock incorrecto a la tienda en línea o recibiendo pedidos de productos
que no existen todavía en la base.

La secuencia segura es:

```
Construir M0–M8
  → Corte SICAR (catálogo y existencias reales ya en Mi Tienda SM)
  → WooCommerce en modo lectura: emparejar por código, ensayo en seco
  → Comparar diferencias sin escribir nada
  → Encender sincronización real
```

El emparejamiento por código (sección 5 del contexto maestro) sí puede
prepararse antes en modo lectura, sin escribir en la tienda.

### 7.3 Runbook del corte (se ejecuta al final, se escribe antes)

> El procedimiento completo — los tres ensayos previos, qué se migra,
> el criterio de aceptación firmado por anticipado, la secuencia de la
> noche, el rollback y el encendido de WooCommerce — está en
> [`RUNBOOK_CORTE.md`](RUNBOOK_CORTE.md). Lo que sigue es el resumen.

- **D-7:** ensayo completo con exportación real en staging. Medir cuánto
  tarda la importación y cuántos errores de datos aparecen.
- **D-1:** confirmar que en SICAR no queden apartados, compras o
  devoluciones sin registrar.
- **Día D, al cerrar la tienda:**
  1. Corte final en SICAR y dejarlo sin más movimientos.
  2. Exportación final: productos, existencias, apartados con saldo,
     clientes con crédito, compras pendientes.
  3. Respaldo de la base de Mi Tienda SM (punto de retorno).
  4. Importación a producción.
  5. Validación automática: conteo de filas, suma de existencias por
     sucursal, cero códigos duplicados, cero códigos vacíos.
  6. Verificación manual por muestreo: 30–50 códigos contra SICAR y un
     conteo físico de una sección.
  7. Aprobación humana explícita → se habilita el POS.
- **Día D+1:** la tienda abre operando con Mi Tienda SM. SICAR queda en
  **sólo consulta**; no se vuelve a capturar nada ahí.
- **D+1 a D+7:** comparación diaria de cortes y monitoreo cercano.

**Rollback:** durante todo el proceso SICAR sólo se lee, nunca se
escribe. Si la validación falla antes de abrir, se restaura el respaldo y
la tienda abre con SICAR como si nada hubiera pasado. Ese es el motivo por
el que este orden es seguro.

### 7.4 Lo más urgente de conseguir hoy

Aunque la migración vaya al final, **una exportación de muestra de SICAR
debería conseguirse antes de M2**. El modelo de catálogo (cómo se
representan tallas, colores, producto padre y códigos) depende de cómo
SICAR estructura realmente esa información. Diseñarlo a ciegas y
descubrir en el corte que no coincide obligaría a rehacer M2 completo.

No es la migración: es leer un archivo para diseñar bien.

## 8. Bloqueos: reglas de negocio pendientes

Codex **no implementa** estas funciones hasta tener respuesta. Cada una
indica qué milestone bloquea.

| #   | Pregunta                                                                                                                                                         | Bloquea |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Crédito a clientes: ¿ya existe en SICAR? ¿quién autoriza el límite? ¿hay recargos?                                                                               | M7      |
| 2   | Descuento de cumpleaños: ¿automático o autorizado? ¿monto o porcentaje? ¿vigencia el día o el mes?                                                               | M7      |
| 3   | Tarjeta de lealtad: ¿ya existe una tarjeta física con código impreso?                                                                                            | M7      |
| 4   | Apartados: ¿plazo máximo? ¿enganche mínimo? ¿qué pasa al vencer?                                                                                                 | M7      |
| 5   | Envío automático de tickets: ¿proveedor de SMS/correo y envío obligatorio o a petición? Compartir nativo y WhatsApp con enlace ya están aprobados sin proveedor. | M8      |
| 6   | Ticket de regalo: ¿oculta sólo precios unitarios o también totales?                                                                                              | M8      |
| 7   | Cotizaciones: ¿vigencia? ¿conversión parcial a venta?                                                                                                            | M8      |
| 8   | Cambios: ¿se permite cambio por producto de distinto precio? ¿cómo se maneja la diferencia?                                                                      | M5      |
| 9   | Costo de compra: ¿costo promedio ponderado o último costo?                                                                                                       | M6      |
| 10  | Pagos: ¿cuántos métodos simultáneos permite hoy SICAR en una venta?                                                                                              | M4      |

## 9. Dependencias externas y accesos

| Necesario                                         | Para           | Cuándo                     |
| ------------------------------------------------- | -------------- | -------------------------- |
| Proyecto Supabase (mín. Pro) + accesos            | M1 en adelante | Hoy                        |
| Definir entornos: proyectos separados o branching | M0/M1          | Hoy, antes de cargar datos |
| Acceso al repositorio para Codex                  | M0             | Hoy                        |
| Exportación de muestra de SICAR                   | Diseño de M2   | Cuanto antes               |
| Modelo exacto de impresora térmica y lector       | M4 (ver 9.1)   | Antes de la semana 4       |
| Credenciales de WooCommerce                       | Post-corte     | Más adelante               |
| Lista de sucursales, cajas y empleados con su rol | M1             | Semana 1                   |

### 9.1 Riesgo de hardware que conviene despejar temprano

La impresión de tickets desde Safari en iPad es la parte con más riesgo
técnico de todo el POS: un navegador no habla ESC/POS directamente con
una impresora por USB o Bluetooth. La salida habitual es una **impresora
térmica de red** que acepte impresión por HTTP desde el navegador
(Epson con ePOS-Print o Star con WebPRNT son las opciones típicas), con
el cajón de dinero conectado al puerto de la propia impresora.

Esto conviene probarlo con hardware real **antes de la semana 4**, no al
final: si la impresora que se compre no soporta ese modo, cambia la
arquitectura del POS. El lector de códigos Bluetooth en modo teclado (HID)
sí funciona sin problema en iPad y no representa riesgo.

## 10. Quién ejecuta el corte

Regla que no cambia: **la migración la ejecuta un programa, no un agente
improvisando.**

Un agente escribiendo consultas en vivo contra producción la noche del
corte no se puede ensayar, y por lo tanto no se puede garantizar que la
corrida real se parezca al ensayo. Todo lo que pase esa noche tiene que
haber pasado idéntico tres veces antes. Por eso el importador es código
versionado, probado y re-ejecutable (M9), no una sesión de chat.

| Quién                     | Qué hace                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Codex**                 | Construye el importador, el reporte de reconciliación y las validaciones automáticas. Corrige lo que los ensayos revelen.    |
| **Claude**                | Revisa esa herramienta de forma adversarial, analiza los reportes de cada ensayo, diagnostica diferencias y ayuda a decidir. |
| **ProcesaLab**            | Ejecuta la herramienta contra producción, dirige la noche del corte y da el go / no-go.                                      |
| **Personal de la tienda** | Verifica los números: conteo físico y muestreo de códigos contra SICAR.                                                      |

Dos límites que conviene tener claros desde ahora:

1. **Ningún agente escribe en producción** (regla 9 de la sección 2). El
   importador se ejecuta contra producción por una persona, con una
   herramienta que ya se ensayó.
2. **Los agentes no tienen memoria entre sesiones.** La noche del corte,
   la sesión de Claude o de Codex será nueva y no recordará esta
   conversación. Por eso el runbook, el criterio de aceptación y el
   importador viven en el repositorio: **el repositorio es la memoria del
   proyecto, no el agente.** Todo lo que haga falta esa noche tiene que
   estar escrito y ejecutable sin depender de que un agente recuerde algo.

Corolario práctico: el procedimiento debe poder completarse **sin ningún
agente disponible**. Si esa noche no hay internet, o la sesión falla, la
persona en sitio tiene que poder correr el importador, leer el reporte y
decidir con el runbook en la mano. Un agente ahí es una ayuda, no una
dependencia.

## 11. Resumen del arranque

1. **Hoy:** Codex arranca M0 (no necesita base de datos). En paralelo se
   define plan de Supabase y estrategia de entornos, y se pide la
   exportación de muestra de SICAR.
2. **Semana 1:** M1 con la base ya disponible — roles, permisos,
   sucursales, auditoría y la matriz de tests de RLS.
3. **Semanas 2–9:** M2 a M8, un milestone a la vez, cada uno revisable y
   demostrable.
4. **Después:** ensayo del corte, corte de SICAR con tienda cerrada, y
   sólo entonces WooCommerce en vivo.
