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
