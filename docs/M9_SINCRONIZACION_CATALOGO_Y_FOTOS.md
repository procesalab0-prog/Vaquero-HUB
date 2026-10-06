# M9 — Integración de catálogo y fotografías

## Resultado solicitado por el usuario

1. Crear el producto desde Mi Tienda, con su ficha, y obtener el producto correspondiente en WooCommerce.
2. Agregar fotos desde Mi Tienda o desde Woo y reflejar la galería en ambos lados.
3. En la migración, incorporar las fotos existentes de Woo al producto de Mi Tienda cuya identidad esté conciliada. Productos sólo SICAR siguen existiendo aunque no tengan fotos/vínculo Woo.

Conservar Clave 1 literalmente por variante. Nunca usar nombre como identidad. SICAR sigue siendo fuente del catálogo y precio público; no importar existencias ni inferir costos. Probar primero en el programa staging y el Woo independiente autorizado. Los IDs de cada tienda se conservan separados.

## Estado comprobado al 6 de octubre

- Programa publicado 0.69.1: captura de ficha y fotos interna, 41 portadas conciliadas de lectura. La cola existente sigue dirigida al Woo local; no es aún conexión automática al Woo remoto.
- Woo remoto independiente: conector 1.1.2 instalado. Producto 14 de ensayo, código10521, imagen15, precio8695, borrador; creado por ensayo de transporte, no por alta nueva desde interfaz del programa.
- Nuevo GET autenticado galleries/{request_id}: sólo permite leer la identidad previamente enviada por esa cuenta y con recibo SUCCEEDED. Verifica metadatos, barcode y producto; devuelve galería completa/ordenada, URL original, SHA256 y alt. Bloquea identidad distinta, archivos faltantes, origen externo, duplicados de IDs y más de20 imágenes. No enumera catálogo general ni permite leer productos ajenos.
- Cabeceras privadas/no-store y exclusión LiteSpeed para rutas M9. LiteSpeed permanece desactivado. Prueba real misma URL: anónimo401 → autenticado200 → anónimo401; todas no-store. No se habilitó caché.
- Planificador puro photo-sync.mjs: comparación de tres versiones (última sincronización, Mi Tienda, Woo), por SHA256 de bytes + alt + orden. Compara identidad por tienda, producto, códigos y huella de evidencia. No descarga ni escribe; sus entradas deben venir de lectores confiables, nunca afirmaciones del navegador.

## Decisiones de la comparación

- Ambas galerías iguales: no copiar de nuevo.
- Primer vínculo con un lado vacío: proponer copiar desde el lado con fotos.
- Primer vínculo con galerías diferentes no vacías: revisión manual.
- Con historial común, cambio en un solo lado: proponer actualizar el otro conservando portada y orden.
- Cambios distintos en ambos lados: revisión manual.
- Retirada/reemplazo de fotos: revisión, sin borrado automático de archivos.
- Falta información, galería parcial, código ambiguo o identidad distinta: bloquear.
- Antes de ejecutar, releer ambos lados y comparar revisiones y huellas con el plan. Esto detecta cambios previos al envío; NO garantiza exclusión mutua contra editores externos durante una escritura ni detecta ABA. Falta el protocolo de aplicación condicionada y recuperación.

## Evidencia y límites

outputs/m9-fotos-bidireccionales-2026-10-06 contiene lector reproducible, galería remota real de producto14, pruebas de autenticación, ZIP1.1.2 y32 comprobaciones PHP con stubs. 239 unitarias del repositorio aprobadas (19 de conciliación de fotos y13 del cliente remoto), lint dirigido aprobado.

El archivo dry-run-synthetic-empty.json usa la galería remota real contra un destino VACÍO SINTÉTICO; no representa la galería actual de Mi Tienda ni una importación realizada. No se escribió ninguna foto en Mi Tienda en este ensayo. La migración completa de fotos no está ejecutada.

## Pendiente para aceptación funcional

- Cola remota duradera, vínculo por tienda y recibo visible integrados con el alta de Mi Tienda, sin exigir un ID de producción a productos nuevos/SICAR_ONLY.
- Alta remota sin foto inicial y soporte completo de galerías, categorías y familias/variantes; el POST actual sólo acepta un producto simple con una imagen.
- Procesamiento de fotos en ambos sentidos: copia verificada, asociación condicionada, historial común, conflictos visibles y recuperación sin duplicados. Lectura remota implementada; aplicación de galerías aún pendiente.
- Recorrido real desde UI: crear producto → recibirlo en Woo; añadir foto en cada interfaz → verla en la otra; repetir/reiniciar sin duplicados, conservar códigos y precios.
- Importación de galerías Woo existentes mediante vínculos revisados y exportaciones frescas; excluir casos ambiguos. Las41 portadas visibles no equivalen a todas las galerías migradas.

No cerrar staging ni declarar 100% con las pruebas del transporte o del planificador. Sin modificaciones de producción, importación de existencias ni merge a main.


### 2026-10-06 — Cola remota preparada y acceso Vercel recuperado

Versión local0.70.0 preparada: cola duradera y recibo visibles en ficha; alta simple elegible se encola al guardar, sólo en staging configurado. Primer alcance: producto nuevo sin vínculo Woo, una variante sin atributos, una foto, sin categorías y textos completos. No reenviar POST ante timeout: recuperar por recibo; conservar literalmente código/precio, no existencias. RPC de claim/huella/confirmación sólo service_role, validación de propietario y permisos actuales. Migración20261006142911 aplicada únicamente a zsezjtswqeijboezvado.16 pruebas SQL transaccionales con rollback aprobadas; siguen41 productos y0 trabajos reales.252 unitarias/39 archivos, TypeScript y compilación final aprobados.

Usuario completó autorización Vercel CLI. Configurados y verificados M9_REMOTE_WOO_ENABLED, M9_REMOTE_WOO_USERNAME y M9_REMOTE_WOO_PASSWORD como secretos exclusivamente Preview + rama codex/m9-staging-review. SUPABASE_SECRET_KEY ya existe en Preview. No valores secretos en repositorio/evidencias. La configuración se incorpora al próximo despliegue; todavía NO demuestra el recorrido interfaz→Woo. Pendientes publicación0.70.0, avatar y ensayo integral; después galerías bidireccionales, categorías/familias y fotos migradas. Producción intacta. No cerrar M9 ni afirmar100%.


### 2026-10-06 — Recorrido UI→Woo remoto aprobado (0.70.1)

Commit8375be36 publicado Preview READY (vaquero-3cx1izyq9-procesa-lab.vercel.app); avatar0.70.1 comprobado. Desde formulario publicado se creó PRUEBA M9 conexión remota0610 (nombre real contiene espacio antes de0610), categoría interna Accesorios, sin atributos, costo SINTÉTICO1/público123.45, textos, una URL de foto ilustrativa y sin categorías web. Producto Mi Tienda e8cfb266-e17f-4482-9756-ac0c1e457b8d, barcode generado2000010001699, SKU1000169-1. Envío automático confirmado SUCCEEDED: trabajo1870ed16-203c-4cc6-8d2b-0228011fb116, Woo remoto18, imagen19, borrador no comprable. Recibo GET independiente validó código/precio/foto/textos; Actualizar estado de UI conservó ID18 y consulta SQL confirmó un solo trabajo. Sin importación de existencias ni escrituras en producción.

Evidencia outputs/m9-cola-remota-2026-10-06/ui-remote-receipt.json y alta-0701-recibida.png. Build, TypeScript y lint dirigido aprobados; CI294 en curso al registrar. Alcance aceptado: alta NUEVA simple desde UI con una imagen. Pendientes: familias/categorías/galerías, actualizaciones posteriores, fotos en ambos sentidos, importación completa y visualización de vínculo por tienda en panel de variante (todavía muestra Sin vínculo WooCommerce porque ese rótulo usa vínculo histórico de producción). No confundir recibo remoto18 con Woo local18 de ensayo anterior. No cerrar M9.


### 2026-10-06 — Recepción protegida de galería remota (0.71.0 preparada)

Acción explícita Traer fotos de Woo de pruebas para altas remotas SUCCEEDED propias. Verifica recibo, propietario/permiso vigente, identidad/código, galería completa, SHA de bytes, límite20 fotos/4MB por foto/16MB total, sin redirecciones ni hosts arbitrarios. Descarga sin credenciales de Woo en archivos; copia por hash a product-images con upsertfalse, valida copia previa al reintentar; relee revisión remota antes de guardar y save_web_draft exige revisión/huella local. Mantiene textos/precios y no escribe en Woo. Bloquea cambios locales respecto del alta inicial, salvo repetición exacta, y retirada de foto original; no baseline persistente incremental aún. Puede dejar archivos sin asociar ante conflicto, nunca borra archivos. No garantiza transacción distribuida con ediciones Woo posteriores a la relectura.

12 pruebas de conciliación/copia propuestas aprobadas junto a13 del procesador. Pendiente ensayo UI de copia, actualización de portada del catálogo, baseline incremental y salida de fotos Mi Tienda→Woo. Variantes/categorías siguen pendientes. No declarar conexión bidireccional ni migración completa.


### 2026-10-06 — Copia Woo→ficha verificada en UI0.71.1

Commit a4eb5597032153477a610e1deb5dfbf98f77070a publicado READY (vaquero-fk535s8h7-procesa-lab.vercel.app), avatar0.71.1 confirmado. Botón Traer fotos copió original de imagen19 Woo18 a Storage de staging y guardó ficha e8cfb266-e17f-4482-9756-ac0c1e457b8d revisión2, conservando texto alternativo modificado en Woo. Repetición devolvió «Las fotos ya coinciden con Woo de pruebas»; SQL confirma revisión2,1 archivo, sin duplicados. image_path del producto sigueNULL: copia verificada en ficha web, todavía no portada del catálogo. Evidencia fotos-0711.png y original-photo-check.json en outputs/m9-cola-remota-2026-10-06.267 unitarias/40 archivos, build/TypeScript y lint aprobados; CI295success, CI296 en curso al registrar.

Pendientes concretos para cerrar integración antes de migración completa: 1) portada del catálogo con control de concurrencia, 2) baseline persistente y salida de fotos Mi Tienda→Woo con actualización condicionada/recuperación, 3) categorías y familias/variantes sin perder códigos, 4) aplicar galerías históricas por vínculos conciliados y últimas exportaciones. La copia actual sólo acepta primera adopción sobre galería inicial intacta o repetición exacta; una siguiente edición remota tras adopción requiere revisión, no se debe afirmar sincronización recurrente terminada. Producción y existencias intactas.


### 2026-10-06 — Portadas desde ficha guardada (0.71.2 preparada)

read_catalog_covers ahora prioriza primera foto de ficha guardada y conserva fallback histórico sólo con vínculo conciliado; excluye productos con image_path propio. Se reutiliza en Productos y Venta, con lotes de máximo200 y destinos de imagen restringidos. No escribe image_path ni sobrescribe cambios concurrentes de portada: lectura de fuente vigente. Una galería guardada vacía no recupera silenciosamente la portada histórica. Migración20261006154347 aplicada sólo staging después de pruebas con rollback: portada almacenada visible y prioridad de imagen explícita conservada. Pendiente confirmación visual de despliegue y contexto Venta (requiere caja de pruebas abierta). No abrir caja ni crear ventas para esa comprobación.


### 2026-10-06 — Portada publicada y cierre parcial comprobado

0.71.2 READY en vaquero-nz8oc395s-procesa-lab.vercel.app, commit a448d365808de47ae4698b99ce90379d06cc8bad. Catálogo filtrado PRUEBA M9 muestra foto de bolsa junto a producto/código2000010001699; avatar0.71.2 confirmado. Evidencia portadas: outputs/m9-cola-remota-2026-10-06/portada-0712.png. Lectura también conectada a Venta, sin abrir caja para comprobación visual. No se escribió image_path, no se importaron existencias, no producción. Pruebas SQL con rollback de portada guardada/prioridad de explícita y build/lint/TypeScript correctos; CI296 anterior completó success.

No cerrar integración completa: baseline persistente y escritura de fotos Mi Tienda→Woo, galerías recurrentes con recuperación, categorías/familias y migración completa siguen pendientes. Usuario pide cerrar TODA la parte; esto debe guiar la siguiente ejecución, no sustituirla por un cierre documental del piloto.


### 2026-10-06 — Historial persistente de recepción de fotos (0.71.3)

Checkpoint privado por trabajo remoto, sólo servicio con propietario y permisos vigentes comprobados. Guarda SHA/alt/orden y revisión Woo tras verificar bytes y coincidencia con revisión/galería local; serializa mediante bloqueo del trabajo y versión esperada. Repeticiones exactas no incrementan versión. El lector acepta nuevas ediciones remotas si Mi Tienda conserva la última galería común; bloquea cambios locales y retirada de cualquier imagen previa. Una interrupción entre guardado y checkpoint se recupera por igualdad verificada, sin duplicar archivos. No representa transacción distribuida con Woo. Migración20261006155407 aplicada sólo staging; pruebas SQL con rollback verificaron creación, repetición, rechazo de versión anterior/revisión local cambiada y denegación a anon/authenticated.15 pruebas unitarias del lector aprobadas, TypeScript correcto. Falta validación del Preview de esta versión.

Continúan pendientes salida recurrente de fotos Mi Tienda→Woo, familias/categorías remotas y migración de galerías históricas. No declarar cierre total ni100%.


### 2026-10-06 — Recepción recurrente comprobada en Preview0.71.3

Commit d09db1f33900a0bc6f7e9e28eae3bc3d3c1dfc74, Preview vaquero-rc8mw0yhe-procesa-lab.vercel.app READY; avatar0.71.3 confirmado. CI298 completó success,270 unitarias aprobadas, lint y build correctos. En Woo remoto se editó nuevamente el texto alternativo de imagen19 del producto18; UI recibió «Foto ilustrativa de bolsa — segunda actualización de prueba M9». Ficha revisión3 y checkpoint versión2; repetir Traer fotos devolvió coincidencia, conservó revisión3/versión2 y un único archivo Storage. Evidencia outputs/m9-cola-remota-2026-10-06/fotos-recurrentes-0713.png. No producción ni existencias.

Pendiente corregir texto de ayuda del panel remoto que todavía menciona exclusivamente fotos del alta inicial: ahora admite la última galería sincronizada. No cerrar toda la conexión: continúan pendientes envío de cambios Mi Tienda→Woo, familias/categorías y galerías de catálogo histórico.


### 2026-10-06 — Envío de galerías preparado (0.72.0)

Nuevo botón Enviar fotos a Woo de pruebas. Plan compara galería remota contra checkpoint común y verifica bytes/identidad; bloquea ediciones remotas divergentes, duplicados y retirada de imágenes. Cola privada app.web_remote_gallery_outbox reclama cada envío una vez, conserva revisión de ficha y consulta recibo tras resultados inciertos; no reintenta POST. Confirmación valida producto/código/tienda/galería y guarda checkpoint sólo si sigue vigente la ficha local. Migración20261006161256 aplicada sólo staging; prueba SQL con rollback de reclamación única, recibo incorrecto, confirmación y permisos aprobada.

Plugin1.2.0 incorpora endpoint limitado gallery-updates: verifica aislamiento, propiedad, revisión de galería y tablas InnoDB; prepara copias, bloquea filas de producto/medios, vuelve a comprobar revisión y cambia exclusivamente metadatos de portada/galería dentro de transacción. Texto alternativo modificado crea copia independiente para no alterar medios compartidos. Archivos preparados ante conflicto quedan sin asociar para revisión; no se borran.277 unitarias,34 comprobaciones PHP, lint, TypeScript y build aprobados. Pendiente comprobar actualización remota y recorrido UI; todavía no declarar sincronización completa ni migración. Familias/categorías y galerías históricas siguen pendientes.


### 2026-10-06 — Galería enviada desde Mi Tienda y copia histórica preparada

0.72.0 publicada (c767da35c04265b7dc37f6b766bd0bdf827dd11e), avatar confirmado, CI299success. Plugin1.2.0 instalado; aislamiento de correo/red/pagos/ventas comprobado. En ficha sintética e8cfb266-e17f-4482-9756-ac0c1e457b8d revisión4 se cambió alt de portada y añadió segunda foto ilustrativa. Envío7702ee4d-b771-4198-8fff-abed51ef9997 SUCCEEDED: Woo18 conserva barcode2000010001699 y recibe medios22/23. Repetir envío y traer galería devolvieron coincidencia sin duplicación. Evidencia gallery-outbound-0720.json y fotos-ambos-sentidos-0720.png.

0.73.0 prepara /productos/fotos-migracion con lector exclusivamente staging y products.update, limitado a fuentes web cuyo producto Woo coincide con app.m9_products.41 productos conciliados contienen186 referencias de fotos actuales. Acción secuencial copia bytes al almacenamiento por hash/producto, verifica archivos ya existentes, conserva orden/alt y guarda por revisión/huella. URLs ajenas a fuente conciliada/almacenamiento propio, duplicados de contenido y límites requieren revisión. No crea productos ni cambia stock/Woo. Migración20261006162434 aplicada staging;282 unitarias aprobadas después de corregir frontera cliente/servidor pasando la acción por propiedad desde la página. Build y lint correctos; pendiente ejecutar lote publicado. Familias/categorías remotas siguen pendientes.
