# M9 — Preparación de lectura remota de fotos por talla

Fecha: 2026-10-06. Este documento registra la preparación previa. Actualización posterior: el lector1.3.3 ya está instalado y verificado en Woo de pruebas; consultar [el cierre real](M9_LECTOR_REMOTO_VARIANTES_VERIFICADO.md). La asignación de fotos por talla desde la ficha publicada sigue pendiente.

## Implementación

Plugin preparado1.3.3 añade exclusivamente GET `/m9-test/v1/variant-photos/<request_id>`. Sólo permite las dos familias remotas ya autorizadas, recibos97c82026-b3cc-4c60-8f22-13d7c00fb33a yba239bba-7691-43cc-9c76-8768a1af9f21. Mantiene autenticación de aplicación, rol acotado, propiedad del recibo, origen exacto del Woo de pruebas, aislamiento, no-cache y bloqueo de API general. No admite consultas arbitrarias, alta de adjuntos ni asignación de fotos.

Comprueba recibo de familia exitoso, padre/variantes exactos mediante el verificador existente, códigos originales, tallas, precio público y archivo propio (`get_image_id('edit')`). No confunde la portada heredada con foto de talla. Dos capturas consecutivas deben coincidir; si observa cambios devuelve revisión. Esta doble lectura no es una transacción ni autoriza escribir con una revisión futura.

El preparador de envío independiente coteja paquete original, recibo, lectura actual y evidencia de fuente que debe aportar el servidor. Valida bytes locales y originales remotos por SHA256, tamaño y comparación directa. Reutiliza la lectura de un mismo adjunto durante la preparación. Todos los resultados conservan `remote_dispatch_allowed:false`; no existe método de escritura para este protocolo.

Estados diferenciados: candidato de adjunto existente; ya asignado; requiere adjunto separado; duplicado ambiguo; foto propia distinta que exige revisión; ausencia conservada. No borra ni sustituye fotos automáticamente. No amplía el piloto ni usa nombres para emparejar. El preparador recibe evidencia confiable del servidor; no debe aceptar pruebas o asignaciones suministradas por el navegador.

## Verificación

503 pruebas unitarias/68 archivos aprobadas, incluidas20 nuevas que verifican el preparador y el cliente. Rechazos por tienda real, familia no autorizada, lectura parcial, duplicados, cambio de talla/código/precio, huella de archivo distinta, ausencia de campo propio y sobrescritura. El cliente sólo añade GET con preflight de aislamiento; no incorpora POST de fotos por talla.

23 controles PHP ejecutados en el runtime8.3 ya instalado, con fixtures explícitos de WordPress/Woo, sin bootstrap de WordPress, base real ni consultas remotas. Verifican sintaxis y comportamiento del lector, permisos declarados, ausencia de foto propia, recuperación de bytes, aislamiento, ámbito, cambio concurrente y errores de precio/galería. No son una prueba integral contra el Woo publicado. Comando reproducible desde repositorio: `node scripts/m9/woo-remote/test-variant-photo-read.mjs <ruta-del-runtime-existente>`.

Lint y formato aprobados. Dos paquetesZIP reproducibles idénticos. Se inspeccionó por Chrome el panel actual del Woo de pruebas: protección1.3.2, destino/correo/red/pagos/webhooks/compra/variaciones/carrito en OK. No se instaló ni activó ningún plugin, no se consultaron fotos con credenciales y no se cambió la tienda real. No confundir el plugin antiguo1.0.0 que aparece inactivo en una pestaña histórica con la protección vigente1.3.2 comprobada en el panel actual.

## Pendiente concreto

1. Instalar el paquete1.3.3 en la ruta del plugin vigente, conservando aislamiento y verificando el resultado real. El ZIP no debe activarse como segundo plugin si duplicaría funciones del instalado.
2. Conectar la lectura autenticada desde el servidor de Preview y comprobar las diez variantes reales. El diagnóstico previo de nueve fotos candidatas y código10324/2XL sin foto sigue siendo evidencia histórica, no lectura remota nueva.
3. Crear cola persistente y escritor condicional independiente con recibos, revisión de contexto completo y recuperación de resultado incierto. Después añadir la acción de ficha y ensayar las dos familias autorizadas. No enviar desde este preparador.
4. Preparar adjuntos separados y resolver las referencias duplicadas del catálogo antes de ampliar.

No se activó la sincronización publicada por talla. No se desplegó el programa; Preview sigue0.76.2. Cero escrituras remotas, Supabase, producción, existencias, pedidos o pagos. Cobertura de catálogo sigue7,709/16,224=47.516%;8,515pendientes. No mide porcentaje total del proyecto. Sol suficiente para este bloque; Astra para fase operativa de inventario/pedidos/devoluciones y auditoría final.

## Evidencia

Workspace principal `outputs/m9-preparacion-remota-fotos-2026-10-06/`: verificacion.json, php-verificacion.json, fixtures/script de ensayo, dos ZIP y sha256.json. Código mantenido en scripts/m9/woo-remote/variant-photo-read.php, prepare-variant-photo.mjs, client.mjs y test-variant-photo-read.mjs; fixtures/tests dentro del repositorio.

Referencia oficial consultada: https://developer.woocommerce.com/docs/apis/rest-api/v3/product-variations/ . El acceso de producción mediante API general permanece fuera del alcance.
