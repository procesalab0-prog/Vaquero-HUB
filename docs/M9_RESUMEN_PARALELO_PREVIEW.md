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


### Cierre aceptado · Preview0.88.0 · Tres frentes paralelos

DespliegueSUCCESS `fccde53bd5815beb8db095ecb80bada99f804162`, árbol idéntico
local/remoto `09e81637b071b0dae78afede5ba26df1148ba30a`, rama codex/m9-staging-review.
Vercel: https://vercel.com/procesa-lab/vaquero-hub/Cp4AYwmEHXawFMxWMf1fChhkB3US .
SesiónADMIN real: /migracion→botón «Ver avance, bloqueos y siguientes lotes»→
/migracion/avance; versión0.88.0 visible en avatar. Cifras agregadas coinciden.
Escritorio1440x1000 y teléfono390x844 aceptados. ScrollWidth390=viewport390;
botón final termina704.83px, por encima de navegación inferior752px. Restituido
viewport original y dejado resumen abierto. No se ejecutan botones de ensayo.

Auditoría165tablas repetida después de la navegación: hashes/conteos idénticos
al inicio. Evidencia privada y reporte conjunto con manifiesto/verificador en
outputs/m9-avance-paralelo-2026-10-22/. Verificadores de clientes55archivos,
Woo y fotos3/4 idénticos PASS. Las variantes/copias comprobadas son metadatos,
no nuevos bytes; el contrato financiero documental nunca autoriza una venta.
No se importó saldo, existencia o costo ni se crearon pedidos. No main/producción.
