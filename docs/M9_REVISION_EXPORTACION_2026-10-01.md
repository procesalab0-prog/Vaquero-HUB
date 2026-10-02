# M9 — Nueva exportación y conciliación, 1 de octubre de 2026

Se conservaron los originales y se guardaron copias de SICAR y WooCommerce en outputs/m9-fuentes-2026-10-01. Ambos archivos son nuevos. Woo exportado con herramienta nativa, sin metadatos personalizados ni papelera. Conteo validado contra panel: 2,119 productos (2,007 publicados, 86 borradores y 26 privados), 12,139 variaciones, 14,258 registros CSV.

SICAR: 16,130 filas frente a 16,035 previas; 98 códigos nuevos y 3 ausentes. No hay Claves 1 vacías ni duplicadas; se mantiene un código con cero inicial. Ausentes 12206 CUBREMONTURA, 7039 POLAINANIÑ y 7043 POLAINASCUERO: revisión manual, no bajas automáticas.

Cambios en 1,660 códigos conservados: 55 descripciones, 149 precios públicos, 1 costo y 1,502 existencias (un registro puede cambiar varios campos). No hubo cambios de departamento ni categoría en códigos conservados. Las existencias se comparan sólo como evidencia: no se importan.

## Casos revisados

- Camisas: siguen CARO23135 en Woo 38060 y 38083 y en las siete filas SICAR. M/M, L/L y XL/XL aún duplican descripción. No se puede marcar la corrección como terminada.
- Cintos: plata 5731 / CINVINPIELCHAPHERRPLTNEG y dorado 18055 / CINVINPIELCHAPHERRDORNEG, correspondientes a bases Woo 23958 y 23957. Dorado requiere revisión de existencia inválida y plata carece de existencia Woo disponible; no hay autorización de importación.
- Gorras: 11756 / GORRCUAMETCOCOCAF frente a 13254 / GORRCUAMETCOC. Woo tiene bases correspondientes 23955 y 29646; el conciliador mantiene 11756 bloqueado por prefijos superpuestos, sin elegir automáticamente el más largo.
- Hebillas, bolsas cuadradas café y bosales aún comparten sus bases anteriores entre registros Woo. Se conservan las decisiones humanas y sus pendientes; un registro privado o borrador no se presenta como publicación pública. Orleado 22175 ahora está en borrador y 23039 publicado.

## Reporte vigente

[Resumen de conciliación](m9-reporte-actualizado-2026-10-01/resumen.md) y [revisión por grupos](m9-revision-actualizada-2026-10-01/revision.html).

7,455 coincidencias exactas; 5,844 filas sólo SICAR; 770 con base Woo duplicada; 307 variantes no publicadas; 686 sufijos especiales; 1,068 conflictos. Las coincidencias no equivalen a importación aprobada. 47 filas con cantidades inválidas. Mayoreos siguen sin definir.

Dos ejecuciones generaron archivos idénticos. Comparación por Clave 1 reproducible con scripts/m9/compare-source.py; resultados en m9-fuentes-2026-10-01/comparacion-sicar.json. Reportes sicar-nuevo-woo-historico son provisionales y no constituyen el cruce vigente.

Cero importaciones, cero cambios de catálogo en Woo o producción. Staging alojado sigue pendiente. La pantalla local previa todavía usa la captura histórica de septiembre y no representa este reporte nuevo.
