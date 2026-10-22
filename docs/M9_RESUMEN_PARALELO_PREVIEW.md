# M9 · Integración del avance paralelo · plan previo

Usuario autorizó tres agentes paralelos. Cada uno trabaja en worktree/rama propia:
clientes/saldos, catálogo/fotos y contrato de pagos Woo. Sólo lectura remota y
pruebas locales; el coordinador concentra cualquier DDL/DML de staging y Preview.
No main, producción, nuevas órdenes Woo ni cambio del límite de cinco ensayos.

Añadir al centro /migracion un resumen de tres frentes con cifras leídas de staging,
fechas originales de los archivos, conteos piloto pendientes y controles de ensayo.
RPC sólo lectura, ADMIN activo/customers.manage, privada SECURITY DEFINER con
search_path vacío y envoltura pública SECURITY INVOKER. Sin permisos de tabla ni
nombres/contactos/folios/saldos individuales en ese resumen. Sin servicio de
aprobación, importación, apertura, pagos, actualización de foto o inventario.

Diferenciar revisiones/fotos guardadas de aptitud para vender, archivo histórico
de saldo operativo, ensayo sintético de pago verificado por proveedor. No tratar
NULL como cero ni contar lecturas como importaciones. Entregas UNKNOWN y cortes
viejos permanecen bloqueados. No dar un porcentaje global automático.

Integrar módulos puros de agentes tras revisar diferencias/pruebas, sin duplicar
importadores existentes. Los planes son inertes: nunca ejecutar un lote sólo por
ser técnicamente elegible. Auditar las165tablas antes/después, probar permisos y
lectura desde Preview con sesión real, móvil, tipos/lint/unitarias/build. Conservar
expediente privado reproducible. Reversión: retirar interfaz/RPC de consulta si
falla; ningún dato de migración previo debe cambiar ni borrarse.

## Validación integrada

Tres agentes integrados;232pruebas nuevas,1,423/132PASS,lint/tipos/buildPASS.
165tablas idénticas;ACL comprobada;sin nuevos avisos de seguridad.
Ver cierres del handoff y plan maestro para alcance,límites y próximos adaptadores.
