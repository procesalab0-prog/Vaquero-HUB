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


## 2026-10-22 · Venta nativa Woo atómica ensayada en Preview 0.87.0

Plan previo: docs/M9_WOO_VENTA_NATIVA_ATOMICA_STAGING.md. Sólo staging
zsezjtswqeijboezvado. Local7b1d8e2 / remoto Preview d221ad7f5aa9d8b602b7bfc2a5e904f18b9fdf9b,
árbol558595523e92e0199425c42e55891d52e4ceb537. VercelSUCCESS;
avatar0.87.0 confirmado con ADMIN real. Sin main/producción ni pedidos remotos.

Servicio privado sintético POST/FULL_CANCEL: reserva→venta/pago/ticket nativos
atómicos, sin encadenar CONSUME; cancelación nativa con prueba separada de
reembolso y recepción física simulada, sin encadenar RESTOCK. Costo desconocido
permaneceNULL. PagoM9_WEB_TEST/OTHER sólo transitorio; ceroefectivo/cobro/pasarela.
Identidad y Clave1 literales, precio público, MXN, alcance/líneas/importes/versiones
validados. Envío/impuestos/cupones/descuentos/fees no cero, parcialidades y retornos
parciales quedan retenidos. Cancelación/devolución retail de ventas vinculadas
no puede saltarse el servicio. Worker/captura/piloto siguenfalse,cron0,cincoensayos
Woo conectados anteriores no se amplían. Las observaciones53/54 no se pagan.

Doble registro de mercancía evitado mediante motor nativo único y bloqueos de
stock compartidos con POS. Última pieza reservada rechaza venta POS secuencial;
NO certifica dos checkouts simultáneos. Docker local no disponible; esa aceptación
concurrente queda pendiente explícita. SQL21rechazos/10invariantes/3replays y
fallos inyectados después de venta/movimientos/folios, tanto POST como cancelación:
17tablas afectadas regresan al hash anterior. Regresión kernel21comandos,
31rechazos,6ACL,12invariantes,5replays PASS, siempreROLLBACK.

Nueva pantalla /productos/ensayo-woo/venta desde /migracion. RPC autenticada exige
ADMINactivo,customers.manage y sesión abierta propiaLaPiedad. Crea venta/pago/ticket
y cancelación sintéticos en subtransacción con rollback interno; guarda sólo el
recibo de comprobación privado/inmutable. Replay conserva recibo, cooldown30s,
sesión ajena/actor desconocido/anon/service_role/direct private execute denegados.
9ACLfunción+3ACLtabla+2denegacionesRPC comprobadas con rol authenticated real.
Sin IDs de ticket efímero presentados como venta disponible después de revertir.

Aceptación realPreview: recibo26b25f0c-3b54-444f-955e-e442ddd26586;
2líneas,1venta/1pago sintéticos,2descuentos/2reposiciones,0movimientosefectivo;
5/3→3/2→5/3 y rollback al estado inicial. Sólo1recibodeensayo persistente.
Las159tablasanteriores idénticas por hash y conteo, incluidos dos archivos
históricos. Evidencia/postings/recibosfinancieros/ticketoutbox/pedidos/links0;
métodosintético0, controlfinancierofalse. Catálogo,folios,saldos,caja y
36cantidadespilotoNULLsin cambios. Teléfono390×844sin desborde (documento390),
últimoenlace704.86píxeles;viewportrestaurado. No certifica Safari/hardware.
1,191pruebasunitarias/126archivos,tipos,lintcompleto y buildPASS.
RLSprivadasinpoliciesINFOesperado; avisos previosdefiner/protecciónpassword
no se declaran resueltos. No hay nueva RPC públicaSECURITYDEFINER en este bloque.
DDLlocal20261022203711→remota20261022204119; local20261022204832→20261022205141.
No editar migracionesaplicadas.

Expedienteprivado outputs/m9-venta-woo-atomica-2026-10-22/:SQL, resultados,
auditorías, capturas, logs, manifest y verificar.mjs. Siguiente: conectar evidencia
verificada de pasarela de pruebas y casos comerciales completos; aceptar
concurrencia POS/Woo; cerrar conteo físico/entregas y corte renovado del piloto;
abrir saldos confirmados por etapas con compensación. Mantener17líneas históricas
sin vínculo y entregas sin acreditar bloqueadas. Catálogo96.92% sin cambio;
esta aceptación sintética no es porcentaje de importación ni pasarela operativa.
