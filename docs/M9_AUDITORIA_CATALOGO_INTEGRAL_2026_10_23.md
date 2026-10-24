# Auditoría integral de catálogo · 23 octubre 2026

Plan previo desde `7e615df`, Preview anterior `ea17357`. Sólo archivos locales
por este agente; root captura SELECT de staging y conserva la única facultad de
publicar o escribir. Sin navegador, Docker, SQL ejecutado, HTTP, Woo o producción.

Se reutiliza `auditStagedCatalog` y las proyecciones instaladas
`app.m9_rehearsal_current_row`, con el censo de retenidos ya fijado. No se crea
otro conciliador ni se reconstruyen postimágenes antiguas como si fueran lecturas
actuales. El snapshot anterior completo tiene 15,876 filas y fecha de origen;
sirve sólo para comprobar preservación de UUIDs, nunca para simular las 85 altas.

Root captura todas las filas gestionadas actuales por páginas de hasta 500,
orden literal `COLLATE C`, con total, huella gestionada común, texto JSON y SHA256
de esos bytes por página. LEFT JOIN conserva identidades rotas en el reporte.
Auditoría completa de tablas antes/después, igualdad de huellas y continuidad de
páginas son requisitos; si faltan páginas, se repiten códigos, cambia el contexto
o una respuesta se trunca, no hay reporte completo. Son transacciones de lectura
por página, no un corte simultáneo acreditado por una única transacción.

La comparación preserva `current` y `stored` sin rellenarlos con datos SICAR. Para
productos sólo SICAR, su proyección instalada omite el padre Woo por diseño: el
SELECT aporta el ID nativo realmente observado, que permite comparar sin inventar
un vínculo. Los atributos derivados de reglas aprobadas o un vínculo web distinto
se informan con su procedencia; no son autorización para reagrupar o reasociar.
Clave 1, UUIDs y diferencias de precio/taxonomía permanecen explícitos.

La partición de origen debe explicar 16,396 códigos: 15,961 presentes y 435
retenidos, con razones superpuestas y valores de Precio1 literales. No se
redondean los 38 precios con precisión extra ni se completan los dos ceros.
Las 316 restricciones de exhibición/venta no crean variantes vendibles.

Fotos: reutilizar el censo SQL ya existente, si root lo captura, y los hashes de
tablas del corte. Separar evidencia, copia, metadata/reader y ausencia deliberada;
ningún recuento prueba elegibilidad comercial ni byte nuevo. Sin ese censo sólo
se describen agregados con su límite, no una revisión por variante inventada.

Entregables: dos reportes idénticos, manifiesto de entradas y código, comparación
completa y cola mínima de acciones técnicamente sustentadas. No incluir payload
de escritura ni aprobación de dueño. Pruebas negativas de truncamiento, deriva,
duplicados/UUID, códigos literales, NULL/cero y separación de cambios observados
frente a correcciones ya aplicadas. Rollback no corresponde: no hay mutación.

## Resultado observado y reproducible

32 páginas completas, 15,961 códigos literales únicos y 179 tablas idénticas
antes/después. Las 15,876 variantes del snapshot anterior conservan su UUID;
85 UUIDs adicionales se observaron realmente. Los 435 códigos restantes del
corte SICAR22 son exactamente los del índice retenido; no hay bajas inferidas.

Los 15,961 códigos coinciden en departamento y sección. Hay 15,939 precios
iguales al corte y 22 distintos; 15,942 descripciones iguales y 19 distintas.
14,756 proyecciones completas coinciden y 1,205 tienen alguna diferencia de
comparación. Esas 1,205 **no son productos nuevos bloqueados ni preguntas para
dueños**: incluyen 865 casos con sólo atributos distintos y otros candidatos
complementarios de Woo. No se evalúan aquí la aprobación histórica de agrupación
ni la elegibilidad comercial. No se reemplazan atributos ni asociaciones.

Los motivos retenidos se superponen: 316 restricciones de exhibición/venta,
86 taxonomías, 40 precios inválidos (38 con precisión extra y dos ceros) y tres
conflictos de categoría. Se conservan los valores textuales exactos.

El censo actual distingue 7,768 códigos vinculados a Woo y 8,193 sólo SICAR.
Hay 5,984 evidencias de foto: 5,871 no vacías con copia y metadata/reader exactos,
y 113 ausencias explícitas preservadas. Hay 1,393 huecos de evidencia en el
alcance del censo y 391 vínculos simples separados. Cero problemas observados de
identidad, mapa, metadata de objeto o hash de copia. No se descargaron bytes;
estas cifras no autorizan publicación ni rellenar las 113 ausencias.

La auditoría conserva una fila de saldos y ocho movimientos de inventario ya
existentes, sin cambio entre las dos huellas. No confundir historial existente
con una nueva carga, ni las existencias mostradas con conteo físico confirmado.

## Siguiente corrección técnica acotada: 12 precios, todavía sin aplicar

Los códigos literales `3416` a `3427` tienen 179,000 centavos en la proyección
nativa y gestionada. El Precio1 textual de SICAR19 y SICAR22 es `1990` en ambos
cortes, equivalente a 199,000 centavos. El snapshot previo ya tenía 179,000:
este desfase anterior no aparecía en el plan que comparaba sólo cambios 19→22.
No está relacionado con los 40 precios inválidos retenidos. Las descripciones
son BRWPEZMARYTICA26 a BRWPEZMARYTICA31.5, pero **no se propone agruparlas**.

Lo observado para los 12: Clave1, UUIDs y taxonomía conservados, único binding,
activos, unidad PIECE, costo NULL, atributos vacíos y Woo parent/variation NULL.
SHA de fuente nativa original:
`3940d108da85729d074284f83e27f3ffe700d03818273c5f96bb087c73828d37`.
El extractor completo no contiene el estado íntegro de web, registro provisional
ni permisos: no se declara elegibilidad de venta o de sincronización.

El preparador/escritor protegido existente sólo admite los diez precios fijados
980→1150 y el caso 11777 8100→8300. **Debe rechazar los 12 actuales**. No se
reutiliza el protocolo antiguo falsificando cortes, códigos, fechas o preimágenes.
Para una aplicación posterior:

1. Capturar `app.m9_sicar_price_state` de los 12 UUIDs actuales y las definiciones
   y ACL instaladas, sólo lectura. Exigir separación provisional, fuente y
   `current==source_row`, ningún contexto web, snapshots/fuentes originales
   inmutables, mismos UUIDs, nombres, atributos, categorías, costos y claves.
2. Extender estrechamente el mismo preparador/escritor y diario. Nuevo protocolo
   literal para estos 12 y transición 179000→199000; rechazar cambios adicionales,
   fuente distinta o vínculos Woo nuevos. Actualizar sólo precio y su proyección
   gestionada; jamás inventario, costos, agrupación o precio Woo.
3. Mantener actor postgres de mantenimiento + ADMIN activo + permiso explícito
   `products.price_update`, guard staging y ACL pública cerrada. Barreras NOWAIT
   y advisory común dentro del subbloque recuperable, con igualdad del estado
   completo bajo locks. Dos preparaciones idénticas y preimágenes fijadas.
4. Ensayar APPLY/replay/REVERSE/replay en QA, auditoría completa antes/después y
   ROLLBACK exacto; negativas y ambas carreras con escritor real. Regresión
   exacta de los diez y de 11777. Compensación sólo si la postimagen sigue exacta,
   diario aditivo, preservando historia. Root revisa antes de DDL/DML en staging.

Este bloque entrega candidatos y plan inertes, no ese nuevo protocolo ni SQL
de mutación sin QA. Las siete diferencias sólo de descripción adicionales
(16601 y 17407–17412) también existían antes del corte19: se informan, no se
mezclan con las siete descripciones ya corregidas 18221–18227. `7522` conserva
su retención de descripción+precio; `13659`, `7047` y los 435 no se liberan.

## Verificación y expediente

40 pruebas unitarias enfocadas: paginación completa, truncamiento, huellas,
duplicados, literalidad, fechas, sidecar Woo observado, NULL sin rellenar,
UUIDs y separación de precios/atributos. Corridas finales `corrida-2` y
`corrida-3`, idénticas byte a byte; la corrida preliminar 1 se conserva.
El manifiesto privado fija entradas y salidas; el verificador local compara
todos esos hashes y vuelve a ensamblar las páginas sin acceso a red.

Expediente privado: `outputs/m9-preparacion-corte-integral-2026-10-23/catalogo`.
No hay PII de clientes, fuente privada ni payload real en Git. El 97.35% sólo
describe presencia de códigos (15,961/16,396); no es avance global de migración,
stock listo, aceptación de los dueños o fecha de entrega.

Revisión independiente posterior: dos endurecimientos de procedencia en un
commit separado. MCP sólo acepta `isError === false`; una respuesta sin ese
booleano no acredita éxito. La ventana compara instantes UTC normalizados a
microsegundos y conserva las cadenas originales, evitando invertir límites al
mezclar `Z`, `+00:00` y precisiones distintas. Dos regresiones nuevas: 42 pruebas
enfocadas aprobadas. Corridas y manifiesto anteriores conservados; cierre nuevo
en `corrida-4`, `corrida-5`, `manifest-cierre-p2.json` y
`verificar-catalogo-p2.mjs`. Para reconstruir el cierre anterior con sus pins de
código se requiere el commit original `b2419be`, sin reescribir sus resultados.
