# M9 — lectura complementaria de fotos conciliadas

Se elimina un pendiente técnico del analizador: 599 variantes de 159 familias
ya registradas se reconocen mediante su evidencia complementaria, sin cambiar
la fuente original ni aprobar nuevas identidades. 486 tienen foto propia y 113
no tienen foto propia. Estas últimas no heredan automáticamente la portada.

Cruce completo de 7,709 variantes: 5,815 con foto propia comprobada, 1,520 sin
foto de variante, 368 productos simples y seis reservas. Las reservas siguen
siendo códigos 1132, 1133, 1134, 16566 y 2521 del padre Woo33002 no publicado,
y código11755 con vínculo de fuente incompleto. No se eliminan productos.

Se consultó staging por sólo lectura: 599 evidencias complementarias /159
familias, tabla total5,928, copias5,815 y cero saldos/movimientos. Se comparan
las huellas completas actuales del catálogo por familia y fuente con las
registradas; además, snapshot original, código literal, UUID, IDs Woo,
actividad, precio, departamentos/secciones/atributos, export Woo y todos los
metadatos de fotos. SICAR se audita por separado y sigue siendo maestro.

Se usaron los exports recibidos y los archivos locales previamente descargados:
1,035 URLs/1,032 SHA256 distintos, comprobados otra vez contra los bytes locales,
MIME y tamaño. No es una nueva exportación de Woo ni una descarga actual de sus
fotos. Las1,037 copias Storage fueron comprobadas en el bloque anterior, no
vueltas a descargar en éste. La consulta actual confirma su cantidad de enlaces.

Cuatro corridas con siete archivos canónicos idénticos cada una. Conservación
de identidad/precio/fuentes sobre las7,709 filas del snapshot; las599 evidencias
además se contrastan con staging actual. 479pruebas/66archivos y lint dirigidos
aprobados. No hubo escrituras de base, producción o Woo, importación de
existencias, colas, despliegue o cambios de interfaz. Preview sigue0.76.2.

Cobertura del catálogo:7,709/16,224=47.516%;8,515 pendientes. Este bloque cierra
una limitación del diagnóstico, no carga productos adicionales. Pendientes:
ensayo independiente de fotos por variante hacia Woo de pruebas, conciliación
de identidades retenidas/SICAR_ONLY y corte actualizado antes de uso operativo.
No amplía la lista autorizada de productos para envíos Woo.

## Implementación y límites

prepareVariantPhotos admite un sexto parámetro opcional con el export de
app.web_variant_photo_evidence (sólo supplemental) y padres actuales. Sin éste,
conserva la revisión de entradas ausentes en el snapshot histórico. Rechaza
contexto ajeno a staging, inventario no vacío y duplicados en UUID/código/ID Woo.

Por fila exige huellas MD5 actuales iguales a las registradas, snapshot original
idéntico, export Woo serializado JSON indent2+LF con SHA256 igual al registrado,
variante Woo completa exacta y pruebas reales de bytes. No completa entradas
originales conflictivas ni reemplaza una entrada ya existente. Campos adicionales
separan uso complementario y huella de evidencia del indicador histórico de
cambio de foto. Un desacuerdo conserva REVIEW_REQUIRED; import_allowed y
send_allowed siempre son false. No es un paquete ejecutable ni otorga permiso.

review-editorial-delta conserva su comparación contra el snapshot histórico:
los precios/diferencias anteriores no pueden inventarse a partir de la evidencia
fotográfica complementaria. No se modificaron importadores ni lectores SQL.

Evidencia: outputs/m9-lectura-complementaria-2026-10-06/ en el workspace principal.
preparar.mjs y verificar.mjs, contexto-completo.json, cuatro corridas idénticas y
reporte. La consulta inicial contexto-staging.json es preliminar, no entrada del
preparador; sólo contexto-completo.json contiene el catálogo por familia.
