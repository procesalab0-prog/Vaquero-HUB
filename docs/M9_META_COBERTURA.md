# Meta de cobertura superior al 50% — revisión pendiente

La meta solicitada se interpreta como superar el 50% del catálogo SICAR cargado
en staging, no sumar 50 puntos de avance global. **No se alcanzó en este bloque**:
se mantienen 7,709 de 16,224 variantes (47.516%). No hubo cargas nuevas.

Para superar estrictamente la mitad se necesitan 8,113 variantes, es decir,
404 adicionales. No se convierten propuestas de familia en aprobaciones para
cumplir una cifra. Tampoco se importan existencias ni se modifica Woo real.

## Resultado y revisión priorizada

`scripts/m9/prepare-coverage-review.mjs` reutiliza `prepareSicarOnly`,
`reviewSicarFamilies` y `auditStagedCatalog`. Examina el catálogo completo,
valida la referencia aplicada contra el mismo corte literal SICAR y audita
el destino contra dicha referencia. Mantiene separada la auditoría del último
Woo, que tiene cinco reservas por cambio de publicación de Woo33002.

Las 5,937 filas sólo SICAR siguen incluidas. Sus 400 propuestas con delimitador
literal T. reúnen 1,322 filas; las otras 4,615 conservan la descripción sin
deducir tallas por números finales. De las propuestas T., 302 / 966 filas no
tienen observaciones adicionales después de comprobar:

- Datos, precio público, exhibición y clasificación de las herramientas existentes.
- Rutas de taxonomía señaladas para revisión.
- Nombres coincidentes con todos los 1,499 padres del destino, incluidos no gestionados.
- Registros con la descripción de la base sin talla y miembros adicionales con
  el mismo delimitador T., incluso si no se pudo interpretar su sufijo.
- Retenciones manuales previas fijadas por código y descripción. CAWRNIÑO3587
  mantiene sus cuatro códigos pendientes; no se inventó respuesta de los dueños.

Se priorizan 68 propuestas / 405 variantes. Condicionadas a confirmación humana
y aceptación del plan vigente del destino, llevarían a 8,114 / 16,224 = 50.012%.
Los 67 expedientes mayores de este conjunto sólo reúnen 401 variantes: 68 es el
mínimo por cantidad de expedientes dentro de este conjunto, manteniendo familias
completas. No significa que la agrupación esté aprobada ni que el importador
aceptará los nombres comerciales que propongan los dueños.

Partición exclusiva completa: 7,709 cargadas verificadas, 405 en revisión
prioritaria, 561 en otras propuestas sin observaciones adicionales, 356 en
propuestas T. con observaciones, 4,615 sin separar y 2,578 en revisión Woo.
Cada código aparece una sola vez. Todas las plantillas permanecen `pending`,
sin revisor, fecha ni motivo. El planificador SICAR existente las rechaza;
ninguna salida de este bloque contiene una carga aprobada o SQL de escritura.

## Evidencia reproducible

Directorio local `outputs/m9-meta-50-2026-10-06/`:

- `config.json`: rutas y SHA-256 de filas actuales, referencia aplicada,
  staging, taxonomía, manifiesto y consultas previas; también fija Woo y decisiones
  para repetir el preflight original.
- `corrida-4` / `corrida-5`: 12 archivos idénticos, versiones definitivas.
  Corridas 1–3 conservan versiones intermedias anteriores al certificado de mínimo.
- `revision.html`: 68 preguntas numeradas, códigos/tallas/precios desplegables;
  `consulta.txt`: texto de acompañamiento para enviar junto al documento.
- `solo-sicar.json`, `familias-completas.json`, `particion.json`,
  `revision-prioritaria.json`, `plantillas-pendientes.json`: evidencia y propuestas,
  todas sin aprobación de importación/envío.
- `preflight-1.json` / `preflight-2.json`: idénticos, 22 candidatas reservadas
  en siete padres, cero preparadas y cero candidatas nuevas por alcance de sección.
  No se modificaron buildBatch, buildPayload ni las compuertas de base de datos.
- `expedientes-1` / `expedientes-2`: 240 archivos idénticos; todos los 8,515
  pendientes en 5,773 expedientes. Los primeros 20 reúnen 612 filas. La entrada
  usa la referencia aplicada explícita: históricas ya cargadas y filas pendientes
  del último Woo; no se presenta como una nueva conciliación canónica.
- `staging.json` / `staging-final.json`: lecturas remotas nuevas, idénticas en
  catálogo, UUIDs, nombres de todos los padres y contadores de inventario.
- `verificacion.json`, `verificar.mjs`, `sha256-ejecucion.json`: comprobaciones
  y huellas de 551 archivos. SICAR6, Woo JSON y CSV coinciden con sus hashes fijados.

Repetir desde el repositorio:

```text
node scripts/m9/prepare-coverage-review.mjs CONFIG.json DIRECTORIO_NUEVO
```

Las respuestas deben identificar cada expediente, confirmar o corregir la
agrupación y las tallas, e indicar el nombre comercial. No se interpreta silencio
ni confirmación general como aprobación. Después se contrastan respuestas con
las fuentes, se preparan decisiones reales mediante `plan-sicar-only.mjs` y se
ejecuta un nuevo plan, ensayo rollback, carga y auditoría sólo en staging.
Un corte nuevo obliga a recalcular las propuestas y contrastar sus huellas.

## Verificación y límites

450 pruebas unitarias / 63 archivos y lint dirigido aprobados; 12 pruebas nuevas
de umbral estricto, partición, mínimo por familias completas, retenciones previas,
alcance literal, taxonomía, nombres, evidencia, inventario, protección del destino,
plantillas pendientes, HTML escapado y reproducción. La verificación ejecutada
no sustituyó revisión visual: no se abrió el HTML bloqueado anteriormente por
otro origen, no se creó un servidor para sortearlo ni se afirma prueba de UI.

Sin DDL, escrituras de base, permisos, colas, fotos, despliegue, merge o cambios
de producción. Los seis bindings de categorías invalidados del bloque anterior
siguen pendientes; este bloque no los reactivó ni amplió los 1,240 IDs públicos.
Aplicación permanece 0.74.0. Cero saldos y cero movimientos.

Sol6.1 es suficiente para estas revisiones. Recomendar Astra al abordar pedidos,
devoluciones, inventario central o auditoría final de operación. El siguiente
avance real de cobertura depende de resolver identidades; no declarar 50% por
contabilizar expedientes preparados como variantes ya cargadas.
