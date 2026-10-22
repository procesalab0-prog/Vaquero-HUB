# M9 · Venta nativa Woo atómica · piloto privado de staging

Plan: enlazar reserva Woo, venta nativa, pago no efectivo, comprobante y cola de
entrega en una transacción. Reutilizar create_sale, que ya descuenta mercancía;
NO invocar CONSUME. Liberar sólo la reserva del pedido bajo los bloqueos de stock
que usa POS, registrar FULFILL y llamar al motor nativo una sola vez. Comprobar
importe, cantidades, identidad, revisión M9 y precio antes de tocar inventario.
Mantener costo desconocido NULL. Referencias del pedido/pago se preservan.

Primer alcance deliberadamente sintético: origen Woo test fijo, control de
mantenimiento deshabilitado, ADMIN, ubicación/sesión propias y ventana corta.
La sesión es una sesión de prueba ya abierta; el método M9_WEB_TEST es OTHER,
no efectivo, disponible sólo como fixture ROLLBACK. No elegir CARD/TRANSFER para
fingir pasarela. Evidencia privada explícita SYNTHETIC_TEST_ONLY; ningún estado,
fecha o hash Woo aislado demuestra pago. Ningún pedido nativo53/54 cancelado se
transforma en pagado. No activar pasarelas/correo/cron ni ampliar cinco ensayos.

Conciliar precio público completo, moneda MXN, pago íntegro y todos los componentes
conocidos; envío/impuestos/cupones/comisiones/descuentos no cero quedan retenidos
en esta primera vía, sin descartarlos ni convertirlos a efectivo. No aceptar
cantidades fraccionarias, códigos numéricos, varias líneas por variante, cambios
de identidad, consumo previo o pagos reutilizados. No se inventan compradores.

Ensayar también cancelación total únicamente con evidencia separada de reembolso
y recepción física completa. Reembolso sin mercancía recibida, devoluciones
parciales y cancelación fuera del servicio permanecen bloqueados. La cancelación
nativa repone stock una sola vez; no encadenar RESTOCK. Conservar el pago original
como historia y un recibo compensatorio inmutable, sin entrada/salida de efectivo.
No confundir método de ensayo con liquidación real ni envío de comprobante.

Orden común de bloqueos con POS; el núcleo técnico Woo adquirirá también los
advisory locks sale-stock antes de inventario. Pedido y operaciones se serializan;
replay conserva IDs. Bloquear comandos técnicos sobre pedidos ya financieros y
cancelación/devolución manual de esas ventas para no saltarse la conciliación.
No cambiar permisos públicos del motor POS ni su firma.

Plan + ensayo ROLLBACK + auditoría159tablas. Pruebas de precios/pagos/identidad,
reintentos, última pieza frente al motor POS, cancelación y fallo tras venta,
movimiento/folio/outbox. Revertir todos los datos sintéticos, sin borrar historia
ni reiniciar secuencias. Tablas nuevas vacías/controlfalse fuera de los ensayos.
No declarar carrera simultánea aprobada si sólo hubo llamadas secuenciales.
Revisión Auth/Preview y pasarela real de pruebas son aceptaciones posteriores.
No main, producción, existencias SICAR ni operaciones Woo remotas en este bloque.

## Ampliación de aceptación desde Preview

Añadir un botón ADMIN que ejecute el mismo ciclo sintético bajo subtransacción
y fuerce ROLLBACK interno antes de guardar un recibo del ensayo. No conservar
venta, pago, folio, evidencia sintética, método de pago, stock ni compuertas activas.
Conservar únicamente resultado, actor, sesión propia y operación idempotente en
una tabla privada de auditoría del ensayo. Sin IDs de tickets efímeros como si
existieran después. Repetición conserva recibo; enfriamiento30s para operaciones
nuevas. El recibo no prueba pasarela ni pedido remoto y la pantalla lo explicará.
