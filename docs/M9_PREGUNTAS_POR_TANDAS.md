# M9 — Preguntas pequeñas desde Inicio

7 de octubre de 2026. El usuario pidió reducir la carga para los dueños: preguntas con ejemplos, por tandas, desde Inicio y con pendientes que se descuenten. La integración funcional se prepara primero en Preview; no se fusiona toda la rama de migración a main ni se escriben datos del catálogo de producción. La ubicación final en main requiere una integración aislada que preserve las mejoras de otros chats.

## Alcance de la revisión

El preparador fija por SHA las propuestas completas y prioritarias del bloque de cobertura, además del corte de 8,515 pendientes ya cargado. Conserva 302 propuestas con delimitador literal T. sin observaciones adicionales (966 registros), más la camisa CAWRNIÑO3587 previamente consultada (4 registros). Son **303 preguntas reservadas / 970 registros**, no modelos aprobados ni una tarea de revisar 970 productos individualmente. Las otras 7,545 filas siguen en trabajo técnico separado; no se presentan como preguntas genéricas que resolverían identidades.

Sólo se libera la **primera tanda de 3 preguntas / 16 registros**: CAWRNIÑO3587, CARONINE1501 y CAWRRET901. Las 300 preguntas restantes no son consultables desde el navegador, ni siquiera buscando su ID. La selección se registra explícitamente; no hay publicación automática de todo el banco. El operador no puede abrir otra tanda mientras queden preguntas sin respuesta o «No lo sé todavía» en las anteriores. Una repetición de la liberación no duplica la tanda.

Cada pregunta muestra sección, modelo literal, ejemplos de tallas, todas las tallas propuestas y precios. Los códigos completos quedan desplegables. Las opciones son «Sí, es el mismo modelo y sólo cambia la talla», «Hay algo que corregir» y «No lo sé todavía». La corrección requiere explicación; el nombre comercial es opcional. No se repiten las políticas ya resueltas de precio1, códigos heredados, costos desconocidos o amartigones.

## Guardado y protección

Tablas privadas app.m9_owner_questions y app.m9_owner_answers con RLS cerrado, sin acceso directo de anon, authenticated ni service_role. Lectura exige empleado activo con products.read; responder exige además products.update. Funciones privilegiadas sólo en app, search_path vacío, wrappers públicos invoker con EXECUTE explícito. Carga y liberación sólo postgres y guarda STAGING.

Las respuestas se agregan al historial, con actor, fecha y revisión; nunca sobrescriben respuestas anteriores. La revisión esperada evita que dos personas pisen una aclaración. El request UUID permite repetir un envío exactamente igual sin duplicarlo y rechaza reutilizarlo con otros datos. Un nuevo corte, una evidencia distinta, un código ya incorporado o una pregunta no liberada impiden responder con datos anteriores. No se aceptan opciones «aprobado» ni campos comerciales arbitrarios.

El contador se descuenta con una respuesta concreta, pero «No lo sé todavía» permanece pendiente. Una respuesta afirmativa **no autoriza una importación**: requiere contrastar la evidencia y ejecutar por separado el plan y ensayo del importador existente. No se modifican productos, variantes, precios, códigos, categorías, aprobaciones, fichas, Woo ni existencias.

## Continuación técnica

scripts/m9/export-owner-answers.sql obtiene un archivo de sólo lectura con evidencia e historial de las preguntas liberadas. scripts/m9/review-owner-answers.mjs valida el paquete y el corte, IDs, evidencia exacta, revisiones completas y campos permitidos. Clasifica por separado lo que requiere plan técnico, corrección de fuente o consulta pendiente; todas las salidas conservan import_allowed=false y send_allowed=false. La exportación real actual contiene 3 preguntas y **0 respuestas**; las respuestas de ensayo se revirtieron.

Nueva ruta /productos/migracion-dudas, enlace desde pendientes y tarjeta de Inicio. Si no hay permisos, migración o configuración de staging, la tarjeta no rompe el tablero de operación. Las tablas y funciones se aplicaron únicamente a zsezjtswqeijboezvado; no a drubkjlmfbdeglucakmg.

## Verificación

Dos preparaciones idénticas (19 archivos por corrida). Ensayo remoto en transacción revertida y repetición sobre el esquema instalado: 25 controles SQL, incluidos anonimato, preguntas reservadas, idempotencia, revisión concurrente, corrección vacía, rechazo de aprobación, descuento del contador, historial, límite de tandas y evidencia cambiada. La primera prueba refería por error public.product_variants; se corrigió a public.variants y se comprobó que la transacción fallida no dejó tablas.

516 unitarias / 69 archivos (13 nuevas); formato, lint dirigido, tipos y build aprobados. Advisor: dos INFO nuevos de tablas RLS sin políticas, intencionalmente privadas; ningún aviso nuevo de funciones privilegiadas ejecutables. No abrir permisos directos para quitar esos INFO. Quedan las advertencias históricas documentadas.

Catálogo conservado: 7,709 gestionadas, 1,499 padres, 7,710 variantes y 8,515 pendientes. Huella de catálogo d3fe299f72f3b8ab6d9f869ee9ddf4bf. Cobertura operativa permanece 47.516%; no se convierte el banco de preguntas en progreso de carga.

Evidencia reproducible en outputs/m9-preguntas-por-tandas-2026-10-07/ del workspace principal. Versión 0.78.0 publicada en Preview y verificada visualmente: tarjeta de Inicio con 3 pendientes, navegación a las tres preguntas, búsqueda 4485 y códigos/tallas/$740 de CAWRNIÑO3587. Envío real de corrección vacía rechazado sin persistir respuestas. Se simplificó el texto y se ajustaron espacios después de la primera revisión visual. CI 311/run 37675099913 completado con éxito, incluidas integración y E2E. Main no se actualizó: la integración a la página principal queda separada del despliegue de migración. Sol suficiente; Astra para la fase operativa de inventario, pedidos/devoluciones y auditoría final.

Publicación funcional final: local 51745c8; remoto 47d480d05ef4c4e681e365196d62f3ad68df453f; árbol remoto c67841478dbf8b4024da93d763d18956b0013d39. Coincide con el árbol local salvo tres cierres documentales previos no republicados (handoff, plan maestro y reporte de carga completa). Publicación por actualización no forzada sobre la cabeza remota vigente; PR 87 permanece sin fusionar. Migración remota 20261007191449.

Confirmación posterior del usuario: opción múltiple donde corresponda y subida a main **al terminar esta parte**, para que los dueños lo abran en el programa principal. Se mantiene la validación en Preview y la integración aislada al cierre, sin adelantar el merge. Comprobación visual renovada el7deoctubre: tres tarjetas, opciones y campo de aclaración; cero respuestas guardadas por el agente. La continuación técnica está en [el escritor condicional preparado](M9_ESCRITOR_FOTOS_VARIANTES_PREPARADO.md).
