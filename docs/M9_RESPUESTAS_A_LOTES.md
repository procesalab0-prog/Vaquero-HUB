# M9 — De respuestas a preparación de lotes

7 de octubre de 2026. Preparador de sólo lectura que conecta las preguntas de los dueños con las herramientas existentes de conciliación y planeación. No carga productos ni ejecuta SQL. Tampoco considera una respuesta afirmativa como una aprobación técnica.

## Flujo

`scripts/m9/prepare-owner-load-review.mjs` fija por SHA los archivos de preguntas, exportación de respuestas, corte SICAR conciliado, referencia aplicada, captura de staging, taxonomía y retenciones manuales. Primero ejecuta `reviewOwnerAnswers` y `coverageReview`, incluidos `auditStagedCatalog`, `prepareSicarOnly` y `reviewSicarFamilies`. No crea otro conciliador ni cambia sus reglas.

Comprueba todas las preguntas reservadas contra familias completas: identidad de expediente y evidencia, códigos literales, descripción, talla, precio1, departamento, sección, clasificación y ausencia de candidatos Woo. También verifica el catálogo aplicado contra su referencia y exige staging sin saldos ni movimientos. Un corte distinto, una pregunta parcial, códigos ya cargados o fuente/destino alterados detienen la preparación.

Sólo las preguntas realmente liberadas aparecen como tareas de respuestas. El banco reservado recibe una auditoría técnica privada sin liberar más preguntas a los dueños. Correcciones, dudas y preguntas sin respuesta no producen decisiones. Se utiliza la última revisión y se conserva una huella de todo el historial.

Una confirmación sin observaciones genera únicamente una plantilla **pending**, con código, talla y evidencia exactos. Revisor, fecha y motivo técnico quedan vacíos. Los nombres comerciales se contrastan con todos los padres del destino y con otras respuestas afirmativas. Notas del dueño, dimensiones combinadas, nombres demasiado largos y retenciones manuales mantienen la revisión. No se deduce talla de números finales ni se transforma una talla/largo en una sola talla.

Las plantillas se prueban con `planSicarOnly`: no debe aceptar ninguna familia ni fila. No se llama `prepareSicarDatabasePacket`, no se genera SQL y todas las salidas mantienen `import_allowed=false` y `send_allowed=false`. La aprobación técnica y el ensayo del importador quedan separados y requieren volver a comprobar fuentes y destino vigentes.

## Ejecución

```text
node scripts/m9/prepare-owner-load-review.mjs CONFIG_CON_HASHES.json DIRECTORIO_NUEVO
```

La configuración contiene `inputs.packet`, `answers`, `rows`, `applied`, `snapshot`, `taxonomy` y `holds`, cada uno con ruta relativa y SHA256. La huella de `rows` debe coincidir con el corte de las preguntas. El directorio de salida debe ser nuevo. No se sobrescriben resultados ni se descarga información durante esta ejecución.

Produce cinco archivos: `revision-tecnica.json`, `decisiones-pendientes.json`, `resumen.json`, `siguiente-paso.txt` y `sha256.json`. Son herramientas del operador, no una lista adicional para enviar a los dueños. Los ejemplos y preguntas permanecen en las tandas pequeñas del programa.

## Resultado real

Captura nueva de staging: 7,709 filas administradas, 1,499 padres, cero saldos y movimientos. Se revalidaron las 303 preguntas / 970 registros del banco. 302 no tienen observaciones técnicas adicionales; CAWRNIÑO3587 conserva su retención manual. Primera tanda: CARONINE1501, CAWRRET901 y CAWRNIÑO3587. Exportación nueva: **cero respuestas reales**, por tanto cero plantillas de decisión, cero aprobaciones y cero cargas. No se inventó ninguna respuesta para probar el flujo real.

Dos ejecuciones idénticas en sus cinco archivos, con entradas fijadas por hash. Evidencia: `outputs/m9-respuestas-a-lotes-2026-10-07/` en el workspace principal. El catálogo mantiene la huella d3fe299f72f3b8ab6d9f869ee9ddf4bf y cobertura 7,709 / 16,224 = 47.516%. Las pruebas sintéticas sí ejercitan respuestas afirmativas/correcciones/dudas, pero nunca se guardan como respuestas de los dueños.

22 pruebas nuevas; suite completa 576 pruebas / 72 archivos y lint/formato dirigidos aprobados. Cubren fuente vencida, familia incompleta, tamaño adicional, código con ceros, conflicto de nombres Unicode, nota, retención, tamaño/largo, rechazo del planificador y reproducibilidad. No hubo DDL, escrituras remotas, cambios Woo, frontend, existencias, despliegue ni merge.

## Integración al programa principal

Se inspeccionó main 766c92e538ddc12099879aa24f485fb85950a251 y su Inicio actual, conservando sus mejoras. Sigue en versión 0.55.5. No se sustituyó por la rama completa M9. Las preguntas actuales tienen guarda de staging; copiar sólo la tarjeta a main no las habilita en producción. Su integración requiere una entrega aislada de permisos, almacenamiento de respuestas y pantalla, sin llevar el catálogo de prueba, sus credenciales o movimientos al sistema principal. No se publicaron preguntas nuevas ni se modificó main en este bloque.

Siguiente: integrar esa revisión para los dueños, recoger la primera tanda y convertir sólo aclaraciones verificadas en decisiones técnicas y ensayos de carga. Sol es suficiente para este preparador; Astra recomendado para permisos entre entornos, inventario/pedidos/devoluciones y la auditoría final de operación.
