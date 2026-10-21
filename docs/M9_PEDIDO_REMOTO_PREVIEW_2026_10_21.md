# M9 · Pedido remoto y Preview · 21 octubre 2026

## Plan previo

Probar el núcleo anterior contra un pedido nativo de Woo independiente, creado
administrativamente y marcado SINTÉTICO. No es checkout público, pago bancario,
venta financiera ni aprobación del inventario de origen. Mantener bloqueados
pagos, correo, webhooks, red saliente, API Woo general y compra pública.

Extender el plugin existente con un canal de ensayo autenticado, limitado a
recibos de las dos familias remotas ya existentes y al propietario de esos
recibos. Crear sólo una línea, cantidad 1–3, sin cliente/dirección ni datos de
pago; usar el código literal y precio ya comprobados en esa familia. Bloquear
cualquier pedido ajeno y las escrituras de stock automáticas de Woo para ese
pedido. Una excepción de guardado sólo vive en el callback autenticado, ligada
al UUID del ensayo y al ID del pedido; no retirar la guarda global.

Guardar solicitud y pasos antes de cada escritura. Serializar por ensayo y
conservar recibos. Un resultado incierto se recupera por GET; no reenviar una
creación con UUID distinto. Los únicos pasos de esta prueba serán crear pendiente,
pasar a procesamiento y cancelar. En este escenario sintético, cancelación
implica reposición de las piezas de prueba; no generalizarlo a pedidos reales.

Desde Preview, una cola privada registra despacho y una lectura del pedido
valida nuevamente propietario, IDs, código/precio y journal completo. El SQL
ejecuta el núcleo de reservas/consumo/reposición con stock SINTÉTICO y rollback;
sólo persisten solicitud y evidencia, sin ventas, caja, costos o stock reales.
La firma HMAC existente sigue siendo preparación: este bloque utiliza lectura
autenticada y todavía no es recepción automática de webhooks.

Preparar por separado el envío condicionado de disponibilidad, manteniendo
revisiones, resultado incierto, origen fijo y alcance de las mismas variantes.
La captura de cambios POS y carrera real entre conexiones se verifican antes
de afirmar sincronización continua. No prometer cierre con pruebas secuenciales.

## Verificación y reversión

Pruebas PHP aisladas y unitarias antes de actualizar el plugin de pruebas;
relectura de sus ocho protecciones después. Ensayo SQL con rollback y huellas de
las tablas existentes. Publicar sólo la rama Preview y comprobar con sesión real.
Los pedidos sintéticos se conservan cancelados para auditoría; no borrarlos.
El rollback local deja los conteos SICAR en NULL y el control privado apagado.
Regresión de catálogo/fotos y permisos; ni main ni producción reciben cambios.

Pendientes separados: checkout público de prueba, documentos financieros de la
venta Woo, devoluciones físicas y monetarias reales, webhook automático, corte
real y autorización productiva. No llamar a este ensayo una venta real conectada.
