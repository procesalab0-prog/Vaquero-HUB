# Revisión completa de cambios Woo y retenciones por sección

Bloque del 6 de octubre de 2026. Herramienta `scripts/m9/review-source-sections.mjs`; evidencia en `outputs/m9-revision-cambios-secciones-2026-10-06/` del directorio de trabajo exterior. Es revisión técnica reproducible, sin SQL de importación, escrituras, red, actualización de fuentes, borradores o aprobaciones.

## Fuentes y destino

SICAR6 mantiene el corte del 5 de octubre: 16,224 registros y SHA `171200f4b21f1a1f11bd977739d3e80a7f191b09977d2cdffcee1a6a4daab12a`. Woo corresponde a la exportación nativa autenticada del 6 de octubre: 2,119 padres/12,126 variaciones; JSON SHA `6a4bf69ecf715010645d4d3974c7c01a80a3690df9efd1d3268f3d55f051d1e1`. No se volvió a consultar producción.

Lecturas nuevas de staging `zsezjtswqeijboezvado`: catálogo completo y contexto de 1,494 productos gestionados con fuente/borrador. Las 7,683 filas guardadas coinciden íntegramente —UUID, current y stored— con el cierre anterior. Auditoría frente a su referencia aplicada: 7,683 exactas/0 diferencias; frente al último Woo: 7,678 exactas/5 reservas por publicación. Cero saldos y movimientos. No confundir una referencia aplicada con una conciliación nueva: `referencia-procedencia.json` documenta las 7,666 filas históricas aplicadas, 17 nuevas y las 8,541 pendientes del último corte.

## Cambios Woo

Los 44 padres con cambios quedan revisados contra su fuente guardada actual, no sólo contra la exportación vieja. Dos fuentes ya están actualizadas (38363/38364), cuatro no están cargadas y 38 conservan diferencias que requieren tratamiento técnico. Esto no significa que todas sus variantes estén mal, ni autoriza reemplazar borradores.

Se separan categorías, precios/promociones, publicación, galerías de padre, fotos de variación, ausencias y otros campos CSV. Precio1 SICAR sigue siendo el precio del catálogo; las categorías Woo no reemplazan departamento/sección. Las 13 variaciones ausentes de 38578 se conservan como evidencia sin borrar nada. La fuente de 33002 ahora borrador no causa baja de sus cinco variantes ya cargadas.

Seis galerías de camisas tienen comparación explícita de URLs anteriores/nuevas/agregadas/retiradas, revisión y huella de borrador, posibles ediciones de texto y comprobaciones pendientes. No se declaró equivalencia de bytes ni se copiaron imágenes. Antes de actualizar: comprobar bytes/orden, preservar texto/alt/ediciones locales, distinguir fotos del padre y de variación, volver a leer huellas, ensayo protegido en staging y repetición sin cambios. El guard existente `WEB_SOURCE_CHANGED_REVIEW_REQUIRED` permanece intacto.

## Secciones

Se analizaron las 331 filas pendientes retenidas por secciones, relacionadas con 47 IDs candidatos. Los IDs candidatos no son vínculos confirmados ni familias aprobadas.

- Cuatro padres/26 variantes: 7852 (14), 33500 (5), 22733 (4) y 32991 (3). Sus filas con padre canónico asignado tienen una sección, mientras referencias amplias de otras filas generan el bloqueo. Estado `CANDIDATE_SCOPE_REVIEW`: evidencia para revisión técnica, **no aprobación**. Se mantienen las filas ambiguas y los controles originales; no se eliminan candidatos ni se elige el prefijo más largo.
- 21 padres tienen varias secciones entre filas asignadas y quedan para confirmación del dueño, sin escoger la más frecuente.
- Otros 22 IDs tienen identidad u otros controles pendientes; no se convierten en preguntas de sección innecesarias.

Todas las salidas mantienen import/refresh/delete/send_allowed=false. No se alteró `buildBatch`, el conciliador, el plan de destino ni las decisiones del negocio.

## Revisión de todo el pendiente

Se renovó el expediente completo con Woo actual y captura nueva: 8,541 filas en 5,773 expedientes; los primeros 20 reúnen 626 registros. Incluye los 5,937 SICAR_ONLY, que continúan dentro del alcance, no excluidos definitivamente. CAWRNIÑO3587 sigue esperando confirmación. Los componentes de revisión no son fusiones de productos. Plantilla de respuestas vacía y protegida por huellas; no se inventaron testimonios.

Corridas 5/6 definitivas deben compararse en todos sus artefactos salvo `config-revision.json`, que contiene rutas absolutas de salida diferentes. Corridas 1–4 y `pendientes-1` son intermedias. `config-ejecucion.json` fija todas las huellas; `ejecutar.mjs corrida-nueva` reconstruye comparación, auditorías, revisión y expediente. Reporte raíz resume el bloque sin abrir HTML bloqueado mediante otro origen.

Validación: 434 pruebas unitarias/61 archivos y lint dirigido; siete nuevas pruebas cubren fuentes ya actualizadas, fotos padre/variación, precio, ausencias, publicación, candidatos amplios, secciones reales, proyecto/inventario/identidad/exclusiones/huellas e inmutabilidad.

Cobertura permanece 7,683/16,224 = 47.4% del catálogo, no avance global. Este bloque agregó 0 variantes y actualizó 0 fichas. Siguiente: resolver técnicamente las cuatro retenciones de alcance mediante evidencia y plan original; preparar actualización protegida de las seis galerías; consultar las secciones reales y los expedientes prioritarios. Producción, inventario, pedidos y nuevos envíos siguen fuera de este bloque. Sol sigue siendo suficiente; Astra antes de pedidos/devoluciones/inventario central y auditoría final operativa.
