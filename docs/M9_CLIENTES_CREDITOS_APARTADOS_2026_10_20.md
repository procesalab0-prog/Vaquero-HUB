# M9 — preparación de clientes, créditos y apartados (20 octubre 2026)

## Alcance autorizado y diseño antes del ensayo

Preparación reproducible y ensayo transaccional exclusivamente en el proyecto
staging `zsezjtswqeijboezvado`. Sin producción, main, escrituras SICAR/Woo,
alta de cuentas Auth, correos, saldos de inventario ni reservas nuevas.

El alcance observado es la búsqueda de clientes **APARTADO**, 61 registros,
con los filtros pagado y no pagado y recepción Todos. No representa todavía
todo el padrón de clientes ni todos los créditos SICAR. Se conservará el límite
del alcance en cada reporte; no se declarará migración total.

Identidad primaria: empresa y referencia de cliente SICAR, conservadas por
separado. Teléfono y nombre sólo detectan posibles duplicados; nunca fusionan.
Se preservan literalmente nombres, folios y Clave 1 en el plan privado.
Sin contacto o consentimiento observado, los campos quedan NULL y el alta
operativa queda bloqueada. No se fabrican teléfonos, consentimiento, afiliación
o acceso al portal para satisfacer restricciones del esquema.

Importes en centavos enteros, con formato MXN estricto. Por documento:
total = abonado histórico conciliado + saldo pendiente. Un abono cancelado
se conserva como evidencia y se excluye del importe abonado activo. El saldo
utilizado por cliente debe igualar la suma de sus documentos abiertos. Los
documentos pagados se archivan con saldo cero y nunca reabren deuda.

La deuda inicial candidata equivale sólo al saldo pendiente por documento;
los abonos históricos no se vuelven a cobrar ni se registran como ingresos
actuales de caja. No se genera una venta para copiar deuda. Entrega desconocida
queda desconocida, incluso si el documento ya está pagado. Las líneas sin
variante exacta quedan en revisión. No se descuenta ni reserva inventario.

## Brechas del sistema y prueba propuesta

El alta normal exige teléfono mexicano único y consentimiento de privacidad
registrado; no sirve como importador de clientes heredados sin esos datos.
El libro de crédito admite cargos con referencia distinta de SALE y el
cobrador distribuye abonos entre CHARGE por vencimiento. Falta un adaptador
permanente autorizado para saldos de apertura, identidad heredada y entregas
de origen. Los apartados nativos reservan mercancía y no son una equivalencia
automática de ventas SICAR a crédito.

Se ensayará el lote privado con tablas temporales: claves estables, integridad
referencial, dinero, cancelaciones, reintentos y conflictos. Un segundo ensayo
técnico usará exclusivamente el cliente existente de staging como fixture,
sin vincularlo a ninguna identidad SICAR, para comprobar cargos de apertura
sintéticos y el RPC nativo de abonos. El escritor temporal debe comprobar
staging, administrador, saldo cero y metadatos QA; no crea una API pública ni
una vía de importación permanente. Los ensayos finalizan siempre con ROLLBACK.

Comparar antes/después los hashes completos de las 120 tablas de negocio
auditadas. No cambiar guardas M9, PIN, saldos de catálogo, consentimiento,
datos del cliente existente ni permisos. Pruebas negativas: saldo inválido,
documento huérfano, pago cancelado incluido, repetición conflictiva y sobrepago.

## Evidencia y resultados verificados

Lectura completa de las 61 identidades del alcance: 50 contactos telefónicos
normalizables, 11 sin contacto utilizable, ninguna dirección de correo observada
y dos registros con el mismo nombre, conservados separados. No se observó
consentimiento de privacidad o marketing; no se crearon cuentas Auth ni clientes.
El punto y coma terminal del botón Celular es un artefacto del icono de SICAR:
se conserva el texto original y sólo se retira ese sufijo al proponer el número.

73 documentos: 66 pagados, siete abiertos en seis cuentas. Saldo pendiente
conciliado **$11,910.00**, incluyendo vencimientos observados. Ocho documentos
de abono vinculados leídos para los créditos abiertos: siete activos suman
**$4,200.00** y uno cancelado de **$1,000.00** queda excluido. En cada documento,
el total menos los abonos activos coincide con su saldo. No se dedujeron
eventos de pago a partir de una resta ni se supusieron sus medios de pago.
Los abonos detallados de los documentos pagados aún no están capturados.

99 líneas de mercancía, 95 códigos literales: 94 líneas con variante única
en staging y cinco en revisión por tres códigos sin destino exacto. No se
inventó una variante para `SX00000`. Las 99 entregas siguen UNKNOWN, sin
atribuirles reservas, saldo físico o descuento adicional de inventario.

Plan reproducible con seis archivos fijados por SHA256; dos corridas finales
idénticas. El primer borrador detectó como inválidos los 50 teléfonos por el
sufijo visual del icono; se corrigió la extracción, conservando evidencia original.
El borrador se mantiene privado y no se usó como carga ni como conclusión final.

Ensayo de preparación real en staging: 61 clientes y 73 documentos en tablas
TEMP, ocho abonos, 142 reintentos idénticos, tres negativos rechazados (conflicto,
saldo negativo y documento huérfano). Comparación de saldos por cuenta y de
abonos activos por documento PASS. ROLLBACK completo.

Ensayo nativo separado: cliente preexistente usado sólo como fixture técnico,
sin vincularlo con SICAR ni cambiar sus datos. Dos cargos sintéticos por $3.00,
dos abonos nativos de $1.50, aplicación FIFO, reintentos sin duplicados y cinco
negativos rechazados: apertura distinta, escritura directa, conflicto de abono,
sobrepago e intento de alterar el libro inmutable. Saldo final de fixture cero;
sin ventas, puntos, reservas o movimientos de inventario. Función escritora
temporal revocada a roles de aplicación; ningún adaptador permanente instalado.
Todos los cargos, recibos y $3.00 sintéticos de caja se retiraron por ROLLBACK.

**120 tablas completas idénticas antes/después**, incluyendo clientes, caja,
libros, guardas M9 y catálogo; siguen las dos ventas, una devolución y ocho
movimientos de inventario previos. Estas pruebas son SQL con contexto de actor
de staging: **no equivalen a aceptación con Auth/PostgREST ni a operación UI**.
917 unitarias / 108 archivos, ESLint y TypeScript PASS.

## Reproducción y continuación

`scripts/m9/prepare-customer-credit.mjs CONFIG_FIJADA.json DIRECTORIO_NUEVO`
genera plan privado, SQL TEMP sin COMMIT, reporte sin datos personales y hashes.
No conecta a ninguna base. `customer-credit-native-rehearsal.mjs` construye el
ensayo nativo técnico desde un snapshot completo y reciente de staging; nunca
importa identidad o deuda SICAR real. Ambos requieren ejecución explícita del
SQL exclusivamente en staging y comparación posterior de auditoría.

Los archivos con nombres, contactos y documentos se guardan fuera de Git,
con permisos locales restringidos, en
`outputs/m9-clientes-creditos-preparacion-2026-10-20/` del workspace raíz.
Corridas finales `corrida-2` y `corrida-3`; manifiesto y reporte verificado al
lado del snapshot, resultados y auditorías privadas.

Siguiente: obtener corte completo de clientes/créditos (fuera de APARTADO),
documentos con abonos activos/cancelados y evidencia de entregas pendientes.
Preparar el adaptador de identidad heredada con contactos/consentimiento
desconocidos sin habilitar portal, marketing ni crédito nuevo automáticamente;
después apertura de deuda por documento con claves SICAR, auditoría y reversión
compensatoria. Las entregas heredadas necesitan su propio efecto explícito:
no llamar a create_layaway para reconstruir una venta ya descontada por SICAR.
Antes de operar: corte renovado, responsables, aceptación Auth real y ensayo
de entrega/abono con rollback. Producción y main permanecen sin cambios.
