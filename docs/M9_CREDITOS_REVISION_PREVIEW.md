# M9 · Archivo documental y revisión en Preview

Plan previo: conservar el expediente conciliado del22 como archivo privado,
inmutable y separado del padrón del21. No extender importador APARTADO ni abrir
saldos. Fuente fijada por SHA del plan y de las cuentas originales. Mantener
cuenta/folio/ID, fechas originales, abonos cancelados, líneas con Clave1 literal
y entrega desconocida. No transportar teléfonos, consentimientos, Auth ni caja.

Archivo nuevo sólo staging. Ingesta de mantenimiento postgres con actor ADMIN
activo/customers.manage; sin permisos de tabla para clientes ni service_role.
Lectura por RPC invoker→función privada con comprobación explícita del actor y
entorno. Sin métodos para aprobar, cobrar, reservar ni importar. Validador vuelve
a calcular identidades, totales por cuenta/documento, abonos activos y mappings
exactos, rechaza campos extra/entregas/reservas/duplicados. Repetir igual conserva
fecha y datos; cambiar el payload con la misma fuente se rechaza. Trigger impide
UPDATE/DELETE. Archivo histórico conserva validez documental aunque pase24h;
la UI muestra antigüedad sin habilitar operaciones.

Ensayar ingesta/replay/rechazos, permisos de anon/authenticated/noADMIN, lectura
paginada y rollback antes de conservar1fila. Auditar158 tablas app/public previas
antes/después: sólo la nueva tabla cambia. Probar UI con sesión real en Preview,
flujo búsqueda/filtros/abonos cancelados y teléfono. Tipos, lint, unitarias y build.
Publicar exclusivamente codex/m9-staging-review. Reversión: ROLLBACK de ensayos o
retirar la nueva interfaz de Preview; conservar evidencia inmutable. No producción.

## Archivo conservado en staging

Fuente a8897dc2883ddfd0bbdcae2deb08b16ab9b4f07bf9741565c2c2f682d90ae205.
60 cuentas/84 documentos/183 líneas/95 abonos;1fila privada inmutable.25rechazos,
4controles ACL, replay y paginación de60 cuentas conROLLBACK antes de conservar.
Saldo observado$240,558,92abonos activos$70,589 y3cancelados$1,850excluidos.
166líneas identificadas,17sin vínculo;10documentos con diferencias,8de nombre.
Este archivo no sustituye el padrón ni las aperturas previas.
Migración local20261022194248→remota20261022194538. Sin cambios a SQL ya aplicado.
1,191unitarias/126archivos, tipos/lint puntual/buildPASS. Publicación0.86.0 y
aceptación de navegador pendientes al preparar esta nota.
