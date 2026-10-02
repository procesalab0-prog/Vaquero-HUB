# M9: analizador de solo lectura, versión m9-readonly-1

Esta entrega genera evidencia; no contiene importador, RPC, conexión a Supabase,
modo apply, creación de SKU ni cambios de inventario. SICAR conserva autoridad
sobre el catálogo y Clave 1. Woo aporta sólo información complementaria.

## Ejecución reproducible

Requisitos: Node 24 (lectura nativa de TypeScript), Python 3.10+ y dependencias
bloqueadas del repositorio, incluido ExcelJS. Ejecutar desde la raíz.

```sh
# Exportación nativa: Productos > Exportar, todas las columnas, tipos y categorías.
# Verificar total de padres en el panel; no activar metadatos personalizados.
python3 scripts/m9/woo_csv.py --csv /ruta/woocommerce.csv \
  --expected-parents 2092 --out /ruta/woo-authenticated.json
node scripts/m9/report.mjs --sicar /ruta/sicar.xlsx \
  --woo /ruta/woo-authenticated.json --out /ruta/reporte-nuevo
# Segunda corrida con los mismos archivos y un directorio nuevo:
node scripts/m9/report.mjs --sicar /ruta/sicar.xlsx \
  --woo /ruta/woo-authenticated.json --out /ruta/reporte-repetido
diff -r /ruta/reporte-nuevo /ruta/reporte-repetido
```

El número 2092 corresponde a esta captura, no es una constante del catálogo.
El CSV debe guardarse completo junto al JSON normalizado. Su SHA-256 queda en
ambos manifiestos. Nunca usar contraseñas de WordPress como claves REST.

Alternativa de lectura pública:

```sh
node scripts/m9/capture.mjs --origin https://vaquerosm.com --out /ruta/publico.json
```

El capturador sólo hace GET, rechaza redirecciones y exige paginación íntegra,
totales estables e IDs distintos. Admite `--mode authenticated` con claves REST
existentes de lectura en `WOO_READ_KEY` y `WOO_READ_SECRET`; no las crea ni guarda.
No se utilizó esta alternativa autenticada: se obtuvo el CSV nativo mediante la
sesión ya abierta del panel. La Store API sólo cubre productos publicados:
https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/

## Fuentes y cobertura

Captura del 23 de septiembre de 2026: 16035 filas SICAR; CSV Woo con 2092 padres
(1983 publicados, 85 borradores, 24 privados) y 11971 variaciones. Coincide con
los contadores del panel. Se excluye la papelera. Los metadatos personalizados
no fueron exportados; no se declara acceso completo a todos los datos de Woo.
El CSV no es una transacción atómica: una futura corrida requiere una captura
nueva y comprobación de totales. No se conoce la fecha efectiva del stock SICAR.

## Contrato de lectura y comparación

- Un solo XLSX poblado, máximo 25 MiB comprimido/100 MiB declarado expandido,
  100000 filas y 100 columnas. Se exige `clave1 *` y `descripción *`.
- Se guardan todas las columnas originales como texto y el número de fila.
  Clave 1 numérica, fórmulas y celdas no admitidas se marcan, jamás se corrigen.
  El archivo binario original preserva formato y valores para auditoría.
- Comparación NFC, mayúsculas y trim; no se eliminan guiones, puntos, Ñ ni
  ceros iniciales. El código base proviene sólo de descripción corta.
  Múltiples bloques de texto no se concatenan. Bases con espacios internos
  o entidades HTML no interpretables se rechazan conservadoramente.
- Se evalúan todos los prefijos posibles. No se selecciona el más largo para
  resolver ambigüedades. Bases duplicadas, Clave 1 duplicadas, descripciones
  repetidas, IDs y combinaciones de atributos repetidas bloquean el vínculo.
- Un atributo exige coincidencia exacta del sufijo. Los slugs públicos sólo se
  traducen mediante términos explícitos del mismo padre. Dos o más atributos
  requieren `TALLA=30;LARGO=32`, sin inferir concatenaciones ni ignorar dimensiones.
  `T.M`, `30X32` o `MUESTRA` no se convierten silenciosamente.
- CSV: las dimensiones de variación se obtienen de las filas hijas. No se usa
  visibilidad del atributo como indicador de variación. Variaciones bajo padre
  simple se bloquean, incluso si el exportador las conserva históricamente.
- Precio1 frente a precio normal y stock explícito Woo son diagnósticos. No se
  decide política de impuestos, canal o fecha. Si hay precio rebajado, no se
  adivina su vigencia: precio no comparable. Diferencias se marcan CONFLICT.
  Costos/precios cero exigen revisión. Precio2–4 vacíos permanecen vacíos;
  valores no vacíos inválidos se bloquean. No se redondea ni inventa cero.
- Dinero y cantidades se comparan mediante enteros BigInt escalados. Se admite
  precisión de centavos y tres decimales de cantidad. Se reportan por separado
  las filas excluidas de totales por datos inválidos.
- Dos filas nunca pueden reclamar el mismo destino. Todos los resultados
  tienen `automatic_import_allowed: false`, incluso las coincidencias exactas.

## Artefactos y revisión

`resumen.md`: conteos y límites. `manifest.json`: versiones, alcance y hashes.
`filas.json`: una fila por registro SICAR, originales, candidatos, clasificación,
motivos y controles comerciales. `excepciones.json`: filas con revisión y casos
Woo pendientes. `woo-revision.json`: cada padre y variaciones no vinculadas.
`metricas.json`: conteos, integridad de códigos y totales parciales de origen.
`sha256.json`: huellas de todos esos artefactos, idénticas al repetir corrida.

Clasificaciones: MATCH_EXACT_VARIANT (identidad única); SICAR_ONLY (sin padre en
esta captura, agrupación aún manual); DUPLICATE_WOO_BASE; VARIANT_NOT_PUBLISHED
(ausente o no publicado, sin afirmar que fue eliminado); SPECIAL_SUFFIX;
CONFLICT. WOO_ONLY se cuenta por padres en `woo-revision.json`, no por filas SICAR.
Las categorías son exclusivas y siguen el orden: problemas SICAR, ausencia,
duplicidad de base/prefijos, estructura Woo, sufijo, estado y datos comerciales.
La clasificación no reemplaza los demás motivos ni autoriza importación.

SICAR_ONLY es normal: no se restringirá el catálogo al subconjunto de Woo.
Esta fase aún no deriva agrupaciones de padres SICAR sin correspondencia ni
exporta una plantilla importable. Las excepciones necesitan decisión humana.

## Verificación y siguiente compuerta

```sh
node node_modules/vitest/vitest.mjs run tests/unit
python3 scripts/m9/test_woo_csv.py
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build --webpack
```

Se reutiliza la lectura de celdas y validación ZIP de M2 mediante
`lib/import-xlsx.mjs`, conservando los límites de M2. No se duplica su importador.
El motor M9 está aislado, sin dependencias de configuración de aplicación.
Los datos/exportaciones reales se mantienen fuera de Git.

El ensayo actual es local y offline. **No se ha validado una importación en
staging alojado.** El handoff, alcance paso 8, establece: «No escribir en staging
hasta que el reporte de sólo lectura esté aprobado». Después de revisarlo se
podrá implementar y probar en staging el modo catálogo, con pruebas de stock
sin cambios e idempotencia de estado; producción sigue fuera del alcance.

Se trabaja en `codex/m9-conciliador-lectura`, worktree aislado de la copia con
cambios no confirmados de PWA/POS. El analizador tiene versión independiente
`m9-readonly-1`; no se publica ni cambia la versión visible de la aplicación.

### Evidencia de verificación de esta entrega

- 30 pruebas unitarias Node aprobadas, incluidas 16 de M9 y regresiones M2.
- 5 pruebas Python del adaptador CSV aprobadas.
- ESLint, TypeScript y build Next webpack aprobados. El primer build sin red
  no pudo descargar Google Fonts; la repetición con acceso a esas fuentes pasó.
- Dos corridas completas sobre los mismos bytes generaron archivos idénticos.
- 16035 filas de origen únicas en el reporte, Clave 1 conservada y hash del
  XLSX original sin cambios. Cero filas habilitadas para importación automática.
- No se ejecutaron pruebas contra Supabase, importación ni navegador de la app:
  no hay cambio visible de interfaz ni nueva versión publicada. Los ensayos
  de estado/inventario en staging siguen pendientes, no simulados como cumplidos.

## Revisión por grupos y exportaciones recurrentes — m9-review-1

Tras cada reporte nuevo, ejecutar:

```sh
node scripts/m9/review.mjs --report /ruta/reporte-nuevo \
  --woo /ruta/woo-authenticated.json --out /ruta/revision-nueva \
  --previous /ruta/revision-anterior/estado.json \
  --decisions /ruta/registro-decisiones.json
```

En la primera ejecución omitir `--previous` y `--decisions`. El HTML permite
buscar Clave 1, descripción o IDs; muestra hasta 20 ejemplos por grupo. El JSON
`grupos.json` conserva todos los miembros. Las filas pueden participar en una
revisión de identidad y varios temas comerciales, por lo que no deben sumarse
sus conteos como si fueran filas distintas.

Los grupos con candidatos Woo usan el conjunto de IDs padre. Para SICAR sin
padre se sugiere un prefijo quitando números finales o `T.M` y agrupando también
por departamento/categoría. **Es una hipótesis para revisar**, nunca un producto
ni una regla aprobada: esos números pueden pertenecer al modelo. Los 170 casos
Woo sin prefijo incluyen bases inválidas; no equivalen a los 92 WOO_ONLY del
reporte anterior (que excluía las bases inválidas).

`decisiones-plantilla.json` comienza completamente pendiente. Mantener un
registro separado con las entradas que el humano haya revisado. Los estados
admitidos son `pending`, `acknowledged` (revisión reconocida) y `deferred`
(pospuesta); los dos últimos exigen revisor, fecha YYYY-MM-DD y motivo. No hay
estado que apruebe importación, ni se aplican reglas de agrupación desde notas.
No reemplazar el registro humano con una nueva plantilla vacía.

Cada entrada usa ID de grupo y huella de evidencia. Una decisión se muestra
vigente únicamente con la misma evidencia, versión de reglas y alcance. Cambios
reabren el grupo; miembros nuevos nunca heredan una revisión automáticamente.
Las decisiones de grupos ausentes se conservan en `decisiones-sin-grupo.json`.
La evidencia de identidad omite precio/stock y posición de fila; los temas
comerciales conservan sus propios datos. Esto permite distinguir una revisión
comercial pendiente de una agrupación estable.

`estado.json` es la línea base reproducible. `cambios.json` detecta registros
nuevos, ausentes, modificados y claves ambiguas, usando Clave 1 exacta para SICAR
e ID para Woo. Un cambio de alcance se señala; no se interpreta como baja.
Las capturas no se sobreescriben y la primera corrida no inventa historial.

Verificación: siete pruebas nuevas (37 unitarias Node en total), lint y tipos
aprobados; repetición de la captura real sin altas, ausencias ni cambios. No se
solicitó otra exportación ni se consultó producción para esta etapa: se utiliza
la captura autenticada ya conservada del 23 de septiembre.

## Actualización vigente: costos y taxonomía (m9-readonly-2 / m9-review-2)

La decisión expresa del usuario del 24 de septiembre sustituye la regla anterior
que exigía revisar costos cero: significan costo no capturado. Se conserva el
valor crudo y se añade cost_status; no se fabrica un costo real cero. Precio de
venta cero sigue requiriendo revisión. La valuación de inventario pasa a null,
con estado UNAVAILABLE_COSTS_NOT_VERIFIED; no hay margen calculado. Los importes
no cero del archivo no se consideran costos confirmados por esta decisión.

`departamentos-secciones.md` muestra el árbol completo; su JSON contiene IDs
estables por pareja exacta de nombres, conteos, Claves 1, muestras y rutas por
revisar. `categoria` se usa como segundo nivel porque no hay columna `sección`.
Nombres originales, departamentos y combinaciones se conservan; no se extraen
marcas del nombre de sección ni se fusionan departamentos por parecido.
El ID es una huella de nombres de origen, no un ID de base de datos destino;
un cambio de nombre requiere una decisión explícita, no equivalencia automática.

Resultado vigente: 11738 filas en revisión manual, 3092 grupos de identidad y
9 temas comerciales. Taxonomía: 12 departamentos, 301 nombres de sección, 463
rutas; 8 rutas con marcadores dudosos y 59 padres Woo en múltiples rutas SICAR.
41 pruebas Node, tipos y lint aprobados. Todo sigue offline, sin escrituras de
inventario/catálogo ni habilitación de importaciones.

## Comparación de padres y propuestas SICAR_ONLY — m9-grouping-1

```sh
node scripts/m9/grouping.mjs --report /ruta/reporte \
  --woo /ruta/woo-authenticated.json --out /ruta/agrupacion-nueva
```

Se verifican hashes de fuentes. `agrupacion.json` contiene todos los casos,
miembros, candidatos, atributos y rutas originales; `PROPUESTAS.md` ofrece
muestras y `DECISIONES.md` concentra preguntas de negocio. Los casos llevan ID
estable por identidad de grupo y huella de evidencia; estado siempre manual.
No modifican clasificaciones ni vínculos del conciliador.

De los 59 padres con múltiples rutas (543 filas), 45 conservan la sección y
cambian departamento, 12 cambian sección en el mismo departamento y 2 cambian
ambos. Conservar la clasificación por Clave 1 evita elegir una categoría padre
por mayoría. El patrón por talla es evidencia para preguntar, no regla aprobada.

Hay 55 bases duplicadas: 18 comparten combinaciones de atributos y 37 no tienen
solapamiento observado. Se incluyen todos los estados y problemas estructurales;
no se elige por nombre, precio o foto. La lista conserva otros padres candidatos
para que una coincidencia dentro de una base no oculte prefijos superpuestos.
804 Claves 1 aparecen en estos grupos; difieren de las 786 clasificadas como
DUPLICATE_WOO_BASE porque el conciliador da prioridad a otros conflictos.

SICAR_ONLY: 1630 hipótesis cubren 4849 de 6064 filas, 3404 con más de una
hipótesis y 1215 sin propuesta. Se separan siempre departamento/sección. Sólo
se ofrecen familias con al menos dos sufijos distintos: T. explícito o cortes
alternativos de los últimos 1–3 dígitos y decimal. No se intenta enumerar todas
las sintaxis de talla. No se elimina todo el tramo numérico ni se aprueba un
corte automáticamente; las propuestas pueden solaparse y no son padres finales.

Validación: 7 pruebas nuevas, 48 Node en total, lint y tipos. Dos ejecuciones
reales generan los mismos artefactos. No hubo nueva captura, escritura remota,
importación ni despliegue de aplicación.


### Confirmación del usuario: departamento por talla — 24 de septiembre

El usuario confirmó que un mismo modelo cambia de departamento según la talla.
Conservar departamento y sección por Clave 1; no crear padres separados sólo
por ese cambio ni inferir umbrales universales. Se registra la decisión y las
huellas de los 45 casos observados en M9_DECISIONES_NEGOCIO.json. Confirma el
patrón de clasificación, no todos los vínculos ni una importación. Los 14 casos
con sección distinta y los duplicados permanecen pendientes. El comparador de
agrupaciones sigue siendo diagnóstico: este registro no cambia sus clasificaciones.

## Duplicados: propuestas globales por Clave 1 — m9-duplicates-1

```sh
node scripts/m9/duplicates.mjs --report /ruta/reporte \
  --woo /ruta/woo-authenticated.json --out /ruta/duplicados-nuevo
```

Este análisis refina el de grupos: cuenta cada Clave 1 una vez, incorpora
productos simples y comprueba TODOS sus padres candidatos. No interpreta el
nombre ni privilegia publicados frente a privados/borradores para eliminar
ambigüedad. Bloquea comodines/problemas estructurales incluso en padres vecinos,
prefijos superpuestos, códigos/descripciones repetidos y destinos ocupados.
Un atributo exige sufijo exacto; varios requieren todos los atributos etiquetados.

Resultado: 55 grupos (35 con tallas disjuntas, 18 con solapamiento y 2 con
problemas estructurales). De 804 filas: 508 con un candidato publicado observado,
10 con múltiples destinos exactos, 39 con estructura Woo conflictiva, 66 sin
variante exacta, 128 con prefijos superpuestos, 18 con conflictos SICAR y 35 no
publicadas. Los 508 son propuestas pendientes, no vínculos aprobados ni nuevas
coincidencias del reporte canónico. No se aprueba importar ninguna fila.

En los 10 casos con destinos competidores, características y clave2 SICAR están
vacíos: la exportación no aporta una distinción adicional. Gorras/diseños, bolsas,
hebillas y otros casos se conservan separados para decisión humana. No se asume
que compartir código significa mismo modelo físico ni se crean existencias
separadas a partir de diseños Woo.

Salida: DUPLICADOS.md, duplicados.json, manifest y SHA-256. Validación: siete
pruebas nuevas (55 Node en total), lint, tipos y dos corridas reales idénticas.
Los conteos anteriores por grupo no eran únicos por Clave 1; no compararlos
sumando candidatos de bases distintas.


### Respuestas de los dueños — 29 de septiembre de 2026

Registradas las ocho respuestas en M9_RESPUESTAS_DUENOS_2026-09-29.md y
M9_DECISIONES_NEGOCIO.json. Se confirma separación de diseños con códigos propios,
conservación de códigos existentes, muestras de exhibición, búsqueda por familia,
notación de tallas y precio público igual entre canales salvo promociones. No se
infiere el mapa Precio1–4, reglas de margen, clasificación pendiente ni códigos
nuevos. Los códigos compartidos exigen transición explícita; no duplicar su
asignación ni repartir stock. Reportes previos no recalculados; sin aprobación
de importación o escritura en staging/producción.

## Estado vigente — m9-readonly-3 (2026-09-29)

Las reglas de notación confirmadas viven en `suffixMatchRule`, compartidas por
los diagnósticos. T. sólo aplica al atributo Talla; X sólo se interpreta como
Talla × Largo cuando ésos son exactamente los dos atributos. No se aceptan
valores vacíos, atributos omitidos, inversión de orden ni números concatenados.
Se conserva coincidencia literal y notación explícita con etiquetas. No se
traduce CH/G a S/L ni se infiere ninguna equivalencia de valores.

Las descripciones terminadas en MUESTRA se marcan `display_only: true`, aun sin
padre Woo. No se confunden con mercancía vendible ni se pierden sus Claves 1.
La clasificación sigue priorizando conflictos de fuente cuando los hay.

El precio Woo se conserva como observación; no se compara contra Precio1 como
si fuera menudeo. `price_mapping_status: pending` y niveles destino null evitan
fabricar ese dato. Diferencias de existencia continúan como diagnóstico de
conflicto, sin copiar existencias. Costos cero permanecen no capturados.

El reporte incorpora `politica-migracion.json` y `cola-preparacion.json` con
identidades exactas y filas de exhibición. No contiene payload ejecutable ni
aprobación de importación. Todos conservan `automatic_import_allowed: false`.
Revisión comercial pendiente no significa que haya 16035 decisiones individuales:
falta resolver el mapa global de precios y después las excepciones particulares.

Ejecuciones con la misma captura: 6718 identidades exactas, 318 muestras,
2036 vínculos con notaciones confirmadas. Se actualizan reportes auxiliares
con los mismos comandos, siempre a carpetas nuevas. Los informes del 24 siguen
como historial; los del 29 usan reglas nuevas sobre datos del 23, no datos en vivo.
Dependencias restauradas desde lockfile en este worktree (sin scripts de
instalación); la copia original no se modifica. Build local con descarga de
fuentes aprobado; no hubo despliegue ni validación contra staging alojado.

## Actualización vigente: precio al público (2026-09-29)

Reglas `m9-readonly-4`: el usuario confirmó que `precio1` es el precio al público y pidió dejar mayoreo y medio mayoreo sin definir. Se conservan precio2–4 como evidencia original, sin asignarles un nivel ni interpretar ceros como precios de venta. Las diferencias con Woo requieren revisar promociones, sin corregirlas automáticamente. Esta decisión sustituye la duda de mapeo de precio1 de versiones anteriores. No autoriza importaciones, existencias ni escrituras en Woo o producción.

## Flujo de códigos compartidos aprobado (2026-09-29)

Reglas vigentes m9-readonly-5. El usuario aprobó conservar la etiqueta antigua compartida como búsqueda de grupo con selección obligatoria del diseño; cada diseño tendrá un código único. Los códigos ya únicos resuelven su variante sin cambiarse. Es aprobación del flujo, no de relaciones concretas SICAR/Woo ni de reparto de existencias. Sin relación validada se bloquea la selección automática. La interfaz y persistencia aún no están implementadas ni probadas en staging. Antes de importar se requiere mapa revisado código antiguo → grupo → diseños → códigos únicos, sin reutilizar el mismo código como identificador único de varias variantes.

## Respuestas y evidencia del 1 de octubre de 2026

Respuestas completas en M9_DECISIONES_NEGOCIO.json, owner_answers_2026_10_01. Evidencia local en outputs/m9-evidencia-2026-10-01/evidencia.html y JSON GET por ID. Catálogo histórico 23/09 no equivale a publicaciones visibles hoy. Gorras: producto con variantes de color, sin separación automática en padres. Botines 7922/7923 eran borradores; no afirmar duplicidad pública. Cintos: nuevas bases distintas comprobadas públicamente, Clave 1 vigente pendiente de nueva exportación SICAR. No resolver relaciones automáticamente con respuestas generales; no fusionar bolsas confirmadas distintas; camisas con código erróneo pendientes de código correcto, sin modificar Woo. Los reportes m9-readonly-5 se mantienen históricos, no mezclados con esta consulta parcial.

## Ensayo local de códigos — 1 de octubre de 2026

Implementado `scripts/m9/scan-rehearsal.mjs` versión `m9-scan-rehearsal-1`, separado del POS. No conecta a base de datos ni a WooCommerce. Búsqueda por cadena exacta, conservando ceros iniciales; rechaza números, espacios, prefijos parciales y colisiones. Mapas compartidos aprobados exigen selección explícita de diseño en cada lectura; evidencia cambiada invalida aprobación. No genera SKU ni códigos, ni permite ventas o importaciones. Las aprobaciones del selector se ejercitan únicamente con fixtures sintéticos; no se aprobaron relaciones reales.

Ejecutar desde el repositorio: `node scripts/m9/scan-rehearsal.mjs --report ../../outputs/m9-reporte-selector-aprobado --out ../../outputs/carpeta-nueva`. Valida hashes de filas y manifiesto del reporte de entrada. No acepta mapas externos en la CLI: los candidatos históricos no se convierten en aprobaciones.

Sobre 16,035 filas de la captura histórica: 5,807 vistas previas de identidad, 9,910 en revisión y 318 sólo exhibición. Todos los códigos exactos preservados. Dos ejecuciones idénticas byte por byte. 69 pruebas unitarias, lint de archivos nuevos y TypeScript pasan. Esta entrega sólo versiona la herramienta offline; no publica ni cambia versión de la app.

Pendiente: nueva exportación SICAR tras correcciones; captura Woo contemporánea; confirmar mapas de diseños y códigos; integrar y validar selector en staging alojado, con escaneo físico. No confundir ensayo local con importación o validación alojada. Evidencia: outputs/m9-ensayo-codigos-2026-10-01. No se modificó producción, WooCommerce ni existencias.

## Pantalla local de ensayo — 1 de octubre de 2026

M9 Scan UI 1.0.0 incorpora consulta de etiqueta completa y selector de diseños de demostración. Usa el mismo resolver puro (`scan-resolver.mjs`) que la CLI. El catálogo histórico y los fixtures se eligen en modos separados, sin activar mapas reales. Precio público procede de precio1; mayoreos sin definir. No hay persistencia ni conexión a base de datos o Woo.

Arranque: `node scripts/m9/scan-server.mjs --rehearsal ../../outputs/m9-ensayo-codigos-2026-10-01` desde work/m9; abrir http://127.0.0.1:3199. Sólo escucha en loopback, valida huella del ensayo, permite GET/HEAD y rutas explícitas. Sin cámara integrada: admite entrada manual o lector USB que escriba y envíe Enter. No se hizo prueba con lector físico.

Verificación en navegador: carga de 16,035 filas, camisa 17645 pendiente, grupo ficticio exige selección, selección guinda y segunda lectura vuelve a pedir diseño, 000123 distinto de 123. Captura en outputs/m9-ensayo-codigos-2026-10-01/selector.png. Comprobaciones HTTP: 200 inicio, 405 POST, 404 ruta ajena, 403 Host ajeno. 69 pruebas unitarias, lint y TypeScript pasan.

No se publica nueva versión de Mi Tienda SM: es una herramienta local independiente, versión M9 Scan UI 1.0.0. Integración con POS, staging alojado y escaneo físico siguen pendientes. No se importaron existencias ni se escribieron productos. Las correcciones anunciadas necesitan nueva exportación antes de validar vínculos reales.


## Registro vivo — lote de preparación para staging (2026-10-01)

Implementado scripts/m9/staging-batch.mjs, m9-staging-preparation-1. Entradas verificadas por SHA-256: filas, manifiesto y taxonomía; decisiones de negocio y comparación identificadas por huella. Se rechazó inicialmente la comparación enlazada al reporte provisional y se regeneró contra el reporte vigente como comparacion-sicar-reporte-vigente.json; mismos cambios SICAR, distinta huella del cruce Woo actualizado.

De 16,130 filas, 6,384 candidatas y 9,746 excluidas. Piloto reproducible de 40 variantes / 40 referencias padre Woo: primera por ruta departamento/sección en orden textual de código, hasta 40. Reserva todos los casos discutidos con dueños; bloquea revisión comercial, exhibición, clasificación pendiente, secciones distintas en familia y colisiones Woo. Preserva Clave 1 exacta, atributos, departamento/sección por variante y precio1 convertido a centavos sin redondeo. Costos y mayoreos sin definir. No contiene existencias, SKU generados ni instrucciones de alta/baja; no es plantilla de importación directa. Tres códigos ausentes se mantienen para revisión, sin eliminación.

Evidencia: outputs/m9-lote-staging-2026-10-01/{resumen.md,piloto.json,candidatos.json,excluidos.json,verificacion.json,manifest.json,sha256.json}. Dos ejecuciones idénticas byte por byte; 74 pruebas unitarias, lint de los nuevos archivos y TypeScript pasan. Sin cambios a Woo ni producción. Staging alojado NO ejecutado: falta lectura y correspondencia del destino, validación en seco con colisiones/categorías/escalas, aceptación del resultado concreto, ensayo de catálogo sin inventario e idempotencia y lectura física. Un subconjunto no autoriza desactivar tallas omitidas.

Reproducir desde work/m9:

```sh
node scripts/m9/staging-batch.mjs --report ../../outputs/m9-reporte-actualizado-2026-10-01 --decisions docs/M9_DECISIONES_NEGOCIO.json --comparison ../../outputs/m9-fuentes-2026-10-01/comparacion-sicar-reporte-vigente.json --out ../../outputs/nuevo-lote-staging
```


## Registro vivo — validación alojada de compatibilidad M9 (2026-10-01)

Se verificó staging zsezjtswqeijboezvado por Supabase list_branches. Ejecutado núcleo app.catalog_import_report en READ ONLY para piloto de 40: 0 aceptadas, 150 errores (40 categoría, 30 color, 40 talla/escala, 40 costo no capturado). Códigos y precios conservados 40/40; ninguna colisión. Catálogo destino vacío antes/después. No se cargó ni modificó esquema, Woo, producción o inventario.

Nuevo scripts/m9/staging-preflight.mjs (m9-staging-preflight-1) genera entrada diagnóstica no importable, SQL de sólo lectura y trazabilidad de campos que M2 omite. M2 no sirve para M9: origen SUPPLIER, sin IDs Woo ni clasificación por variante, costo obligatorio y segunda corrida rechazada. Se requiere camino M9 con soporte explícito de costo no capturado, clasificación exacta y reejecución transaccional. No resolver con un CSV que pierda datos. No falta una nueva respuesta del cliente para este hallazgo técnico.

Evidencia completa y reproducción: outputs/m9-staging-diagnostico-2026-10-01/resumen.md; entrada en outputs/m9-staging-preflight-2026-10-01. 77 pruebas, lint y tipos aprobados. Validación de compatibilidad alojada completada, pero carga/idempotencia/escaneo físico NO realizados. Sin versión nueva publicada de la app. El reporte de lote preparado anterior no equivale a compatibilidad con destino.


## Registro vivo — importador M9 y piloto persistido en staging (2026-10-01)

Implementado m9-import-1 con payload reproducible, plan read-only y aplicación transaccional privada limitada a postgres. Aplicadas migraciones 20261001232939, 20261001233047, 20261001233416 y 20261001233805 exclusivamente en staging zsezjtswqeijboezvado. 40 variantes/40 padres importados, códigos SICAR exactos, IDs Woo, costos NULL y mayoreos sin definir; clasificación por variante en m9_variant_details. SKU sólo desde secuencia. Atributos literales sin suponer escala comercial. No hay importación de existencias ni cambios Woo/producción.

Segunda corrida persistida: 0 altas, 0 cambios, 40 sin cambios; misma huella de catálogo, auditoría y secuencia. 40 comparaciones origen/destino completas, 0 filas/movimientos de inventario. 81 pruebas unitarias, lint y tipos aprobados; pruebas alojadas con rollback cubren grupos/tallas/departamentos, ceros, producto nativo, ausencias, cambios de precio, colisiones, ediciones externas, token vencido, inmutabilidad y permisos. La secuencia puede tener huecos por pruebas revertidas.

Se encontró importador plano de septiembre ya alojado, ausente en este worktree, con cero corridas/vínculos. No es compatible con agrupación por atributos ni costo desconocido. Reutilizados su control STAGING y candado; protegido contra sobrescritura de códigos M9. Pendiente integrar estos cambios con la rama reciente y converger los caminos antes de promover. No se ejecutó merge/deploy de aplicación. Revisar frontend y reportes para NULL, clasificación por variante y escalas literales; búsqueda en UI/lector físico pendientes. No se migraron imágenes/textos largos. Sólo se habilitó el piloto explícito, no el resto de candidatos.

Evidencia: outputs/m9-importacion-staging-2026-10-01/resumen.md, payload y plan, primera/segunda carga, comparaciones, regresiones, manifest y sha256. El diagnóstico M2 anterior permanece histórico: ya no describe el resultado del camino nuevo M9. Sin versión nueva publicada de Mi Tienda SM; versión independiente de herramienta m9-import-1.
