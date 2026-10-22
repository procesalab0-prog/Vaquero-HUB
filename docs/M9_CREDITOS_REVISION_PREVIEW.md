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


## Cierre · revisión documental publicada en Preview0.86.0

Publicación894ee30cb2fe3d1fa86774a44c5e3facc1a35a2b, árbol
c7c6a245c12d243965b8c727886452ce6c810fb7, únicamente codex/m9-staging-review.
Vercelstatussuccess y avatar0.86.0 con sesiónADMINreal. Ruta/migracion/creditos
accesible desde el centro/migracion. Datos conservados:60cuentas/84documentos/
95abonos/183líneas;166identificadasy17sinvínculo;10documentos con diferencias.
Sin actualización del padrón histórico ni de las aperturas operativas.

Validación servidor:25rechazos+4ACL, replay, inmutabilidadUPDATE/DELETE y60cuentas
paginadas;ROLLBACKantesdeCOMMITde1archivo privado.1,191unitarias/126archivos,
tipos/lintcompleto/buildPASS. RevisiónReact:ServerComponents,guardas servidor,
paginación,clavesestables,labels,detailsnativos,sin efectos/cargascliente adicionales.
SinDDLreescrito:local20261022194248→remota20261022194538.

Aceptación UI: búsquedafolioVSM3477→pagado/0conabonos históricos, sin afirmar
entrega. VSM6907→Abono1325cancelado excluido y1326activo. Código18275→sin
variante/visible como pendiente. VSM7407→adicional y0activo explícito, sin
inventar historialcompleto. Limpiar→qvacío, página2de6 y filtropagados→1cuenta.
Teléfono390×844sin desborde:últimopanel722.03<menú760;tableta1024×768sin
desborde. Viewportrestaurado. No certificaSafari/hardware/impresiónfísica.

Auditoría:158tablasapp/public anteriores idénticas; sólonuevatablaarchivo1fila.
Tras lecturaUI,159tablas(conelnuevoarchivo)idénticas. Registroheredado61,
clientenativo1fixtureprevio, libro$11,910/7entradasprevias y36cantidadesNULL.
Worker/capturastock/pilotofalse,cron0 siguenpor auditoría sin cambios.
No ventas/pagos nuevos,stock,Auth,consentimientos,producción,main niWoo.
RLSprivadosinpoliciesINFOesperado; categoríasWARNdefiner/protecciónpassword
previas no se declaran resueltas. La RPCprivada exigeADMINactivo+customers.manage
yentornostaging;anon ylecturadirecta de tabla denegados.

Expediente privado outputs/m9-creditos-centro-preview-2026-10-22/:payloads,SQL,
ensayos,recibo,auditorías,medidas,capturas,manifest yverificar.mjs. Elpadróndel21
conserva1fila/hash; nuevoarchivo del22conserva1fila/hashdespuésUI.
Sigue verificar17líneas/8nombres históricos,acreditarentregas/compromisosfísicos
yconteopiloto,preparar apertura por etapas+compensación y cierre financieroWoo.
Renovar el corte completo antes de operar. Catálogo96.92%sin cambio; lectura
documental84/84delalcanceobservado no es100%demigración. No se añadieron preguntas.
