# Padrón general de clientes SICAR · 21 octubre 2026

Continuación de [M9_COBRO_OPERATIVO_RENOVACION_STAGING.md](M9_COBRO_OPERATIVO_RENOVACION_STAGING.md).
Autorizado avanzar en staging, sin producción, main, SICAR/Woo, abonos o existencias
inventados. Este bloque amplía la evidencia y la conciliación de sólo lectura.
No importa clientes ni abre los saldos adicionales.

## Resultado del padrón visible

Se quitó la dependencia del filtro APARTADO y se recorrió el listado hasta su final:
171 tarjetas, buscador vacío, contador de filtros cero y sin progressbar. Se abrió
cada ficha para conservar el UUID real de SICAR, nombre y consulta de crédito.
Las búsquedas sólo ayudaron a localizar las fichas; no se usaron como identidad.
Nombres repetidos se recorrieron por separado y se comprobaron sus IDs diferentes.

| Comprobación | Resultado |
| --- | ---: |
| Fichas capturadas / listado visible | 171 / 171 |
| UUIDs distintos | 171 |
| Referencias anteriores encontradas | 61 / 61 |
| Cuentas adicionales identificadas | 110 |
| Cuentas con saldo utilizado positivo | 60 |
| Documentos no pagados observados | 83 |
| Saldo utilizado sumado | $250,128 |
| Saldos de documentos sumados | $250,128 |
| Deuda observada de cuentas adicionales | $238,218 |
| Cambios en importes/documentos de las 61 cuentas anteriores | 0 |
| Cuentas con alerta por nombre igual, sin fusionar | 2 |
| Importes utilizados ausentes al finalizar | 0 |

La diferencia de alcance es material: $11,910 era únicamente la apertura del
paquete APARTADO. Los $250,128 son la deuda observada en el padrón visible más amplio,
concordante entre filas de documentos y saldo utilizado. No es todavía una apertura
conciliada en detalle ni dinero cobrado. Las 110 cuentas adicionales incluyen 54
con deuda y 56 sin saldo utilizado positivo en la consulta.

Captura entre 08:22 y 10:31 del 21 octubre, México; source_at conservador
2026-10-21T14:22:21.669Z y última observación 2026-10-21T16:31:29.355Z.
Es un recorrido durante un intervalo, no un cierre simultáneo. Se deberá renovar
el corte antes de operar y no extender artificialmente la vigencia.

No incluye el menú separado de clientes eliminados ni todo el historial pagado.
El filtro de la tabla de crédito se comprobó visualmente: No pagado y recepción
Todos. No se abrió Multi-Abono, edición, eliminación ni recepción de pagos.

## Hallazgos y tratamiento

Hay cuentas con deuda cuyo nombre dice NO CREDITO, otras de empleados y otras sin
etiqueta APARTADO. Registrar su deuda heredada no autoriza crédito nuevo.
Se mantienen native_customer_id, consentimiento y Auth sin asignar.

Se encontraron folios numéricos antiguos, por ejemplo 148. Se conserva el folio
literal, sin agregar VSM. Clave de documento = tenant + UUID fuente + folio;
un mismo folio en otra cuenta nunca reutiliza su identidad por coincidencia de nombre.

Una captura mostró documentos y saldo vencido, pero todavía no saldo utilizado.
La primera observación quedó preservada y la relectura completa sí mostró el importe.
No se dedujo desde el listado ni desde la suma de documentos. Las primeras fichas
se releyeron con recarga completa antes del paquete final. Las 171 referencias
finales son distintas y todas tienen importe utilizado explícito.

SICAR tarda en aplicar algunas búsquedas o actualizar fichas. La captura comprueba
el nombre de destino y URL real, recarga, espera la consulta y rechaza páginas
en carga o sesión vencida. Un fallo no se convierte en un cliente vacío.
No se extrajeron cookies, tokens, claves ni estado interno del navegador.

## Analizador, cola y reporte

scripts/m9/prepare-general-customers.mjs consume tres archivos fijados por SHA256:
listado final, 171 capturas y plan anterior. Rechaza alcance incompleto, IDs
duplicados, ficha incorrecta, fuente vencida/futura, carga sin terminar, filas
malformadas o folios duplicados dentro de la misma cuenta.

Conserva por separado saldo de tarjeta, utilizado, vencido y filas de documentos.
Una diferencia queda en revisión, no reemplaza la cifra anterior. Un campo ausente
permanece null. No se deduce identidad, consentimiento, autorización de crédito,
entrega o existencia. operational_import_allowed sigue false para todo el paquete.

Produce plan-lectura.json, resumen.json, reporte.html y cola-detalles.json.
La cola identifica 83 documentos: siete en el paquete anterior y 76 adicionales.
Los siete conservan su ID de documento anterior sólo como referencia esperada;
todos requieren comprobación de detalle y abonos para un corte operativo vigente.
No se inventa un source_document_id para los adicionales.

Dos ejecuciones idénticas byte a byte. Reporte privado con búsqueda por nombre/ID/
folio y filtros de cuentas adicionales, documentos pendientes y alertas. HTML
escapado, sin recursos externos. Validación estática: 171 artículos y 83 documentos.
El navegador automatizado rechazó abrir protocolo file; no se declara aceptación
visual ni interacción de filtros en navegador. El archivo queda disponible para
abrirse localmente. No se expusieron datos personales en Git ni en un sitio público.

## Verificación de sólo lectura en staging

comparacion-staging-readonly.sql usa BEGIN READ ONLY, referencias/cifras del
reporte y ROLLBACK. En zsezjtswqeijboezvado confirmó 171 fuentes, 61 registros
conocidos, 110 adicionales, cero conflictos de ID y cero diferencias de saldo
en las referencias previas. Libro heredado permanece $11,910, PAYMENT cero y
ventanas operativas cero.

Auditoría de 140 tablas antes y después: todas idénticas. Sin DDL, nuevas
aperturas, clientes nativos, consentimientos, Auth, stock, ventas, caja o folios.
Los doce códigos del piloto siguen con sus 36 cantidades sin capturar.
No se despliega ni promueve main/producción en este bloque.

982 pruebas unitarias / 117 archivos PASS. Las nueve pruebas del nuevo analizador
cubren identidad, duplicados, importes, moneda MXN, fuente incompleta/vencida,
folios antiguos, escapado HTML y vínculo de documentos por clave completa.
Tipos, ESLint y diff-check PASS.
Cobertura de catálogo documentada sigue 96.92%, no es porcentaje total de migración.

## Revisión de anulación operativa

La anulación de abono aún no está implementada ni aceptada. El libro actual sólo
admite importes positivos en OPEN y negativos en PAYMENT/PAYMENT_TRIAL/REVERSE;
las asignaciones y recibos son inmutables. REVERSE compensa una apertura y no
sirve para anular un abono negativo: hacerlo así reduciría otra vez la deuda.

El siguiente diseño debe incluir:

1. Evento de compensación positivo ligado al PAYMENT original y único por solicitud,
   sin borrar el recibo o asignaciones originales.
2. Reversión trazable de las asignaciones originales y lectura de su importe neto
   en FIFO; guardar antes/después, motivo, autor y recibo de anulación inmutable.
3. Caja propia abierta y sucursal correcta; revertir sólo el efectivo efectivamente
   aplicado. No aumentar/reducir efectivo por tarjeta o transferencia.
4. Una caja cerrada no se edita. Reintegros externos requieren evidencia y tratamiento
   propio, sin fingir que un movimiento contable devolvió dinero en banco/terminal.
5. Autorización de supervisor de un solo uso, siguiendo el modelo nativo
   returns.authorize y su vínculo al actor/operación; no fabricar aprobación o PIN.
6. Ensayo de cobrar → compensar → repetir, referencias alteradas, sobrecompensación,
   caja cerrada y permisos; rollback y auditoría antes de habilitarlo.

Este es un diagnóstico del esquema y orden de implementación, no prueba de una
anulación que ya funcione. El cobro operativo sigue bloqueado.

## Siguiente trabajo concreto

- Abrir el detalle y abonos de los 83 documentos con la cola; prioridad a los
  76 adicionales. Confirmar ID literal, vencimiento, total/saldo, abonos activos/
  cancelados y líneas, guardando evidencia de origen.
- Preparar la ampliación del importador más allá de APARTADO con identidades
  literales e importes comprobados, sin duplicar las 61 referencias existentes.
- Conciliar entrega física y conteos del piloto: una deuda no demuestra que la
  mercancía esté en la tienda o que falte entregarla.
- Implementar y ensayar compensación/recibo operativo; renovar corte y acordar
  un solo sistema registrando abonos antes de autorizar arranque.

Evidencia privada, fuera del repositorio:
outputs/m9-padron-general-anulacion-2026-10-21/. Conserva capturas iniciales y
relecturas, listado completo, prueba del filtro, pins, dos corridas, comparación
READ ONLY y auditorías. No generar otra tanda de preguntas a los dueños por
los nombres repetidos: permanecen como dos IDs distintos sin fusión.

