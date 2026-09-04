# M4 — POS, ventas, pagos mixtos y caja

> Especificación para quien implemente. Ver [`../PLAN_CODEX.md`](../PLAN_CODEX.md)
> sección 4 para la arquitectura de la lógica crítica.
>
> Es el milestone más grande y donde el dinero se puede perder de verdad.
> M3 protege el inventario; M4 protege la caja.

## 1. La regla que gobierna este milestone

**El cliente nunca dice cuánto cuesta algo.**

`create_sale` recibe qué variantes y qué cantidades, **no** los precios. Los
precios se leen de `variants` dentro de la transacción. Un cliente
manipulado que pudiera mandar `unit_price_cents: 1` vaciaría la tienda sin
dejar rastro de que hizo algo raro: la venta se vería perfectamente
normal.

Lo mismo aplica a los descuentos: el cliente pide un descuento y un
autorizador; el servidor decide si procede y cuánto vale.

## 2. Tablas

```sql
create table public.payment_methods (
  code               text primary key,   -- 'EFECTIVO','TARJETA','TRANSFERENCIA'
  name               text not null,
  is_cash            boolean not null default false,
  requires_reference boolean not null default false,
  is_active          boolean not null default true,
  display_order      int not null default 0
);

create table public.cash_registers (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  unique (location_id, code)
);

create table public.cash_sessions (
  id                  uuid primary key default gen_random_uuid(),
  cash_register_id    uuid not null references public.cash_registers(id),
  location_id         uuid not null references public.locations(id),
  status              text not null check (status in ('OPEN','CLOSED')),
  opening_amount_cents bigint not null check (opening_amount_cents >= 0),
  opened_by           uuid not null references public.app_users(id),
  opened_at           timestamptz not null default now(),
  expected_cash_cents bigint,
  counted_cash_cents  bigint,
  difference_cents    bigint,
  closed_by           uuid references public.app_users(id),
  closed_at           timestamptz
);

-- Una sola sesión abierta por caja, garantizado por la base y no por la app.
create unique index cash_sessions_una_abierta_idx
  on public.cash_sessions (cash_register_id) where status = 'OPEN';

create table public.cash_movements (
  id              uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions(id),
  type            text not null check (type in
                    ('OPENING','SALE','RETURN','WITHDRAWAL','DEPOSIT')),
  amount_cents    bigint not null check (amount_cents <> 0),  -- con signo
  reason          text,
  reference_type  text,
  reference_id    text,
  user_id         uuid not null references public.app_users(id),
  created_at      timestamptz not null default now()
);

create table public.sales (
  id               uuid primary key default gen_random_uuid(),
  folio            text not null,
  location_id      uuid not null references public.locations(id),
  cash_session_id  uuid not null references public.cash_sessions(id),
  customer_id      uuid references public.customers(id),
  subtotal_cents   bigint not null check (subtotal_cents >= 0),
  discount_cents   bigint not null default 0 check (discount_cents >= 0),
  total_cents      bigint not null check (total_cents >= 0),
  status           text not null default 'COMPLETED'
                     check (status in ('COMPLETED','CANCELLED')),
  sold_by          uuid not null references public.app_users(id),
  created_at       timestamptz not null default now(),
  unique (location_id, folio)
);

create table public.sale_items (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references public.sales(id),
  variant_id       uuid not null references public.variants(id),
  quantity         numeric(12,3) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_cents   bigint not null default 0 check (discount_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  unit_cost_cents  bigint not null default 0
);

create table public.sale_payments (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references public.sales(id),
  method_code  text not null references public.payment_methods(code),
  amount_cents bigint not null check (amount_cents > 0),
  tendered_cents bigint,
  reference    text,
  created_at   timestamptz not null default now()
);

create table public.applied_discounts (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid not null references public.sales(id),
  sale_item_id   uuid references public.sale_items(id),
  kind           text not null check (kind in ('AMOUNT','PERCENT')),
  value          numeric(12,4) not null check (value > 0),
  amount_cents   bigint not null check (amount_cents > 0),
  reason         text,
  authorized_by  uuid not null references public.app_users(id),
  created_at     timestamptz not null default now()
);

create table public.idempotency_keys (
  key          uuid primary key,
  scope        text not null,
  request_hash text not null,
  sale_id      uuid references public.sales(id),
  created_at   timestamptz not null default now()
);

create table public.folios (
  location_id uuid not null references public.locations(id),
  doc_type    text not null,
  next_number bigint not null default 1,
  primary key (location_id, doc_type)
);
```

`unit_cost_cents` guarda el costo **al momento de la venta**. Sin él, el
margen histórico se recalcula con el costo de hoy y miente.

### 2.1 Nada se borra ni se edita

`sales`, `sale_items`, `sale_payments` y `cash_movements` son de sólo
inserción, con las mismas tres capas que `inventory_movements` en M3: sin
política de RLS para update/delete, revocación explícita, y un disparador
que detiene incluso a funciones `SECURITY DEFINER`.

Cancelar una venta **no la borra**: cambia `status` y genera documentos
compensatorios. `sales.status` es la única columna que puede cambiar, y el
disparador debe permitir exactamente eso y nada más.

### 2.2 El POS no vende lo que está dado de baja

**`create_sale` rechaza cualquier renglón cuya variante o cuyo producto tenga
`is_active = false`.** La comprobación va dentro de la transacción, junto a la
lectura del precio, no en la pantalla.

El motivo no es hipotético. `search_catalog` devuelve a propósito las
variantes dadas de baja —hacen falta para reactivarlas, ver §7.1 de
[`M2_CATALOGO.md`](M2_CATALOGO.md)—, así que el POS las va a recibir en los
resultados. Si nadie las filtra, se venden.

Y hay un caso que lo vuelve concreto desde el primer día: **producción ya
contiene productos de prueba que no se pueden borrar.** Sus códigos son
`GENERATED` y por lo tanto inmutables; la variante no se puede borrar porque
el código la referencia, y el producto tampoco porque la variante lo
referencia. Lo único que se puede hacer es darlos de baja. Si el POS no
respeta esa baja, el primer día de operación se puede cobrar un artículo de
prueba.

Prueba obligatoria: **intentar vender una variante dada de baja se rechaza**,
y el mensaje dice por qué.

## 3. La única forma en que el dinero cuadra

### 3.1 Todo en centavos enteros

`bigint`, sufijo `_cents`, jamás punto flotante. El formateo a pesos
ocurre sólo al pintar.

### 3.2 Las tres igualdades que nunca se rompen

```
1. sale_items.line_total_cents  =  round(quantity × unit_price) − discount_cents
2. sales.total_cents            =  Σ line_total_cents − sales.discount_cents
3. Σ sale_payments.amount_cents =  sales.total_cents      ← la crítica
```

La tercera se impone con una **restricción diferida** que se evalúa al
final de la transacción, porque los renglones se insertan uno por uno:

```sql
create constraint trigger sale_payments_cuadran
after insert or update or delete on public.sale_payments
deferrable initially deferred
for each row execute function app.fn_check_sale_balance();
```

Un pago 30/70 que no cuadre por redondeo **debe fallar**, no ajustarse
solo. Si el sistema puede «acomodar» un centavo por su cuenta, también
puede acomodar mil.

### 3.3 El vuelto no es un pago negativo

Cuando alguien paga $500 por una compra de $430:

- `amount_cents = 43000` — lo que se aplica a la venta.
- `tendered_cents = 50000` — lo que entregó.
- El vuelto de $70 **se calcula y se muestra, no se guarda como renglón.**

Si el vuelto se guardara como pago negativo, la igualdad 3 se rompería y
todo reporte de formas de pago quedaría mal. En caja, lo que entra al
cajón es `tendered`; lo que cuadra contra la venta es `amount`.

### 3.4 Reparto de descuento porcentual: mayor residuo

Un 10% sobre tres renglones de $33.33 son 999 centavos, pero el reparto
proporcional da 333.3 por renglón. Repartir mal pierde o inventa centavos.

El algoritmo, explícito porque es fácil equivocarse:

1. Calcular el descuento total: `floor(base × pct / 100)`.
2. Para cada renglón, la parte ideal: `line_total × descuento_total / base`.
3. Asignar a cada renglón el `floor` de su parte ideal.
4. Repartir los centavos sobrantes de uno en uno, **empezando por los
   renglones con mayor residuo fraccionario**, y desempatando por el
   renglón de mayor importe.

Al final, la suma de los descuentos por renglón es exactamente el
descuento total. Esto necesita su propia prueba unitaria con casos que
den residuo.

## 4. `create_sale`

Es el contrato que desbloquea el trabajo en paralelo (ver
`REPARTO_TRABAJO.md`). **Se publica antes de implementarse.**

```sql
create or replace function public.create_sale(
  p_idempotency_key  uuid,
  p_cash_session_id  uuid,
  p_items            jsonb,   -- [{"variant_id":uuid,"quantity":number}]
  p_payments         jsonb,   -- [{"method_code":text,"amount_cents":bigint,
                               --   "tendered_cents":bigint?,"reference":text?}]
  p_customer_id      uuid   default null,
  p_discounts        jsonb  default null,
                              -- [{"scope":"TICKET"|"ITEM","variant_id":uuid?,
                              --   "kind":"AMOUNT"|"PERCENT","value":number,
                              --   "authorized_by":uuid,"reason":text}]
  p_notes            text   default null
) returns public.sales
```

Nótese lo que **no** recibe: precios, subtotal, total. Los calcula el
servidor (sección 1).

Orden de operaciones dentro de una sola transacción:

1. **Idempotencia** (sección 4.1).
2. Validar que quien llama tiene `pos.sell` y acceso a la ubicación.
3. Validar que la sesión de caja existe, está `OPEN` y pertenece a esa
   ubicación.
4. Leer precios y costos vigentes de `variants` para cada renglón.
5. Validar y aplicar descuentos: cada uno exige `authorized_by` con
   permiso `sales.discount`, verificado contra la base (sección 4.2).
6. Calcular importes y repartir descuentos (sección 3.4).
7. Validar que los pagos cuadran y que los métodos que exigen referencia
   la traen.
8. Descontar inventario llamando a `app.apply_movement` con tipo `SALE`,
   una vez por renglón. Si alguno devuelve `INSUFFICIENT_STOCK`, **toda la
   venta falla**.
9. Asignar folio (sección 4.3).
10. Insertar `sales`, `sale_items`, `sale_payments`, `applied_discounts`.
11. Insertar `cash_movements` tipo `SALE` por la parte pagada en efectivo.
12. Registrar la llave de idempotencia con el `sale_id`.

Si algo falla, no queda nada a medias.

### 4.1 Idempotencia — el doble toque en «Cobrar»

La llave la genera el cliente **al abrir la pantalla de cobro**, no al
tocar el botón. Un botón tocado dos veces manda la misma llave.

Al entrar, la función busca la llave:

- **No existe** → sigue adelante y la registra al final.
- **Existe y el `request_hash` coincide** → devuelve la venta ya creada.
  El segundo toque no cobra de nuevo.
- **Existe y el `request_hash` es distinto** → error `IDEMPOTENCY_CONFLICT`.

Ese tercer caso importa: significa que el cliente reusó una llave para un
carrito diferente. Devolver la venta anterior le entregaría al cajero un
ticket que no corresponde a lo que cobró. Es preferible fallar ruidoso.

El `request_hash` se calcula sobre los renglones, los pagos y los
descuentos normalizados.

### 4.2 Descuentos autorizados

El rol `CASHIER` **no** tiene `sales.discount`. Un descuento exige que un
supervisor se autentique en el momento, con la función de PIN de M1:

```
Cajera pide descuento → pantalla de autorización → PIN del supervisor
  → public.verify_supervisor_pin(codigo, pin, 'sales.discount')
  → devuelve supervisor_id → viaja como authorized_by
```

`create_sale` **vuelve a verificar** que ese `authorized_by` tenga el
permiso. Nunca confía en que la interfaz ya lo validó.

Cada descuento genera su renglón en `applied_discounts` con quién
autorizó y por qué. Sin eso, el reporte de descuentos de M8 no puede
responder quién autorizó qué.

### 4.3 Folios

```sql
update public.folios
   set next_number = next_number + 1
 where location_id = p_location_id and doc_type = 'VENTA'
returning next_number - 1 into v_numero;
```

Dentro de la misma transacción. El `UPDATE` toma el candado de la fila, así
que dos cajas simultáneas no pueden obtener el mismo folio. Formato
`S01-V-000123`.

Consecuencia aceptada: si una venta falla después de tomar el folio, ese
número se pierde. Un hueco en la numeración es preferible a un folio
duplicado.

## 5. Caja

### 5.1 Apertura

`open_cash_session(register_id, opening_amount_cents)` exige `cash.open`,
acceso a la ubicación, y que no haya otra sesión abierta en esa caja — lo
cual ya garantiza el índice único parcial, así que el error viene de la
base y no de una comprobación que se pueda olvidar.

Genera un `cash_movements` tipo `OPENING`.

### 5.2 Cierre y corte

```
esperado = apertura
         + Σ ventas en efectivo
         + Σ depósitos
         − Σ retiros
         − Σ devoluciones en efectivo
```

**Conteo a ciegas.** Al cerrar, el sistema pide el efectivo contado
**antes** de mostrar el esperado. Si se muestra primero el esperado, el
número contado tiende a parecerse a él y el corte deja de detectar nada.
Es la diferencia entre un corte que sirve y uno decorativo.

Después de capturar: se muestran esperado, contado y diferencia. Una
diferencia distinta de cero exige un comentario y queda en bitácora.

`close_cash_session` exige `cash.close`. Una sesión cerrada no admite más
ventas: `create_sale` valida `status = 'OPEN'` (paso 3).

### 5.3 Movimientos de caja

Retiros e ingresos exigen `cash.movement` y motivo obligatorio.

## 6. Cancelación

`cancel_sale(p_sale_id, p_reason)` exige `sales.cancel`:

- La venta original **no se modifica** salvo `status = 'CANCELLED'`.
- Movimientos `CANCELLATION` que devuelven cada renglón al inventario.
- Si hubo efectivo, un `cash_movements` negativo en la **sesión abierta
  actual**, no en la original — el dinero sale de la caja de hoy.
- Queda en bitácora con usuario, fecha y motivo.

**Pregunta de negocio pendiente:** ¿se puede cancelar una venta de otro
día, o después de cerrada la sesión sólo procede devolución (M5)? La
práctica común es lo segundo. Confirmar antes de implementar.

## 7. Interfaz: touch-first para iPad

Requisitos de la sección 15 del plan maestro, hechos concretos:

- **Objetivos táctiles de 44 pt como mínimo.** Nada de listas densas de
  escritorio.
- **Carrito siempre visible**, sin necesidad de cambiar de pantalla.
- **Teclado numérico propio** para cantidades e importes; el del sistema
  tapa media pantalla.
- **Un solo campo de búsqueda** que acepte código escaneado, texto o
  teléfono de cliente y decida solo qué es.
- **Funciona en horizontal y en vertical.**
- **El botón de cobrar se deshabilita al primer toque**, con estado de
  carga visible. La idempotencia del servidor es la red; la interfaz es la
  primera línea.
- **Estado de conexión explícito y bloqueante.** V1 es en línea: si no hay
  red, se dice claramente y no se deja cobrar. La cola sin conexión llega
  después y por eso existe la llave de idempotencia desde ahora.

## 8. Impresión

**Imprimir no es parte de la transacción de venta.** La venta se confirma
en la base y el ticket es un paso aparte, reintentable. Si la impresora
está atascada, la venta ya es válida y se reimprime.

Existe `print_jobs` desde este milestone, con el controlador
intercambiable, para que la decisión de impresora no quede soldada al POS.
Ver la discusión de arquitectura en `PLAN_CODEX.md` sección 9.1.

## 9. RLS

- `sales`, `sale_items`, `sale_payments`: lectura por ubicación vía
  `app.can_access_location`. Escritura sólo por `create_sale`.
- `cash_sessions`, `cash_movements`: igual, pero la lectura del libro de
  caja de una sesión **abierta** exige `reports.sales`, no `cash.close`.
  Atarla a `cash.close` la volvía inútil: `cash.close` es el permiso de la
  cajera, porque es ella quien cierra su propia caja, así que un
  `select sum(amount_cents)` le entregaba el esperado antes de contar.
  La cajera revisa su propia sesión completa una vez cerrada.
- Mientras la sesión está abierta, ninguna RPC devuelve importes de venta al
  cajero: `get_my_cash_session` entrega conteos de operaciones. Fondo inicial
  más efectivo cobrado más entradas menos retiros reconstruye el esperado, así
  que basta con publicar el desglose por método para que el conteo a ciegas
  deje de serlo. **Esta regla es de la base, no de la pantalla.**
- `payment_methods`: lectura para cualquier usuario activo.
- Los costos (`unit_cost_cents`) sólo para quien tenga `reports.inventory`.
  **Una cajera no ve el margen.**

## 10. Pruebas obligatorias

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | **Doble toque en «Cobrar»** con la misma llave | Una sola venta; la segunda llamada devuelve la primera |
| 2 | Misma llave con carrito distinto | `IDEMPOTENCY_CONFLICT` |
| 3 | **Pago 30/70 sobre un total impar** | La suma cuadra exacto al centavo |
| 4 | Pagos que no suman el total | Rechazado |
| 5 | Descuento 10% sobre tres renglones con residuo | La suma de descuentos por renglón == descuento total |
| 6 | Descuento sin autorización de supervisor | Rechazado |
| 7 | Descuento con `authorized_by` sin el permiso | Rechazado |
| 8 | Venta con `unit_price` mandado por el cliente | Ignorado: se usa el precio de la base |
| 9 | Venta sobre existencia insuficiente en un renglón | **Toda** la venta falla; nada queda escrito |
| 10 | Dos cajas vendiendo la última pieza a la vez | Exactamente una tiene éxito |
| 11 | Dos cajas cobrando a la vez | Folios distintos |
| 12 | Venta con sesión de caja cerrada | Rechazada |
| 13 | Abrir dos sesiones en la misma caja | Rechazado por la base |
| 14 | Pago en efectivo con vuelto | `Σ amount_cents == total`; el vuelto no es renglón |
| 15 | Corte con ventas en efectivo, retiro e ingreso | El esperado cuadra |
| 16 | Cancelación | La venta original intacta salvo `status`; inventario regresa |
| 17 | `UPDATE` o `DELETE` sobre una venta | Rechazado por el disparador |
| 18 | `CASHIER` consulta ventas de otra sucursal | Cero filas |
| 19 | `CASHIER` consulta el costo de un renglón | No lo ve |
| 20 | Vender una variante dada de baja | Rechazado, con el motivo (§2.2) |
| 21 | Vender un producto dado de baja con variante activa | Rechazado igual |

## 11. Criterios de aceptación

- [ ] Las 21 pruebas pasan en CI. La 1, la 3, la 9 y la 10 son las
      bandera.
- [ ] Ningún precio ni total llega desde el cliente.
- [ ] La restricción diferida de cuadre de pagos está activa.
- [ ] El conteo de caja es a ciegas.
- [ ] La firma de `create_sale` está publicada antes de implementarla.
- [ ] Cobrar una venta de tres renglones con pago mixto toma menos de 30
      segundos en un iPad, cronometrado con una persona real.

## 12. Preguntas abiertas

1. ¿Cuántos métodos de pago simultáneos permite hoy SICAR en una venta?
2. ¿Se puede cancelar una venta después de cerrada la sesión de caja?
3. ¿El corte se hace por turno o por día? ¿Varios turnos por caja?
4. ¿Qué datos lleva el ticket impreso? Conviene una foto de uno actual.
5. ¿Hay un tope de descuento que un gerente pueda autorizar sin el dueño?
