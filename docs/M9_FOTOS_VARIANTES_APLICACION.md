# M9 — registro y visualización de fotos por variante

## Alcance

Continuación del cruce completo del 6 de octubre. Se agregó un registro privado
de evidencia de fotos por variante en staging `zsezjtswqeijboezvado`, separado de
las galerías y portadas de producto. No afecta Woo, producción ni existencias.

Se aplicaron **5,928 variantes / 1,017 familias**, incluyendo las **599 variantes
en 159 familias** que faltaban en la evidencia guardada. Éstas quedan como
evidencia complementaria: el snapshot web original no se reemplaza ni reescribe.
5,815 variantes tienen una foto propia verificada y 113 de las complementarias
no tienen foto propia. Las seis reservas previas siguen excluidas: cinco por
Woo 33002 draft y código 11755 sin vínculo de fuente completo.

Las fotos se registran como **referencias públicas originales de Woo**, con
SHA256, bytes y MIME verificados; no son nuevas copias en Supabase Storage.
Se conservan los archivos locales del bloque previo y se verificaron seis URLs
adicionales para el complemento. No afirmar que existe edición manual o
sincronización independiente de fotos por variante con Woo: esa parte no se
implementó en este bloque.

## Guardado protegido

Migración `20261007014932_m9_variant_photo_evidence.sql`. Tabla privada con RLS,
sin acceso directo para anon/authenticated/service_role. Procedimiento importador
SECURITY INVOKER, sólo postgres, stage guard y expectativas exactas de catálogo,
fila completa de fuente y borrador. Bloquea producto/variantes/fuente/borrador
antes de comparar. Comprueba UUID, Clave1 literal, padre, variación, publicación,
URL original de la variante y evidencia de archivo. Rechaza duplicados, URLs
ajenas, bytes excesivos, MIME no admitido, cambios concurrentes y reemplazo de
evidencia existente. La repetición exacta no incrementa revisiones ni auditoría.
No escribe productos, variantes, precios, códigos, inventario o colas.

La evidencia complementaria sólo cubre vínculos que ya estaban conciliados en
el catálogo actual y en SICAR/Woo canónico. No agrupa ni aprueba identidades
nuevas. La fuente de cada registro se limita a ID/status/atributos/imágenes;
no se incorporan stocks o datos de pedidos. El export se identifica por SHA256.

Lector público RPC con SECURITY INVOKER llama a lector privado autorizado:
el acceso privado requiere SECURITY DEFINER porque la tabla no está expuesta;
comprueba auth.uid(), products.read, staging, límite 200 UUID y vínculos actuales
de variante/barcode/padre/fuente. Si cambia la fuente guardada, no devuelve fotos
del registro anterior sin revisión. No acepta escrituras desde el navegador.

## Programa

`lib/variant-photos.ts` consulta lotes de 200 IDs sólo en staging, valida destinos
y entrega únicamente URL/alt al cliente. El catálogo prioriza imagen manual
explícita del producto, después foto de la variante y después portada de galería.
La ficha web muestra las imágenes dentro de la tarjeta del código y talla
correspondientes, conservando la galería general. El lector falla con fallback
a las imágenes anteriores si la consulta no está disponible.

Versión preparada **0.75.0**. Verificar publicación y recorrido autenticado antes
de afirmar disponibilidad visible. No modifica el adaptador remoto de familias
ni envía estas fotos a Woo de pruebas o producción.

## Validación y evidencia

Ensayo transaccional con rollback: **21 controles** de expectativas, identidad,
origen, SHA, tamaño, MIME, URL original, duplicados, permisos, creación, repetición,
protección de ediciones, conservación e inventario. Primer intento detectó una
ambigüedad de alias sólo en el test; corregida antes de aplicar la migración.
Piloto real de ocho variantes: ocho creadas; repetición cero creadas/ocho iguales.
Aplicación ampliada en 51 transacciones con expectativas exactas y sin errores.

Los snapshots previos conservan 7,709 filas/UUID, fuentes y borradores. Cobertura
de catálogo sigue **7,709/16,224 = 47.516%**: los 5,928 registros de fotos no son
altas de catálogo. 1,238 categorías válidas/cero invalidadas, colas 3/1/9 y cero
saldos/movimientos. No se publica ninguna identidad retenida SICAR_ONLY.

Raíz `outputs/m9-fotos-variantes-aplicacion-2026-10-06/` en el workspace principal:
contexto fresco, dos paquetes reproducibles, ensayo corregido, piloto/repetición,
aplicación por partes, repetición ampliada, cierre y seis imágenes adicionales.
Las respuestas individuales de SQL muestran sólo el último SELECT de cada
parte; las cantidades globales se verifican por consulta independiente.
No sumar esos resultados parciales como si cubrieran cada familia.

## Pendientes del bloque de fotos

Copiar archivos al almacenamiento de Mi Tienda con flujo autenticado, control de
concurrencia, verificación de bytes e idempotencia; no sustituir referencias con
archivos inexistentes. Incorporar la evidencia complementaria a los preparadores
que todavía leen únicamente el snapshot original: esos lectores anteriores
siguen mostrando la retención histórica hasta adaptarlos. La sincronización
independiente de fotos de variantes hacia Woo requiere su propio ensayo.
La comprobación visual del Preview debe registrarse por separado del build local.
