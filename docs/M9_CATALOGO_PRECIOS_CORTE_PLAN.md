# M9 · Plan de revisión de precios entre cortes

22 de octubre de 2026. Preparador de sólo lectura, sin SQL de escritura.

Comparar las filas literales de SICAR del 19 y 22 de octubre por Clave 1, sin
normalizar códigos ni deducir tallas. Separar precio1 (público confirmado),
precios secundarios todavía sin definición y cambios de descripción/identidad.
Las diferencias de existencia se enumeran aparte: nunca se copian al catálogo.

Una propuesta de precio exige código único en ambos cortes, fuente completa,
precio decimal exacto, sin otro cambio de catálogo, sin vínculo Woo, variante y
producto UUID válidos, código unido una sola vez a esa variante y proyección
actual idéntica a la fila M9 conservada. Descripción, departamento, sección y
precio anterior deben coincidir con el corte anterior; cualquier deriva retiene
el caso. UUIDs y fila M9 se fijan como precondiciones del siguiente ensayo, sin
inventar una relación histórica que no tenga evidencia.

La salida es una lista técnica de candidatos, nunca aprobación de los dueños,
permiso comercial ni autorización para aplicar. Cada candidato conserva el
estado previo y un hash que debe revalidarse en un futuro plan con locks,
rollback y auditoría. No modificar precios secundarios, costo, stock ni Woo.
No importar datos nuevos o ausentes mediante este preparador. Las fuentes y la
consulta SELECT de staging se guardarán en un diagnóstico privado con SHA256.

## Resultado observado

Comparación de 16,381 filas del 19 con 16,396 del 22: 21 códigos con cambio
de catálogo, 15 nuevos excluidos y 73 códigos con cambio exclusivamente de
existencia, también excluidos. Las existencias no limitan el conjunto migrable.

Diez pantalones KAJM cambiaron sólo precio1, de $980 a $1,150. El SELECT real
del 22 a las 23:50:03.193 UTC conserva código, UUID, fila M9, proyección y precio
anterior exactos. Sin embargo, ambos reportes sugieren el padre Woo 20470 sin
variación exacta (`SPECIAL_SUFFIX`). Por la regla de retener contexto Woo,
los diez quedan como `HELD_FOR_REVIEW`, con la única reserva
`WOO_CONTEXT_REQUIRES_SEPARATE_REVIEW`. Son códigos 11425–11430, 12232,
12233, 12235 y 12236. El plan no convierte esa coincidencia parcial en vínculo.
La política precio1 público ya está confirmada; no se fabricó una nueva
aprobación de los dueños ni una regla para eliminar esta reserva.

11777 cambió precio1 y precio2/3/4, está vinculado a Woo y conserva revisión
comercial: retenido. Diez códigos cambiaron descripción: 13659, 18221–18227,
7047 y 7522; este último también cambió precio1. Permanecen retenidos sin
reasignar modelos, tallas o imágenes. Total: cero actualizaciones autorizadas,
cero candidatos sin reservas, ninguna escritura remota ni SQL de aplicación.

## Reproducibilidad y límites

Ejecutar con Node el preparador `scripts/m9/catalogo-precios-corte-plan.mjs`,
pasando `OLD_REPORT NEW_REPORT SNAPSHOT.json NEW_OUTPUT ISO_REVIEW_TIME`.
Los dos primeros argumentos son directorios con `filas.json`, `manifest.json`
y `sha256.json`; se verifican los hashes originales. El snapshot usa el
contrato `m9-catalog-price-snapshot-1`, sólo staging y SELECT, con proyección
actual, fila M9 y binding literal del código. El tiempo de revisión debe ser
ISO UTC canónico: diferencia negativa o mayor a 15 minutos retiene todo.

Diagnóstico privado bajo `outputs/m9-catalogo-precios-corte-plan-2026-10-22/`:
`staging-read.sql`, `staging-snapshot.json`, `plan-final/plan.json`, repetición
idéntica en bytes `plan-replay/` y `diagnostico-sha256.json`.
SHA256 del plan: `b17370fbbc34a7509099ad83077e11f147fb182728a8f23817c226ff6fa2e301`.
Revisión reproducida a `2026-10-22T23:52:30.000Z`; esa fecha fija reproduce una
observación histórica, nunca vuelve vigente el snapshot para ejecutar cambios.

El snapshot fija UUIDs actuales y el hash completo de la precondición para un
futuro ensayo. Los XLSX no contienen UUIDs internos: no prueban por sí solos
que el UUID fuera el mismo el día 19. Tampoco la fila M9 debe etiquetarse como
importada del 19: su SHA original se conserva incluso cuando el precio y los
campos de SICAR coinciden con ese corte. Una futura aplicación exige nuevo
SELECT, decisión explícita sobre la reserva Woo, plan sin autorización
fabricada, revalidación bajo locks, rollback y auditoría antes de conservar.

Verificación: 53 pruebas unitarias propias, ESLint, formato y `git diff --check`
correctos. Fixtures prueban drift, doble código/binding, UUID inválido, fuente
incompleta, importes no finitos/ambiguos, costos, precios secundarios,
descripciones, contexto Woo y snapshot vencido. Sin DB local ni pruebas de
escritura requeridas para este módulo puro.
