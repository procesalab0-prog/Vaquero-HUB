# Familias remotas: preparación de sólo lectura

Este paso revisa el lote staging antes de ampliar el conector remoto. No habilita envíos ni sustituye las pruebas desde la interfaz.

## Repetición

Desde el repositorio, con Node disponible, ejecutar:

```sh
node scripts/m9/prepare-remote-families.mjs STAGING.json REPORTE_SICAR SICAR.xlsx WOO.json SALIDA_NUEVA
```

STAGING.json debe contener project_id=zsezjtswqeijboezvado y las filas obtenidas con la consulta guardada en la evidencia. El reporte debe contener manifiesto, filas y sha256.json. La herramienta verifica los hashes de las fuentes y genera familias.json, resumen.md y sus hashes. Rechaza sobrescribir la salida. No hay acceso de red ni escrituras de base de datos.

Las propuestas conservan todos los códigos, atributos, precios públicos, rutas de categorías y fotos de cada familia. Los IDs Woo son referencias de origen; no identifican productos del Woo de pruebas. Las imágenes se referencian por la copia propia en staging; el futuro envío deberá volver a descargar y verificar sus bytes. Las revisiones y huellas deben releerse antes de cualquier envío: el reporte no reserva ni bloquea ediciones posteriores.

READY_FOR_ADAPTER_TEST_ONLY significa estructura comprobada para preparar el siguiente ensayo, nunca permiso de importar. Las reservas distinguen datos fuera del piloto, actualización pendiente, falta de evidencia y revisión comercial. No se crean variantes SICAR por opciones web ni se importan existencias/costos.


### 2026-10-06 — Preparación reproducible de familias remotas (sin envío)

Añadidos scripts/m9/prepare-remote-families.mjs y woo-remote/family-readiness.mjs. Cruzan snapshot de staging con reporte SICAR6 verificado por SHA de filas, manifiesto y archivos originales; no tienen cliente de base de datos ni transporte HTTP. Preservan códigos literales, precio público, departamento/sección por variante, galería y rutas de categoría. Detectan familias parciales, combinaciones repetidas, códigos duplicados/ausentes, evidencia caducada, cambios de fuente, categorías no verificadas y exhibición. Propuestas exclusivamente para ensayo del adaptador, dispatch_allowed=false; no son paquetes ejecutables, autorización de publicación ni vínculos de destino.

Resultado real:41 productos/64 variantes;3 estructuras completas para preparar el adaptador (camisas Wrangler guinda con amarillo y George Strait modelo6950, con5 tallas cada una, más bolsa simple Cuadra mantarraya),38 con reservas técnicas. Un producto necesita actualización de staging: Nokota, códigos11201 y3280, DAMA→CABALLERO según SICAR6. La corrección ya está en la exportación; no volver a preguntar al usuario.32 productos carecen de evidencia de categorías vigente;34 tienen filas SICAR fuera del piloto;35 tienen variantes Woo fuera del piloto. No equivalen a errores nuevos ni a nuevas preguntas comerciales. Talla60 del Tombstone sigue sólo web: no crear código/variante física; amartigón conserva reserva de exhibición sin compra.

Evidencia fuera del repositorio: outputs/m9-familias-remotas-2026-10-06/{consulta.sql,staging.json,reporte,repeticion}. Dos corridas produjeron los3 archivos idénticos; SHA de familias.json4fbc6a774a91269003e85a960b2eb23d039dfb9daf001e5c899bbc398a335509.297 pruebas unitarias/43 archivos y lint dirigido aprobados. Sin nuevo despliegue: app0.73.0 y conector1.2.0 conservan alcance anterior. No hubo envío de familias, actualización de departamentos, cambio de esquema, inventario ni producción. Siguiente: adaptar cola/conector remoto a familias completas y categorías, ensayar las dos camisas desde UI con recibos de cada variante; refrescar staging con SICAR6 mediante flujo auditado, completar categorías y ampliar catálogo. Woo fuente histórica del1 de octubre, no corte vivo.


## Ensayo remoto completado el 6 de octubre

Las dos camisas se enviaron desde Preview0.74.0 al Woo remoto de pruebas: productos25 y37, diez variantes y siete fotos. Recibos SUCCEEDED independientes y checkpoint de galerías1 en ambos. Conector1.3.2 corrige el nombre de opción del recibo; incluye recuperación del primer ensayo sin recrear productos. Ver cronología y alcance en HANDOFF_MIGRACION_SICAR_WOOCOMMERCE.md. Las38 reservas del informe de preparación no quedan habilitadas por este ensayo. El preparador continúa siendo de sólo lectura.
