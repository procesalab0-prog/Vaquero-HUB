# M9 — 26 variantes y actualización protegida de seis galerías

Bloque del 6 de octubre de 2026, posterior a la revisión masiva. Sólo staging `zsezjtswqeijboezvado`. SICAR6 conserva el corte del 5 de octubre y Woo el exportado autenticado del 6 de octubre. No hubo nueva exportación SICAR, cambios Woo, producción, inventario, pedidos, despliegue ni ampliación de consultas públicas de categorías.

## Retenciones técnicas resueltas

`scripts/m9/section-scope-candidates.mjs` revisa las filas cuyo único control de preparación es `FAMILIA_CON_SECCIONES_DISTINTAS`. Exige identidad canónica exacta y única, candidato padre/variación únicos, reglas reconocidas de atributos, ausencia de issues/muestras, controles comerciales conocidos, precio1 positivo, taxonomía válida, exclusiones vigentes, ausencia de casos bloqueados por dueños y unicidad de destino en **todas** las filas. Aplica únicamente las proyecciones comerciales ya autorizadas de stock omitido/precio público SICAR.

Todas las filas canónicamente asignadas al padre deben tener una sección; las referencias amplias de filas con otro padre o sin asignación se conservan, no se eliminan ni se importan por suposición. No elige el prefijo más largo, no fusiona productos ni cambia el reporte original, `buildBatch`, el conciliador o el plan de destino. La salida sigue siendo una preparación con evidencia individual y exige el plan original vigente; no es aprobación general.

Cuatro padres: 7852 (14 variantes), 22733 (4), 32991 (3) y 33500 (5). Payload SHA `8b70d0b35d1b4c1866dbf217338ee9dcec6a9409bcf3678066a061234b936bce`. Plan original: 26 CREATE/0 errores. Ensayo transaccional revertido y aplicación posterior con siete comprobaciones: 26 creadas, cero actualizadas; repetición 26 sin cambios, cero creadas/actualizadas; todas las 7683 filas anteriores con UUID/current/stored idénticos y cero operaciones de inventario.

Cuatro fuentes/fichas nuevas y 18 imágenes únicas guardadas desde la UI de Preview. El paquete Woo contiene 19 referencias: 7852 repite exactamente una URL; `draftFromPacket` conserva la primera, no duplica la foto. No confundir referencias de origen con archivos únicos. Fuentes originales y catálogo permanecen trazables; las categorías de estas cuatro fichas no se aprobaron automáticamente.

## Seis galerías renovadas

Woo 38362/38366/38367/38368/38369/38370: 35→50 referencias de fotos. Primera verificación: 82 URLs distintas leídas entre fotos originales y copias anteriores, con SHA, MIME, límites, identidad de carpeta y orden. Las 35 imágenes anteriores coinciden byte por byte con Woo, no se retiran ni cambian de orden relativo. No hay duplicados de contenido dentro de cada galería; tamaño total máximo 16 MB por producto.

Paquete de revisión de fuentes SHA `bbb9d6ce0d99ee7ca1b3f2d3b6df639fe018b464d3ca59a59910066bf05342e6`. SQL de datos protegido, sin DDL: bloqueo de fuente/borrador, comparación de filas completas contra captura, vínculo Woo exacto, única diferencia permitida `snapshot.image_urls`/`suggested_content.images`, validación del contenido y registro en audit_log. Ensayo con rollback y aplicación con repetición; las 1498 fichas permanecieron intactas en ese paso. No se alteró ni saltó la protección del importador genérico: este expediente acredita una revisión concreta de seis galerías, no una excepción automática.

Después se usó la UI publicada para editar exclusivamente el campo de galería, comprobando antes ID Woo, revisión1 y texto literal de fotos. Se conservaron URLs almacenadas y alt anteriores; se añadieron las 15 fotos nuevas. Guardado por RPC normal: revisión2. Copia de las seis galerías con la acción existente, comprobaciones de fuente/revisión y archivos por hash: revisión3. Lista recargada: cero pendientes. No se modificó directamente una revisión o borrador en SQL.

Validación independiente final: 68 referencias de galería en diez fichas, 86 URLs descargadas, bytes/orden correctos. Incluye 18 fotos de productos nuevos, 15 añadidas a las camisas y 35 anteriores preservadas. En las seis fichas se verificó igualdad exacta de todo el contenido excepto imágenes, conservación de los alt previos, misma referencia almacenada de cada imagen anterior y aumento de revisión1→3. Captura `ficha-camisa-actualizada.png`: nueve fotos cargadas, 1600×1600, en Preview.

## Categorías: invalidación esperada, todavía pendiente

Cambiar la huella de una fuente invalida su binding de categorías por diseño. Las seis fuentes renovadas tenían binding: ahora hay **1232 válidos y seis invalidados** (`SOURCE_CHANGED`), frente a 1238 válidos antes. No se reactivaron ni se alteró el trigger, aunque las categorías literales no cambiaron. Requieren nueva revisión protegida antes de habilitar envíos. Los procedimientos existentes rechazan reactivar bindings invalidados; no sortear ese control mediante UPDATE directo.

Las cuatro fichas nuevas mantienen categorías sin verificar. No se añadieron IDs a la autorización de lectura pública de 1240 productos. Colas sin cambios: tres trabajos remotos, uno de galería y nueve locales; sin nuevos envíos ni ampliación de familias habilitadas.

## Cierre verificable

- 7709/16224 variantes, **47.5% del catálogo**, no avance global; 8515 pendientes.
- Auditoría contra referencia aplicada: 7709 exactas/0 diferencias. Frente al último Woo: 7704 exactas/cinco reservas por padre33002 ahora borrador; sus códigos se conservan.
- 1498 padres gestionados, 1497 fuentes y 1498 borradores. De la captura de productos gestionados anterior, 1487 fuentes y 1487 borradores ajenos a las seis galerías conservan fila exacta. El borrador sintético está fuera del vínculo M9; el ensayo SQL verificó inicialmente todos los 1498 borradores antes de las seis ediciones UI.
- 305 filas todavía retenidas por secciones, 21 padres con secciones distintas para dueños. Cero candidatos restantes en la revisión técnica de las cuatro retenciones tratadas.
- De los 44 cambios Woo: siete fuentes ya corresponden al último corte, 33 aún con diferencias y cuatro sin ficha. 38366 mantiene revisión de foto de variación: renovar la galería del padre no resuelve esa foto.
- 438 pruebas unitarias/62 archivos y lint dirigido aprobados. Cuatro pruebas nuevas de alcance, inmutabilidad, controles y unicidad global. Preparaciones1/2/3 idénticas en cuatro archivos.

Evidencia exterior: `outputs/m9-secciones-carga-2026-10-06/` y `outputs/m9-galerias-renovadas-2026-10-06/`. Contienen SQL revisable, ensayo/aplicación, capturas completas, auditorías, preservación, fotos comprobadas, código de reproducción y huellas. No reutilizar la aplicación: exige baseline7683, que ya cambió a7709; generar siempre un plan vigente.

Siguiente: revisión protegida de los seis bindings invalidados, categorías de fichas nuevas y los 33 cambios Woo restantes. Las 5937 filas sólo SICAR siguen incluidas; requieren identidad/agrupación comprobada, no se inventan aprobaciones. CAWRNIÑO3587 sigue pendiente. Sol es suficiente para estos bloques; Astra antes de pedidos/devoluciones/inventario central y auditoría operativa final.
