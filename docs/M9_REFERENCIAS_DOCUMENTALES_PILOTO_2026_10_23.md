# M9: referencias documentales de los doce códigos del piloto

## Hueco y alcance

La hoja de conteo tenía casillas para referenciar folio y renglón, pero no consultaba el archivo de créditos. La exportación explícita de `/clientes/heredados-sicar/hoja` ahora puede acompañar sus 36 casillas vacías con referencias documentales exactas. Se reutilizan el lector de registro y `m9_delivery_review_read`; no se modifica la pantalla principal, ningún escritor, permiso, RPC, tabla o libro.

Cada coincidencia exige la Clave 1 literal contra los doce códigos originales. Se conserva documento, índice original, folio seguro, cantidad original de referencia, fecha y huella originales. No se copian cliente, nombre histórico, descripción de la línea, saldo, pagos o autor de declaraciones. El enlace de las exportaciones del programa abre `/migracion/entregas` por documento exacto y sin filtrar las declaraciones pendientes; no agrega formularios ni respuestas.

## Lectura completa y límites

El permiso `inventory.count` precede la consulta de registro; ambos lectores existentes conservan ADMIN activo, `customers.manage` y staging. Primero se valida el alcance fijo del piloto. Sólo al abrir la hoja imprimible se consultan todas las páginas del archivo documental, con un máximo de veinte páginas, grupos de hasta tres solicitudes y una nueva lectura de la primera al final. El archivo actual necesita once páginas más una relectura: doce llamadas documentales, además de la consulta de registro. La página principal conserva su única consulta.

Si falta una página, hay claves duplicadas, cambia archivo, intervalo, resumen, total o primera página, se excede el tope o se pierde permiso, no se imprime una lista parcial. El número de documentos y renglones debe coincidir con el resumen completo. Las fechas se validan sin normalizar días imposibles; cada documento conserva una fecha dentro de su intervalo de origen.

Son consultas independientes, observadas durante un intervalo: la validación no las convierte en una transacción simultánea ni renueva SICAR. No se exportan las declaraciones actuales o identidades derivadas como prueba física. La entrega original permanece UNKNOWN y los compromisos actuales no se evalúan. Un folio, cantidad anotada o abono no acredita presencia, entrega, reserva o descuento previo.

La extensión de metadatos es opcional. El preparador de hojas histórico sigue funcionando sin ella y conserva sus casillas vacías. Cuando se aporta, su contrato estricto rechaza campos adicionales, PII, declaraciones de autorización, códigos ajenos, renglones duplicados y contexto contradictorio. Los enlaces sólo se muestran en la hoja servida por el programa; una hoja offline conserva las referencias sin enlaces de navegación.

## Evidencia disponible y siguiente comprobación

El archivo histórico conservado tiene 60 cuentas, 84 documentos y 183 líneas, todas UNKNOWN. La comparación literal de los doce códigos no encontró coincidencias en esas líneas. La hoja muestra: **«Sin coincidencia en este archivo histórico; compromisos actuales no evaluados»**. Esto no prueba cero compromisos: el archivo no cubre cualquier documento nuevo, liquidado o no capturado. No se cambian los doce códigos ni se eligen sustitutos para producir coincidencias.

Para cerrar esa parte hace falta comprobar en tienda los documentos y mercancía guardada o separada de esos códigos, incluidos tipos fuera del archivo, y los movimientos SICAR de cada código/almacén/corte. Las cantidades físicas, V y S siguen sin rellenar; el efecto anterior desconocido conserva UNKNOWN. No hay nuevas preguntas automáticas ni datos inventados.

## QA local

65 pruebas en cuatro suites: referencias paginadas, hoja, ruta y frontera de servidor. Incluyen coincidencia literal frente a substring, dos documentos distintos con el mismo código, cambio de archivo entre páginas y en relectura, duplicados, página incompleta, fecha imposible/fuera de intervalo, folio inseguro, cantidad/estado incorrectos, pérdida de permiso, contrato sin PII y compatibilidad del preparador offline. Lint y tipos se verifican antes del commit.

Dos preparaciones privadas fijadas sobre las fuentes conservadas producen cinco artefactos idénticos: referencias, hoja JSON, hoja HTML, resumen y manifiesto. Son reprocesamiento histórico local, sin consultas actuales de SICAR/staging, sin captura de respuestas, ni movimientos físicos o financieros. Root verificará coste real, sesión Auth/PostgREST e impresión en Preview; este bloque no acredita esa aceptación.
