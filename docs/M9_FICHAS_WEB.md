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
