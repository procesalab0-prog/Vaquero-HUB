# Ampliación de catálogo con identidades distintas — 6 de octubre de 2026

Se cargaron **878 variantes adicionales en staging**, en 155 familias: 129 padres
nuevos y 26 existentes ampliados. Total **6,942 de 16,224 filas SICAR (42.8%)**.
Este porcentaje mide cobertura de catálogo, no terminación global de la migración.

## Criterio y límites

Los nombres Woo son editoriales. `review-distinct-named-parents.mjs` identifica
padres del mismo nombre sólo cuando cada código base literal es distinto y único
en toda la exportación Woo. Conserva IDs, bases originales y estado de cada padre;
no los fusiona. HTML, frases, bases vacías, repetidas o con prefijos superpuestos
quedan en revisión. La prueba de identidad no autoriza escrituras por sí misma.

Se usa el conciliador existente para exigir variante exacta, clasificación y
precio válidos. La proyección de revisión de catálogo conserva las diferencias de
existencias como observación, sin importarlas. No se aprobaron familias SICAR_ONLY.
De 1,003 candidatos pendientes, se prepararon 990. El plan de destino rechazó 112
por coincidencia con nombres existentes; quedaron apartados íntegramente por
padre. No se cambió ni se evitó `EXISTING_NAME_REQUIRES_IDENTITY_REVIEW`.
Los tres lotes aceptados crearon 458, 412 y 8 variantes. Al repetir: cero creadas,
cero actualizadas y 878 sin cambios.

La auditoría independiente del catálogo entero confirmó 6,942 coincidencias
exactas: códigos literales SICAR, descripción, departamento/sección, precio1,
atributos e IDs Woo. Las 6,064 variantes anteriores conservaron su huella.
Costo permanece desconocido; cero saldos y cero movimientos importados.

## Fichas, fotos y exportaciones repetidas

Se prepararon y guardaron 129 fuentes editoriales nuevas, con 496 imágenes,
a partir del corte Woo autenticado del 1 de octubre. No es una exportación fresca.
Se copiaron las 129 galerías y se verificaron por lectura los bytes de las 496
imágenes guardadas, sin faltantes ni extras. La lista quedó sin pendientes.
Las 1,239 fuentes y borradores anteriores conservaron hash, contenido y revisión;
los 1,238 vínculos de categorías siguen válidos. Las categorías de los 129 padres
nuevos necesitan comprobación de pertenencia antes de un futuro envío; no se
extendió la consulta autorizada para los 1,240 IDs anteriores a otros productos.

La función de lectura de galerías ahora omite del listado general los borradores
que ya tienen todas sus imágenes en la carpeta propia de Mi Tienda. Usa el mismo
criterio de no cambio del copiador. Una lectura explícita por producto sigue
mostrando la fuente para comprobar identidad antes y después de copiar. No se
cambian permisos, revisión, protección de edición ni rutinas de escritura.
Borradores ausentes, malformados o con imágenes externas/de otro producto siguen
en la lista. Una galería vacía ya guardada se considera sin trabajo, como antes.

Migración local creada con CLI: `20261006230904_m9_pending_gallery_reader.sql`.
Registro remoto staging: `20261006230941`. Once comprobaciones SQL ejecutadas en
transacción revertida antes de aplicar: anonimato, permisos, lectura explícita,
pendiente, completada, ruta de otro producto, malformada, sin borrador, fuente
intacta, privilegios y staging deshabilitado. Advisor sin hallazgos de esta función.

## Cobertura y revisión

Quedan **9,282 filas**: 5,937 sólo SICAR y 3,345 con otros pendientes.
La revisión de familias ahora incluye 1,369 padres: 847 estructuralmente completos,
522 con variantes faltantes, ninguna variante inesperada. Al ampliar el alcance
aparecen 1,514 variaciones Woo faltantes: 1,424 sin fila SICAR confirmada y 90 con
filas SICAR pendientes. No se inventan códigos para variantes sólo Woo.
44 familias tienen departamentos mezclados; es observación, no corrección automática.

El reporte consolidado mantiene juntas las dudas: clasificación en 86 registros,
precio público en 40 e identidad repetida en 62; las listas pueden solaparse y no
representan ese número de preguntas nuevas. CAWRNIÑO3587 sigue pendiente de los
dueños. Las políticas ya resueltas no se vuelven a preguntar.

## Evidencia y reproducción

Directorio: `outputs/m9-ampliacion-identidades-distintas-2026-10-06/`.
`preparar.mjs` genera el paquete determinista desde fuentes verificadas.
`corrida-1` y `corrida-2` son idénticos byte a byte. `plan-destino-*.json`
conserva las reservas del destino y `lote-validado` las filas aceptadas.
`aplicacion.json`, `repeticion.json`, `integridad.json` y `staging.json`
registran el resultado real. Auditoría completa y revisión de familias se
reprodujeron en dos carpetas con resultados idénticos. `preservacion-web.json`
compara las fichas anteriores. `dudas-consolidadas/dudas.html` reúne pendientes.

383 pruebas unitarias en 55 archivos y lint dirigido aprobados. La invocación
inicial de Vitest sin filtro incluyó incorrectamente suites Playwright y pruebas
locales sin variables de Supabase; falló por selección/entorno. Se ejecutó después
el comando unitario previsto por el repositorio, con las 383 aprobadas. Las pruebas
alojadas de esta modificación son las comprobaciones SQL y la UI de galerías.

Todo se ejecutó en staging `zsezjtswqeijboezvado`. Sin escrituras en producción ni
Woo, sin importación de existencias, sin activar colas ni pedidos. No hay despliegue
frontend. Pedidos, devoluciones e inventario central siguen pendientes. Sol6.1
es suficiente para este bloque; recomendar Astra al diseñar/auditar esos flujos
y antes de la revisión operativa final.
