# M9 · Piloto de pedidos Woo e inventario central · 21 octubre 2026

## Plan previo y alcance autorizado

Continuar sólo en staging. La tienda Woo remota independiente mantiene pagos,
pedidos, correo, webhooks y red saliente bloqueados. No retirar esas barreras
para probar el motor de inventario. No modificar Woo real, main o producción.

Construir primero un núcleo privado de comandos transaccionales. Cada comando
requiere tienda de pruebas fijada, pedido, operación externa estable, versión
esperada, evidencia, actor ADMIN y ubicación autorizada. Los vínculos deben
incluir producto/variación de ESA tienda, variant_id y Clave 1 literal; nunca
se busca por nombre o se reutilizan IDs de la tienda real.

Separar cuatro operaciones: reservar disponibilidad, consumir una reserva,
liberar lo no consumido y reponer mercancía ya consumida. Reponer no equivale
a devolver dinero ni certificar recepción física. No interpretar un cambio de
estado Woo o un reembolso monetario como evidencia suficiente de reposición.

Pedido, líneas, recibo idempotente, movimientos nativos y actualización pendiente
de disponibilidad deben confirmarse juntos. Conflictos de versión, identidad,
saldo o revisión M9 revierten el comando completo. Un evento atrasado no puede
reabrir una reserva cancelada. Bloquear filas de inventario en orden de UUID y
usar el mismo libro que POS; no crear otro contador de stock.

El verificador de avisos comprobará HMAC-SHA256 del cuerpo original, con límite
de tamaño, sin secretos ni datos personales en evidencia. Una firma válida sólo
despierta una futura lectura autenticada del pedido: no autoriza descontar desde
el payload ni prueba actualidad. Woo no firma un contador monotónico; la versión
del núcleo es interna y no debe inventarse a partir de fecha/status/delivery ID.

## Ensayo, auditoría y reversión previstos

Ensayar en SQL de staging con cantidades explícitamente SINTÉTICAS dentro de
ROLLBACK. No confundirlas con existencias SICAR, ni guardar conteos del piloto.
Probar repetición, operación reutilizada con otro contenido, conflicto de versión,
pedido fuera de orden, reservas y consumo parciales, cancelación, reposición
parcial, ausencia de reposición por dinero devuelto, sobreventa y atomicidad de
varias líneas. Conservar costos, códigos y variant_id.

Capturar huellas de todas las tablas public/app antes y después. Las tablas
nuevas permanecen vacías y el control deshabilitado fuera del ensayo. Sin endpoint
público, permisos de navegador/service_role, activador ni despachador de stock.
La reversión de datos del ensayo es ROLLBACK; no borrar movimientos para simular
éxito. No aplicar esta migración a producción.

## Aceptaciones posteriores, separadas

1. Adaptador de lectura autenticada y conciliación del pedido Woo completo,
   devoluciones físicas, estados y operaciones externas estables.
2. Transporte duradero de avisos firmados, reintentos y reconciliación periódica;
   recepción del aviso y procesamiento deben tener estados auditables separados.
3. Ensayo restringido de pedidos en Woo de pruebas conservando pagos/correo y
   destinos reales bloqueados; aceptación desde Preview y carrera POS/Woo real.
4. Despacho condicionado de disponibilidad a Woo, recuperación de timeout y
   prevención de cambios remotos tardíos. El outbox no demuestra esa escritura.
5. Corte de stock físico/apartados/entregas, renovaciones, respaldo/restauración
   y autorización de arranque. Los doce conteos NULL no se transforman en cero.

Referencias técnicas consultadas: [firma Woo](https://developer.woocommerce.com/docs/apis/rest-api/v2/webhooks/),
[funciones de stock](https://woocommerce.github.io/code-reference/files/woocommerce-includes-wc-stock-functions.html),
[reposiciones de reembolsos](https://woocommerce.github.io/code-reference/files/woocommerce-includes-wc-order-functions.html),
[privilegios de funciones PostgreSQL en Supabase](https://supabase.com/docs/guides/database/functions).

## Implementación y resultados comprobados

Migración local generada con CLI:
`supabase/migrations/20261021165401_m9_woo_inventory_pilot_kernel.sql`.
Aplicada sólo a `zsezjtswqeijboezvado`, registro remoto `20261021165856`.
No se reescribe ninguna migración aplicada. Seis tablas privadas, RLS sin
políticas permisivas y todos los privilegios revocados para PUBLIC, anon,
authenticated y service_role. Función SECURITY INVOKER con search_path vacío,
sólo mantenimiento postgres y contexto ADMIN vigente de La Piedad. Control
deshabilitado, sin vínculos ni pedidos habilitados fuera de la transacción.

`scripts/m9/woo-order-protocol.mjs` verifica HMAC sobre bytes originales y devuelve
sólo ID/hash/tienda y la obligación de releer autenticadamente; no conserva datos
del comprador. El validador exige estructura explícita, números enteros seguros,
Clave 1 textual y orden determinista. No hay ruta HTTP ni secreto nuevo creado.

`scripts/m9/test-woo-order-pilot.sql`: dos ejecuciones finales con el mismo
resultado lógico. 21 comandos, cinco reintentos idénticos sin duplicar recibos,
31 rechazos esperados, seis controles ACL y doce invariantes. Hubo 14 movimientos
nativos de mercancía (incluyen dos semillas SINTÉTICAS) y 20 de reserva durante
cada transacción; todos revertidos. No hubo pedido Woo, cobro, venta financiera,
folio, correo, costo inventado ni existencias SICAR importadas.

Se comprobaron consumo/liberación/reposición parciales, reserva competidora,
rechazo de una salida por el mismo motor de inventario usado por POS cuando
consume piezas reservadas, evento atrasado, operación reutilizada con otro
contenido, identidad equivocada, código numérico, cantidades fraccionarias,
pedido duplicado y límites acumulativos. Si falla una línea, se revierten las
anteriores. Si falla el outbox DESPUÉS del movimiento y recibo, se revierten ambos;
el mismo comando puede reintentarse y su posterior replay no duplica. Retirar
la revisión M9 bloquea nuevas reservas/consumos, pero permite liberar o reponer.

Una prueba intentó colocar en el pasado la caducidad de revisión; la guarda
existente la rechazó (`M9_REVIEW_EXPIRY_INVALID`). El ensayo se corrigió para
revocar el hash revisado sin eludir esa guarda. Se conserva el intento fallido.

El intento de contención con dos llamadas MCP no observó solapamiento y devolvió
`CONTENTION_NOT_OBSERVED`. NO se cuenta como prueba concurrente aprobada. No se
relaja su aserción ni se sustituye por una prueba secuencial llamada concurrente.
La carrera real de última pieza POS/Woo sigue pendiente de conexiones simultáneas
y del adaptador remoto. No se afirma aceptación Auth/PostgREST o de navegador.

Se intentó ejecutar realmente la función como anon, authenticated y service_role:
tres denegaciones 42501, adicionales a las consultas de ACL. Historial de recibos
inmutable ante UPDATE/DELETE. Las 140 tablas anteriores mantienen conteos y huellas
idénticos tras DDL y ensayos; auditoría extendida de 146 tablas idéntica antes y
después de los últimos ensayos. Las cinco tablas operativas nuevas están vacías,
la fila de control está deshabilitada y los doce conteos del piloto siguen NULL.
Las secuencias técnicas pueden avanzar al revertir; no se reinician.

1,022 unitarias en 118 archivos, incluidas 40 nuevas, TypeScript, ESLint dirigido,
Prettier dirigido y `git diff --check` correctos. Advisors: las seis tablas
privadas aparecen como INFO por RLS sin políticas, deliberadamente cerrado por
[privilegios/RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Ninguna función nueva figura en las advertencias de SECURITY DEFINER públicas;
continúan advertencias generales de 131 RPC existentes y protección de contraseñas
filtradas deshabilitada, fuera del cambio. No se declara auditoría global cerrada.

El outbox sólo captura disponibilidad en comandos de este núcleo. No recibe aún
todos los cambios POS ni despacha stock a Woo, y no representa una sincronización
externa terminada. El recibo demuestra un efecto de inventario técnico; no sustituye
una venta financiera, un reembolso bancario o una entrega real. Aún falta decidir y
aceptar el adaptador de esos documentos para evitar movimientos duplicados.
Ediciones de líneas después de reservar, cambio de talla, aumento de cantidades
o varias líneas para la misma variante se retienen: no se reagrupan ni reabren
reservas por deducción. El adaptador deberá resolver esos casos explícitamente.

Evidencia privada: `outputs/m9-pedidos-inventario-woo-2026-10-21/` en el workspace
exterior, fuera de Git. Contiene auditorías completas, resultados crudos, intentos,
SQL exacto, manifiesto y reporte. No nueva versión web, despliegue, main o producción:
es infraestructura privada de mantenimiento y ensayo, todavía sin interfaz.
