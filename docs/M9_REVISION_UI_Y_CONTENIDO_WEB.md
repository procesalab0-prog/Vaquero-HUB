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
