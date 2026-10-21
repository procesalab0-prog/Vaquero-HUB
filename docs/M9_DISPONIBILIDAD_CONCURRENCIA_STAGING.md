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
