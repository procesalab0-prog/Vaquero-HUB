# M9 · Detalle del padrón con crédito · 22 octubre 2026

Plan: consultar en SICAR, sólo por UI y sin alterar datos, los83 documentos de60
cuentas con saldo del padrón visible del21. Capturar detalle, ID de origen,
productos, formas de pago y documentos vinculados. Conservar el corte original;
las observaciones posteriores son otro expediente, no un refresco ficticio del
padrón completo de171 cuentas. Si falta un folio, consultar el filtro Pagado y
exigir evidencia; si surge otro, conservarlo como adicional sin autorizar apertura.

El nuevo conciliador offline verifica SHA de entradas, fecha, cuenta/folio/ID,
total=abonado+saldo, abonos vinculados frente al desglose de pagos, originales y
reversiones canceladas. Clave1 literal como texto, sin coerción numérica. Descuentos
y recargos históricos se conservan como etiquetas/importes fuente; no son costos.
Un nombre histórico diferente se conserva y queda en revisión, sin fusionar cuentas.
Un código genérico de deuda no se interpreta como producto físico. La ausencia de
vínculos no prueba historial completo: sólo se acepta abono activo cero cuando el
desglose lo muestra explícitamente. No se inventa vencimiento del documento pagado.

Ensayo: sólo tablas TEMP en staging zsezjtswqeijboezvado, comprobación explícita
del entorno, identidades seudónimas, replay y rechazos de conflicto, saldo negativo,
huérfanos, pago cero y reserva inventada. Termina siempre en ROLLBACK. No cambia
importador operativo de61, registros de clientes, caja, apertura, ventas, inventario,
Auth, consentimiento, pedidos o Woo. Auditoría antes/después de todas las tablas
app/public previas y archivo del padrón. Dos corridas con entradas fijadas deben
producir los mismos archivos. La reversión del ensayo es ROLLBACK; para el código
local basta retirar el nuevo preparador. Ninguna migración DDL requerida.

Entregas, reservas y descuentos de stock permanecen UNKNOWN/NULL. Mapear un código
sólo acredita identidad de variante; no certifica existencia, disponibilidad,
entrega ni autorización de cobro. La lectura secuencial no es un corte simultáneo
de cierre. Antes del arranque hace falta renovar toda la fuente, revisar cambios,
comprobar compromisos físicos y aceptar las aperturas por etapas.


## Cierre · detalle general de créditos · 22 octubre2026

Lectura real de60 cuentas enSICAR tras renovar sesión:83 de83 documentos
previstos, más1 nuevoVSM7407;84 en total. El faltanteVSM3477 se localizó en
Pagado, con liquidación posterior al corte del21. No se infirió cero por ausencia.
Las60 cuentas concilian:83 abiertos/1 pagado ysaldoobservado$240,558.
95abonos vinculados:92activos por$70,589 y3cancelados por$1,850 excluidos.
En36 documentos el desglose muestra ceroactivo; la falta del botón de vínculos
no prueba completitud histórica. Ocho diferencias de nombre histórico quedan
marcadas; no se fusionanUUIDs. Ninguna apertura ni abono nuevo se creó.

183líneas:166con variante única literal;15genéricasSX00000 y2sin variante
(18275 y7501140700032) quedan sin asignar. Se conservan descuentos/recargos
fuente; no se inventan costos. Las183entregas siguenUNKNOWN y las reservas/
deduccionesNULL. La lectura cubre las60cuentas con saldo delcortevisible
anterior, no renueva171cuentas ni acredita un cierre simultáneo.

Preparador scripts/m9/reconcile-general-credit-details.mjs y29pruebas nuevas;
suite final1,183/125archivos ylintPASS. Configcon4entradasfijadasSHA,
corridas4/5idénticas. Ensayo TEMP real staging:84replays y5rechazos;ROLLBACK.
157tablas previas idénticas yarchivo histórico delpadrón con1fila/hashigual:158
BASE TABLESapp/public sin cambios. SQLensayadocorrida3=SQLfinalcorrida5.
SinDDL, nueva versión, publicación, main, producción, caja o inventario.
Worker/capturastock/piloto desactivados,cron0, cincoensayosWooanteriores sin
ampliar. Preview sigue0.85.2. Catálogo96.92%, sin alterarporcentajeglobal.

Expediente privado outputs/m9-detalles-creditos-general-2026-10-22/: fuente
porcuenta/documento,config,mapeoliteral,planes,SQL,auditorías,reporte,manifest
yverificar.mjs. Pendiente integrar el nuevo archivo de detalles a la revisión
Preview con controles propios; no cambiar el archivo inmutable anterior ni
extender silenciosamente el importador APARTADOde61. Después apertura por
etapas/compensación, entregas/conteopiloto y uniónfinancieraWoo con cortefresco.
