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


### Cierre aceptado · Preview0.84.1 · Revisión financiera M9

Publicado sólo codex/m9-staging-review: SHA
d4945e918fc91e014747c34aaf2204c646fcf943,
árbol0c65a52e1f4e5a5a51729674769e8a79532a7495,
Vercel dpl_4fJXxvoR7eGRWMytApTdfKUYoBD8 READY, targetPreview.
0.84.0 se aceptó primero; 0.84.1 corrige artículo de la confirmación e incluye
el plan del siguiente servicio financiero, sin cambiar permisos ni protocolo.
Versión0.84.1 comprobada pulsando avatar en Preview con Auth real.

UI aceptada en pedidos nativos sintéticos53/54: código10317,2×$890=$1,780;
código10582,2×$820=$1,640. Ambos cancelados, referencia de transacción vacía,
is_paidfalse, método sintético, fecha de pago nativa observada: revisión, no cobro.
Se conservan dos observaciones inmutables con costoNULL/pagadoNULL y venta,
ticket e inventariofalse. Repetición en0.84.0 y0.84.1 conserva IDs, hashes,
created_at y conteo2, sin nuevos pedidos. GET anónimo Woo rechazado401.
Se releyó también el recibo de restauración54: before=after/restoredtrue;
esto es evidencia del ensayo previo, no un conteo físico SICAR nuevo.

Auditoría146 preexistentes idéntica antes/después y al cierre. Workerfalse con
actor/window/expires/identity_expiresNULL, cron0, captura/concurrencia/pilotofalse,
outboxstock0, outbox/eventosdisponibilidad0. Connectedtrials5, jobs2/eventos10
sin cambios. No ventas, pagos, folios, caja, costos ni existencias reales nuevos.
Dos filas privadas de evidencia financiera y actualización pluginWoo test1.6.0
son los cambios persistentes del ensayo; las fixtures SQL fueron ROLLBACK.
Ocho aislamientos Woo test comprobados en panel; main/producción intactos.

1,136 unitarias/123 archivos; PHP64 controles, SQL20 rechazos, tipos/lint/build
PASS. Evidencia privada outputs/m9-pedido-finanzas-2026-10-21/: reporte.html,
resumen.json, auditorías, pruebas, capturas, ZIP determinista y verificar.mjs,
manifest.json. Advisors: tabla privada con RLS sin políticas por diseño; nueva
RPC de contexto definer authenticated sólo ADMIN propietario; advertencias
preexistentes de funciones definer y contraseñas filtradas continúan abiertas.
No se declara auditoría global cerrada ni aceptación de compras reales.

Sigue el servicio atómico pedido/venta/pago/reserva/ticket, sin ejecutar CONSUME
y create_sale sobre las mismas unidades. Requiere evidencia conciliada de pago,
tratamiento explícito de totales y medio web (no efectivo ficticio), contención
financiera POS/Woo y reversión integral. Después sincronización operativa de
stock, corte final actualizado y autorización por etapas. Catálogo96.92% sin
cambio; no porcentaje global de migración. Ver plan financiero para secuencia.
