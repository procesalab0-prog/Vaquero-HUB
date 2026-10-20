# Conciliación de vínculos, saldos y entregas del piloto

Diseño previo al cambio · 20 octubre 2026. Sólo staging/Preview; sin main,
producción ni escrituras SICAR/Woo. El permiso para avanzar no es evidencia
de identidad, consentimiento o entrega.

Renovar en lectura las seis cuentas con deuda y sus siete documentos/abonos.
Conservar ambas capturas; comparar por referencia SICAR y folio, no por nombre.
No reemplazar la fecha del lote almacenado: el corte nuevo es una comprobación
parcial de esos abiertos, no una renovación de las 61 cuentas.

Construir una conciliación reproducible de las tablas privadas ya cargadas:
saldo por cuenta/documento, cancelaciones excluidas, documentos pagados como
archivo, vínculos de artículo contra barcode literal actual y estado separado
de identidad/entrega. Validar importes enteros y rechazar discrepancias.

Un RPC de sólo lectura, ADMIN + customers.manage + staging, sirve la misma
entrada al programa. Sin grants directos de tablas ni nuevas tablas de datos.
La pantalla prioriza abiertos y coincidencias de los doce códigos del piloto;
permite revisar cada cuenta existente. No contiene acciones de activación.
Una coincidencia de teléfono es candidata, no identidad aprobada. Ningún
cliente nativo acreditado coincide actualmente: no crear socios/consentimiento
ni vincular la fixture QA a SICAR para completar un indicador.

La recepción de pago de SICAR dice «Pendientes de facturar»: no es entrega.
Todas las cantidades de entrega/importación siguen NULL hasta evidencia física.
No descontar inventario a partir de una deuda o del estado pagado. Mantener la
billetera histórica fuera del lote de once códigos sin coincidencia observada;
la ausencia de coincidencia en APARTADO no implica ausencia global de compromisos.

Verificar reglas adversas, RPC con rol authenticated y rechazos sin actor/anon,
consulta desde Preview con sesión real, doce códigos y auditoría completa antes
y después. Ensayo SQL READ ONLY + ROLLBACK; sin aperturas ni cobros nuevos.
Repetir generador offline con entradas SHA256 y comprobar salidas idénticas.
Publicar sólo la rama Preview. Evidencia con datos personales fuera de Git.

## Resultados comprobados antes de publicar

RPC instalado sólo en staging, migración `20261020181918`. Consulta sin actor,
actor no registrado y anon rechazada; authenticated con ADMIN/permisos consulta
61 cuentas, 73 documentos y 99 líneas. Dos lecturas en la misma transacción son
idénticas. Todo el ensayo fue READ ONLY + ROLLBACK. Ningún grant de tablas nuevo;
sin nuevas tablas de negocio. Los 129 hashes antes/después permanecen idénticos.
Advisors sin WARN nuevos (73 INFO, 131 WARN definer previos y un WARN Auth previo).

SICAR renovado parcialmente: seis cuentas deudoras, siete documentos abiertos,
ocho antecedentes de abono. Mismos $11,910 pendientes, $4,200 activos y $1,000
cancelados excluidos. Las lecturas transitorias retenidas entre pantallas se
descartaron: recarga completa, ID de documento exacto y tabla de abonos completa
antes de capturar; validación independiente rechazó los borradores inconsistentes.
La renovación parcial no cambia el timestamp del lote completo ni certifica
todo el padrón. 66 documentos pagados siguen como archivo, sin reabrir deuda.

94 de 99 líneas conservan vínculo exacto vigente por Clave 1 literal contra
barcodes actuales. Cinco líneas sin vínculo único y 99 entregas sin confirmar.
Cero coincidencias con el único cliente nativo de staging: ningún vínculo real
puede completarse con la evidencia disponible. No se usa la fixture QA como
destino SICAR ni se inventan socios/consentimientos. La billetera histórica
sigue separada de los once códigos sin coincidencia en este alcance parcial.

Generador offline con cinco entradas SHA256: grafo persistido, plan original,
cuentas renovadas, detalles renovados y selección de doce códigos. Dos corridas
idénticas. Reporte sin datos personales; plan y evidencia privados fuera de Git.
Node 24 ejecuta TypeScript con eliminación de tipos; la advertencia informativa
MODULE_TYPELESS_PACKAGE_JSON no requiere cambiar el tipo del proyecto Next.
950 unitarias/112 archivos, ESLint, TypeScript y Prettier PASS. La pantalla
se publica para la aceptación desde Preview; no se presenta el ensayo SQL de
rol authenticated como sesión real de navegador.

## Reproducción, reversión y siguiente paso

`node scripts/m9/reconcile-customer-pilot.mjs CONFIG_FIJADA.json SALIDA_NUEVA`.
No cliente de red ni SQL de COMMIT. Evidencia privada:
`outputs/m9-conciliacion-piloto-clientes-2026-10-20/`. El manifest compara entradas,
salidas y auditoría. Configuración fija una hora de evaluación real; no modificar
fechas de captura para prolongar vigencia. Nueva entrada exige una corrida nueva.

Reversión de ensayo: ROLLBACK (sin cambios de datos persistentes). Si se retira
la pantalla, volver al commit Preview anterior; después pueden retirarse los dos
RPC de esta migración mediante mantenimiento exclusivo en staging. Conservar el
registro de migración; no borrar historial ni las tablas de origen. No hay deudas,
abonos, reservas o inventario nuevos que compensar en este bloque.

Sigue evidencia de identidad/contacto o adaptador operativo heredado aprobado,
entregas físicas por documento y conteo de doce códigos; corte completo fuera
de APARTADO y renovación final antes de activar cualquier saldo. La interfaz
presenta siete cuentas priorizadas y permite consultar las 61, sin convertir
candidatos o saldos conciliados en autorización. No se envían preguntas ni se
publica nada en main automáticamente. Cobertura de catálogo no cambia.

## Aceptación publicada con sesión real

Código `c1f2defe04954ca5d92a1c9be0bee9870b3cd87c`, deployment
`dpl_D5GRbCBcEpnSkydbPqmTyksjRpPR` READY, exclusivamente Preview.
Sesión real de Emmanuel: entrada desde revisión de clientes, siete enlaces de
cuenta verificados contra su nombre/documentos y bloqueo de identidad/entrega,
vista completa de 61 cuentas y regreso a siete prioritarias, doce códigos y
resumen 94/99, cero diferencias y $11,910. A 390px: scrollWidth=clientWidth=390;
viewport restaurado. No se guardó ninguna revisión ni se reabrió la ventana QA.

Se volvió a consultar la billetera histórica en SICAR: documento pagado de
2025 con código literal y saldo cero; sin campo que acredite entrega física.
El nombre histórico del documento difiere del nombre actual de esa cuenta:
no se resuelve identidad por semejanza ni se enlaza con un cliente nativo.
Las tablas de origen permanecen como copia del corte anterior.

Auditoría final tras navegador: las 129 tablas idénticas al baseline, incluidos
fuentes, auditoría, revisiones, clientes, libro, caja, ventas e inventario. Cero
aperturas/abonos/entregas/vínculos reales nuevos. El panel es una conciliación
de origen y una cola concreta de revisión, no una activación financiera.
Las dos corridas offline coinciden byte a byte en sus hashes de salida.

Limitación de observabilidad: el conector no permitió listar despliegues con
slug y devolvió 404 al solicitar logs; el deployment concreto sí se consultó
READY y el flujo se verificó en navegador. No afirmar que se inspeccionaron
logs remotos sin errores. Main/producción no se modificaron. No se probó un
empleado activo no ADMIN por falta de fixture; los tres negativos corresponden
a actor ausente, actor no registrado y anon en SQL, no a ese rol real.
