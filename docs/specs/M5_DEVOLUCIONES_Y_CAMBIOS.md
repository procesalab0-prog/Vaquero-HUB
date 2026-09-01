# M5 — Devoluciones, cambios y cancelaciones

> Especificación para quien implemente. Depende de M3 (movimientos de
> inventario) y M4 (ventas y caja).
>
> Una tienda de botas no aguanta un día sin esto: el primer cliente que
> vuelva con la talla equivocada deja al personal sin salida. Por eso M5
> está en el alcance de octubre y no se puede recortar.

## 1. Tres operaciones distintas, no una

| Operación | Qué pasa | Dónde vive |
|---|---|---|
| **Cancelación** | Se anula una venta completa poco después de hecha, normalmente por un error de captura | M4 §6 |
| **Devolución** | El cliente trae mercancía y recibe su dinero | Aquí |
| **Cambio** | El cliente trae mercancía y se lleva otra; la diferencia se cobra o se devuelve | Aquí |

Se confunden seguido, y modelarlas igual trae problemas. Una cancelación
niega que la venta debió existir; una devolución reconoce que existió y la
revierte parcialmente.

## 2. La regla que gobierna este milestone

**La venta original jamás se modifica.** Ni sus renglones, ni sus importes,
ni sus pagos. Toda devolución y todo cambio son **documentos nuevos** que
apuntan a ella.

Si mañana alguien pregunta «¿qué se vendió el 3 de octubre?», la respuesta
tiene que ser la misma antes y después de cualquier devolución. Lo que
cambia es que existe además un documento que dice qué regresó.

## 3. Un solo documento para devolución y cambio

Un cambio **no** son dos operaciones sueltas. Es un documento con
renglones que entran y renglones que salen:

```sql
create table public.returns (
  id                uuid primary key default gen_random_uuid(),
  folio             text not null,
  type              text not null check (type in ('RETURN','EXCHANGE')),
  location_id       uuid not null references public.locations(id),
  cash_session_id   uuid not null references public.cash_sessions(id),
  original_sale_id  uuid not null references public.sales(id),
  customer_id       uuid references public.customers(id),
  returned_cents    bigint not null default 0 check (returned_cents >= 0),
  delivered_cents   bigint not null default 0 check (delivered_cents >= 0),
  difference_cents  bigint not null,   -- con signo, ver §5
  reason            text not null,
  authorized_by     uuid not null references public.app_users(id),
  created_by        uuid not null references public.app_users(id),
  created_at        timestamptz not null default now(),
  unique (location_id, folio)
);

create table public.return_items (
  id               uuid primary key default gen_random_uuid(),
  return_id        uuid not null references public.returns(id),
  direction        text not null check (direction in ('IN','OUT')),
  sale_item_id     uuid references public.sale_items(id),
  variant_id       uuid not null references public.variants(id),
  quantity         numeric(12,3) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  condition        text check (condition in ('RESELLABLE','DAMAGED')),
  constraint entrada_referencia_venta check (
    (direction = 'IN'  and sale_item_id is not null and condition is not null)
    or
    (direction = 'OUT' and condition is null)
  )
);

create table public.return_payments (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references public.returns(id),
  direction    text not null check (direction in ('REFUND','CHARGE')),
  method_code  text not null references public.payment_methods(code),
  amount_cents bigint not null check (amount_cents > 0),
  reference    text,
  created_at   timestamptz not null default now()
);
```

`direction = 'IN'` es lo que regresa a la tienda; `'OUT'` lo que se lleva
el cliente. Una devolución simple tiene sólo renglones `IN`. Un cambio
tiene de los dos. Así el cambio de talla queda trazado como **una sola
operación**, que es lo que pidió el negocio.

Estas tablas son de sólo inserción, con las mismas tres capas de M3 y M4.

## 4. Las dos reglas que evitan pérdidas reales

### 4.1 Se devuelve al precio que se pagó, nunca al de hoy

`return_items.unit_price_cents` para renglones `IN` se copia de
`sale_items`, **no** de `variants`.

Si no, la devolución se vuelve un negocio: comprar en descuento y devolver
a precio de lista deja la diferencia como ganancia del cliente y pérdida
de la tienda. Es un fraude clásico de retail y sale gratis si el sistema
lo permite.

Para renglones `OUT` en un cambio, el precio sí es el vigente en
`variants`: se está llevando mercancía hoy.

### 4.2 No se puede devolver más de lo que se vendió

Antes de aceptar un renglón `IN`:

```sql
select si.quantity
  into v_vendido
  from public.sale_items si
 where si.id = p_sale_item_id
   for update;      -- ← el candado no es opcional

select coalesce(sum(ri.quantity), 0)
  into v_ya_devuelto
  from public.return_items ri
 where ri.sale_item_id = p_sale_item_id
   and ri.direction = 'IN';

if v_ya_devuelto + p_quantity > v_vendido then
  raise exception 'RETURN_EXCEEDS_SOLD';
end if;
```

**El `for update` es lo que hace correcta la comprobación.** Sin él, dos
cajas procesando la devolución del mismo ticket al mismo tiempo pasan
ambas la validación y devuelven el doble. Es el mismo patrón de la última
pieza en M3, sólo que aquí el que se duplica es el dinero.

## 5. La diferencia en un cambio

```
difference_cents = delivered_cents − returned_cents
```

| Signo | Qué significa | Qué se hace |
|---|---|---|
| Positivo | Lo nuevo cuesta más | El cliente paga: renglones `CHARGE` en `return_payments` |
| Negativo | Lo nuevo cuesta menos | La tienda devuelve: renglones `REFUND` |
| Cero | Cambio parejo, típico de talla | Ningún movimiento de dinero |

Y la igualdad que se impone con restricción diferida, igual que en M4:

```
Σ CHARGE − Σ REFUND = difference_cents
```

**Pregunta de negocio pendiente:** cuando lo nuevo cuesta menos, ¿se
devuelve efectivo o se emite un saldo a favor? Muchas tiendas prefieren lo
segundo. Sin respuesta, se implementa sólo el efectivo y el saldo a favor
queda fuera.

## 6. Movimientos de inventario

Por cada renglón `IN`:

- **`RESELLABLE`** → un movimiento `RETURN` positivo en la ubicación. La
  mercancía vuelve a estar disponible.
- **`DAMAGED`** → el movimiento `RETURN` positivo **y además** un
  `ADJUSTMENT` negativo con motivo `DAÑO`.

Los dos movimientos en el caso dañado son a propósito: el libro tiene que
contar las dos cosas que pasaron —entró mercancía y se dio de baja— y no
una neta que esconde ambas. Es lo que permite después preguntar cuánto se
pierde por producto devuelto en mal estado.

Por cada renglón `OUT`: un movimiento `SALE` negativo, con la misma
función atómica de M3. **Si no hay existencia de lo que el cliente quiere
llevarse, todo el cambio falla**, igual que una venta.

## 7. Efecto en caja

Los renglones de `return_payments` en efectivo generan `cash_movements` en
la **sesión de caja abierta hoy**, no en la de la venta original.

Es deliberado y hay que decirlo porque suena raro: el dinero sale del
cajón de hoy, así que el corte de hoy tiene que reflejarlo. La venta
original ya cuadró en su día y no se toca.

**Las devoluciones a tarjeta no las procesa el sistema.** Van por la
terminal bancaria; Mi Tienda SM registra método, monto, referencia y
estado, para poder conciliar después. Mismo criterio que los cobros con
tarjeta en M4.

## 8. Autorización

El rol `CASHIER` tiene `returns.create`, porque devolver es parte del
trabajo diario. Pero se exige autorización de supervisor con PIN, igual
que los descuentos de M4, cuando:

- La devolución es en efectivo por encima de un monto a definir.
- La mercancía viene marcada como `DAMAGED`.
- Pasó más tiempo del plazo permitido.

`authorized_by` se verifica contra la base dentro de la función, nunca se
confía en que la interfaz ya validó.

## 9. Idempotencia

El botón de devolver tiene el mismo riesgo de doble toque que el de
cobrar, y aquí el doble toque **regala mercancía y dinero**. Se reutiliza
el mecanismo de M4: llave generada al abrir la pantalla, con los tres
casos —nueva, repetida idéntica, repetida con contenido distinto.

## 10. Lo que no se puede hacer

- Devolver sobre una venta `CANCELLED`.
- Devolver un renglón que no pertenece a la venta referida.
- Cambiar mercancía por dinero sin renglones `OUT`: eso es una devolución,
  y se registra como tal.
- Devolver sin venta original. **Pendiente de confirmar:** si el negocio
  acepta devoluciones sin ticket, hace falta definir a qué precio, porque
  el sistema no puede saberlo. Para V1 se exige la venta original.

## 11. Gancho para lealtad

Cuando exista M7, una devolución deberá retirar los puntos que generó la
compra. No se implementa ahora, pero `returns` ya guarda `customer_id` y
`original_sale_id`, que es todo lo que hará falta.

Está entre las preguntas abiertas de `IDENTIDAD_CLIENTE.md`: si se
devuelve una compra, ¿se retiran los puntos?

## 12. Pruebas obligatorias

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | **Devolver más de lo vendido** | `RETURN_EXCEEDS_SOLD` |
| 2 | **Dos devoluciones simultáneas del mismo renglón** | La suma nunca supera lo vendido |
| 3 | **Devolver algo comprado con descuento** | Se reembolsa el precio pagado, no el de lista |
| 4 | Cambio de talla al mismo precio | Diferencia cero; sin movimiento de dinero |
| 5 | Cambio por algo más caro | Cobro por la diferencia exacta |
| 6 | Cambio por algo más barato | Reembolso por la diferencia exacta |
| 7 | Cambio sin existencia de lo que se lleva | Todo el cambio falla; nada queda escrito |
| 8 | Devolución de mercancía dañada | Dos movimientos: `RETURN` y `ADJUSTMENT` con motivo |
| 9 | Devolución en efectivo | Afecta la sesión de caja **de hoy** |
| 10 | **La venta original después de una devolución** | Idéntica: mismos renglones, importes y pagos |
| 11 | Devolución sobre una venta cancelada | Rechazada |
| 12 | Renglón que no pertenece a la venta referida | Rechazado |
| 13 | Doble toque en «Devolver» | Un solo documento |
| 14 | Devolución sin autorización cuando se requiere | Rechazada |
| 15 | `UPDATE` o `DELETE` sobre una devolución | Rechazado por el disparador |
| 16 | Inventario tras devolver y volver a vender | El libro cuadra con el saldo |

## 13. Criterios de aceptación

- [ ] Las 16 pruebas pasan en CI. La 1, la 2, la 3 y la 10 son las
      bandera.
- [ ] Ninguna consulta modifica `sales`, `sale_items` ni `sale_payments`.
- [ ] El `for update` sobre `sale_items` está presente y hay una prueba
      concurrente que lo demuestra.
- [ ] Un cambio queda como **un** documento, no dos.
- [ ] Hacer un cambio de talla en el POS toma menos de 45 segundos,
      cronometrado con una persona real.

## 14. Preguntas abiertas

1. ¿Cuántos días se aceptan devoluciones? ¿Con ticket obligatorio?
2. ¿Se permite cambio por producto de distinto precio, y cómo se maneja la
   diferencia a favor del cliente: efectivo o saldo?
3. ¿A partir de qué monto una devolución en efectivo necesita autorización
   de supervisor?
4. ¿Qué se hace con la mercancía devuelta en mal estado? ¿Existe una
   categoría de saldos o se da de baja?
5. ¿Se aceptan devoluciones sin venta original?
