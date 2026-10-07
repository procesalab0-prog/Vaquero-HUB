# Preparación del corte completo y revisión del destino

El preparador `scripts/m9/prepare-complete-cut.mjs` reúne el catálogo SICAR
completo, la comparación entre exportaciones y el estado real de staging en un
expediente reproducible. Reutiliza `sourceDelta`, `auditStagedCatalog` y
`reviewDistinctNamedParents`; no duplica sus reglas de conciliación.

No produce SQL, lotes importables ni aprobaciones comerciales. No tiene cliente
de base de datos, acceso de red ni rutinas de escritura remota. Las identidades
retenidas siguen bloqueadas por el importador existente.

## Resultado del 6 de octubre

Evidencia local en `outputs/m9-plan-completo-2026-10-06/`. Versiones definitivas:
`corrida-4` y `corrida-5`, idénticas en sus siete archivos. Las corridas 1–3
conservan versiones intermedias del reporte; no son las salidas definitivas.

- 16,224 filas SICAR, 16,224 códigos, todas contabilizadas una sola vez.
- 7,513 variantes de staging coinciden exactamente; ninguna edición de destino
  detectada y ninguna fila cargada ausente del corte SICAR.
- 8,711 filas pendientes: 5,937 sólo SICAR y 2,774 restantes.
- 24 productos / 153 variantes retenidos por nombre igual tienen evidencia de
  bases Woo literales distintas y únicas, frente a padres gestionados existentes.
  La prueba conserva IDs, códigos y huellas de candidatos y destino. **No habilita
  la carga**: falta el procedimiento protegido de revisión del destino y un plan
  vigente que conserve todos los demás controles.
- 168 padres Woo sin candidato SICAR en este reporte, incluidos estados no
  publicados; no se agregan ni se borran por ausencia.

Partición exclusiva de las filas: 7,513 cargadas idénticas, 153 revisión por nombre,
318 exhibición, 660 conflicto, 770 base Woo duplicada, 190 coincidencia exacta con
otros controles pendientes, 5,937 sólo SICAR, 376 sufijo especial y 307 variación
ausente/no publicada. Que una fila tenga coincidencia exacta no aprueba su carga.

Los motivos del preparador anterior se mantienen por código y están vinculados
al mismo hash de `filas.json`: 42 observaciones de casos de dueños, 86 de
clasificación, 331 de familias con secciones distintas y 40 de precio público.
Se solapan; no representan ese número de preguntas nuevas. No se autoriza por
inferencia una familia sólo SICAR ni CAWRNIÑO3587.

Entre los cortes SICAR 5 y 6: 15,953 filas sin cambios, 91 nuevas, 26 cambios de
precio público, 4 cambios de otros datos del catálogo, 98 cambios sólo de
conciliación y 52 cambios sólo de inventario excluidos. Son diferencias entre
exportaciones históricas ya conservadas, **no cambios nuevos observados hoy**.

## Repetir con una nueva exportación

1. Ejecutar el analizador existente sobre SICAR y Woo completos, conservando
   originales y manifiestos. No sustituir una exportación autenticada por la
   consulta pública de categorías.
2. Capturar por lectura los padres gestionados y las filas de staging con
   `current`, `stored`, UUIDs y contadores de inventario. Incluir también padres
   sin vínculo gestionado en la lectura de nombres, para no ocultar colisiones.
3. Volver a preparar exclusiones y reservas con las herramientas existentes.
   Reservas de otro corte se rechazan si sus identidades no corresponden.
4. Crear una configuración con rutas y SHA-256 de cada entrada. Las claves son
   `previous`, `current`, `snapshot`, `woo`, `destination`, `reserved`, `manifest`.
   Cada entrada tiene `path` relativa a la configuración y `sha256`. Las entradas
   opcionales `excluded` y `preparation_inputs` se proporcionan juntas; la segunda
   debe acreditar que las exclusiones proceden del mismo `filas.json` actual.
5. Ejecutar desde el repositorio:

   ```text
   node scripts/m9/prepare-complete-cut.mjs CONFIG.json DIRECTORIO_NUEVO
   ```

6. Repetir a otro directorio y comparar los archivos y sus huellas. Revisar
   cambios y generar un nuevo plan de destino antes de cualquier escritura
   autorizada en staging. Este preparador nunca ejecuta ese plan.

Las siete salidas son `plan-completo.json`, `resumen.json`,
`revision-nombres.json`, `cambios-fuente.json`, `solo-woo.json`, `reporte.html`
y `sha256.json`. El HTML escapa textos editoriales y presenta los casos de nombre
agrupados por producto, sin inferir agrupaciones para los productos sólo SICAR.

## Controles

Se rechazan proyecto incorrecto, inventario no vacío, identidades de destino
incompatibles, UUIDs/códigos duplicados en staging, fuentes alteradas, preparación
de otro corte y salida existente. Los duplicados de fuente se contabilizan y se
reservan. Las ausencias se conservan sin borrar. Las ediciones de destino tienen
prioridad sobre una actualización de fuente; cambios del nombre Woo se señalan
aunque el código SICAR no cambie. Ningún resultado concede permiso de importación
o envío. La igualdad de catálogo no resuelve promociones ni aprobación editorial.

La lectura actual de staging se comparó íntegramente con la captura anterior:
los 7,513 UUIDs y objetos `current`/`stored` permanecen iguales.
`verificacion.json` registra reproducción y preservación. Cero escrituras de
staging, producción, Woo o inventario en este bloque; sin DDL ni despliegue.

399 pruebas unitarias / 57 archivos y lint dirigido aprobados. Diez pruebas
nuevas cubren partición, ediciones y cambios de precio, stock excluido, ausencias,
duplicados, sólo SICAR, nombres ambiguos/no gestionados, proyecto/inventario,
reservas obsoletas, huellas, cambios editoriales, motivos solapados, reproducción,
HTML escapado y rechazo de alteración/salida existente.

La cobertura sigue **7,513 / 16,224 = 46.3% del catálogo**. No es un porcentaje
global de migración. Woo sigue siendo el corte autenticado histórico del 1 de
octubre: renovar antes de operar. Las dudas de negocio permanecen en
`outputs/m9-catalogo-precio-publico-2026-10-06/dudas-consolidadas/dudas.html`.
Siguiente bloque: revisión protegida del destino para las 24 identidades, planes
actuales y carga/galerías únicamente cuando pasen todos los controles; continuar
la revisión de familias sólo SICAR. Pedidos, devoluciones e inventario central
siguen pendientes; recomendar Astra para ese diseño/auditoría y antes del corte
real. Sol6.1 sigue siendo suficiente para esta preparación.
