# Puente documental entre censos y detalle de créditos

Sólo staging y Preview, desde `2366955`. No registra pagos, abre o cierra deuda, modifica fuentes, confirma entregas ni mueve inventario.

## Diferencias históricas y evidencia posterior

El censo de 171 cuentas y el nuevo de 172 muestran dos cuentas con diferencias financieras. El archivo detallado existente del 22 de octubre ya contiene los tres documentos que explican esas diferencias de forma histórica: un documento abierto adicional y un documento con desglose pagado y saldo cero. Sus fechas originales se conservan. La lectura nueva se compara por separado; no se atribuye una renovación al archivo anterior por volver a procesarlo.

`scripts/m9/clientes-census-detail-bridge.mjs` reutiliza `creditDetailArchive` y `censusRenewalDelta`. Verifica la preimagen del archivo a partir del plan y sus capturas originales, los pins de bytes y el contexto PostgreSQL leído del archivo. La huella de bytes JSON y la huella PostgreSQL son conceptos distintos; no se comparan entre codificaciones.

Compara UUID y clave de cuenta, folios compuestos por cuenta, identidad del documento, total, saldo y desglose de abonos activos/cancelados. La ausencia en el censo de documentos no pagados se representa con `null` para ese documento, no con un supuesto pago. Para explicar un documento desaparecido exige un desglose explícito pagado, no sólo saldo global cero. Los cambios de abonos, cancelaciones, IDs o contenido de líneas en una lectura posterior permanecen retenidos.

El preparador emite cuatro archivos privados reproducibles: puente, resumen, cola exacta de capturas y sus hashes. Usa carpetas nuevas 700 y archivos 600. Config: `project_id`, `mode=READ_ONLY_EVIDENCE_BRIDGE`, `assessment_at` UTC canónica e inputs fijados `previous/current/detail_plan/detail_accounts/archive/archive_context`. La pareja opcional `renewed_plan/renewed_accounts` usa el conciliador existente para la lectura posterior. No produce un escritor de apertura ni una carga automática.

```sh
node scripts/m9/clientes-census-detail-bridge.mjs CONFIG_PRIVADO SALIDA_NUEVA
```

El resumen distingue coincidencia histórica de alineación con una lectura posterior. Incluso si ambas coinciden, `operational_import_allowed`, cierre de deuda y replay de pagos siguen desactivados. La cuenta nueva sin detalle archivado se lista aparte; no queda oculta al concentrarse en las dos diferencias.

## Reutilización del ensayo existente

La cola resultante se puede pasar a `reconcile-general-credit-details.mjs` con dos cuentas recargadas, los tres detalles, desgloses/vinculados y un mapeo literal reciente de staging. Las capturas de No pagado y Pagado son evidencias distintas. Una tabla todavía vacía o que sólo muestra encabezados no acredita ausencia. No se completa `table_folios` a mano sin observar sus filas o un mensaje terminal inequívoco.

Cuando el texto visible incluye letras de avatar entre cantidad y código, no se eliminan por longitud o por coincidencia con el nombre. `corroborateRenderedItemRoles` exige el mismo ID de documento en texto original, AX y texto de corroboración; exige igualdad completa de los tokens de los artículos entre ambas lecturas y sus roles AX, y corrobora los párrafos de los artículos en los nodos DOM. Sólo excluye marcadores literales de una allowlist técnica explícitamente revisada, observados como `generic` inmediatamente después de cantidad y antes de los cuatro párrafos de código, descripción, precio e importe. Un código, descripción, cantidad o artículo completo con rol genérico se rechaza; el rol por sí solo no acredita decoración. Conserva códigos literales aunque también sean letras. Verifica el resultado con `creditDetailLines` existente. El texto raw se conserva aparte y la extracción registra huellas, posiciones y fecha propia de corroboración; mantiene la fecha y recarga originales. La corroboración de roles no renueva por sí misma el desglose financiero ni finge otra recarga.

El conciliador existente genera el ensayo SQL con tablas temporales y `ROLLBACK`. Root ejecuta el ensayo con auditoría del esquema completo. No se debe conservar un archivo parcial de dos cuentas como el nuevo archivo global: el lector existente elige el último archivo por fecha y ocultaría las demás cuentas. No se modifica ese contrato ni se redatan las otras capturas.

## Indicación prudente en Preview

La página `/migracion` consulta el RPC existente de detalle sólo para las filas visibles con `PREVIOUS_BALANCE_CHANGED` o `PREVIOUS_DOCUMENTS_CHANGED`, hasta 20 consultas independientes. Se conservan los guards de staging, `customers.manage` y los controles de ADMIN del lector existente. No hay tabla, DDL ni grants nuevos.

El helper puro `lib/migration-credit-evidence.ts` exige respuesta histórica no operativa, una cuenta única con paginación completa, UUID/clave/nombre exactos, conjunto completo de folios abiertos con importes idénticos, aritmética y abonos activos conciliados, evidencia con SHA y cantidades físicas desconocidas. Para saldo cero no basta una lista vacía: requiere un documento con desglose explícitamente pagado. Valida las fechas del contrato PostgreSQL sin normalizar fechas imposibles.

La indicación dice «Saldo y folios coinciden con el detalle histórico», con la fecha propia de la evidencia y enlace al detalle. Aclara «No acredita vigencia, pagos nuevos ni entregas». No dice aprobado o resuelto, no retira holds, no reduce la cola ni cambia filtros. Una consulta fallida, rechazada o incompleta simplemente no muestra la indicación; el aviso anterior se conserva.

Las pruebas cubren el puente, abonos cancelados, identidades separadas aunque compartan nombre/folio, lectura parcial, cero sin prueba, diferencias posteriores, preservación de códigos literales y UNKNOWN, reproducción por pins y rechazo de sobrescritura. La página prueba permisos antes de consultas, límite de lecturas y conservación de avisos ante fallos. La aceptación autenticada y cualquier SQL remoto quedan a cargo de root.
