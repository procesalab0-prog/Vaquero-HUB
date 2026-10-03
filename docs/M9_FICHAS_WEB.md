# M9 — Fichas web nativas en staging (0.56.0)

## Alcance

Captura editorial interna desde Productos → Ficha web o Revisar piloto → Revisar ficha web. Incluye nombre comercial, código base, descripción larga y corta en texto plano, portada/galería ordenada, categorías propuestas y consulta de variantes. Crear producto ofrece preparar su ficha en la misma captura; producto y ficha se guardan en una transacción idempotente. Si falla la foto, el producto creado se conserva y la pantalla permite reintentar la foto sin duplicarlo.

Sin publicación ni llamadas de escritura a WooCommerce, outbox, importación de existencias o cambios de producción. La interfaz sólo se habilita para Supabase staging zsezjtswqeijboezvado. Los códigos SICAR, SKU, precios e IDs Woo no son campos editables de esta ficha. Price1 permanece precio público, costos desconocidos siguen NULL.

## Fuentes reproducibles

Entrada verificada: outputs/m9-contenido-web-2026-10-01/contenido.json y sha256.json en el directorio de esta tarea. Ejecutar desde work/m9-ui:

```sh
node scripts/m9/prepare-web-drafts.mjs ../../outputs/m9-contenido-web-2026-10-01/contenido.json ../../outputs/m9-contenido-web-2026-10-01/sha256.json ../../outputs/NUEVA_CARPETA
```

Genera sources.sql y manifest.json sin conexión de red. Aplicar sólo después de comprobar el proyecto staging. La propuesta deduplica fotos conservando su orden; la evidencia original queda intacta. Convierte HTML exportado a texto editorial; no es un sanitizador HTML para publicación. El código base Woo no reemplaza Clave1.

Carga final v3: 40 fuentes; SQL SHA256 b0fe019fd5dad51dd5cc69e57951568432336d6f8bcc4ed4f8bdb97569eff498. Aplicación repetida sin duplicación. Un hash fuente distinto exige revisión; al repetir el mismo hash sólo puede actualizarse la propuesta derivada si todavía no existe una ficha humana. Las 38 familias parciales conservan los IDs Woo de variantes externas al piloto. Nunca usar esta muestra para reemplazar una familia completa.

## Persistencia y seguridad

Migraciones CLI 20261002010740_m9_web_drafts.sql y 20261002012045_m9_web_draft_photo_guardrails.sql, aplicadas exclusivamente a staging. Tablas privadas app.web_content_sources, app.web_product_drafts y app.web_draft_requests con RLS y sin acceso directo de anon/authenticated/service_role. API pública invoker; funciones privadas autorizan empleado, permisos y entorno. Lectura sin costos; actualización con products.update o products.create del creador de su propio producto. Cada cambio editorial registra actor y revisión en auditoría.

Claves de solicitud y bloqueo transaccional evitan duplicación por reintentos. Revisión de ficha y huella del catálogo impiden guardar sobre cambios ajenos. Guardar textos no altera el catálogo. Los formularios conservan la captura ante un error y no restablecen automáticamente los campos sin control.

Fotos JPG/PNG/WebP hasta 4 MB con comprobación de firma, permiso real de Storage y ruta aleatoria por producto. URLs de galería limitadas a uploads de vaquerosm.com y product-images de staging. La subida es separada del guardado; puede quedar un objeto sin asociación si se abandona la pantalla. No hay borrado automático de objetos ni garantía de disponibilidad permanente de URLs Woo.

## Verificación y pendientes

77 unitarias, tipos, lint y regresión SQL de staging: lectura, guardado, reintento, conflicto de revisión/variantes, rechazo de payload ajeno, alta atómica e idempotente. La regresión SQL usa rollback; no deja productos ficticios. Conteo previo a prueba de navegador: 40 fuentes, 0 fichas humanas, 0 existencias, 0 movimientos. Integración local/CI cubre autorización, concurrencia y cambios de precio. Resultado definitivo de CI y navegador se registra al cierre.

Advisor de staging: INFO esperado RLS sin políticas para tablas privadas cerradas; persisten advertencias históricas de funciones definer públicas y protección de contraseñas, sin nuevas funciones web definer en public. Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Pendiente antes de habilitar envíos: categorías Woo verificadas por ID, validación comercial de fichas, familias completas y flujo de aprobación/outbox + worker en entorno Woo de pruebas. No confundir guardado interno con borrador ya creado en Woo. El lector físico sigue pendiente.


### Evidencia de navegador y CI — 0.56.0

Preview READY en commit 7691e7d507074bea2ebb8477f658ca5c7b36b85b (código funcional cfd6dda, dos ajustes posteriores sólo de fixtures). Navegador autenticado: guardado y recarga de la ficha SICAR 10, revisión 1, 7 fotos cargadas, código/talla 22/precio $910/SKU/IDs Woo intactos. Una URL ajena fue rechazada conservando la captura; luego se guardó el contenido de origen. El formulario normaliza saltos LF a CRLF, sin cambio editorial. Avatar 0.56.0 confirmado y ancho móvil 390 sin desborde. Alta con checkbox de ficha inspeccionada sin insertar productos ficticios.

77 unitarias y 165 integraciones aprobadas en CI #261. Su primer intento falló después en next/font, aunque build local y Preview pasaron; se reintentó el mismo commit. Pendiente resultado de E2E. La sesión del navegador venció durante la prueba de subida de foto: al recargar apareció login, el bucket sigue con 0 objetos. Solicitada nueva sesión; no declarar la subida aprobada todavía. Evidencia y capturas en outputs/m9-fichas-web-2026-10-01-v3/verificacion.json.


Cierre técnico: CI #261, intento 2 / job 110669362578, aprobada completa (formato, lint, tipos, reset, unitarias, integración, build y E2E) en commit 7691e7d507074bea2ebb8477f658ca5c7b36b85b. No quedan fallos de CI abiertos de esta entrega. Subida de archivo pendiente de recuperar la sesión del usuario; no hubo objeto subido ni cambio de galería durante ese intento. Versión Preview 0.56.0. Las categorías y el envío Woo siguen pendientes y desactivados.


### Subida de fotos verificada tras recuperar sesión

Cerrado el pendiente de upload en Preview 0.56.0: el archivo descargado IMG_7873-Photoroom.jpg contenía WebP. La validación rechazó correctamente su MIME/extensión JPEG. Se copió sin transformar bytes a IMG_7873-Photoroom.webp, se subió desde el selector, se guardó y se recargó la ficha SICAR 10. Revisión 2 con siete fotos; la portada usa ahora su copia en product-images de staging y las otras seis URLs siguen iguales. No se duplicó la portada. Objeto bf18e88d-e704-423f-8354-1f73ac25a4fa.webp asociado al producto 68f8c842-47dd-4e95-84f1-b378110fd807. Todas las imágenes cargaron; talla 22, precio $910, SKU 1000074-3 e IDs Woo 7995/11235 intactos. Un objeto de Storage, cero existencias y cero movimientos. Evidencia: outputs/m9-fichas-web-2026-10-01-v3/verificacion.json y foto-subida-verificada.jpg. Sin cambios de código: se mantiene 0.56.0 y la CI aprobada. Próximo paso: correspondencia de categorías Woo por ID y revisión de familias completas antes de habilitar envíos.


### Categorías Woo y revisión completa de familias del piloto — 2026-10-01

Herramienta offline m9-web-family-review-1: captura pública sólo GET de 159 categorías y pertenencia de los 40 padres, contrastada por ruta completa e ID con el CSV autenticado. 40/40 categorías de familia verificadas; 378 miembros Woo completos (338 fuera del piloto preservados), 287 vínculos exactos y 91 pendientes (57 sin vínculo confirmado, 34 en revisión canónica/comercial). 31 familias tienen pendientes; las otras 9 requieren aún revisión editorial/aprobación. Además, 16 filas SICAR candidatas permanecen manuales en 11 familias. No equivale a aprobar categorías editadas por humanos ni a importar familias completas.

87 pruebas unitarias y lint aprobados; dos corridas byte a byte idénticas. Evidencia: outputs/m9-familias-web-2026-10-01-v2 y m9-taxonomia-publica-2026-10-01. Detalle y comandos en [M9_CATEGORIAS_Y_FAMILIAS_WEB.md](M9_CATEGORIAS_Y_FAMILIAS_WEB.md). Códigos SICAR intactos, sin escrituras Woo/producción/staging/inventario. No hay nueva versión de app: Preview sigue 0.56.0. Envíos desactivados; siguiente fase: revisión agrupada de pendientes y correspondencias aprobadas en staging antes de outbox/worker en Woo de pruebas.


### WooCommerce local aislado y conector probado — 2026-10-02

Por autorización expresa del usuario, se creó una instalación nueva de WordPress/WooCommerce sólo en 127.0.0.1:9417, sin copiar clientes/pedidos/credenciales ni modificar vaquerosm.com. WordPress 7.0.6, Woo 11.1.2 y PHP 8.3.33 mediante Playground 3.1.56; correo, pagos, red saliente, cron y webhooks bloqueados. Instalación activa en work/m9-woo-runtime-verified (directorio de esta tarea); datos persistentes y credenciales exclusivamente locales.

Conector m9-woo-local-worker-1: compilador de ficha completa, diario persistente, ID devuelto, bloqueo local, revisión/huella, verificación GET y recuperación por ID explícito. Escrituras inciertas quedan en revisión sin volver a crear a ciegas. Ensayo real por API: padre ficticio 11 con variantes 12/13, creación como borrador y actualización de texto/precio M; XL intacta, código 000007779 exacto. Repeticiones y reinicio: cero solicitudes nuevas; campos de existencias intactos. 122 unitarias (21 nuevas), lint y formato aprobados.

Detalle y límites: [M9_WOO_LABORATORIO_LOCAL.md](M9_WOO_LABORATORIO_LOCAL.md). Evidencia outputs/m9-woo-local-2026-10-02-v6. Es WooCommerce real local con datos ficticios y una vista auxiliar de revisión, no una copia completa de los plugins/tema de producción. La app Preview sigue 0.56.0; no se conectó aún el formulario ni una cola autenticada de staging. Sin despliegue, merge, publicación comercial, escrituras Supabase ni inventario. Próximo paso: integrar el formulario y cola con este conector y mostrar resultados/IDs en staging, manteniendo revisión comercial y producción cerrada.


### Ensayo supervisado desde ficha web — 2026-10-02

Versión de aplicación 0.57.0: solicitud autenticada desde la ficha guardada y consulta de estado/ID local. Cola privada de staging con idempotencia, revisión y huella de catálogo; antes de reclamar se revalida el contenido y evidencia de categorías. Una solicitud por producto; sólo creación de borrador simple habilitado expresamente. Cambios previos al procesamiento dejan SUPERSEDED; respuestas inciertas requieren revisión. Los IDs locales viven en la cola, nunca sustituyen los IDs de Woo real.

Puente administrativo supervisado: `scripts/m9/woo-test/staging-bridge.mjs CLAIM_JSON RUNTIME_DIR OUTPUT_DIR`. Se reclama mediante función privada, se ejecuta contra 127.0.0.1:9417 y se registra el recibo después de verificar. No es un trabajador automático permanente ni integración de producción. Fotografías por GET público con límite 4 MB y sin redirecciones; categorías y adjuntos sólo se crean en laboratorio con diario persistente y bloqueo ante incertidumbre. No envía existencias, promociones ni credenciales de producción.

Validación inicial: 15 comprobaciones SQL dentro de rollback, 6 pruebas de puente y 122 pruebas unitarias existentes. Primera ficha prevista: bolsa Cuadra Woo 19771, código SICAR 10521. El resultado de ejecución y despliegue debe agregarse después de comprobarse; esta entrada no acredita un envío completado.
