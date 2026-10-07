# Revisión agrupada de todo el catálogo pendiente

Este bloque cubre la preparación de revisión de las **8,558 filas pendientes**.
No carga nuevas variantes: la cobertura permanece **7,666 / 16,224 (47.3%)**.
Ese porcentaje mide catálogo, no terminación global de la migración.

## Resultado reproducible

`outputs/m9-revision-total-2026-10-06/corrida-4` y `corrida-5` contienen las
versiones definitivas, idénticas en 241 archivos. Las corridas 1–3 conservan
versiones intermedias. La configuración fija hashes de filas SICAR6, snapshot
verificado de 7,666 variantes, Woo autenticado histórico y exclusiones del
preparador anterior. No hubo lectura remota nueva en este bloque.

- 5,937 filas sólo SICAR: 400 propuestas con delimitador literal T. que reúnen
  1,322 filas, y 4,615 registros sin separar modelo y atributos.
- 2,621 filas restantes: 549 expedientes con candidatos Woo relacionados y
  217 expedientes sin candidato disponible. Los 549 reúnen 710 IDs Woo.
- Total: 5,781 expedientes; los primeros 20 por cantidad reúnen 626 filas.
- Las 8,558 filas aparecen exactamente una vez. Ningún expediente concede
  permiso de carga, agrupación comercial, publicación o envío.

Los grupos Woo son componentes de candidatos compartidos, incluso por relación
transitiva. **No son familias aprobadas**: pueden contener modelos diferentes.
No se resuelven por nombre, similitud, precio, estado publicado ni departamento.
Para SICAR se reutilizan `prepareSicarOnly` y `reviewSicarFamilies`; no se
inventan reglas para separar números finales. Las propuestas T. conservan
límites de clasificación y relaciones entre propuestas de la misma base.

`reviewBacklog` reutiliza `auditStagedCatalog` y exige que la captura gestionada
coincida exactamente con su origen y fila guardada. Rechaza proyecto incorrecto,
inventario, códigos repetidos o alterados, candidatos Woo desconocidos,
exclusiones desconocidas/duplicadas o con descripción distinta y cortes Woo
incompletos. Las entradas se verifican antes de crear una salida nueva.

## Archivos para trabajar

- `revision.html`: búsqueda y paginación de todo el pendiente; muestra datos
  SICAR, candidatos Woo, estado histórico, atributos/variaciones y motivos.
- `primeros-20.json` y `prioridades-para-consulta.txt`: expedientes de mayor
  alcance para revisar con sus tablas completas. No equivalen a 20 productos.
- `trabajo-por-expediente.json`: tareas concretas de identidad, clasificación,
  precio, atributos, exhibición o renovación de estados Woo.
- `bloque-001.json` a `bloque-232.json`: paquetes de hasta 25 expedientes.
- `expedientes.json`, `resumen.json`, `resumen.txt`, `sha256.json`: evidencia
  completa y huellas reproducibles.
- `respuestas-pendientes.json`: plantilla sin respuestas ni aprobaciones.

El reporte conserva códigos de barras literales, precio1, departamento y sección.
No incluye existencias ni costos inventados. Los campos editoriales se muestran
como texto; el JSON embebido escapa `<`. Sólo se aceptan enlaces de producto
HTTPS del dominio original cuando están presentes en la fuente. El CSV actual
no contiene permalink: no se fabricaron enlaces públicos ni se hicieron nuevas
consultas de IDs o categorías.

La apertura de `file:` fue rechazada por la política de URLs del navegador.
No se intentó sortear el bloqueo. Se comprobó estáticamente la sintaxis del
script generado; **no se afirma verificación visual** de este reporte.

## Registrar respuestas sin autorizar cargas

`collect-review-answers.mjs` comprueba la huella del archivo, del paquete completo
y del expediente. Acepta una lista de respuestas concretas con `case_id`,
`packet_sha256`, `evidence_sha256`, `reviewer` y `answer`. No acepta campos de
aprobación, códigos desconocidos, expedientes repetidos, respuestas vacías ni
evidencia modificada. Un corte nuevo cambia la huella y requiere contrastar
nuevamente las respuestas. Las plantillas vacías no se pueden registrar.

El resultado siempre queda `ANSWER_RECORDED_REQUIRES_TECHNICAL_REVIEW`, con
`import_allowed=false` y `send_allowed=false`. No cambia SICAR, no corrige Woo,
no produce SQL ni payload importable. Para familias sólo SICAR continúa siendo
necesario el proceso explícito de decisiones humanas de `plan-sicar-only.mjs`;
esta herramienta no lo sustituye. CAWRNIÑO3587 sigue pendiente.

Desde el repositorio:

```text
node scripts/m9/prepare-review-backlog.mjs CONFIG.json NUEVA_SALIDA
node scripts/m9/collect-review-answers.mjs EXPEDIENTES.json RESPUESTAS.json NUEVA_SALIDA
```

## Verificación y límites

415 pruebas unitarias / 59 archivos aprobados y lint dirigido aprobado. Diez
pruebas nuevas cubren partición, relaciones transitivas, límites de
clasificación, exclusión de filas cargadas, identidad literal, destinos
alterados, inventario, evidencia vencida por cambio de fuente, registro de
testimonio, seguridad del HTML, tareas y reproducción de archivos/huellas.

Sin cambios de base, Woo, producción, existencias, permisos, colas, frontend,
despliegue ni merge. No incrementó el catálogo. Siguiente: contrastar los
expedientes prioritarios y las respuestas recibidas, renovar exportaciones
operativas y preparar exclusivamente cargas que superen las guardas existentes.
No habilitar compra de amartigones ni crear códigos para opciones sólo Woo.
Sol6.1 es suficiente para esta preparación; Astra para diseño/auditoría de
pedidos, devoluciones, inventario central y revisión final operativa.
