# WooCommerce local y primer conector — 2 de octubre de 2026

Herramienta `m9-woo-local-worker-1`. Por autorización del usuario se creó una instalación nueva de WooCommerce, aislada en su equipo. No es una copia completa de vaquerosm.com: no incluye clientes, pedidos, credenciales, tema ni plugins propios de producción. Mi Tienda SM Preview continúa en **0.56.0**; no se desplegó otra versión ni se conectó todavía el botón de la ficha web.

## Resultado comprobado

WordPress **7.0.6**, WooCommerce **11.1.2**, PHP **8.3.33** mediante WordPress Playground **3.1.56**, SQLite persistente. Escucha comprobada exclusivamente en **127.0.0.1:9417**, no en la red local. Vista de revisión: http://127.0.0.1:9417/m9-laboratorio/.

Ensayo por HTTP contra la API real, con datos ficticios:

- Padre local 11, borrador variable, hijos locales 12/13. Descripciones, categoría, imagen de ensayo ya adjunta, atributos y precios.
- Talla M: código de ensayo `000007779` preservado como cadena; SKU de ensayo separado; precio inicial 820.00, actualizado a 825.00. Talla XL: 890.50, sin cambios.
- Actualización de nombre/texto y sólo la variante seleccionada. La respuesta completa del hijo omitido es idéntica antes/después.
- Repetir alta y actualización: **cero solicitudes nuevas**. IDs conservados en diario persistente.
- Reinicio real del proceso: misma ficha/variantes, código exacto, campos de existencias sin cambios y repetición sin solicitudes.
- Diagnóstico autenticado: correo bloqueado, conexiones HTTP salientes bloqueadas, cero pasarelas disponibles, cron desactivado, entrega de webhooks desactivada y cero pedidos.
- 122 pruebas unitarias del repositorio aprobadas, incluidas 21 del nuevo conector. Lint y formato de archivos nuevos aprobados. No se atribuye a estos cambios el resultado histórico de CI del PR.

El código numérico de ensayo no se cargó en Supabase ni constituye una nueva asignación de Clave 1. Las imágenes del ensayo son un pequeño PNG sintético, no fotografías comerciales verificadas. La vista del laboratorio lee WooCommerce real, pero es una página auxiliar del laboratorio, no el tema de la tienda ni la interfaz de Mi Tienda SM.

Evidencia vigente: `outputs/m9-woo-local-2026-10-02-v6/verification.json`, `restart-verification.json`, entradas/respuestas y `laboratorio.jpg`, en el directorio de esta tarea. Los intentos v1–v5 permanecen como diagnóstico histórico; no describen el resultado final.

## Implementación

`scripts/m9/woo-test/plan.mjs` compila sólo campos admitidos. Distingue SKU, código base y código de barras; no usa el código SICAR como SKU ni GTIN. Exige destino local explícito, correspondencias de categorías y adjuntos del sitio de pruebas, identidad única por variante y precios positivos en centavos. Convierte texto plano a HTML escapado. Rechaza inventario, promociones, borrados y campos desconocidos. Las altas son borradores; las actualizaciones exigen un borrador existente con identidad exacta y snapshots previos. No modifica tipo, atributos ni SKU al actualizar. Omite imágenes/categorías que no cambiaron; evita alterar fechas de adjuntos compartidos al editar únicamente un título.

`worker.mjs` conserva estado en un diario local por tienda/producto, con bloqueo exclusivo, escritura temporal, fsync y renombrado. Vincula revisión y huella del plan; reutilizar revisión con otro contenido falla. No permite otra alta del producto con nueva revisión. Confirma por GET el ID y los campos enviados. Los errores remotos no se guardan completos, evitando copiar mensajes arbitrarios o secretos.

Estados: PENDING → DISPATCHING → SUCCEEDED, o REVIEW_REQUIRED. Una lectura fallida permite reintento. Una escritura con resultado incierto —timeout, HTTP de error, respuesta inválida o interrupción— no se repite automáticamente. `reconcileKnownResult` sólo lee un ID expresamente identificado, exige marca de operación y contenido exactos y registra la recuperación. No adivina el ID ni convierte una ausencia en permiso para otro POST. Un lock abandonado exige inspección; no se vence automáticamente.

Playground puede responder a la primera consulta tras arrancar con una redirección a la misma ruta. Sólo GET admite una repetición a la URL original exacta. Nunca se siguen redirecciones externas ni se repite POST/PUT por una redirección.

La primera alta del laboratorio inicial detectó un salto de línea final agregado por Woo al HTML. Se corrigió exclusivamente esa comparación, se verificó el padre por GET y se continuó sin recrearlo. La segunda instalación limpia confirmó creación/actualización completas. Los timeouts, pérdida de respuesta y concurrencia se inyectan en pruebas unitarias; no afirmar que se cortó físicamente Internet durante la prueba real.

## Aislamiento y archivos locales

Instalación activa:

`work/m9-woo-runtime-verified/wordpress/`

Datos privados, contraseña de aplicación sólo local y diario:

`work/m9-woo-runtime-verified/private/`

Directorios privados con modo 0700 y archivos de credenciales/diario 0600. No añadirlos al repositorio ni a reportes. No se reutilizaron credenciales productivas. Las dependencias están fuera de `work/m9-ui/node_modules`; el runtime verificado reutiliza las instaladas en `work/m9-woo-runtime/node_modules`. Ambos directorios deben conservarse para volver a arrancar este laboratorio. El laboratorio inicial/fallido permanece separado como evidencia, no está en ejecución.

`local-guard.php` se instala sólo como mu-plugin de esta instalación. Bloquea correo, HTTP saliente, compras, pasarelas, entregas de webhooks y mutaciones REST de pedidos/clientes. Su endpoint de diagnóstico requiere permiso `manage_woocommerce`. La página de revisión sólo muestra borradores de prueba en loopback. Nunca instalar este guard en producción.

## Reproducción

Desde `work/m9-ui`, con Node y pnpm disponibles en PATH:

```sh
# Sólo para crear OTRO laboratorio vacío; nunca instalar en node_modules de la app.
mkdir ../NUEVO_RUNTIME
cp scripts/m9/woo-test/runtime.package.json ../NUEVO_RUNTIME/package.json
pnpm --dir ../NUEVO_RUNTIME install --ignore-scripts
node --experimental-wasm-jspi scripts/m9/woo-test/start-local.mjs ../NUEVO_RUNTIME
```

Se omiten los scripts nativos de dependencias; el runtime WASM probado funciona sin ellos. El arranque descarga versiones fijadas desde fuentes oficiales. Una instalación incompleta no se sobreescribe automáticamente: inspeccionarla y usar otro directorio.

En otra terminal, una vez que aparezca `M9_LOCAL_WOO_READY`:

```sh
node scripts/m9/woo-test/rehearse-local.mjs ../NUEVO_RUNTIME ../../outputs/NUEVA_EVIDENCIA
```

El ensayo completo exige un catálogo local vacío y una carpeta de salida nueva. Para la instalación actual, **sólo arrancar**:

```sh
node --experimental-wasm-jspi scripts/m9/woo-test/start-local.mjs ../m9-woo-runtime-verified
```

No borrar el diario para repetir envíos. No copiar IDs de categorías, adjuntos o productos de producción como si fueran IDs locales. La parada normal es Ctrl+C en la terminal que lo ejecuta; WordPress/SQLite y diario permanecen guardados.

## Límites y próximo paso

Es un conector ejecutable con persistencia local, **no** una outbox distribuida de producción. El ensayo no parte aún del formulario autenticado de Mi Tienda SM. Falta integrar captura → aprobación/revisión vigente → cola privada en staging → worker → IDs/resultados visibles. El worker alojado necesitará permisos mínimos, exclusión transaccional, identidad del sitio comprobada y recuperación operativa; el bloqueo de archivo local no sustituye esa arquitectura.

Las categorías verificadas previamente para vaquerosm.com no se reutilizan como IDs de esta instalación. Las siete familias candidatas siguen sin publicación autorizada; dudas comerciales y las 41 variantes fuera del lote de nueve siguen pendientes. No se aplicaron las correcciones editoriales reales ni se importaron existencias.

La API de Woo no ofrece aquí una transacción común con nuestra base ni un compare-and-swap entre GET y PUT. La comparación previa evita sobrescritura de snapshots ya cambiados, pero no garantiza ausencia de una edición simultánea durante ese intervalo. Antes de usar el flujo real hacen falta entorno representativo de versiones/plugins, pruebas desde la aplicación, controles de concurrencia y revisión comercial. No asumir que SQLite/Playground reproduce todas las condiciones de Hostinger/MySQL.

Referencias oficiales utilizadas: [Playground programático](https://developer.wordpress.org/playground/handbook/guides/programmatic-playground-cli/), [productos Woo REST v3](https://developer.woocommerce.com/docs/apis/rest-api/v3/products/) y [variaciones](https://developer.woocommerce.com/docs/apis/rest-api/v3/product-variations/).


### Ensayo supervisado desde ficha web — 2026-10-02

Versión de aplicación 0.57.0: solicitud autenticada desde la ficha guardada y consulta de estado/ID local. Cola privada de staging con idempotencia, revisión y huella de catálogo; antes de reclamar se revalida el contenido y evidencia de categorías. Una solicitud por producto; sólo creación de borrador simple habilitado expresamente. Cambios previos al procesamiento dejan SUPERSEDED; respuestas inciertas requieren revisión. Los IDs locales viven en la cola, nunca sustituyen los IDs de Woo real.

Puente administrativo supervisado: `scripts/m9/woo-test/staging-bridge.mjs CLAIM_JSON RUNTIME_DIR OUTPUT_DIR`. Se reclama mediante función privada, se ejecuta contra 127.0.0.1:9417 y se registra el recibo después de verificar. No es un trabajador automático permanente ni integración de producción. Fotografías por GET público con límite 4 MB y sin redirecciones; categorías y adjuntos sólo se crean en laboratorio con diario persistente y bloqueo ante incertidumbre. No envía existencias, promociones ni credenciales de producción.

Resultado comprobado: bolsa Cuadra Woo real 19771, código SICAR 10521, solicitud 3648c7e3-5b73-4540-a19c-8474f14387e2 creada desde la UI autenticada, revisión 1, SUCCEEDED; borrador Woo local 18 con cuatro fotografías, descripción/código base y precio público 8695.00. La UI muestra su resultado e ID local y el avatar confirmó 0.57.0. Repetición del trabajo: cero solicitudes de escritura, sin segundo producto. Se mantienen Woo real 19771 y barcode 10521 en staging; inventario y movimientos cero.

Evidencia: outputs/m9-staging-woo-2026-10-02 (claim, diario de adjuntos/categorías, entrada y resultado del worker, recibo, lectura final y capturas). Primera comprobación se detuvo por orden alfabético de categorías devuelto por Woo; se corrigió comparación de pertenencia exacta sin exigir orden, se añadió prueba contra sustitución y se concilió por GET del ID 18, sin repetir POST. Las fotos sí conservan su orden. 15 comprobaciones SQL rollback; 129 unitarias finales. CI #262 pasó migraciones, tipos, lint, integración, build y E2E en 02b1c985; comprobar también el commit final con la corrección de categorías.

Límites: primera cola de UI admite únicamente un alta simple por producto habilitado; futuras ediciones no se reenvían todavía. El puente es administrativo supervisado; el navegador no accede a secretos ni procesa directamente localhost. Los atributos descriptivos del padre (por ejemplo UNITALLA), variantes completas, promociones, plugins/tema de tienda real y recuperación distribuida siguen fuera de este ensayo. No presentar la copia como clon íntegro o sincronización automática lista para producción. Próximo paso: completar estos campos y el flujo de actualización/variantes en laboratorio antes de ampliar el lote. Ninguna publicación real autorizada ni ejecutada.


### Actualizaciones verificadas y familias con tallas — 2026-10-02

Versión 0.58.0 desplegada en Preview: una revisión editorial posterior a un ensayo exitoso puede solicitar actualización del mismo ID local. El historial conserva todas las solicitudes; se bloquea una segunda solicitud activa o una revisión ya enviada. El recibo de actualización debe conservar el ID confirmado. El puente exige el directorio de evidencia previo, verifica sus huellas y comprueba que Woo local no cambió antes de escribir; reutiliza adjuntos/categorías existentes.

Resultados reales comprobados: actualización solicitada desde UI, job acc23ac1-09ce-46e3-9631-895c5f734d2d, revisión 2, SUCCEEDED en el mismo Woo local 18. Se aplicaron sólo al ensayo las correcciones «AZA»→«ASA» e «INTERNO.EL»→«INTERNO. EL». Comparación antes/después: cambian únicamente description, date_modified/date_modified_gmt y marcador de operación; fotos completas idénticas, precio 8695.00, SKU, código 10521, promociones y campos de existencias intactos. Adjuntos/categorías reutilizados; repetición cero solicitudes. UI y avatar 0.58.0 comprobados. Evidencia outputs/m9-actualizacion-local-2026-10-02.

Ensayo de familia separado: `scripts/m9/woo-test/rehearse-family.mjs` tomó la familia Wrangler 5630 del reporte conciliado y creó el borrador local 23 con hijos 24–28, tallas S/M/L/XL/XXL y códigos SICAR 10581–10585, precio 820.00 por talla, cuatro fotos. Actualización parcial incluyó sólo S y corrigió «AMARILLOEN» en el texto del padre: los otros cuatro hijos conservaron su JSON completo; repetición cero solicitudes. Evidencia outputs/m9-familia-local-2026-10-02. Usa IDs internos y SKUs sintéticos de laboratorio y categoría explícita «Laboratorio M9»; no sustituye vínculos reales ni acredita la taxonomía de producción.

131 unitarias, ocho comprobaciones SQL de actualización con rollback, tipos y lint aprobados; consultar CI del commit de entrega para integración/build/E2E. Los avisos de seguridad históricos siguen en 105 funciones y una configuración de contraseñas filtradas; las tablas nuevas permanecen privadas con RLS cerrado.

Límites: cola UI todavía sólo para productos simples habilitados; la familia variable se probó por herramienta supervisada y no se incorporó al catálogo de staging. No hay trabajador automático permanente. Atributos descriptivos del padre, variantes fuera del piloto, clasificación web completa y compatibilidad de plugins/tema siguen pendientes antes de ampliar el lote o publicar. Siguiente paso: revisar e incorporar las variantes completas al piloto y conectar su edición/envío supervisado desde la ficha. Producción y existencias siguen cerradas.
