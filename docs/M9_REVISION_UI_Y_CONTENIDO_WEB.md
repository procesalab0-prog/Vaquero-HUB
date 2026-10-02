# M9: consulta del piloto y preparación web — 1 de octubre de 2026

## Estado y ubicaciones

La aplicación preparada es **0.55.4, Revisión del piloto SICAR**. No está
publicada. No se ejecutó merge, push, despliegue de aplicación ni escritura
en WooCommerce, producción o inventario.

La implementación de interfaz se aisló en `work/m9-ui`, rama
`codex/m9-staging-review`, desde `5366bd4` (base 0.55.3). El directorio
`qa-caja-inicio-compras` contiene cambios activos ajenos; no se modificó.
El conciliador histórico y sus pruebas siguen en `work/m9`; todavía falta
integrar ese conjunto completo con la rama reciente. Se copiaron a esta rama
las cuatro migraciones del importador y la documentación M9 vigente.

## Consulta implementada

- Ruta `/productos/migracion`, enlazada desde Productos sólo cuando la URL de
  Supabase corresponde exactamente a staging `zsezjtswqeijboezvado`.
- Autenticación y permiso `products.read` en servidor y PostgreSQL. El núcleo
  privado devuelve sólo los campos necesarios; el RPC público es invoker.
- Búsqueda textual literal, código SICAR exacto, filtros por departamento y
  sección y páginas de 20, sin recortar el universo a los primeros 200.
- Clave 1 permanece texto: no se recorta, cambia ni convierte a número.
  SKU interno y referencia Woo aparecen como identificadores separados.
- Talla, largo y color se muestran según los atributos realmente presentes.
- Costo NULL se muestra “Sin capturar” sólo con permiso de costo; mayoreos NULL
  dicen “Sin definir”. Inventario se declara no importado, nunca existencia cero.
- Sin backend correcto o ante error, la ruta no sustituye datos por ejemplos.
- El formulario anterior de edición ya no rellena un costo ausente con cero.
  El servidor también rechaza la cadena vacía: `Number('')` ya no produce un
  costo cero accidental. Un cero escrito expresamente conserva su significado.

Migración nueva aplicada sólo a staging:
`20261001235334_m9_catalog_review.sql`. Su lectura exige el control de staging
habilitado existente. No amplía autoridad de escritura ni acceso directo a
tablas privadas. Los empleados no pueden ejecutar el importador M9.

## Verificación y límites

- 65 pruebas unitarias en 19 archivos aprobadas; lint de cambios, TypeScript
  y compilación Next.js con webpack aprobados. La primera compilación falló
  por red restringida al descargar fuentes; se repitió con acceso de red y pasó.
- 18 comprobaciones SQL en staging: paginación sin solapamiento, códigos
  exactos frente a prefijos/ceros/espacios, `%` literal, clasificación, NULL,
  ocultación de costo, identidad sin permiso y ejecución denegada a anon y
  service_role. Cambios de permisos de la prueba revertidos en su transacción.
- Comprobación final: 40/40 filas coinciden íntegramente con el payload aprobado;
  40 costos NULL, 40 auditorías de alta, cero actualizaciones M9 y cero filas o
  movimientos de inventario.
- Avatar S comprobado localmente: 0.55.4. Página fuera de staging informa que
  requiere ese entorno, sin datos ficticios.
- Componente real renderizado con una copia de la primera página leída de staging
  y marcado expresamente como muestra estática. Revisión visual a 390×844 y
  1024×768 sin desbordamiento horizontal; sus filtros no son una sesión viva.
- **No se verificó el recorrido navegador → sesión staging → RPC**. Falta el
  despliegue Preview y una sesión de empleado en staging; no se encontraron
  configuración local de Vercel ni credenciales de aplicación staging. No
  reutilizar accesos de WordPress/SICAR para entrar a Mi Tienda SM.
- Lector físico del piloto, integración POS y revisión completa de reportes con
  costos NULL siguen pendientes. El reporte de inventario histórico suma costos
  conocidos: debe distinguir valoración incompleta antes de utilizarlo en el corte.
- Los advisors no señalaron la nueva función. Persisten avisos previos de
  funciones definer y protección de contraseñas filtradas; no declarar una
  auditoría global limpia. Ver `security.json` y sus enlaces de remediación.

Evidencia en `outputs/m9-revision-ui-2026-10-01` del directorio de la tarea:
consulta real de primera página, SQL reproducible, resumen de seguridad,
comprobación final y muestra HTML estática. La muestra temporal se retiró de
`public/` y el servidor local de verificación se detuvo.

## Siguiente paso ya ejecutado: contenido web

`scripts/m9/prepare-web-content.mjs` genera evidencia local verificando SHA-256
del payload y la exportación Woo contra el manifiesto de importación. No acepta
un destino remoto ni contiene cliente de escritura.

Resultado: 40 padres existentes y 40 variantes, todos con descripción larga e
imágenes en la exportación. Conserva HTML original como dato no confiable,
descripción corta, URLs de fotos, categorías de origen, atributos y promociones.
No descarga imágenes ni ejecuta HTML, y no inventa información faltante.

38 familias tienen más variantes que las seleccionadas en el piloto. Se
conserva la lista de IDs excluidos; el piloto nunca debe reemplazar la familia
completa ni eliminar tallas. La acción propuesta es revisar el vínculo existente,
no crear otro padre. Las categorías del CSV son nombres, no IDs: todas requieren
correspondencia verificable antes de preparar una operación real.

Dos ejecuciones dieron artefactos idénticos byte por byte. Evidencia:
`outputs/m9-contenido-web-2026-10-01` y su repetición. Reproducir desde `work/m9-ui`:

```sh
node scripts/m9/prepare-web-content.mjs \
  --payload ../../outputs/m9-importacion-staging-2026-10-01/payload.json \
  --woo ../../outputs/m9-fuentes-2026-10-01/woo-authenticated.json \
  --manifest ../../outputs/m9-importacion-staging-2026-10-01/manifest.json \
  --out ../../outputs/nueva-preparacion-web
```

Este paquete **no es importable ni implementa el alta automática**. Lo siguiente
es completar la ficha web nativa y su persistencia en staging: descripciones,
galería, código base separado de Clave 1/SKU, categorías verificadas, precio y
variantes, estado pendiente/error y reintento idempotente. Crear inicialmente
como borrador sigue siendo la recomendación del plan; no una autorización para
escribir hoy en Woo. Antes de conectar escritura se necesitan pruebas integrales
en un Woo de staging y separar promociones del precio público base.


## Registro vivo — Preview M9 desplegado (2026-10-01)

Publicado exclusivamente Preview 0.55.4 desde b7086e3fec5eae4278d1bffdbba86f65210b87be. PR borrador #87: https://github.com/procesalab0-prog/Vaquero-HUB/pull/87. Pantalla: https://vaquero-hub-git-codex-m9-staging-review-procesa-lab.vercel.app/productos/migracion. Vercel confirma entorno Preview y la variable pública apunta a zsezjtswqeijboezvado; no se tocaron variables ni producción.

CI #255 aprobado completo: instalación congelada, formato, lint, tipos, base vacía/migraciones, pruebas unitarias e integración, build y 128 pruebas E2E. La rama remota tiene exactamente el árbol local probado (9332287d1e58bd7ea6452ecbb33039474915859c). Git sin credencial de escritura local; se utilizó el conector autorizado de GitHub. No se fusionó main.

Acceso anónimo probado: redirige a login, sin mostrar catálogo. Solicitada sesión del usuario en staging para cerrar el recorrido autenticado de revisión del piloto; pendiente, junto con lector físico. No reutilizar credenciales de SICAR/WordPress. Sin cambios Woo, producción ni existencias. La documentación anterior que dice “no publicada” describe el checkpoint anterior a este despliegue. Evidencia local: outputs/m9-preview-2026-10-01/despliegue.json.


## Registro vivo — sesión staging y corrección de filtros (2026-10-01)

La sesión real del usuario permitió verificar el recorrido Preview → autenticación → RPC → catálogo: 40 variantes únicas en dos páginas, código exacto 10 con precio público $910, consulta 010 sin equivalencia con 10, departamento JUVENIL y sección BOTAS DE TRABAJO RHINO con una coincidencia. Costos sin capturar y mayoreos sin definir. Vista móvil 390×844 sin desbordamiento horizontal. Lector físico pendiente.

Se corrigió la incompatibilidad del esquema de staging con la consulta del perfil: faltaba locations.label_code. Se aplicaron solamente en zsezjtswqeijboezvado las migraciones existentes 20260920220152_location_label_codes.sql y 20260921183000_location_label_code_guardrails.sql. El historial remoto asignó respectivamente 20261002004009 y 20261002004019; no se renombraron archivos históricos ni se reparó masivamente el historial. La Piedad/LAP tiene VSM1 y TRANSIT permanece NULL. Después: 40 filas M9, 0 inventory_by_location, 0 inventory_movements.

La revisión viva descubrió que Limpiar filtros renovaba los resultados pero retenía el selector de búsqueda anterior por defaultValue. Corrección 0.55.5, commit 336e9194f97bcd87a3d1624f0eefe2db44fcf6b6: remontar el formulario al cambiar la consulta/página. 13 pruebas unitarias de revisión y lint aprobados. Publicada únicamente en la rama Preview del PR borrador #87. Primer build falló en módulos de fuentes Google; se reintentó sin caché. Resultado del despliegue y regresión final se registran en outputs/m9-preview-2026-10-01/sesion-verificada.json.

Sin escrituras WooCommerce, producción ni existencias. Sigue pendiente desarrollar y probar la ficha web nativa; el paquete de contenido no equivale a alta automática.


También faltaba products.image_path: Productos caía en su modo de demostración anterior y ocultaba el enlace M9. Se aplicó la migración existente 20260908011917_m6_product_images.sql sólo a staging, registrada remotamente como 20261002004914. Antes se comprobó que no existía el bucket product-images ni archivos en él; se creó vacío para fotografías comerciales según la migración original, sin subir contenido. Productos volvió a mostrar el catálogo real y el enlace del piloto.

Los dos intentos de build Turbopack fallaron; el commit 86f376cddf7670dbfbaf6edeb6e3944767d8849f configura next build --webpack, coherente con la compilación ya verificada en CI. Compilación y TypeScript locales aprobados.

Advisors: permanecen avisos de funciones SECURITY DEFINER autenticadas, incluidos set_product_image y upsert_location_v2 recién habilitados por las migraciones originales. Ambas verifican identidad y permisos internos; no se concedieron accesos a anon. No declarar auditoría global limpia. Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable. Sigue previo aviso de protección de contraseñas filtradas: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.


La CI #257 pasó 126/128 E2E y detectó que Webpack resolvía el manifiesto global sobre el de /mi. Se corrigió en 0.55.6, commit c56d0500d2ac9cd1276fbffab9edd0cf0b145613: el manifiesto POS conserva URL y contenido mediante Route Handler explícito, permitiendo que el metadata del layout /mi seleccione su manifiesto propio. Fundamento: https://nextjs.org/docs/app/api-reference/functions/generate-metadata (los metadatos basados en archivos tienen prioridad). Build, tipos y lint aprobados; navegador local de producción confirma /mi/manifest.webmanifest. Servidor local detenido. La nueva CI es #258; consultar evidencia final, no reutilizar el estado fallido de #257 ni declararlo aprobado.


Cierre de esta revisión: Preview 0.55.6 READY en c56d0500d2ac9cd1276fbffab9edd0cf0b145613; sesión autenticada y avatar verificados, piloto 40 variantes, manifiestos separados comprobados en Preview. CI #258 / job 110656233726 aprobado completo, incluidas las pruebas E2E. Evidencia final: outputs/m9-preview-2026-10-01/sesion-verificada.json. PR #87 permanece borrador; sin merge ni escrituras de producción/Woo/inventario. Próximo trabajo: ficha web nativa en staging y lector físico pendiente.


## Registro vivo — fichas web nativas (2026-10-01, 0.56.0)

Se implementó la captura editorial con fotos y variantes consultables, persistencia privada en staging, reintentos idempotentes y protección ante cambios simultáneos. El alta nueva puede guardar producto y ficha en una sola transacción. 40 fuentes comerciales cargadas de forma reproducible; no cambian códigos, precios, inventario ni Woo. Detalle, hashes, pruebas y límites en [M9_FICHAS_WEB.md](M9_FICHAS_WEB.md). Preview y CI de esta versión se verifican antes del cierre; PR #87 continúa borrador y sin merge. Categorías Woo/familias completas y envío real siguen pendientes.
