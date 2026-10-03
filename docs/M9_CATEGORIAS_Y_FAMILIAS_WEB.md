# M9 — Categorías Woo y familias completas

Herramienta `m9-web-family-review-1`, sólo lectura. La app Preview sigue en **0.56.0**: esta entrega no modifica la interfaz, la base staging ni WooCommerce. No es una aprobación ni un payload de importación.

## Evidencia y resultado del 1 de octubre de 2026

Se contrastaron las 40 familias del piloto con la exportación autenticada Woo vigente (incluye borradores y privados, excluye papelera), las 16,130 filas del reporte SICAR y una captura pública adicional de taxonomía/pertenencia. La captura pública guarda fecha UTC, URLs, respuestas, estado HTTP, paginación y SHA-256; no sustituye la exportación autenticada de variantes.

- 159 categorías Woo obtenidas en 2 páginas con `hide_empty=false`.
- 40/40 familias: ruta completa del CSV e IDs de categorías coinciden con la pertenencia pública actual.
- 378 miembros Woo: 40 del piloto y **338 fuera del piloto que se conservan**.
- 287 vínculos canónicos exactos sin revisión comercial pendiente; 91 pendientes: 57 sin vínculo confirmado y 34 con revisión canónica/comercial.
- 31 familias requieren revisión: 29 contienen miembros Woo pendientes y 11 contienen candidatos SICAR pendientes; ambos conjuntos se solapan. Son 16 filas SICAR candidatas en esas 11 familias.
- Las otras 9 familias superan este diagnóstico de identidad/categorías. **Todavía requieren revisión editorial y aprobación**; no se habilita envío.

La ruta `Bota` no equivale a `Caballero > Bota`. No se hace coincidencia difusa, por nombre de producto, por hoja de categoría ni por similitud de códigos. Una ruta duplicada, incompleta, con escape ambiguo o cuya pertenencia cambió queda manual. Se detectan ciclos/padres de categoría ausentes e IDs Woo globales repetidos.

Cada miembro conserva ID, estado, atributos, precios/promociones de origen y filas SICAR vinculadas con Clave 1 exacta, departamento/sección y motivos de revisión. No se genera costo, mayoreo, código, existencia, nueva agrupación ni baja. Los candidatos ambiguos no se convierten en vínculos. Un departamento distinto por talla no divide automáticamente un padre.

## Repetir el procedimiento

Desde `work/m9-ui`, con Node disponible. Usar **carpetas de salida nuevas** en cada ejecución; no se sobrescriben capturas. Primero regenerar el reporte canónico y el paquete editorial cuando cambien las exportaciones SICAR/Woo.

```sh
node scripts/m9/capture-web-taxonomy.mjs \
  ../../outputs/m9-contenido-web-2026-10-01/contenido.json \
  ../../outputs/NUEVA_CAPTURA_TAXONOMIA

node scripts/m9/review-web-families.mjs \
  ../../outputs/m9-contenido-web-2026-10-01 \
  ../../outputs/m9-fuentes-2026-10-01/woo-authenticated.json \
  ../../outputs/m9-reporte-actualizado-2026-10-01 \
  ../../outputs/NUEVA_CAPTURA_TAXONOMIA \
  ../../outputs/NUEVO_REPORTE_FAMILIAS
```

Capturador: exclusivamente GET público al host fijo vaquerosm.com, sin autenticación, cookies, redirecciones ni endpoints de escritura. Si la captura falla, no genera manifiesto completo: repetir en otra carpeta. API utilizada: [WooCommerce Store API Product Categories](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/product-categories/).

Analizador: completamente offline; comprueba hashes de filas, manifiesto, contenido y taxonomía, además de correspondencia entre fuentes. No consulta base de datos ni genera SQL. Guarda `familias.json`, `resumen.md` y `sha256.json`. La misma entrada debe producir los mismos bytes. Los SHA identifican evidencia local; no son firmas del proveedor.

Evidencia local vigente en la raíz de la tarea:

- `outputs/m9-taxonomia-publica-2026-10-01/` — captura pública de categorías y 40 padres.
- `outputs/m9-familias-web-2026-10-01-v2/` — reporte vigente, etiquetas legibles en español.
- `outputs/m9-familias-web-2026-10-01-v2-repeticion/` — reproducción idéntica.

## Validación y límites

87 pruebas unitarias aprobadas, incluidas 10 nuevas: preservación de ceros iniciales/variantes privadas, pertenencia cambiada, producto no público, rutas duplicadas/escapadas, ciclos y padres ausentes, colisiones de IDs/barcodes, retenciones comerciales y candidatos ambiguos, piloto desactualizado y hash alterado. Lint y formato de archivos nuevos aprobados. Dos corridas reales byte a byte iguales. No se ejecutaron migraciones ni pruebas que escriban en staging.

Las categorías verificadas son las existentes en la exportación y captura, **no** una aprobación automática de las categorías propuestas en fichas humanas. Las capturas tienen momentos distintos y no constituyen una transacción remota; antes de un envío futuro se debe actualizar evidencia y detectar cambios de revisión. La API pública no acredita categorías de publicaciones privadas; una ausencia pública se conserva en revisión.

Esta revisión abarca los 40 padres del piloto, no todas las familias del catálogo. Los 338 miembros externos al piloto siguen fuera del catálogo staging: el reporte no los importa. Sigue pendiente resolver los 91 miembros y 16 candidatos, revisión editorial, aplicar correspondencias aprobadas en staging, aprobación/outbox/worker en Woo de pruebas y lector físico. Nunca reemplazar una familia remota con las variantes del piloto.


### Desglose de pendientes por causa — 2026-10-01

Añadido scripts/m9/triage-web-families.mjs, m9-web-family-triage-1. De los 91 miembros pendientes, 33 sólo tienen observaciones de existencias, 1 diferencia de precio y 57 carecen de vínculo confirmado. No se reclasifica el reporte canónico ni se aprueba importar los 33. De las 16 filas candidatas: 8 muestras conservan la regla de exhibición, 6 tienen prefijos solapados, 1 talla no equivalente automáticamente y 1 existencia inválida con identidad aún sin confirmar. Los candidatos pueden solaparse con miembros Woo sin vínculo; no sumar como productos distintos.

Preguntas concentradas: cinto cocodrilo negro talla 42 (SICAR 10520, público 2690 frente a Woo regular 2390 sin rebaja capturada); Nicol Minnick bicolor/natural (23965/23966, seis códigos SICAR con base SOMNICOLMINIKBIC); camisa Rodeo West lisa negra (17787, XXL frente a 2XL). Estas hipótesis no son decisiones. Las 57 variantes permanecen en lista detallada para obtener código SICAR exacto o decisión de conservar sin vínculo. No aplicar equivalencia XXL/2XL a todo el catálogo.

Evidencia: outputs/m9-pendientes-familias-2026-10-01/{revision.md,pendientes.json,sha256.json}. 91 pruebas unitarias aprobadas, lint y dos ejecuciones idénticas verificadas. Fuentes conservadas y huellas comprobadas. Ninguna escritura en Woo, producción, staging ni inventario; Preview sigue 0.56.0.

Reproducir desde work/m9-ui:

```sh
node scripts/m9/triage-web-families.mjs ../../outputs/m9-familias-web-2026-10-01-v2 ../../outputs/m9-fuentes-2026-10-01/woo-authenticated.json docs/M9_DECISIONES_NEGOCIO.json ../../outputs/NUEVOS_PENDIENTES
```


### Lote candidato de revisión editorial — 2026-10-02

Implementado prepare-candidate-review.mjs (m9-candidate-review-1), offline con fuentes verificadas por SHA-256. Selecciona sólo familias completas sin conflictos del diagnóstico y valida cada precio SICAR contra el regular Woo sin igualar precios entre tallas. Resultado: 9 familias, 50 miembros (9 del piloto inicial, 41 aún fuera de staging). Cero cambios remotos propuestos: productos ya existentes, conservar IDs, categorías, imágenes, códigos y precios. No confundir baseline exportado con comparación de las fichas humanas staging ni con estado Woo actual.

Revisión legible local: outputs/m9-lote-candidato-2026-10-02/revision.html; detalle lote.json y sha256.json. HTML de origen escapado y CSP sin scripts/red. Una familia con formato HTML requiere revisión editorial: Woo 24939 Bota Nokota Lincoln; el título dice BLANCK CHERRY y el cuerpo BLACK CHERRY, contiene marcado de hoja de cálculo y una comilla final. No se corrigió automáticamente. Las otras ocho también necesitan revisión visual/editorial, no están aprobadas para publicar.

95 pruebas unitarias aprobadas, lint limpio, reproducción byte a byte idéntica. No se escribió staging, Woo, producción ni inventario. Preview permanece 0.56.0; esta entrega es herramienta local. Próximo paso: revisar contenido completo y comparar borradores humanos con este baseline antes de preparar prueba de envío; falta entorno Woo de pruebas y prueba de reintentos. Las tres dudas previas y 57 variantes sin vínculo siguen pendientes.

Reproducir desde work/m9-ui:

```sh
node scripts/m9/prepare-candidate-review.mjs ../../outputs/m9-familias-web-2026-10-01-v2 ../../outputs/m9-fuentes-2026-10-01/woo-authenticated.json ../../outputs/NUEVO_LOTE_CANDIDATO
```


### Revisión editorial de páginas Woo — 2026-10-02

Consultadas nueve páginas del lote en navegador, sin mutaciones. Inspección de texto/precio visible/portada y miniaturas; no todas las fotografías ampliadas ni propiedades físicas. Preparadas tres propuestas locales con antes/después y huella fuente: espacio AMARILLO EN (5630), ASA y espacio INTERNO. EL (19771), BLACK CHERRY y limpieza del HTML de hoja de cálculo/comilla final (24939). Sin aplicación ni aprobación. Dos comprobaciones comerciales: toquilla de piedra roja descrita en texana 13560, no distinguible en portada; colores distintos de amartigón 37102 bajo código único, sin inferir separación o selección.

Evidencia y generación repetible: outputs/m9-revision-editorial-2026-10-02/{revision.md,revision.json,sha256.json,generar.py}. Segunda generación idéntica; fuente lote intacta. No se modificó código de aplicación, staging, Woo o inventario: Preview 0.56.0. No se compararon borradores humanos staging ni se aprobó galería completa/materiales. Las comprobaciones comerciales y prueba Woo aislada siguen pendientes; no presentar revisión parcial como permiso de publicación.


### Galerías completas y lectura staging — 2026-10-02

Consulta Supabase en transacción READ ONLY al proyecto staging zsezjtswqeijboezvado. No se actualizó ninguna tabla ni se guardaron borradores.

- 9/9 snapshots coinciden estructuralmente con el paquete de contenido original; SHA-256 fuente correcto.
- 9/9 códigos base y listas ordenadas de imágenes coinciden.
- No hay borradores humanos guardados en estas 9 fichas; no significa que no existan borradores en otras familias.
- Las categorías verificadas por ID del reporte todavía no están incorporadas en staging: category_ids sigue NULL y los campos editoriales contienen propuestas textuales. No usar esos textos como IDs.
- 40 imágenes revisadas en navegador, mostradas completas a 340 px de alto (incluye detalles e interiores, no sólo portadas). Todas se visualizaron. Esto no prueba composición, autenticidad, medidas o correspondencia con mercancía física.

La texana presenta una cinta del mismo color y adorno lateral pequeño; no se distingue la piedra roja que menciona la descripción. Confirmación comercial pendiente. El amartigón muestra dos juegos de color/diseño (café/negro y negro con figura clara), bajo una sola ficha sin selector. No separar códigos ni declarar venta surtida sin confirmación.

Las otras siete galerías no muestran una mezcla evidente de modelos en esta inspección. Siguen pendientes aprobación comercial y las tres propuestas de texto locales. No se han aprobado envíos, importado las 41 variantes fuera del piloto ni activado sincronización Woo.

Siguiente implementación: incorporar correspondencias verificadas de categorías en la preparación staging, preservando snapshots y controlando revisiones; mantener las dos fichas comerciales dudosas fuera del primer ensayo de envío. Se requiere Woo de pruebas para validar creación/actualización/reintento sin duplicados. Las siete restantes son candidatas técnicas, no publicaciones autorizadas.

Evidencia: lectura.json (consulta restringida al lote), comparacion.json y galerias/*.html. Las galerías referencian las imágenes públicas remotas, no son copias permanentes de los archivos. Preview sigue en 0.56.0, sin despliegue ni cambio de código funcional.



### Preparación de categorías y preflight alojado — 2026-10-02

7 familias: 5630, 5738, 8059, 13440, 19771, 24939 y 25814. Texana 13560 y amartigón 37102 excluidos por dudas comerciales.

La preparación conserva cada ID Woo con su ruta completa; por ejemplo, Bota y Caballero > Bota siguen separados. Departamento/sección SICAR no se sustituye por esa clasificación web. Los textos de categorías propuestos se separan en elementos individuales, sin modificar la evidencia original.

Comprobación READ ONLY en staging: 7/7 fuentes y contenidos sugeridos intactos, ausencia de borradores humanos y validación de contenido correcta. 98 pruebas unitarias y lint aprobados; dos generaciones idénticas.

Límite: el modelo actual del editor sólo admite categorías de texto. La correspondencia numérica está en categorias.json; NO está persistida como vínculo verificado en staging. No se guardaron sugerencias, no se actualizaron snapshots ni se habilitaron envíos. Tampoco se aplicaron las tres correcciones editoriales pendientes.

Siguiente implementación: persistencia separada de categorías por ID y su huella fuente, con invalidación al editar categorías y control de revisiones, seguida de pruebas en staging. No introducir IDs en el campo de texto ni tratar la propuesta como aprobación comercial. La app continúa en 0.56.0; herramienta m9-verified-categories-preparation-1.


Reproducir: `node scripts/m9/prepare-verified-categories.mjs LOT_DIR FAMILY_REPORT_DIR STAGING_READ_DIR NEW_OUT`. Evidencia vigente: outputs/m9-categorias-preparadas-2026-10-02-v2. El primer preflight devolvía sólo la última consulta en el conector; v2 reúne los siete resultados con UNION ALL, todos comprobados.


### Persistencia de categorías verificada en staging — 2026-10-02

Completada m9-category-persistence-1: 7 correspondencias Woo por ID/ruta guardadas en app.web_category_bindings, RLS cerrado sin API pública. Categorías sugeridas separadas por ruta; snapshots intactos. Triggers invalidan cambios de categoría/fuente/vínculo; restaurar texto no reactiva. Segunda carga 7 UNCHANGED. 19 verificaciones SQL con rollback, 101 unitarias, lint y reproducción idéntica. Huellas de catálogo/snapshots/borradores conservadas, cero inventario/movimientos. Texana y amartigón excluidos.

Detalle: [M9_CATEGORIAS_PERSISTENCIA.md](M9_CATEGORIAS_PERSISTENCIA.md). Evidencia outputs/m9-categorias-persistencia-2026-10-02. Migración local 20261003000213, registrada en staging 20261003000437. Sin Woo/producción; sólo infraestructura interna. Preview permanece 0.56.0, todavía sin indicador/IDs en UI: falta lectura autorizada y señalización de estado antes de la prueba Woo aislada. No presentar esta carga como publicación ni aprobación comercial.
