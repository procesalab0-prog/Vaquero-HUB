# M9 — Ensayo local de fotos por variante

Fecha: 2026-10-06. Alcance: laboratorio Woo real en `http://127.0.0.1:9417`, únicamente familia local23 y variantes24–28 ya autorizadas. No es una implementación publicada ni el cierre de toda la migración.

## Resultado comprobado

Las tallas S/M/L/XL/XXL de la camisa de ensayo conservan códigos10581/10582/10583/10584/10585 y precio público $820. Cada variante tiene ahora asignada su foto propia19, reutilizando el archivo existente verificado por SHA256, bytes y texto alternativo. Las cinco comparten la misma imagen porque así corresponde a la fuente conciliada. Cero archivos nuevos.

Se corrigió una distinción necesaria: Woo puede devolver la portada del padre como imagen visible de una variante que no tiene foto propia. El lector verifica `get_image_id('edit')`; la imagen visible heredada no basta para afirmar una asignación.

La única mutación de producto fue `_thumbnail_id` de cinco variantes locales. Padre, galería, textos alternativos, códigos, UUIDs, precios, atributos, existencias y otras variantes se conservaron después de cada asignación. Recibos locales persistentes registran las operaciones.

## Repetición y recuperación

Cinco repeticiones con el mismo identificador devolvieron su recibo sin volver a escribir la foto. El primer envío había asignado correctamente la foto, pero la comparación estricta de objetos PHP dejó el recibo en revisión. Se corrigió la comparación con serialización canónica y se confirmó usando el paquete original, la huella original y el contexto anterior completo. No se reenvió la asignación incierta.

La familia local antigua sólo registra la operación del padre. Se vinculó explícitamente con el último recibo exitoso de revisión4 y el diario correspondiente, sin inferir por nombre ni aceptar el recibo original obsoleto. Los intentos anteriores se conservan como historial; la aplicación final es `aplicacion-4/`.

## Controles

- Sólo entorno local, origen literal127.0.0.1:9417 y laboratorio con salida de red, correo, webhooks, compras, pagos y cron bloqueados. Rechaza modo de recuperación de sólo lectura.
- Permiso `manage_woocommerce`, familia en borrador marcada, vínculo exacto padre/variante, códigos literales y revisión condicional del contexto completo.
- Foto existente en galería, bytes/SHA256/alt verificables, sin sustituir foto propia distinta.
- Recibo persistido antes de asignar. Exclusión mutua con los escritores cooperantes del laboratorio; no constituye una transacción distribuida ni bloquea cambios externos de un editor WordPress. Un bloqueo abandonado exige revisión manual, no caduca automáticamente.
- 22 controles reales del protocolo local; cinco recibos repetidos sin cambios. 483 pruebas unitarias/67 archivos y lint aprobados. Verificación final después de corregir la llamada al filtro de compra, más evidencia visual del resultado.

## Diagnóstico reproducible del resto

Dos corridas finales idénticas: `alcance-3/` y `alcance-4/`. Sólo leen exportaciones, recibos y evidencia recibida; no consultaron ni modificaron Woo remoto.

| Clasificación de fotos propias | Variantes |
| --- | ---: |
| URL encontrada en la galería de la exportación del padre | 5,002 |
| Necesita preparación de archivo independiente | 720 |
| Galería exportada con referencias duplicadas, requiere revisión técnica | 93 |
| Total | 5,815 |

Las5,002 son referencias en una exportación, no comprobantes actuales de adjuntos remotos. Las720 sí tienen foto propia verificada; su URL no figura en la galería del padre. Las93 pertenecen a16padres; no se deduplicó ni reescribió la fuente automáticamente. `alcance-1/` es diagnóstico histórico corregido, no resultado final.

En el piloto remoto existente, nueve variantes tienen referencia candidata en su recibo y necesitan lectura actual antes de cualquier envío. El código10324/talla2XL conserva ausencia de foto propia. Cero ampliaciones de autorización; el analizador marca el despacho remoto como no permitido.

## Límite y próximo bloque

No se cambió el plugin Woo de internet ni se conectó este protocolo con la ficha del programa publicada. Preview sigue0.76.2. Cero escrituras en Woo remoto, Supabase staging, producción, inventario, pedidos o pagos. Cero despliegues o merge. La cobertura de catálogo sigue7,709/16,224 (47.516%);8,515pendientes. Este porcentaje mide filas del catálogo, no terminación general de la migración.

Próximo bloque: adaptar el protocolo acotado al Woo remoto de pruebas y a la cola de la ficha, verificar permisos, recibos, condiciones y fotos independientes; después ensayar únicamente el piloto remoto ya autorizado. Resolver primero las93referencias ambiguas técnicamente, sin usar nombres para emparejar. No ampliar el lote remoto por este reporte.

Sol es suficiente para este bloque; Astra antes de inventario operativo, pedidos, devoluciones y auditoría final.

## Evidencia

En workspace principal: `outputs/m9-foto-variante-ensayo-2026-10-06/`. `verificacion-final.json`, `aplicacion-4/verification.json`, recibos, paquetes, contextos, `alcance-3/sha256.json`, `alcance-4/sha256.json` y `fotos-propias.png`. Scripts reproducibles incluidos en esa carpeta; usan autenticación privada local sin imprimirla. La verificación final repite sólo los identificadores originales; no crea operaciones nuevas.

Código: `scripts/m9/woo-test/variant-photos.php`, preparador puro `variant-photo-plan.mjs`, incorporación al lanzador local y `tests/unit/m9-local-variant-photo.test.mjs`. Este módulo no se incluye en el plugin remoto ni debe instalarse en producción.
