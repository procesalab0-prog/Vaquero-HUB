# M9 — revisión técnica integral, 2026-10-06

Se cerraron seis revisiones de categorías invalidadas por la renovación de
galerías. Staging vuelve a **1,238 bindings válidos / cero invalidados**.
No se modificaron las categorías, fuentes, borradores, productos ni variantes.
La cobertura sigue en **7,709 / 16,224 = 47.516% del catálogo SICAR**; quedan
8,515 filas pendientes. Esta cifra no mide el avance global de la integración.

## Revisión protegida de categorías

Migración local `20261007012536_m9_gallery_category_rereview.sql`, aplicada
exclusivamente al proyecto `zsezjtswqeijboezvado`; registro remoto de migración
`20261007012747`. Se conserva el nombre local generado por CLI, sin reescribir
historia. No se aplicó a producción ni se desplegó frontend.

`app.review_gallery_category_binding` es SECURITY INVOKER con search_path
vacío, restringida a postgres y sin ejecución para PUBLIC, anon,
authenticated o service_role. Exige evidencia completa previa y actual,
captura de categorías de menos de 24 horas, vínculos Woo exactos, catálogo y
borrador sin cambios. Sólo admite el cambio de `snapshot.image_urls`; cualquier
otro cambio de fuente, pertenencia de categorías, categorías de borrador o
expectativa obsoleta bloquea la revisión. Conserva mappings y category_paths.
No concede aprobación comercial ni autorización de envío.

Se contrastaron los seis casos con la captura pública ya autorizada de 1,240
IDs, sin ampliar consultas. El ensayo transaccional previo pasó **27 controles**
de rechazo, conservación, permisos e idempotencia y terminó en rollback.
Aplicación: seis verificaciones y seis entradas de auditoría. Repetición conjunta:
seis UNCHANGED, sin duplicar auditoría. Los procedimientos genéricos siguen
rechazando la reactivación automática. El ensayo guardado incluye CREATE FUNCTION
y corresponde al estado previo: no volver a ejecutarlo tal cual con la función
ya instalada ni reutilizar evidencia vencida.

## Revisor reproducible de diferencias editoriales

`review-editorial-delta.mjs` explica diferencias sin reescribir evidencia literal
ni autorizar importación, refresh, eliminación o envío. De los 44 padres:

- 23 diferencias de categorías mantienen exactamente la misma pertenencia;
  cambió el orden o la representación textual. Se verifican rutas e IDs con el
  parser conservador existente, no separando ingenuamente por comas.
- Un cambio de categorías sigue reservado: Woo 21289 está fuera de los 1,240
  IDs autorizados y no se consultó. No se deduce su pertenencia.
- 27 diferencias de precios de variantes conservan precio público SICAR;
  los precios Woo observados no sustituyen precio1 ni aprueban promociones.
- Seis referencias de fotos de variantes corresponden a cinco archivos únicos.
  Se descargaron por GET, con límite de tamaño, MIME, firma y SHA256 verificados.
  Permanecen como evidencia local: **no se aplicaron a variantes o galerías**.

Los estados literales de revisión anterior siguen siete fuentes ya actualizadas,
33 con diferencias y cuatro sin ficha. La explicación semántica no equivale a
33 actualizaciones aplicadas. Cinco unidades nuevas; suite **455 pruebas / 64
archivos** aprobada y lint dirigido aprobado.

## Conexión y fotos en Woo de pruebas

Sólo GET al Woo temporal `salmon-nightingale-251188.hostingersite.com`:
tres recibos previos SUCCEEDED, vínculos de productos y variaciones conservados,
un recibo previo de actualización de galería y tres galerías completas. Aislamiento
de correo, salidas, compras y pedidos comprobado; cero pasarelas; acceso anónimo
al endpoint protegido devuelve 401. No se crearon productos ni se enviaron
trabajos nuevos en esta verificación.

Comparación de nueve fotos entre Mi Tienda y Woo de pruebas: bytes, orden,
alt y checkpoint coinciden. Ocho referencias son copias guardadas en Storage
de staging; una del producto sintético sigue siendo una referencia pública
Woo. Se acepta únicamente su URL exacta observada, no cualquier origen externo.
No afirmar que las nueve imágenes están almacenadas en Mi Tienda.

## Renovación de fuentes y conservación

Se reprodujo el conciliador completo sobre SICAR (6) y el Woo recibido el
6 de octubre. No es una descarga nueva ni prueba de vigencia hasta el corte
operativo. Las diez salidas coinciden con el corte canónico. Dos corridas
definitivas de renovación producen **23 archivos idénticos**, incluyendo
auditorías, deltas, configuración y comparación de exports Woo.

Mismo corte contra sí mismo: 16,224 UNCHANGED / cero cambios. Referencia aplicada
histórica contra último Woo: 16,045 UNCHANGED / 179 cambios sólo de metadatos de
conciliación. No confundir éstos con las cinco reservas de publicación de la
auditoría: aplicada 7,709 exactas / cero diferencias; último Woo 7,704 exactas /
cinco reservas (Woo 33002 ahora draft; códigos 1132, 1133, 1134, 16566, 2521).

La comparación repetida entre exports Woo conserva 1,964 padres sin cambios,
111 diferencias de inventario excluidas y 44 cambios de fuente retenidos. Relaciona
40 padres staging / 238 códigos; no significa 238 variantes nuevas desactualizadas.
Cero movimientos de identidad, refreshes o eliminaciones aprobados.

Verificación final: las 7,709 filas mantienen UUID/current/stored exactos frente
al cierre previo; fuentes, borradores y bindings ajenos a los seis casos mantienen
sus huellas. Colas remotas 3 / galerías 1 con registros completos sin cambios;
cola local 9 por conteo. Cero saldos y movimientos de inventario. Cero escrituras
Woo o producción. Única escritura de negocio: seis verificaciones técnicas y
su auditoría en staging, además del DDL privado descrito arriba.

## Evidencia y siguiente paso

Raíz `outputs/m9-revision-tecnica-integral-2026-10-06/` del workspace principal:
`verificacion.json`, `verificar-cierre.py`, `cierre-datos.json`,
`categorias-antes.json`, `ensayo.json`, `repeticion-completa.json`,
`conexion-fotos-verificadas.json`, `galerias-dos-lados-verificadas.json`,
`editorial-1.json` / `editorial-2.json`, `corrida-1` / `corrida-2` y
`renovacion-3` / `renovacion-4` definitivas. Renovaciones 1/2 son intermedias:
su manifiesto raíz no incluía el prefijo conciliacion/; corregido en 3/4.
`sha256-ejecucion.json` cubre los archivos finales salvo sí mismo.

Pendiente: categorías de fichas nuevas, la categoría fuera del alcance público,
aplicación protegida de fotos por variante y cambios editoriales no equivalentes,
confirmación real de familias SICAR_ONLY (incluida CAWRNIÑO3587) y lote preparado
de 68 propuestas / 405 variantes. No convertir las propuestas en aprobaciones.
Pedidos, devoluciones e inventario central siguen como fase operativa separada.
Sol es suficiente para este bloque; revisar con Astra esa fase y el corte final.
Versión frontend permanece 0.74.0; sin despliegue, push ni merge.
