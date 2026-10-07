# Catálogo con precio público SICAR — 6 de octubre de 2026

Se cargaron **571 variantes adicionales en staging**, distribuidas en 130 familias:
93 padres nuevos y 37 existentes ampliados. El catálogo contiene **7,513 de 16,224
filas SICAR (46.3%)**. Esto mide cobertura del catálogo, no avance global ni permiso
de operación. Las 6,942 variantes anteriores se conservaron exactamente.

## Precio del catálogo y revisión de Woo

El usuario y los dueños ya confirmaron que `precio1` es el precio al público.
También explicaron que las promociones web pueden diferir. Una diferencia entre
Woo y SICAR no establece por sí sola una identidad distinta. Se aplica esta
política exclusivamente al catálogo interno de pruebas: se toma precio1 positivo
de SICAR y no se cambia Woo, sus precios normales, rebajas ni promociones.

`scripts/m9/catalog-retail-review.mjs` crea una proyección offline, sin mutar el
reporte original. Exige identidad única y regla exacta de atributos, ausencia de
problemas de origen, precio1 positivo y política confirmada. Sólo admite la
observación literal de precio diferente y, opcionalmente, diferencias/ausencia de
stock ya conocidas. No admite precios no comparables, impuestos inferidos,
identidades ambiguas, publicaciones privadas, muestras, datos inválidos ni otros
problemas comerciales. La identidad simple debe apuntar al propio padre.

El reporte original conserva `manual_review=true` y sus controles comerciales.
La proyección registra `original_manual_review`, revisión comercial Woo pendiente,
`woo_writes_allowed=false` y `automatic_import_allowed=false`. No aprueba envío,
publicación ni cambios de precios del canal web. Las guardas existentes de casos
de dueños, clasificación, nombres y destino siguen vigentes. Los padres nuevos
no se añadieron a las listas habilitadas de envío remoto/local.

639 filas tenían esta evidencia de precio. Con los candidatos anteriores aún
reservados se revisaron 746; se prepararon 724 en 154 padres. El destino reservó
153 por `EXISTING_NAME_REQUIRES_IDENTITY_REVIEW`; se apartó cada padre completo,
sin relajar ese control. Lotes finales: 354 y 217 creaciones. Segunda aplicación:
0 creadas, 0 actualizadas y 571 sin cambios. Todas las filas nuevas pertenecen al
bloque de precio diferente: 453 sólo precio, 69 precio/stock no disponible y 49
precio/diferencia de stock. No se importó stock en ningún caso.

## Fichas y fotos

93 fuentes editoriales nuevas, 401 fotografías copiadas al almacenamiento propio.
Fuente: Woo autenticado histórico del 1 de octubre, no exportación actualizada.
Total: 1,461 fuentes y 1,462 borradores (incluye sintético). Las 1,368 fuentes y
borradores anteriores conservaron identidad, contenido y revisión; verificación
independiente de fuente/draft por hash o JSON exacto. Se mantienen 1,238 vínculos
de categorías válidos y cero invalidados. Las categorías de los 93 padres nuevos
requieren comprobación antes de un futuro envío; no se amplió la autorización de
consultas públicas anterior.

El catálogo completo fue auditado dos veces: 7,513 coincidencias exactas, cero
diferencias en Clave1, descripción SICAR, departamento/sección, precio1, atributos
e IDs Woo; costo null y cero inventario. Ambas salidas son idénticas. La repetición
de la preparación de lotes, fichas y revisión de familias también es idéntica.

## Familias y productos no publicados

1,462 padres revisados: 904 estructuralmente completos, 558 con opciones Woo
faltantes y ninguna variante inesperada. Dentro de esas familias ya no quedan
variantes faltantes con fila SICAR confirmada por el reporte; las 90 del corte
anterior quedaron cubiertas. Las 1,616 opciones restantes no tienen fila SICAR
confirmada: no se inventan códigos ni se consideran unidades físicas faltantes.
49 familias mezclan departamentos; es observación, no corrección automática.

Se revisaron offline otras 196 filas con coincidencias en 60 padres no publicados:
129 con padre/variación en borrador y 67 con padre privado/variación publicada.
No se cambió ningún estado. Se recalcularon prefijos/atributos completos con el
parser y reglas existentes, sin simular publicación. No hay destinos compartidos
entre esas 196 candidatas. Son evidencia pendiente, no vínculos aprobados ni
variantes importadas; ambas autorizaciones permanecen false. Las limitaciones de
los importadores para no publicados siguen intactas.

## Pendientes y comprobaciones

Quedan **8,711 filas**: 5,937 sólo SICAR y 2,774 con otras reservas.
Dudas de negocio consolidadas: clasificación en 86 registros, precio público
vacío/inválido/cero en 40 e identidad repetida en 62. Las listas se solapan; no son
ese número de preguntas nuevas. CAWRNIÑO3587 sigue pendiente de los dueños. No se
fabricaron decisiones para familias SICAR_ONLY.

389 pruebas unitarias en 56 archivos y lint dirigido aprobados; seis pruebas nuevas
cubren política confirmada, preservación, identidad única/simple, muestras/privados,
observaciones comerciales y precios inválidos. No hay migración de esquema,
despliegue frontend, nuevas tareas de envío ni escrituras Woo/producción. Colas
permanecen en 3 remotas, 1 galería y 9 locales. Cero saldos/movimientos.

Evidencia: `outputs/m9-catalogo-precio-publico-2026-10-06/`:
`corrida-1/2/3`, `lote-validado`, planes, aplicación/repetición, captura staging,
auditorías, fichas, familias, preservación y dudas consolidadas. La revisión
`no-publicados-1/2` es idéntica y siempre manual. Los planes históricos no sirven
como autorización futura: releer destino y generar un plan vigente antes de aplicar.
Sol6.1 sigue siendo suficiente para estas comprobaciones. Astra recomendado para
el diseño/auditoría de pedidos, devoluciones, inventario central y revisión operativa.
