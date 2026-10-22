# M9 · Revisión de pedido antes de venta/ticket

Leer los importes y el estado de pago del pedido nativo Woo de pruebas mediante
GET autenticado, restringido a los mismos pedidos sintéticos ya verificados.
No ampliar la API Woo general ni crear pagos, pedidos o datos del comprador.
Conservar aislamientos de compra, correo, red saliente y webhooks.

Guardar una observación financiera inmutable por pedido/hash, con lectura estable
doble y autorización ADMIN propietario. Mostrar en Preview el importe observado,
las líneas y sus códigos literales, y la diferencia entre pedido y venta. Un
pedido cancelado sin pago no crea venta, abono, efectivo, folio ni ticket de venta.
Un costo desconocido continúa NULL. No usar `processing` o `is_paid` aislados como
prueba de pago; faltan referencia, fecha y conciliación de pasarela.

La operación futura debe enlazar documento financiero e inventario atómicamente:
el núcleo técnico CONSUME y create_sale descuentan ambos. No llamarlos juntos.
Este bloque detecta esa incompatibilidad y bloquea la contabilización; no elude
las reservas ni apaga el movimiento de la venta mediante una bandera del cliente.

Ensayar cambios de identidad, importes, pago fingido, moneda, campos ausentes,
repetición y acceso ajeno. PHP y pruebas de protocolo antes de actualizar sólo
el plugin de Woo test. DDL sólo staging, prueba SQL ROLLBACK, después Preview y
lectura real de pedido54. Comparar146 tablas y contadores de pedidos/pagos/
folios antes/después; sin ventana de inventario, cron ni cuenta de caja nueva.

Referencias: [WC_Order](https://woocommerce.github.io/code-reference/classes/WC-Order.html),
[WC_Order_Item_Product](https://woocommerce.github.io/code-reference/classes/WC-Order-Item-Product.html).


## Hallazgo en el pedido nativo54

La lectura GET comprobó fecha2026-10-22T00:12:03+00:00, método de ensayo,
referencia vacía e is_paid=false. El ensayo no ejecutó una pasarela. La fecha
proviene del cambio previo a processing; Woo documenta ese comportamiento en
[maybe_set_date_paid](https://woocommerce.github.io/code-reference/classes/WC-Order.html#method_maybe_set_date_paid).
La lectura inicial se rechazó porque esperaba fechaNULL. Se conservó la evidencia
y se añadió una migración nueva: fecha presente ⇒ CANCELLED_PAYMENT_DATE_REVIEW,
importe pagadoNULL, contabilizarfalse, ticketfalse, inventariofalse. No se corrige
ni se borra la fecha en Woo. Una fecha inválida, un método distinto o un indicador
de pago true siguen rechazados. No se toma la fecha como prueba de liquidación.

## Siguiente unión financiera: orden de implementación y aceptación

1. Mantener este lector separado de la contabilización. Una observación, incluso
   con fecha de pago, no abre caja ni habilita un medio de cobro. Para un pedido
   pagado se requerirán lectura autenticada actual, evidencia de la pasarela y
   conciliación de moneda, total, descuentos, impuestos, envío y devolución.
   Cualquier campo desconocido o diferencia retiene el pedido completo.
2. Diseñar un único servicio transaccional que registre la venta web y consuma
   su reserva una sola vez. No encadenar `CONSUME` con `create_sale`. El núcleo
   actual llama `app.apply_movement` y la venta nativa también lo hace; la venta
   nativa además requiere una sesión de caja y genera folio, pagos y auditoría.
   No reutilizar efectivo de mostrador para simular una liquidación web.
3. El servicio deberá conservar `origin/order_id/line_id`, vínculo a `variant_id`
   y Clave 1 literal, documento financiero, referencia de pago y recibo idempotente
   en la misma transacción. Serializar pedido y bloquear variantes en orden
   estable con el libro de inventario canónico. Si se consume una reserva,
   disminuir reservado y físico juntos; comprobar que no toca otras reservas.
4. Probar primero SQL con ROLLBACK y pagos explícitamente sintéticos: repetición,
   última pieza frente a POS, pedido cancelado, cobro parcial o duplicado,
   cambio de importe/código, múltiples líneas, devolución parcial y fallo después
   de folio/movimiento/outbox. Todo fallo revierte venta, pago, reserva, mercancía
   y vínculo. No borrar historia ni reiniciar secuencias para ocultar ensayos.
5. Aceptar desde Preview con identidad real y evidencia del medio de pago de
   pruebas, conservando los bloqueos del sitio real. La reposición física y el
   reembolso monetario siguen siendo operaciones separadas. Después vendrán
   actualización continua de disponibilidad, roles operativos y corte final de
   fuentes, existencias, apartados y entregas para autorizar el arranque por etapas.

Esta lista es diseño pendiente, no una ruta pública de contabilización ni una
afirmación de que las compras reales ya llegan al libro de ventas.
