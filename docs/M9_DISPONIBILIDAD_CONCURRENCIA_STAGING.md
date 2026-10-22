# M9 · Disponibilidad y concurrencia · 21 octubre 2026

## Plan antes de modificar

Capturar la disponibilidad en la misma transacción de inventory_by_location,
incluidas modificaciones de caja y reservas, conservando cantidad física,
reservada, disponible y revisión monotónica. La captura será privada, apagada
por defecto y limitada a las dos familias ya verificadas, a La Piedad y a una
ventana de ensayo sintético ADMIN. No habilitar existencias de operación.

El ensayo conectado existente activará esta captura sólo dentro de su
subtransacción con rollback; conservará en el recibo la traza comprobada, sin
persistir stock ni una cola de stock utilizable fuera del ensayo. Fallar la
captura debe revertir el movimiento: nunca perder una actualización en silencio.

Woo de pruebas recibirá un ensayo de disponibilidad referido al mismo UUID del
pedido sintético cancelado. La traza esperada deriva de su cantidad; sólo se
permite la secuencia [cantidad+1,1,0,1,1,cantidad+1]. El cero y su recuperación
provienen de venta y devolución sintéticas usando el motor nativo de caja.
Guardar intención antes de
escribir, serializar por familia y mantener el mismo UUID al recuperar. Usar
setters nativos de Woo, releer cada paso y restaurar los campos de stock de
variación y padre antes de confirmar éxito. Un error incierto queda en revisión;
no crear otra solicitud ni declarar éxito si no se comprueba la restauración.
Mantener bloqueados pagos, correo, webhooks, compra y API Woo general.

La cola coalesce cambios de una transacción: el consumo primero libera la reserva
y después descuenta las piezas, por lo que hay estados internos intermedios en
la auditoría que nunca deben despacharse antes del COMMIT. Los checkpoints que
se envían representan final de siembra/reserva/consumo/reposición, no cada evento
interno. Releer la revisión actual evita publicar un trabajo que ya quedó obsoleto.

Probar por separado conexiones simultáneas, identificando backend PID y bloqueo
observado; no llamar carrera aceptada a una prueba secuencial. Todas las pruebas
de stock nativo terminan ROLLBACK y una auditoría compara tablas preexistentes.

Esto comprueba transporte y reversión de cantidades SINTÉTICAS. Para sincronizar
la operación siguen haciendo falta corte físico, entregas/apartados, inicialización
autorizada y trabajador de envío continuo con tratamiento de pedidos reales.


## M9 · Disponibilidad y bloqueo simultáneo en Preview · 21 octubre 2026

Publicado Preview0.82.0 READY, commit6e7653e7bb1c4694c248d7486b45863e638bb37b,
árbol860796bcb7cb957bbae0704f81bd0848bd2cb6d5; avatar comprobado. Plugin Woo test
1.5.0, ocho protecciones OK. Nueva captura privada en inventory_by_location, con
revisión monotónica, outbox y eventos atómicos; apagada fuera del ensayo sintético,
ADMIN/La Piedad/dos familias verificadas. No cola operativa con existencias reales.

Aceptados desde Preview con sesión real: pedidos52 y53 (códigos10582 y10317),
cancelados; cada uno ensayó reserva/consumo/reposición y dos movimientos sintéticos
SALE/RETURN mediante el mismo motor nativo de inventario de caja. La captura registró
8 revisiones, incluido disponible0. Woo recibió checkpoints3→1→0→1→1→3, comprobó
agotado y restauró campos de stock de padre/variación exactamente según snapshot.
Dos recibos VERIFIED; una repetición UI por recibo conservó las mismas solicitudes.
No cobro, envío, documento financiero, importación de conteos o costos inventados.

Contención simultánea REAL vía dos pestañas Preview/Auth/PostgREST: backends841967
(HOLDER/reserva1 sintética) y841999(CONTENDER/native SALE), espera1206.085ms y
native_lock_observed=true, ambos con rollback. La ventana privada90s fue cerrada
y restablecida a false/NULL; reintento UI rechazado M9_CONTENTION_WINDOW_REQUIRED.
Esto acepta el bloqueo técnico compartido, no la carrera financiera completa de
checkout público contra una venta POS. Intento previo por MCP sin solapamiento no
aceptado; evidencia conservada junto al ensayo UI que sí observó el bloqueo.

1,070 unitarias/120 archivos, PHP54 +regresión fotos42/23, SQL12 rechazos y fallo
inyectado que revierte todo el movimiento; build/tipos/lint PASS. Auditoría146
preexistentes idéntica antes/después de ambos recorridos y contención. Captura y
sonda apagadas, outbox/eventos nuevos vacíos, controles previos intactos. Nuevas
filas persistentes: dos connected_trials +cuatro connected_events +dos recibos de
disponibilidad; pedidos test52/53 y sus recibos quedan como evidencia.
Migración local20261021231739 aplicada remota20261021232656, sin reescribir SQL.

Ver docs/M9_DISPONIBILIDAD_CONCURRENCIA_STAGING.md; evidencia privada en
outputs/m9-disponibilidad-2026-10-21/. No main ni producción. Sigue trabajador
continuo/versionado de stock, captura para roles operativos, transporte de pedidos
reales y documentos financieros, pruebas de compra completa, corte físico/entregas
y autorización del arranque. Cobertura catálogo96.92% sin cambio; no porcentaje total.
