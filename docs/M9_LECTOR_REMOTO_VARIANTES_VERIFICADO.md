# M9 — Lector instalado y piloto remoto verificado

Se actualizó el conector vigente del Woo independiente de pruebas de 1.3.2 a 1.3.3. WordPress confirmó la actualización y el panel mostró ocho protecciones en OK. No se duplicó el plugin ni se concedieron permisos nuevos. Paquete SHA256: d5565b1408715b04a026c406d81d477d0d464ceff18a9a96041ae6a72bd80055.

## Resultado real

- Dos familias, diez variantes: código literal, talla y precio público coinciden con la evidencia local registrada. Familia Woo25:10581–10585/$820. Familia Woo37:10315/10325/10317/10324/10316/$890.
- Recibos y galerías antes/después idénticos; lecturas de foto propia repetidas sin cambios.
- Las diez variantes tienen own_image_id=0. La portada heredada no cuenta como foto propia.
- Nueve candidatas pueden reutilizar un adjunto existente, comprobado contra los bytes originales locales, SHA256, tamaño y alt. Se comparten dos archivos originales entre esas nueve variantes; no son nueve archivos distintos.
- Código10324/talla2XL: sin foto propia de fuente. Se conserva esa ausencia.
- Siete adjuntos de galería leídos con autenticación y SHA256 idéntico al recibo. Dos de ellos, los usados por las nueve candidatas, se compararon además byte por byte con el cache local. Para los otros cinco no se afirma comparación byte por byte con archivo local.
- Cinco controles de permisos: anónimo401 antes y después de una lectura autorizada200; fuera del piloto403; API general Woo403. Respuestas privadas y sin almacenamiento en cache.

Dos ejecuciones completas de verificación produjeron resultados idénticos. Las pruebas de código previas fueron503unitarias/68archivos y23controles PHP; este cierre añade pruebas contra el Woo remoto real. No se modificó código del programa en este cierre.

## Alcance y siguiente paso

Sólo se actualizaron archivos del conector y se subió el ZIP técnico de instalación. No hubo cambios de productos, asignación de fotos, existencias, pedidos, pagos ni producción. No se consultó vaquerosm.com. No hubo escrituras Supabase ni despliegue del programa; Preview sigue0.76.2.

Esto cierra la instalación y lectura real del lector. Sigue crear el escritor condicional de fotos, su cola persistente y la acción en la ficha publicada; después probar repetición y recuperación de resultados inciertos con las dos familias autorizadas. Las nueve candidatas todavía NO están asignadas ni habilitadas para despacho. No ampliar el piloto automáticamente.

Catálogo:7,709/16,224=47.516%,8,515pendientes. Este bloque valida infraestructura y no agrega productos; ese porcentaje no mide toda la migración. Sol suficiente; Astra para inventario, pedidos, devoluciones y auditoría operativa final.

Evidencia en workspace principal outputs/m9-lector-remoto-aplicacion-2026-10-06/: antes.json, despues.json, verificacion.json, verificacion-repeticion.json, consultar.mjs, verificar.mjs, lector-1.3.3-activo.png y sha256.json. Los scripts sólo leen el destino de pruebas fijado, usan credencial local fuera del reporte y no imprimen secretos. Para repetir: ejecutar verificar.mjs con un nombre de salida nuevo; requiere los snapshots/cache y la credencial privada original.
