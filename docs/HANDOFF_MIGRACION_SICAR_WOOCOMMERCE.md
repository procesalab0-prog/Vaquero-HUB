# Relevo — Migración SICAR + WooCommerce

> Estado al 23 de septiembre de 2026. Este documento es el punto de entrada
> para una tarea nueva dedicada a M9. No contiene credenciales.

## Objetivo

Construir y verificar el conciliador/importador versionado que permitirá
migrar el catálogo de SICAR a Mi Tienda SM y, después, vincular el subconjunto
publicado en WooCommerce.

La herramienta se desarrolla y ensaya en **staging**. Esta etapa no autoriza
escrituras en producción, cambios en WooCommerce ni el corte definitivo de
SICAR.

## Fuentes de verdad

1. **SICAR es la fuente maestra inicial del catálogo y de la Clave 1.**
   No todos los productos de SICAR existen en WooCommerce.
2. **WooCommerce es un canal y una fuente complementaria.** Aporta imágenes,
   textos, categorías publicadas, IDs de producto/variación y atributos del
   subconjunto vendido en línea.
3. **Mi Tienda SM será la fuente maestra después del corte**, nunca antes.
4. La Clave 1 de SICAR es el código de barras heredado de la variante. Se
   conserva sin modificar como fila de `barcodes` con `source = 'SICAR'`.
5. El SKU propio de Mi Tienda SM se genera con `app.variant_serial_seq`; no se
   copia ni se deriva de SICAR o WooCommerce.

## Archivos disponibles

- Exportación de muestra utilizada en la auditoría:
  `/Users/emmanueljuarez/Downloads/Plantilla_Productos (3).xlsx`
- Repositorio/directorio de trabajo:
  `/Users/emmanueljuarez/Documents/Codex/2026-08-27/ca`
- Diseño de M9: [`PLAN_CODEX.md`](PLAN_CODEX.md#m9--importador-de-sicar-y-reporte-de-reconciliación-semana-10)
- Procedimiento operativo: [`RUNBOOK_CORTE.md`](RUNBOOK_CORTE.md)
- Reglas de códigos: [`specs/CODIGOS_Y_SKU.md`](specs/CODIGOS_Y_SKU.md)
- Catálogo y variantes: [`specs/M2_CATALOGO.md`](specs/M2_CATALOGO.md)
- Orden de trabajo: [`COLA_DE_TRABAJO.md`](COLA_DE_TRABAJO.md)

Los archivos bajo `/tmp` son efímeros y no forman parte del relevo. El nuevo
proceso debe volver a obtener o exportar los datos de WooCommerce de forma
reproducible.

## Hallazgo central sobre productos y variantes

SICAR aplana la variante dentro de `descripción *`. WooCommerce, en cambio,
guarda un código base en la descripción corta del producto padre y la talla,
color o largo como atributos de cada variación.

Ejemplos comprobados:

| WooCommerce: código base | WooCommerce: atributo | SICAR: descripción | SICAR: Clave 1 |
| --- | --- | --- | --- |
| `BRAMPH` | Talla `25.5` | `BRAMPH25.5` | Código de barras de esa variante |
| `BTILEGALPETCA` | Talla `27.5` | `BTILEGALPETCA27.5` | Código de barras de esa variante |
| `B7-75P22-DC` | Talla `32` | `B7-75P22-DC32` | Código de barras de esa variante |

La relación correcta es:

```text
producto base + atributos de variante
  -> variación WooCommerce
  -> Clave 1 SICAR
  -> variante Mi Tienda SM
```

Nunca se deben crear productos padre separados por talla sólo porque SICAR
incluye la talla al final de la descripción.

## Resultado cuantitativo de la auditoría de sólo lectura

### SICAR

- 16,035 filas de producto/variante.
- 16,035 valores no vacíos de `descripción *` analizados.
- Ninguna Clave 1 repetida en la muestra.
- Columnas relevantes confirmadas: `clave1 *`, `clave2`, `descripción *`,
  `características`, `departamento`, `categoria`, cuatro precios, tres niveles
  de mayoreo, costo, existencia, mínimos/máximos y localizaciones.

### WooCommerce público

- 1,983 productos publicados.
- 1,412 productos publicados con variaciones.
- 11,281 referencias a variaciones públicas.
- 1,975 productos publicados con código base utilizable en descripción corta.
- 1,860 códigos base normalizados distintos.
- Los SKU de los 1,983 productos padre publicados están vacíos.

### Cruce inicial

- 1,798 de 1,860 códigos base únicos de WooCommerce aparecen como prefijo en
  SICAR: **96.7 %**.
- 9,736 filas de SICAR comienzan con un código base publicado de WooCommerce:
  **60.7 % del archivo SICAR**. Es normal que el resto no coincida porque no
  todo SICAR se publica en línea.
- En 8,485 de 9,237 coincidencias que tenían sufijo, éste coincide con al
  menos un término de variante publicado en WooCommerce: **91.9 %**.
- Una regla estricta y segura sólo pudo asignar de forma única 4,859 de las
  16,035 filas (**30.3 %**). Este porcentaje no mide cobertura comercial: mide
  qué puede automatizarse hoy sin interpretación humana.

### Excepciones detectadas

- 47 códigos base duplicados en WooCommerce, que afectan a 162 productos.
- 665 filas SICAR llegan a uno de esos códigos padre duplicados.
- 4,188 filas tienen un código padre reconocible, pero el sufijo no existe
  exactamente entre las variaciones publicadas actuales.
- 6,299 filas SICAR no tienen producto padre publicado equivalente en el
  conjunto público de WooCommerce.
- Existen sufijos especiales como `MUESTRA` que no son tallas.
- Hay variantes históricas de SICAR cuya talla ya no está publicada en el
  producto WooCommerce correspondiente.
- Sólo se auditó mediante API pública el catálogo publicado. Borradores,
  privados, papelera y metadatos internos requieren la exportación autenticada
  o la REST API administrativa.

## Regla de conciliación

El conciliador debe clasificar cada fila, no forzar una coincidencia:

1. `MATCH_EXACT_VARIANT`: un único padre y una única variación compatibles.
2. `SICAR_ONLY`: existe en SICAR, no en WooCommerce. Se importa normalmente a
   Mi Tienda SM y queda sin IDs de WooCommerce.
3. `WOO_ONLY`: existe en WooCommerce, no en SICAR. No se da de alta ni se
   elimina automáticamente; requiere decisión humana.
4. `DUPLICATE_WOO_BASE`: más de un producto Woo usa el mismo código base.
5. `VARIANT_NOT_PUBLISHED`: coincide el padre, pero la talla/color/largo de
   SICAR no existe actualmente como variación Woo publicada.
6. `SPECIAL_SUFFIX`: valores como `MUESTRA` u otro sufijo no interpretable.
7. `CONFLICT`: mismo identificador, pero datos comerciales incompatibles.

El proceso debe normalizar únicamente para comparar. Siempre conserva el
valor original de SICAR y nunca reescribe la Clave 1.

## Alcance de la siguiente tarea (GPT-6 Astra, razonamiento Medio)

1. Leer completamente los documentos enlazados arriba antes de editar.
2. Revisar el código ya existente de M9 y sus pruebas; no duplicar un
   importador que ya exista.
3. Convertir la auditoría exploratoria en un analizador versionado y
   reproducible dentro del repositorio.
4. Aceptar la exportación SICAR sin modificarla y producir artefactos de
   salida separados: resumen, filas conciliadas, excepciones y métricas.
5. Incorporar el catálogo autenticado de WooCommerce en modo sólo lectura.
6. Diseñar el matching padre-variante usando código base + atributos, nunca
   nombre como identidad.
7. Crear pruebas de regresión para:
   - producto sólo SICAR;
   - producto sólo WooCommerce;
   - talla decimal;
   - talla ausente en Woo;
   - código padre duplicado;
   - sufijo `MUESTRA`;
   - dos atributos (por ejemplo talla + largo);
   - segunda corrida idéntica e idempotente.
8. Ejecutar corrida en seco. No escribir en staging hasta que el reporte de
   sólo lectura esté aprobado.
9. Cuando se habilite staging, demostrar que modo catálogo no cambia ninguna
   existencia y que dos corridas producen el mismo estado.

## Prohibiciones y compuertas

- No escribir en producción.
- No enviar todavía existencias ni productos hacia WooCommerce.
- No borrar, fusionar ni despublicar productos automáticamente.
- No guardar credenciales en el repositorio, reportes, logs o fixtures.
- No usar `service_role` en cliente ni variables `NEXT_PUBLIC_*`.
- No editar migraciones que ya entraron a `main`; toda corrección es una
  migración nueva, probada primero en staging.
- No importar existencias en esta primera etapa.
- No declarar una fila conciliada cuando haya más de un candidato posible.

## Criterio de término de esta etapa

- Analizador ejecutable y documentado.
- Reporte determinista para las 16,035 filas.
- Cada fila queda en exactamente una clasificación con motivo legible.
- Cero Claves 1 alteradas o inventadas.
- Cero escrituras a producción y WooCommerce.
- Pruebas, tipos, lint y build en verde.
- Reporte revisable por el cliente antes de habilitar staging.

## Prompt breve para iniciar la nueva tarea

> Continúa M9, migración SICAR + WooCommerce de Mi Tienda SM. Lee primero
> `docs/HANDOFF_MIGRACION_SICAR_WOOCOMMERCE.md` y todos los documentos que
> enlaza. SICAR es la fuente maestra inicial y WooCommerce una fuente
> complementaria; no todos los productos SICAR existen en Woo. Construye
> primero el analizador y conciliador reproducible de sólo lectura. No escribas
> en producción, no cambies WooCommerce y no importes existencias. Los casos
> ambiguos quedan en revisión manual. Trabaja en un worktree aislado, verifica
> cada cambio y mantén actualizado el documento de relevo.


## Continuación del 23 de septiembre de 2026: fase de lectura

Implementado el [analizador M9](M9_ANALIZADOR.md) y su adaptador CSV autenticado,
en worktree `codex/m9-conciliador-lectura`. La captura completa del exportador
contiene 2092 padres y 11971 variaciones; incluye borradores y privados, excluye
papelera y metadatos personalizados. Se conserva el CSV y sus huellas.

Corrida: 16035 filas, 4538 MATCH_EXACT_VARIANT, 6064 SICAR_ONLY, 786
DUPLICATE_WOO_BASE, 197 VARIANT_NOT_PUBLISHED, 2640 SPECIAL_SUFFIX y 1810
CONFLICT. 92 padres WOO_ONLY. Las diferencias frente a la auditoría pública son
esperables por cobertura autenticada y validaciones comerciales más estrictas.
15746 filas requieren revisión, incluidas coincidencias con costo cero o datos
incompletos. No hay códigos vacíos/duplicados ni códigos de 13 dígitos prefijo
20–29; una Clave 1 conserva cero inicial. Cuatro padres simples conservan hijos
históricos y quedan bloqueados. 46 cantidades no válidas se excluyen de totales.

No se implementó ni ejecutó importación; no hubo escrituras de catálogo, stock
o base de datos. Staging alojado sigue pendiente de revisión del reporte según
el paso 8. No se ha desplegado una nueva versión de Mi Tienda SM.

### 24 de septiembre: revisión reutilizable

Añadido `scripts/m9/review.mjs` (`m9-review-1`): 3092 grupos de identidad
propuestos, 10 temas comerciales y 170 casos Woo sin prefijo reconocido
(incluye bases inválidas). HTML consultable, plantilla de decisiones humanas,
huellas por grupo y comparador entre exportaciones. No hay decisiones humanas
registradas todavía. Los cambios reabren revisiones; las ausencias no causan
bajas. Se mantiene pendiente toda importación y la validación en staging.

### Decisión del usuario y taxonomía — 24 de septiembre

El usuario confirmó: «no le pusieron costos a sus productos, solo estan dejando
en cuanto lo venden». Regla `m9-readonly-2`: cero se conserva en origen y se
interpreta como costo no capturado; no bloquea por sí solo la identidad. No se
calcula margen ni valuación de inventario; los costos no cero siguen sin validar.
Las filas en revisión bajan de 15746 a 11738, sin cambiar las 4538 coincidencias.

También solicitó conservar departamentos y secciones en el sistema. La fuente
contiene `departamento` y `categoria`, sin columna `sección`. La segunda se
presenta como sección, con trazabilidad al nombre original: 12 departamentos,
301 etiquetas y 463 rutas distintas. No se adoptan categorías Woo como maestras
ni se fusionan secciones iguales bajo diferentes departamentos. Se detectaron
8 rutas con etiquetas dudosas y 59 padres Woo asociados a más de una ruta SICAR.
Estos casos quedan pendientes antes de asignar taxonomía única a un padre.

El reporte agrega departamentos-secciones.md/json en cada corrida. Pruebas:
41 unitarias Node, lint y tipos aprobados. No hay importación ni cambios remotos.

### Comparación detallada de padres — 24 de septiembre

`grouping.mjs` analizó los 59 padres multirruta: 45 cambian departamento sin
cambiar sección; otros 14 requieren revisar sección. Identificó 55 bases Woo
duplicadas, 18 con atributos solapados. Generó hipótesis para 4849 filas
SICAR_ONLY, manteniendo 1215 sin propuesta y sin aprobar agrupaciones. El usuario
aún debe confirmar modelo compartido por talla y los casos de sección distinta.
Los artefactos incluyen evidencia completa y decisiones concentradas. 48 pruebas
Node aprobadas; se conserva el bloqueo de toda importación y escritura remota.


### Confirmación del usuario: departamento por talla — 24 de septiembre

El usuario confirmó que un mismo modelo cambia de departamento según la talla.
Conservar departamento y sección por Clave 1; no crear padres separados sólo
por ese cambio ni inferir umbrales universales. Se registra la decisión y las
huellas de los 45 casos observados en M9_DECISIONES_NEGOCIO.json. Confirma el
patrón de clasificación, no todos los vínculos ni una importación. Los 14 casos
con sección distinta y los duplicados permanecen pendientes. El comparador de
agrupaciones sigue siendo diagnóstico: este registro no cambia sus clasificaciones.

### Duplicados revisados sin escribir — 24 de septiembre

Se agregó `duplicates.mjs`: 804 filas únicas analizadas globalmente; 508
propuestas de candidato publicado único aún pendientes, 10 destinos competidores
y 286 casos restantes bloqueados por fuente, estructura, prefijos, ausencia o
estado. No cambian las clasificaciones canónicas. Hay 35 grupos de tallas
separadas, 18 solapados y 2 con problemas estructurales; 55 pruebas Node pasan.
El usuario dijo «creo que si son intencionales» sobre las secciones de
TEXWP8XJMNE: sólo es una interpretación tentativa de ese caso, no confirmación
firme ni autorización para fusionar secciones o generalizarla a otros casos.


### Requisito reafirmado por el usuario: códigos existentes

Cada Clave 1 de SICAR debe conservarse exactamente, incluidos ceros iniciales,
y seguir funcionando para escanear/buscar en Mi Tienda SM. El SKU interno no
reemplaza ese código ni exige reetiquetar. Si un código agrupa diseños, no se
inventan códigos nuevos ni se duplica su asignación a variantes sin resolver
la relación. La aceptación de staging deberá verificar los códigos heredados
contra sus variantes aprobadas, sin importar existencias.


### Respuestas de los dueños — 29 de septiembre de 2026

Registradas las ocho respuestas en M9_RESPUESTAS_DUENOS_2026-09-29.md y
M9_DECISIONES_NEGOCIO.json. Se confirma separación de diseños con códigos propios,
conservación de códigos existentes, muestras de exhibición, búsqueda por familia,
notación de tallas y precio público igual entre canales salvo promociones. No se
infiere el mapa Precio1–4, reglas de margen, clasificación pendiente ni códigos
nuevos. Los códigos compartidos exigen transición explícita; no duplicar su
asignación ni repartir stock. Reportes previos no recalculados; sin aprobación
de importación o escritura en staging/producción.

### Reglas aplicadas al analizador — 29 de septiembre de 2026

`m9-readonly-3` reconoce T. como talla y talla X largo (también T.25X32), sólo
si todos los atributos coinciden. Se comparten las reglas entre conciliador,
agrupador y revisión de duplicados. Dos notaciones que reclamen el mismo destino
siguen bloqueadas; tampoco se elige entre bases duplicadas o prefijos ambiguos.

La captura original, sin modificaciones, da 6718 MATCH_EXACT_VARIANT (antes
4538), 5899 SICAR_ONLY, 773 DUPLICATE_WOO_BASE, 296 VARIANT_NOT_PUBLISHED,
686 SPECIAL_SUFFIX y 1663 CONFLICT. Hay 318 filas marcadas de exhibición;
2036 filas enlazadas usan las notaciones confirmadas. La igualdad comercial no
se presume: Precio1–4 no tienen mapa confirmado y la revisión de precios queda
pendiente para todas las identidades. Esto no exige revisar una por una las
16035 filas: primero falta la decisión general de correspondencia de columnas.
No se genera precio destino, margen, costo inventado ni existencia importada.

Se generan politica-migracion.json y cola-preparacion.json, que no son plantillas
importables. Los reportes auxiliares se recalcularon. Las coincidencias de
notación ahora dejan 17 casos con varios destinos exactos en duplicados, frente
a 10 antes; se mantienen manuales. Los casos de taxonomía multirruta pasan de
59 a 75 al aumentar identidades reconocidas; las aprobaciones anteriores no
se extienden automáticamente a casos nuevos.

Fuentes siguen siendo los archivos conservados del 23 de septiembre. No se
consultó ni modificó producción. No se implementó búsqueda de interfaz ni
transición de códigos compartidos; son requisitos para la fase posterior.
Pruebas Node, tipos, lint y build local aprobados; dos corridas completas del
reporte idénticas y Clave 1 conservada fila por fila. Versión de herramienta 3;
sin nueva versión publicada de la aplicación ni importación en staging alojado.

## Actualización vigente: precio al público (2026-09-29)

Reglas `m9-readonly-4`: el usuario confirmó que `precio1` es el precio al público y pidió dejar mayoreo y medio mayoreo sin definir. Se conservan precio2–4 como evidencia original, sin asignarles un nivel ni interpretar ceros como precios de venta. Las diferencias con Woo requieren revisar promociones, sin corregirlas automáticamente. Esta decisión sustituye la duda de mapeo de precio1 de versiones anteriores. No autoriza importaciones, existencias ni escrituras en Woo o producción.

## Flujo de códigos compartidos aprobado (2026-09-29)

Reglas vigentes m9-readonly-5. El usuario aprobó conservar la etiqueta antigua compartida como búsqueda de grupo con selección obligatoria del diseño; cada diseño tendrá un código único. Los códigos ya únicos resuelven su variante sin cambiarse. Es aprobación del flujo, no de relaciones concretas SICAR/Woo ni de reparto de existencias. Sin relación validada se bloquea la selección automática. La interfaz y persistencia aún no están implementadas ni probadas en staging. Antes de importar se requiere mapa revisado código antiguo → grupo → diseños → códigos únicos, sin reutilizar el mismo código como identificador único de varias variantes.

## Respuestas y evidencia del 1 de octubre de 2026

Respuestas completas en M9_DECISIONES_NEGOCIO.json, owner_answers_2026_10_01. Evidencia local en outputs/m9-evidencia-2026-10-01/evidencia.html y JSON GET por ID. Catálogo histórico 23/09 no equivale a publicaciones visibles hoy. Gorras: producto con variantes de color, sin separación automática en padres. Botines 7922/7923 eran borradores; no afirmar duplicidad pública. Cintos: nuevas bases distintas comprobadas públicamente, Clave 1 vigente pendiente de nueva exportación SICAR. No resolver relaciones automáticamente con respuestas generales; no fusionar bolsas confirmadas distintas; camisas con código erróneo pendientes de código correcto, sin modificar Woo. Los reportes m9-readonly-5 se mantienen históricos, no mezclados con esta consulta parcial.

### Aclaración del caso 2 — gorras Cuadra (2026-10-01)

El usuario confirmó «Son diferentes» para Woo 23955 y 29646. Mantener productos separados aunque compartan nombre y base GORRCUAMETCOC. No decidir cuál corresponde a Clave 1 11756 ni duplicar ese código; mapa de códigos pendiente. Ver followup_answers_2026_10_01 en M9_DECISIONES_NEGOCIO.json.

### Hebillas Cala: separación provisional (2026-10-01)

Por instrucción del usuario, mantener Woo 22759 y 22760 separados mientras no aparezca evidencia del primero. No es confirmación definitiva de identidad física ni asignación de Clave 1 12868. No fusionar, publicar ni duplicar códigos automáticamente; reabrir al contar con evidencia. Ver followup_answers_2026_10_01.question_4.

### Camisas: corrección anunciada y siguiente exportación (2026-10-01)

El usuario informa que corregirán las camisas y pide continuar con exportación. Estado: pendiente recibir SICAR actualizado; no considerar realizada la corrección. Claves originales 17645/17646/17647/17648/17650/17651/17652 deben conservarse. No asignar colores por secuencia. Comparar por Clave 1 exacta y revisar cambios con captura Woo contemporánea; mantener casos no resueltos en revisión.

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

## Registro vivo — exportaciones renovadas (2026-10-01)

Vigente: M9_REVISION_EXPORTACION_2026-10-01.md. SICAR 16,130 filas; Woo autenticado 2,119 padres y 12,139 variantes; reporte actualizado reproducible, sin escrituras de catálogo. Camisas aún sin corrección verificable; cintos y gorras con bases diferenciadas, pero persisten bloqueos particulares. 3 Claves 1 antiguas ausentes no se eliminan. La pantalla local aún usa la captura antigua.


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


## Requisito reafirmado — alta completa en WooCommerce desde Mi Tienda SM (2026-10-01)

El usuario reafirma: «este programa lo estamos haciendo para dar de alta también productos en WooCommerce. Lo que agreguemos al programa que también se dé de alta en WooCommerce, así como está en WooCommerce con su descripción y todo esto».

El alta debe capturarse una sola vez en Mi Tienda SM y preparar también la ficha web completa: nombre, descripción larga, descripción corta/código base según la estructura existente, imágenes, precio público, atributos y variantes, y clasificación web con correspondencia explícita. No basta sincronizar nombre/precio ni crear una publicación por talla. No inventar contenido faltante. El código base, el SKU interno y el código de barras de cada variante son campos distintos; los códigos SICAR existentes se conservan.

Para productos ya presentes en Woo, reutilizar los IDs conciliados, nunca dar de alta un duplicado. Para productos nuevos, guardar los IDs devueltos y reintentar sin duplicar padres ni variantes. Una falla de Woo no debe perder el alta interna: mostrar pendiente/error y permitir reintento. Los departamentos/secciones SICAR por variante no se equiparan silenciosamente a categorías Woo.

La sección 9 del plan maestro recomienda inicialmente crear como borrador para revisar ficha e imágenes antes de publicarlas; se mantiene esa recomendación, sin atribuir al usuario una decisión explícita nueva sobre visibilidad inmediata. El formulario debe contemplar la ficha web desde su diseño, aun mientras la conexión de escritura está deshabilitada en esta fase. El piloto actual sólo migró catálogo: imágenes/textos largos y el flujo de alta web todavía no están implementados ni validados de extremo a extremo.

Este recordatorio reafirma el alcance funcional; no habilita escrituras actuales en WooCommerce, producción ni existencias, ni el cambio anticipado de fuente maestra. Próximo trabajo autorizado: visualización y búsqueda del piloto en staging, conservando este requisito para la integración de alta web. Sin cambio de esquema, importación ni nueva versión de aplicación en esta anotación.


## Registro vivo — revisión del piloto y contenido web (2026-10-01)

Preparada versión 0.55.4, aún no publicada, en work/m9-ui (rama codex/m9-staging-review, base 5366bd4). Consulta nativa /productos/migracion: permiso products.read, búsqueda exacta/textual, clasificación por variante, paginación y costos NULL protegidos. Migración 20261001235334 aplicada sólo a staging. 18 comprobaciones SQL con rollback y 40/40 filas origen/destino correctas; inventario intacto. 65 pruebas unitarias, lint, tipos y build aprobados. Avatar S local muestra 0.55.4; muestra estática del componente revisada en teléfono e iPad. NO confundir esa muestra con sesión nativa autenticada: Preview, recorrido completo y lector físico del piloto siguen pendientes.

Corregido costo vacío tanto en formulario como en servidor, evitando convertirlo en cero. Clave 1 se conserva exactamente en barcodes.source=SICAR; SKU interno independiente. Precio1 es público; mayoreos siguen sin definir. SICAR continúa maestro antes del corte.

Se avanzó después a scripts/m9/prepare-web-content.mjs: paquete local reproducible de textos, fotos, IDs, atributos y promociones para 40 padres/40 variantes. Todos tienen descripción larga e imágenes en la exportación; 38 familias tienen variantes adicionales que deben preservarse. IDs de categorías requieren correspondencia explícita. No es un importable, no crea productos Woo ni implementa todavía el alta web completa.

Detalle: docs/M9_REVISION_UI_Y_CONTENIDO_WEB.md en work/m9-ui. Evidencia en outputs/m9-revision-ui-2026-10-01 y outputs/m9-contenido-web-2026-10-01. Sin producción, Woo ni existencias. No hay despliegue, merge o push. Pendiente integrar las herramientas de work/m9 con la rama reciente, desplegar Preview y verificar sesión staging; después completar captura/persistencia de ficha web y reintentos en entornos de prueba.


## Registro vivo — Preview M9 desplegado (2026-10-01)

Publicado exclusivamente Preview 0.55.4 desde b7086e3fec5eae4278d1bffdbba86f65210b87be. PR borrador #87: https://github.com/procesalab0-prog/Vaquero-HUB/pull/87. Pantalla: https://vaquero-hub-git-codex-m9-staging-review-procesa-lab.vercel.app/productos/migracion. Vercel confirma entorno Preview y la variable pública apunta a zsezjtswqeijboezvado; no se tocaron variables ni producción.

CI #255 aprobado completo: instalación congelada, formato, lint, tipos, base vacía/migraciones, pruebas unitarias e integración, build y 128 pruebas E2E. La rama remota tiene exactamente el árbol local probado (9332287d1e58bd7ea6452ecbb33039474915859c). Git sin credencial de escritura local; se utilizó el conector autorizado de GitHub. No se fusionó main.

Acceso anónimo probado: redirige a login, sin mostrar catálogo. Solicitada sesión del usuario en staging para cerrar el recorrido autenticado de revisión del piloto; pendiente, junto con lector físico. No reutilizar credenciales de SICAR/WordPress. Sin cambios Woo, producción ni existencias. La documentación anterior que dice “no publicada” describe el checkpoint anterior a este despliegue. Evidencia local: outputs/m9-preview-2026-10-01/despliegue.json.


## Registro vivo — sesión staging y corrección de filtros (2026-10-01)

La sesión real del usuario permitió verificar el recorrido Preview → autenticación → RPC → catálogo: 40 variantes únicas en dos páginas, código exacto 10 con precio público $910, consulta 010 sin equivalencia con 10, departamento JUVENIL y sección BOTAS DE TRABAJO RHINO con una coincidencia. Costos sin capturar y mayoreos sin definir. Vista móvil 390×844 sin desbordamiento horizontal. Lector físico pendiente.

Se corrigió la incompatibilidad del esquema de staging con la consulta del perfil: faltaba locations.label_code. Se aplicaron solamente en zsezjtswqeijboezvado las migraciones existentes 20260920220152_location_label_codes.sql y 20260921183000_location_label_code_guardrails.sql. El historial remoto asignó respectivamente 20261002004009 y 20261002004019; no se renombraron archivos históricos ni se reparó masivamente el historial. La Piedad/LAP tiene VSM1 y TRANSIT permanece NULL. Después: 40 filas M9, 0 inventory_by_location, 0 inventory_movements.

La revisión viva descubrió que Limpiar filtros renovaba los resultados pero retenía el selector de búsqueda anterior por defaultValue. Corrección 0.55.5, commit 336e9194f97bcd87a3d1624f0eefe2db44fcf6b6: remontar el formulario al cambiar la consulta/página. 13 pruebas unitarias de revisión y lint aprobados. Publicada únicamente en la rama Preview del PR borrador #87. Primer build falló en módulos de fuentes Google; se reintentó sin caché. Resultado del despliegue y regresión final se registran en outputs/m9-preview-2026-10-01/sesion-verificada.json.

Sin escrituras WooCommerce, producción ni existencias. Sigue pendiente desarrollar y probar la ficha web nativa; el paquete de contenido no equivale a alta automática.


También faltaba products.image_path: Productos caía en su modo de demostración anterior y ocultaba el enlace M9. Se aplicó la migración existente 20260908011917_m6_product_images.sql sólo a staging, registrada remotamente como 20261002004914. Antes se comprobó que no existía el bucket product-images ni archivos en él; se creó vacío para fotografías comerciales según la migración original, sin subir contenido. Productos volvió a mostrar el catálogo real y el enlace del piloto.

Los dos intentos de build Turbopack fallaron; el commit 86f376cddf7670dbfbaf6edeb6e3944767d8849f configura next build --webpack, coherente con la compilación ya verificada en CI. Compilación y TypeScript locales aprobados.

Advisors: permanecen avisos de funciones SECURITY DEFINER autenticadas, incluidos set_product_image y upsert_location_v2 recién habilitados por las migraciones originales. Ambas verifican identidad y permisos internos; no se concedieron accesos a anon. No declarar auditoría global limpia. Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable. Sigue previo aviso de protección de contraseñas filtradas: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.


La CI #257 pasó 126/128 E2E y detectó que Webpack resolvía el manifiesto global sobre el de /mi. Se corrigió en 0.55.6, commit c56d0500d2ac9cd1276fbffab9edd0cf0b145613: el manifiesto POS conserva URL y contenido mediante Route Handler explícito, permitiendo que el metadata del layout /mi seleccione su manifiesto propio. Fundamento: https://nextjs.org/docs/app/api-reference/functions/generate-metadata (los metadatos basados en archivos tienen prioridad). Build, tipos y lint aprobados; navegador local de producción confirma /mi/manifest.webmanifest. Servidor local detenido. La nueva CI es #258; consultar evidencia final, no reutilizar el estado fallido de #257 ni declararlo aprobado.


Cierre de esta revisión: Preview 0.55.6 READY en c56d0500d2ac9cd1276fbffab9edd0cf0b145613; sesión autenticada y avatar verificados, piloto 40 variantes, manifiestos separados comprobados en Preview. CI #258 / job 110656233726 aprobado completo, incluidas las pruebas E2E. Evidencia final: outputs/m9-preview-2026-10-01/sesion-verificada.json. PR #87 permanece borrador; sin merge ni escrituras de producción/Woo/inventario. Próximo trabajo: ficha web nativa en staging y lector físico pendiente.


## Registro vivo — fichas web nativas (2026-10-01, 0.56.0)

Se implementó la captura editorial con fotos y variantes consultables, persistencia privada en staging, reintentos idempotentes y protección ante cambios simultáneos. El alta nueva puede guardar producto y ficha en una sola transacción. 40 fuentes comerciales cargadas de forma reproducible; no cambian códigos, precios, inventario ni Woo. Detalle, hashes, pruebas y límites en [M9_FICHAS_WEB.md](M9_FICHAS_WEB.md). Preview y CI de esta versión se verifican antes del cierre; PR #87 continúa borrador y sin merge. Categorías Woo/familias completas y envío real siguen pendientes.


### Evidencia de navegador y CI — 0.56.0

Preview READY en commit 7691e7d507074bea2ebb8477f658ca5c7b36b85b (código funcional cfd6dda, dos ajustes posteriores sólo de fixtures). Navegador autenticado: guardado y recarga de la ficha SICAR 10, revisión 1, 7 fotos cargadas, código/talla 22/precio $910/SKU/IDs Woo intactos. Una URL ajena fue rechazada conservando la captura; luego se guardó el contenido de origen. El formulario normaliza saltos LF a CRLF, sin cambio editorial. Avatar 0.56.0 confirmado y ancho móvil 390 sin desborde. Alta con checkbox de ficha inspeccionada sin insertar productos ficticios.

77 unitarias y 165 integraciones aprobadas en CI #261. Su primer intento falló después en next/font, aunque build local y Preview pasaron; se reintentó el mismo commit. Pendiente resultado de E2E. La sesión del navegador venció durante la prueba de subida de foto: al recargar apareció login, el bucket sigue con 0 objetos. Solicitada nueva sesión; no declarar la subida aprobada todavía. Evidencia y capturas en outputs/m9-fichas-web-2026-10-01-v3/verificacion.json.


Cierre técnico: CI #261, intento 2 / job 110669362578, aprobada completa (formato, lint, tipos, reset, unitarias, integración, build y E2E) en commit 7691e7d507074bea2ebb8477f658ca5c7b36b85b. No quedan fallos de CI abiertos de esta entrega. Subida de archivo pendiente de recuperar la sesión del usuario; no hubo objeto subido ni cambio de galería durante ese intento. Versión Preview 0.56.0. Las categorías y el envío Woo siguen pendientes y desactivados.


### Subida de fotos verificada tras recuperar sesión

Cerrado el pendiente de upload en Preview 0.56.0: el archivo descargado IMG_7873-Photoroom.jpg contenía WebP. La validación rechazó correctamente su MIME/extensión JPEG. Se copió sin transformar bytes a IMG_7873-Photoroom.webp, se subió desde el selector, se guardó y se recargó la ficha SICAR 10. Revisión 2 con siete fotos; la portada usa ahora su copia en product-images de staging y las otras seis URLs siguen iguales. No se duplicó la portada. Objeto bf18e88d-e704-423f-8354-1f73ac25a4fa.webp asociado al producto 68f8c842-47dd-4e95-84f1-b378110fd807. Todas las imágenes cargaron; talla 22, precio $910, SKU 1000074-3 e IDs Woo 7995/11235 intactos. Un objeto de Storage, cero existencias y cero movimientos. Evidencia: outputs/m9-fichas-web-2026-10-01-v3/verificacion.json y foto-subida-verificada.jpg. Sin cambios de código: se mantiene 0.56.0 y la CI aprobada. Próximo paso: correspondencia de categorías Woo por ID y revisión de familias completas antes de habilitar envíos.


### Categorías Woo y revisión completa de familias del piloto — 2026-10-01

Herramienta offline m9-web-family-review-1: captura pública sólo GET de 159 categorías y pertenencia de los 40 padres, contrastada por ruta completa e ID con el CSV autenticado. 40/40 categorías de familia verificadas; 378 miembros Woo completos (338 fuera del piloto preservados), 287 vínculos exactos y 91 pendientes (57 sin vínculo confirmado, 34 en revisión canónica/comercial). 31 familias tienen pendientes; las otras 9 requieren aún revisión editorial/aprobación. Además, 16 filas SICAR candidatas permanecen manuales en 11 familias. No equivale a aprobar categorías editadas por humanos ni a importar familias completas.

87 pruebas unitarias y lint aprobados; dos corridas byte a byte idénticas. Evidencia: outputs/m9-familias-web-2026-10-01-v2 y m9-taxonomia-publica-2026-10-01. Detalle y comandos en [M9_CATEGORIAS_Y_FAMILIAS_WEB.md](M9_CATEGORIAS_Y_FAMILIAS_WEB.md). Códigos SICAR intactos, sin escrituras Woo/producción/staging/inventario. No hay nueva versión de app: Preview sigue 0.56.0. Envíos desactivados; siguiente fase: revisión agrupada de pendientes y correspondencias aprobadas en staging antes de outbox/worker en Woo de pruebas.


### Desglose de pendientes por causa — 2026-10-01

Añadido scripts/m9/triage-web-families.mjs, m9-web-family-triage-1. De los 91 miembros pendientes, 33 sólo tienen observaciones de existencias, 1 diferencia de precio y 57 carecen de vínculo confirmado. No se reclasifica el reporte canónico ni se aprueba importar los 33. De las 16 filas candidatas: 8 muestras conservan la regla de exhibición, 6 tienen prefijos solapados, 1 talla no equivalente automáticamente y 1 existencia inválida con identidad aún sin confirmar. Los candidatos pueden solaparse con miembros Woo sin vínculo; no sumar como productos distintos.

Preguntas concentradas: cinto cocodrilo negro talla 42 (SICAR 10520, público 2690 frente a Woo regular 2390 sin rebaja capturada); Nicol Minnick bicolor/natural (23965/23966, seis códigos SICAR con base SOMNICOLMINIKBIC); camisa Rodeo West lisa negra (17787, XXL frente a 2XL). Estas hipótesis no son decisiones. Las 57 variantes permanecen en lista detallada para obtener código SICAR exacto o decisión de conservar sin vínculo. No aplicar equivalencia XXL/2XL a todo el catálogo.

Evidencia: outputs/m9-pendientes-familias-2026-10-01/{revision.md,pendientes.json,sha256.json}. 91 pruebas unitarias aprobadas, lint y dos ejecuciones idénticas verificadas. Fuentes conservadas y huellas comprobadas. Ninguna escritura en Woo, producción, staging ni inventario; Preview sigue 0.56.0.

Reproducir desde work/m9-ui:

```sh
node scripts/m9/triage-web-families.mjs ../../outputs/m9-familias-web-2026-10-01-v2 ../../outputs/m9-fuentes-2026-10-01/woo-authenticated.json docs/M9_DECISIONES_NEGOCIO.json ../../outputs/NUEVOS_PENDIENTES
```


### Lote candidato de revisión editorial — 2026-10-02

Implementado prepare-candidate-review.mjs (m9-candidate-review-1), offline con fuentes verificadas por SHA-256. Selecciona sólo familias completas sin conflictos del diagnóstico y valida cada precio SICAR contra el regular Woo sin igualar precios entre tallas. Resultado: 9 familias, 50 miembros (9 del piloto inicial, 41 aún fuera de staging). Cero cambios remotos propuestos: productos ya existentes, conservar IDs, categorías, imágenes, códigos y precios. No confundir baseline exportado con comparación de las fichas humanas staging ni con estado Woo actual.

Revisión legible local: outputs/m9-lote-candidato-2026-10-02/revision.html; detalle lote.json y sha256.json. HTML de origen escapado y CSP sin scripts/red. Una familia con formato HTML requiere revisión editorial: Woo 24939 Bota Nokota Lincoln; el título dice BLANCK CHERRY y el cuerpo BLACK CHERRY, contiene marcado de hoja de cálculo y una comilla final. No se corrigió automáticamente. Las otras ocho también necesitan revisión visual/editorial, no están aprobadas para publicar.

95 pruebas unitarias aprobadas, lint limpio, reproducción byte a byte idéntica. No se escribió staging, Woo, producción ni inventario. Preview permanece 0.56.0; esta entrega es herramienta local. Próximo paso: revisar contenido completo y comparar borradores humanos con este baseline antes de preparar prueba de envío; falta entorno Woo de pruebas y prueba de reintentos. Las tres dudas previas y 57 variantes sin vínculo siguen pendientes.

Reproducir desde work/m9-ui:

```sh
node scripts/m9/prepare-candidate-review.mjs ../../outputs/m9-familias-web-2026-10-01-v2 ../../outputs/m9-fuentes-2026-10-01/woo-authenticated.json ../../outputs/NUEVO_LOTE_CANDIDATO
```


### Revisión editorial de páginas Woo — 2026-10-02

Consultadas nueve páginas del lote en navegador, sin mutaciones. Inspección de texto/precio visible/portada y miniaturas; no todas las fotografías ampliadas ni propiedades físicas. Preparadas tres propuestas locales con antes/después y huella fuente: espacio AMARILLO EN (5630), ASA y espacio INTERNO. EL (19771), BLACK CHERRY y limpieza del HTML de hoja de cálculo/comilla final (24939). Sin aplicación ni aprobación. Dos comprobaciones comerciales: toquilla de piedra roja descrita en texana 13560, no distinguible en portada; colores distintos de amartigón 37102 bajo código único, sin inferir separación o selección.

Evidencia y generación repetible: outputs/m9-revision-editorial-2026-10-02/{revision.md,revision.json,sha256.json,generar.py}. Segunda generación idéntica; fuente lote intacta. No se modificó código de aplicación, staging, Woo o inventario: Preview 0.56.0. No se compararon borradores humanos staging ni se aprobó galería completa/materiales. Las comprobaciones comerciales y prueba Woo aislada siguen pendientes; no presentar revisión parcial como permiso de publicación.


### Galerías completas y lectura staging — 2026-10-02

Consulta Supabase en transacción READ ONLY al proyecto staging zsezjtswqeijboezvado. No se actualizó ninguna tabla ni se guardaron borradores.

- 9/9 snapshots coinciden estructuralmente con el paquete de contenido original; SHA-256 fuente correcto.
- 9/9 códigos base y listas ordenadas de imágenes coinciden.
- No hay borradores humanos guardados en estas 9 fichas; no significa que no existan borradores en otras familias.
- Las categorías verificadas por ID del reporte todavía no están incorporadas en staging: category_ids sigue NULL y los campos editoriales contienen propuestas textuales. No usar esos textos como IDs.
- 40 imágenes revisadas en navegador, mostradas completas a 340 px de alto (incluye detalles e interiores, no sólo portadas). Todas se visualizaron. Esto no prueba composición, autenticidad, medidas o correspondencia con mercancía física.

La texana presenta una cinta del mismo color y adorno lateral pequeño; no se distingue la piedra roja que menciona la descripción. Confirmación comercial pendiente. El amartigón muestra dos juegos de color/diseño (café/negro y negro con figura clara), bajo una sola ficha sin selector. No separar códigos ni declarar venta surtida sin confirmación.

Las otras siete galerías no muestran una mezcla evidente de modelos en esta inspección. Siguen pendientes aprobación comercial y las tres propuestas de texto locales. No se han aprobado envíos, importado las 41 variantes fuera del piloto ni activado sincronización Woo.

Siguiente implementación: incorporar correspondencias verificadas de categorías en la preparación staging, preservando snapshots y controlando revisiones; mantener las dos fichas comerciales dudosas fuera del primer ensayo de envío. Se requiere Woo de pruebas para validar creación/actualización/reintento sin duplicados. Las siete restantes son candidatas técnicas, no publicaciones autorizadas.

Evidencia: lectura.json (consulta restringida al lote), comparacion.json y galerias/*.html. Las galerías referencian las imágenes públicas remotas, no son copias permanentes de los archivos. Preview sigue en 0.56.0, sin despliegue ni cambio de código funcional.



### Preparación de categorías y preflight alojado — 2026-10-02

7 familias: 5630, 5738, 8059, 13440, 19771, 24939 y 25814. Texana 13560 y amartigón 37102 excluidos por dudas comerciales.

La preparación conserva cada ID Woo con su ruta completa; por ejemplo, Bota y Caballero > Bota siguen separados. Departamento/sección SICAR no se sustituye por esa clasificación web. Los textos de categorías propuestos se separan en elementos individuales, sin modificar la evidencia original.

Comprobación READ ONLY en staging: 7/7 fuentes y contenidos sugeridos intactos, ausencia de borradores humanos y validación de contenido correcta. 98 pruebas unitarias y lint aprobados; dos generaciones idénticas.

Límite: el modelo actual del editor sólo admite categorías de texto. La correspondencia numérica está en categorias.json; NO está persistida como vínculo verificado en staging. No se guardaron sugerencias, no se actualizaron snapshots ni se habilitaron envíos. Tampoco se aplicaron las tres correcciones editoriales pendientes.

Siguiente implementación: persistencia separada de categorías por ID y su huella fuente, con invalidación al editar categorías y control de revisiones, seguida de pruebas en staging. No introducir IDs en el campo de texto ni tratar la propuesta como aprobación comercial. La app continúa en 0.56.0; herramienta m9-verified-categories-preparation-1.


Reproducir: `node scripts/m9/prepare-verified-categories.mjs LOT_DIR FAMILY_REPORT_DIR STAGING_READ_DIR NEW_OUT`. Evidencia vigente: outputs/m9-categorias-preparadas-2026-10-02-v2. El primer preflight devolvía sólo la última consulta en el conector; v2 reúne los siete resultados con UNION ALL, todos comprobados.


### Persistencia de categorías verificada en staging — 2026-10-02

Completada m9-category-persistence-1: 7 correspondencias Woo por ID/ruta guardadas en app.web_category_bindings, RLS cerrado sin API pública. Categorías sugeridas separadas por ruta; snapshots intactos. Triggers invalidan cambios de categoría/fuente/vínculo; restaurar texto no reactiva. Segunda carga 7 UNCHANGED. 19 verificaciones SQL con rollback, 101 unitarias, lint y reproducción idéntica. Huellas de catálogo/snapshots/borradores conservadas, cero inventario/movimientos. Texana y amartigón excluidos.

Detalle: [M9_CATEGORIAS_PERSISTENCIA.md](M9_CATEGORIAS_PERSISTENCIA.md). Evidencia outputs/m9-categorias-persistencia-2026-10-02. Migración local 20261003000213, registrada en staging 20261003000437. Sin Woo/producción; sólo infraestructura interna. Preview permanece 0.56.0, todavía sin indicador/IDs en UI: falta lectura autorizada y señalización de estado antes de la prueba Woo aislada. No presentar esta carga como publicación ni aprobación comercial.


### WooCommerce local aislado y conector probado — 2026-10-02

Por autorización expresa del usuario, se creó una instalación nueva de WordPress/WooCommerce sólo en 127.0.0.1:9417, sin copiar clientes/pedidos/credenciales ni modificar vaquerosm.com. WordPress 7.0.6, Woo 11.1.2 y PHP 8.3.33 mediante Playground 3.1.56; correo, pagos, red saliente, cron y webhooks bloqueados. Instalación activa en work/m9-woo-runtime-verified (directorio de esta tarea); datos persistentes y credenciales exclusivamente locales.

Conector m9-woo-local-worker-1: compilador de ficha completa, diario persistente, ID devuelto, bloqueo local, revisión/huella, verificación GET y recuperación por ID explícito. Escrituras inciertas quedan en revisión sin volver a crear a ciegas. Ensayo real por API: padre ficticio 11 con variantes 12/13, creación como borrador y actualización de texto/precio M; XL intacta, código 000007779 exacto. Repeticiones y reinicio: cero solicitudes nuevas; campos de existencias intactos. 122 unitarias (21 nuevas), lint y formato aprobados.

Detalle y límites: [M9_WOO_LABORATORIO_LOCAL.md](M9_WOO_LABORATORIO_LOCAL.md). Evidencia outputs/m9-woo-local-2026-10-02-v6. Es WooCommerce real local con datos ficticios y una vista auxiliar de revisión, no una copia completa de los plugins/tema de producción. La app Preview sigue 0.56.0; no se conectó aún el formulario ni una cola autenticada de staging. Sin despliegue, merge, publicación comercial, escrituras Supabase ni inventario. Próximo paso: integrar el formulario y cola con este conector y mostrar resultados/IDs en staging, manteniendo revisión comercial y producción cerrada.


### Ensayo supervisado desde ficha web — 2026-10-02

Versión de aplicación 0.57.0: solicitud autenticada desde la ficha guardada y consulta de estado/ID local. Cola privada de staging con idempotencia, revisión y huella de catálogo; antes de reclamar se revalida el contenido y evidencia de categorías. Una solicitud por producto; sólo creación de borrador simple habilitado expresamente. Cambios previos al procesamiento dejan SUPERSEDED; respuestas inciertas requieren revisión. Los IDs locales viven en la cola, nunca sustituyen los IDs de Woo real.

Puente administrativo supervisado: `scripts/m9/woo-test/staging-bridge.mjs CLAIM_JSON RUNTIME_DIR OUTPUT_DIR`. Se reclama mediante función privada, se ejecuta contra 127.0.0.1:9417 y se registra el recibo después de verificar. No es un trabajador automático permanente ni integración de producción. Fotografías por GET público con límite 4 MB y sin redirecciones; categorías y adjuntos sólo se crean en laboratorio con diario persistente y bloqueo ante incertidumbre. No envía existencias, promociones ni credenciales de producción.

Resultado comprobado: bolsa Cuadra Woo real 19771, código SICAR 10521, solicitud 3648c7e3-5b73-4540-a19c-8474f14387e2 creada desde la UI autenticada, revisión 1, SUCCEEDED; borrador Woo local 18 con cuatro fotografías, descripción/código base y precio público 8695.00. La UI muestra su resultado e ID local y el avatar confirmó 0.57.0. Repetición del trabajo: cero solicitudes de escritura, sin segundo producto. Se mantienen Woo real 19771 y barcode 10521 en staging; inventario y movimientos cero.

Evidencia: outputs/m9-staging-woo-2026-10-02 (claim, diario de adjuntos/categorías, entrada y resultado del worker, recibo, lectura final y capturas). Primera comprobación se detuvo por orden alfabético de categorías devuelto por Woo; se corrigió comparación de pertenencia exacta sin exigir orden, se añadió prueba contra sustitución y se concilió por GET del ID 18, sin repetir POST. Las fotos sí conservan su orden. 15 comprobaciones SQL rollback; 129 unitarias finales. CI #262 pasó migraciones, tipos, lint, integración, build y E2E en 02b1c985; comprobar también el commit final con la corrección de categorías.

Límites: primera cola de UI admite únicamente un alta simple por producto habilitado; futuras ediciones no se reenvían todavía. El puente es administrativo supervisado; el navegador no accede a secretos ni procesa directamente localhost. Los atributos descriptivos del padre (por ejemplo UNITALLA), variantes completas, promociones, plugins/tema de tienda real y recuperación distribuida siguen fuera de este ensayo. No presentar la copia como clon íntegro o sincronización automática lista para producción. Próximo paso: completar estos campos y el flujo de actualización/variantes en laboratorio antes de ampliar el lote. Ninguna publicación real autorizada ni ejecutada.


### Actualizaciones verificadas y familias con tallas — 2026-10-02

Versión 0.58.0 desplegada en Preview: una revisión editorial posterior a un ensayo exitoso puede solicitar actualización del mismo ID local. El historial conserva todas las solicitudes; se bloquea una segunda solicitud activa o una revisión ya enviada. El recibo de actualización debe conservar el ID confirmado. El puente exige el directorio de evidencia previo, verifica sus huellas y comprueba que Woo local no cambió antes de escribir; reutiliza adjuntos/categorías existentes.

Resultados reales comprobados: actualización solicitada desde UI, job acc23ac1-09ce-46e3-9631-895c5f734d2d, revisión 2, SUCCEEDED en el mismo Woo local 18. Se aplicaron sólo al ensayo las correcciones «AZA»→«ASA» e «INTERNO.EL»→«INTERNO. EL». Comparación antes/después: cambian únicamente description, date_modified/date_modified_gmt y marcador de operación; fotos completas idénticas, precio 8695.00, SKU, código 10521, promociones y campos de existencias intactos. Adjuntos/categorías reutilizados; repetición cero solicitudes. UI y avatar 0.58.0 comprobados. Evidencia outputs/m9-actualizacion-local-2026-10-02.

Ensayo de familia separado: `scripts/m9/woo-test/rehearse-family.mjs` tomó la familia Wrangler 5630 del reporte conciliado y creó el borrador local 23 con hijos 24–28, tallas S/M/L/XL/XXL y códigos SICAR 10581–10585, precio 820.00 por talla, cuatro fotos. Actualización parcial incluyó sólo S y corrigió «AMARILLOEN» en el texto del padre: los otros cuatro hijos conservaron su JSON completo; repetición cero solicitudes. Evidencia outputs/m9-familia-local-2026-10-02. Usa IDs internos y SKUs sintéticos de laboratorio y categoría explícita «Laboratorio M9»; no sustituye vínculos reales ni acredita la taxonomía de producción.

131 unitarias, ocho comprobaciones SQL de actualización con rollback, tipos y lint aprobados; consultar CI del commit de entrega para integración/build/E2E. Los avisos de seguridad históricos siguen en 105 funciones y una configuración de contraseñas filtradas; las tablas nuevas permanecen privadas con RLS cerrado.

Límites: cola UI todavía sólo para productos simples habilitados; la familia variable se probó por herramienta supervisada y no se incorporó al catálogo de staging. No hay trabajador automático permanente. Atributos descriptivos del padre, variantes fuera del piloto, clasificación web completa y compatibilidad de plugins/tema siguen pendientes antes de ampliar el lote o publicar. Siguiente paso: revisar e incorporar las variantes completas al piloto y conectar su edición/envío supervisado desde la ficha. Producción y existencias siguen cerradas.


### Primera familia completa en el catálogo staging — 2026-10-03

Familia Wrangler Woo 5630: se incorporaron cuatro variantes faltantes al mismo producto 14f3af61-18f0-4adb-b1d8-29b447ae9cdb. Cinco tallas literales S/M/L/XL/XXL, códigos SICAR 10581–10585, IDs Woo 6186–6190, precio público 820.00, departamento DAMA y sección CAMISAS WRANGLER. Costos NULL; mayoreo y medio mayoreo indefinidos. La variante S original conservó UUID/SKU. El piloto queda en 40 productos y 44 variantes.

Preparación reproducible de sólo lectura: `node scripts/m9/prepare-staging-family.mjs FAMILY_REPORT_DIR RECONCILIATION_DIR 5630 NEW_OUTPUT_DIR`. Verifica huellas y cruza filas SICAR con la conciliación exacta; rechaza ambigüedad, duplicados, revisiones y atributos distintos. No copia existencias. Dos generaciones idénticas. Paquete SHA256 b27019379401691c7d808f20eec56e2006839d4262abcc9f3d422698988c8ee6.

Se reutilizó el importador privado existente, con plan y token: 4 CREATE + 1 UNCHANGED, sin errores. Ensayo transaccional rollback comprobó identidad, segunda aplicación sin cambios y preservación de fuentes web/borradores/categorías/cola/inventario. Aplicación real sólo en zsezjtswqeijboezvado: 4 creadas, 0 actualizadas; repetición 0 creadas, 0 actualizadas, 5 sin cambios. Las 40 filas previas permanecen idénticas; inventario y movimientos siguen en cero. Evidencia: outputs/m9-familia-staging-2026-10-03 (payload, manifest, preflight, antes/después, rollback, ambas cargas y verificación).

Versión 0.59.0 desplegada y comprobada en el avatar de Preview: el aviso de variantes fuera del piloto compara el snapshot histórico contra variantes activas del catálogo con el mismo padre Woo. No se altera la exportación ni se habilitan envíos por este cálculo visual. 136 pruebas unitarias, lint y tipos aprobados. CI #266 (run 37131005304, commit ce7b67313efcaf01474b486d53eb3686d5ecc1f2) terminó con éxito: formato, lint, tipos, migraciones, unitarias, integración, build y E2E. Vercel confirmó despliegue exitoso; UI mostró las cinco variantes y retiró el aviso obsoleto. Captura: outputs/m9-familia-staging-2026-10-03/tallas-staging.jpg.

Pendiente: conectar esta familia completa con la cola de fichas, correspondencias de categorías jerárquicas y recibos por variante del Woo local; por ahora sigue deshabilitada para envío desde UI. El borrador local 23 del ensayo anterior conserva UUID/SKU sintéticos y no se adoptó como destino de estas variantes. No hubo publicación Woo, modificación de producción, importación de inventario ni integración con main. Las mejoras de caja/dólares del otro chat siguen separadas; no declarar terminado todo staging hasta cerrar el flujo variable y sus verificaciones.


### Flujo nativo de familias completas y cortes de datos — 2026-10-03

Versión 0.60.0 desplegada en Preview. La cola privada admite familias variables completas con evidencia revisada independiente del snapshot original: huellas de fuente y catálogo, conjunto exacto de variantes Woo, códigos/filas SICAR íntegros y categorías verificadas. Cambios de exportación, precio o activación entre preparación y reclamación dejan SUPERSEDED; no se envía automáticamente una mezcla de cortes. Evidencia, habilitación y recibos permanecen privados, sin permisos API.

El puente local valida cada variante, conserva los atributos descriptivos del padre separados de los ejes de variación y crea categorías con jerarquía (Camisa y Dama > Camisa no se fusionan). Actualizaciones exigen evidencia previa íntegra y conservan IDs locales de padre e hijos; verifican padre/hijos antes de modificar. Cada recibo contiene el vínculo de las cinco variantes. La UI muestra los IDs de laboratorio separados de los IDs Woo reales. No hay tareas automáticas ni escrituras de producción.

Validación local inicial: 139 unitarias, lint y tipos; 16 comprobaciones SQL con rollback sobre la familia Wrangler (permisos, fuente/precio/actividad cambiados, idempotencia, hijos faltantes/duplicados, campos de stock rechazados y conservación de destinos al actualizar). Migración local 20261003150138 aplicada sólo a staging. Ensayo real desde UI y CI completados; resultados al final de esta entrada.

La tienda permanece operando: los ensayos usan cortes congelados, no representan existencias ni catálogo en tiempo real. Cada exportación nueva debe conservarse con fecha y SHA256, conciliarse con el corte anterior, separar altas/cambios/ausencias y revalidar el lote. Ausencias no autorizan bajas; cambios ambiguos se revisan. No sobrescribir textos humanos ni costos/mayoreos desconocidos; existencias siguen excluidas. Una solicitud ya reclamada representa su corte; un cambio posterior requiere otra revisión.

Pendiente después del ensayo variable: probar el ciclo incremental con una nueva exportación, incluida la regla de revisión cuando cambia sólo el precio del catálogo y no el texto editorial; actualmente el envío exige nueva revisión editorial y revisión administrativa de evidencia. Ampliar lote, coordinar mejoras del otro chat y ensayar preparación/recuperación del corte final antes de autorizar producción. No declarar cerrada toda la fase staging.


Verificación final de 0.60.0: CI #268 / run 37132484822 / commit 94d82edb880f72e925aca92d9387f97c09c40efa, éxito en todas las etapas; Preview y avatar comprobados. Ensayo nativo Wrangler: job 3d918351-7587-4b54-9da1-84a69fe1b7d9 (revisión 1) y da705acb-b33b-4086-932d-07d0537181fc (revisión 2), ambos SUCCEEDED, padre Woo local 33 y cinco hijos 34–38. Corrección editorial AMARILLOEN→AMARILLO EN sólo en staging/local. Padre cambió descripción, fechas y marcador; hijos sólo fechas/marcadores, con datos comerciales íntegros. Fotos y categorías reutilizadas; repetición cero solicitudes. Atributo Color no variable conservado y taxonomía jerárquica comprobada. UI muestra cada vínculo local. Catálogo SICAR y snapshots Woo conservan sus huellas; inventario/movimientos cero.

Evidencia reproducible: outputs/m9-familia-nativa-2026-10-03 (claims, entradas, diarios, verificaciones, recibos, comparación antes/después y capturas). Reporte humano reporte-avance.md y métricas avance.json: estimación técnica 65% frente a ~60% anterior; 40 productos/44 variantes en staging, producción 0%. No hubo nueva captura de fuentes en esta entrega. El aviso de categorías de la UI sigue siendo genérico; el servidor sí exige la correspondencia verificada antes del envío. El siguiente hito es actualización incremental con nuevos cortes, en especial precio sin edición editorial. Toda la fase staging aún no está cerrada; mejoras del otro chat no integradas.


### Comparador incremental reproducible — 2026-10-03

Herramienta offline m9-source-delta-1, `node scripts/m9/prepare-source-delta.mjs PREVIOUS_REPORT CURRENT_REPORT NEW_OUTPUT_DIR`. Amplía el flujo previo compare-source.py: comprueba huellas de filas y manifests, separa cambios de campos SICAR y de conciliación, agrupa duplicados en revisión, conserva códigos literales, nunca convierte ausencias en bajas y excluye cantidades de inventario. No genera payload de importación ni se conecta a servicios externos.

Ensayo histórico con outputs/m9-reporte-2026-09-29 y outputs/m9-reporte-actualizado-2026-10-01: 16035→16130 filas, 98 códigos nuevos, 3 ausentes, 141 cambios exclusivamente de precio público, 56 otros cambios de catálogo, 7776 cambios sólo de conciliación, 618 sólo inventario y 7441 sin cambios. Reglas y exportación Woo distintas: no tratar cambios de conciliación como cambios físicos del producto. 1502 filas compartidas tienen cambios de campos de inventario, excluidos aun si coinciden con otros cambios. Las huellas SICAR se comprobaron contra Plantilla_Productos (3).xlsx y (4).xlsx.

Dos generaciones idénticas. Comparación vigente contra sí misma: 16130 sin cambios. 144 unitarias y lint aprobados. Evidencia outputs/m9-delta-historico-2026-10-03, su repetición y outputs/m9-delta-mismo-corte-2026-10-03. Reporte humano reporte-avance.md. No se encontró una exportación SICAR posterior a (4) en Descargas; no se ha capturado un corte nuevo.

Revisión del bloqueo de precio: la cola y UI actuales usan la revisión editorial como identidad de envío. Un cambio sólo de precio no incrementa esa revisión y debe seguir bloqueado, no forzarse alterando textos. Próximo cambio: separar revisión editorial de revisión de envío, conservar destino e idempotencia y probar una actualización incremental con nuevas fuentes. Avance global se mantiene estimado en 65% hasta comprobar ese hito; aplicación Preview 0.60.0 sin cambios, piloto 40/44 intacto y producción/inventario cerrados. Las mejoras del otro chat siguen separadas.


### Nuevo corte SICAR (5) verificado — 2026-10-03

Recibida Plantilla_Productos (5).xlsx, preservada sin cambios; SHA256 58efc810c7c8031b1d47fbaa721b7d5658870bcd10fa220d2b369f8fb2e9e61e. Conciliación con las mismas reglas m9-readonly-5 y captura Woo autenticada del 1 de octubre. 16133 filas: tres altas (18056, 18057, 18058), cero ausencias y cero cambios de precio/campos de catálogo existentes. Los dos últimos comparten descripción CINCUARESSTANEG40; mantener códigos separados en revisión, sin afirmar duplicación física. 18056 sólo carece de coincidencia en esa captura Woo, no se verificó ausencia en vivo.

Delta: 16062 UNCHANGED, 45 RECONCILIATION_CHANGE_ONLY, 23 INVENTORY_ONLY_EXCLUDED y 3 NEW_MANUAL_REVIEW. Las 45 alertas cambian exclusivamente por existencias comparadas con Woo histórico (42 aparecen, tres desaparecen); identidad y demás comprobaciones no cambian. 68 filas compartidas con inventario modificado, excluido. Lectura en vivo de staging: 44/44 variantes mantienen código, descripción, departamento/sección, precio, atributos e IDs Woo coincidentes; costos NULL e inventario/movimientos cero. Ninguna escritura ni importación.

Dos generaciones idénticas, doce archivos verificados contra SHA256 y byte por byte. Evidencia outputs/m9-reporte-sicar5-2026-10-03, outputs/m9-delta-sicar5-2026-10-03 y directorios de repetición; reporte-avance.md, staging-read.json y verificacion.json en el delta. Preview sigue 0.60.0. Avance técnico estimado 65%, producción 0%; análisis de un corte nuevo no cierra staging ni el ensayo pendiente de precio sin edición editorial. Próximo hito: separar revisión de envío/texto, probar actualización de sólo precio en staging/local, revisar altas y refrescar Woo antes de ampliar. Mejoras del otro chat no integradas.


### Revisiones de envío independientes del texto — 2026-10-03

Implementada 0.61.0: el número de envío avanza independientemente de la revisión editorial. La cola compara contenido/catálogo revisado, conserva el recibo anterior y bloquea repeticiones sin cambios. Reclamar revalida todos los campos salvo el siguiente número calculado; cambios de texto, fuente o evidencia siguen dejando SUPERSEDED. La lectura de estado ordena por secuencia para evitar empates de fecha transaccional. Productos simples también exigen fila SICAR revisada coincidente; familias conservan sus controles de evidencia. Nuevas funciones privadas, sin permisos API.

27 comprobaciones SQL de staging con rollback: simples y variables, precio sin edición, revisión administrativa previa, idempotencia, doble solicitud, cambio posterior, segundo precio, texto después de precios y permisos. Se detectó y corrigió el orden de estados empatados en una segunda migración independiente (20261003154946), conservando la primera (20261003154512). 144 unitarias, tipos y lint aprobados. Ensayo Woo real exclusivamente local sobre familia sintética 23/hijo 24: 820→821→820, texto intacto, cuatro hermanos sin cambios y repetición cero solicitudes. No modifica el padre nativo 33 ni registra esos precios ficticios como importación SICAR.

Catálogo y snapshots staging conservan huellas 0b383408d10c27de98fdf51768b5f677 y b30594ca2e87a49a4427eb0407e0a031; cuatro jobs reales anteriores, 44 variantes, inventario/movimientos cero. Evidencia outputs/m9-precio-local-2026-10-03. Captura SICAR (5) no trae cambios reales de precio: el ensayo es sintético y reversible. Falta probar un nuevo cambio comercial real cuando exista una exportación que lo contenga, ampliar lote revisado y coordinar mejoras del otro chat antes de cerrar staging. Producción sigue 0%. Estimación técnica 68%; no equivale a porcentaje de catálogo importado. Despliegue/CI de 0.61.0 pendiente de verificación al escribir esta entrada.


Verificación de entrega 0.61.0: commit funcional 3320a12ac47ea8e003eb853580340005052cbd2a; CI #271 (run 37134903562, job 111237348717) completó con éxito formato, lint, tipos, migraciones, 144 unitarias, integración, build y E2E. Vercel exitoso; avatar y consulta de estado comprobados en Preview. Captura outputs/m9-precio-local-2026-10-03/staging-version.jpg. Los avisos de seguridad mantienen las mismas cantidades históricas: 34 tablas privadas con RLS cerrado sin políticas, 105 funciones autenticadas SECURITY DEFINER y una configuración de protección de contraseñas. Las nuevas funciones son privadas y sus permisos se probaron. No se cierra todavía toda la fase staging.


### Etiqueta física aportada por el usuario — 2026-10-03

Foto conservada en outputs/m9-etiqueta-2026-10-03/etiqueta-original.jpeg con SHA256 en manifest.json. Decodificación efectiva de las barras usando ZXing 0.23.0 (misma biblioteca base que el respaldo del escáner de la app): CODE_128, texto literal 2396. La ejecución final leyó la fotografía completa sin giro (rotation 0), resultado en decoder.json; no confundir con lectura OCR ni ingreso manual. El intento inicial con Vision falló por inicialización del modelo y no cuenta como verificación.

SICAR (5), fila 5056: Clave1 2396, SOTOM30XRA1132RO59, UNISEX / SOMBRERO TOMBSTONE, talla 59, precio1 2190. Conciliación exacta contra snapshot Woo del 1 de octubre: padre 19746 / variante 19815. Consulta de app.m9_rows en staging para 2396 no devuelve filas: aún no pertenece al piloto. No se alteró código, catálogo, inventario ni producción.

La foto acredita que esta etiqueta codifica la Clave1; todavía no acredita cámara en vivo, lector USB ni resolución/venta desde staging. Mantener physicalBarcodeVerified=false para autorización de importadores hasta una prueba física de extremo a extremo. Próximo paso: revisar/preparar su familia completa para piloto y probar resolución por 2396; no inventar stock para permitir una venta. Preview permanece 0.61.0, sin cambio de aplicación.


### Sombrero de etiqueta incorporado al catálogo staging — 2026-10-03

Padre Woo 19746 SOMBRERO TOMBSTONE 30X RANDA 1132: seis coincidencias exactas de SICAR (5), códigos 2391–2396 / tallas 54–59 / precio público 2190.00 / UNISEX / SOMBRERO TOMBSTONE. La captura Woo del 1 de octubre tiene siete hijos: talla 60 (19816) sin fila SICAR conciliada, excluida en revisión manual. No es familia web completa; no se habilitó envío Woo ni se inventó Clave1 o stock. Los seis códigos confirmados se incorporaron exclusivamente al catálogo de staging.

Preparación reproducible en outputs/m9-sombrero-etiqueta-2026-10-03/prepare.mjs: verifica huellas de reporte/fuente, vínculo único por código, atributos literales, nombres/base y comprobaciones comerciales. Dos payloads idénticos, SHA256 8ecb76a9e8a326e1dbc6cdc355b3639318ae261db066d901b1963e563132ca99. Plan privado sin errores, ensayo transaccional rollback: seis altas, repetición sin cambios, preservación de catálogo previo/fuentes/borradores/cola/inventario. Aplicación real a zsezjtswqeijboezvado: 6 creadas, 0 actualizadas; repetición real 0 creadas, 0 actualizadas, 6 sin cambios. Piloto: 41 productos / 50 variantes. Costos NULL y mayoreos sin definir.

Producto staging eae132eb-8111-418a-b30c-86a199934e62; variante 2396: 6da4feb2-7146-4d4d-b865-6af14cc02a9b. Lectura final preserva huellas del catálogo previo 0b383408d10c27de98fdf51768b5f677 y snapshots b30594ca2e87a49a4427eb0407e0a031. Inventario y movimientos cero. UI Productos: búsqueda escrita 2396 devuelve sólo talla 59 a $2190.00, evidencia busqueda-2396.jpg. Esto no acredita captura con cámara/USB; la foto ya fue decodificada en el turno anterior. physicalBarcodeVerified permanece false hasta prueba física completa.

Preview 0.61.0 sin cambio de código ni despliegue en esta entrega. Avance técnico estimado se mantiene 68%; la ampliación del piloto no sustituye escaneo físico, revisión comercial o corte final. Siguiente: prueba física de 2396, revisión de talla 60 y preparación de contenido web complementario sin habilitar familia incompleta. No hubo producción, importación de existencias ni integración de mejoras del otro chat. Staging aún no cerrado.


### Fichas guardadas y ampliación de tres familias — 2026-10-03

Staging zsezjtswqeijboezvado tiene 41 productos / 64 variantes. Se agregaron 14 variantes en familias existentes: Woo 5738 (cinto pescado café, seis tallas), 24939 (Nokota Lincoln Black Cherry, seis tallas) y 25814 (Wrangler George Strait 6950, cinco tallas). Payload de 17 filas: 14 CREATE + 3 UNCHANGED, cero UPDATE; repetición real 17 UNCHANGED. SHA256 50fcb57bb6f7410491e43c5d78fca923b291d7e7e3f5e4b850211251e4a9711e. Dos preparaciones por familia idénticas. Ensayo con rollback y guardas en aplicación real comprobó que las 50 filas previas, fuentes web, borradores, correspondencias de categorías y cuatro trabajos anteriores permanecieran íntegros. Inventario y movimientos cero; todos los costos NULL.

Sombrero 19746: fuente web complementaria y categoría verificada Sombrero (278), cuatro fotos y textos de Woo; ficha guardada desde UI revisión 1. Siguen sólo seis tallas 54–59: talla 60 sin SICAR permanece fuera y bloquea habilitación de esa familia. Las tres familias ampliadas también se guardaron por UI en revisión 1, sin editar textos originales. Total siete borradores internos. Categorías válidas; ninguno de estos cuatro productos está habilitado para envío al laboratorio. Guardar no equivale a aprobación comercial ni publicación.

Nuevo SICAR (5) conciliado contra captura autenticada Woo del 1 de octubre. Revisión pública adicional del 3 de octubre confirmó nombres/base, fotos y orden, textos normalizados por tipografía WordPress, IDs de variantes y nombres de términos obtenidos de su taxonomía (no inferir que slug 26-5 sea talla literal). La consulta pública no sustituye una exportación autenticada completa ni verifica precios individuales actuales. La revisión de 40 familias se recalculó: ocho candidatas/44 miembros; sus contadores «ya en piloto» corresponden al lote original y no al catálogo ampliado.

Pendientes separados: 8059 excluido de ampliación porque Clave1 13851 tiene costo 990 marcado unverified; no convertirlo a costo aprobado ni anular el control. 13440 excluido de nueva ampliación por alertas de existencias contra Woo histórico, sin afirmar discrepancia actual. En Nokota 24939 se detectan departamentos SICAR mezclados: códigos 11201/talla 29 y 3280/talla 27 están en DAMA; 9174/26, 8342/26.5, 10954/27.5 y 11202/28 en CABALLERO. Se preservan literalmente para revisión; no reclasificar ni habilitar publicación automáticamente. Evidencia visual nokota-departamentos.jpg.

Archivos: outputs/m9-ampliacion-tres-familias-2026-10-03 (payload, manifests, repeticiones, plan, rollback, aplicación, verificación final, revisión pública y capturas); outputs/m9-ampliacion-contenido-2026-10-03; outputs/m9-ampliacion-taxonomia-2026-10-03; outputs/m9-sombrero-contenido-2026-10-03; outputs/m9-sombrero-taxonomia-2026-10-03. No modificar retrospectivamente snapshots originales.

Preview sigue 0.61.0: esta entrega cambia datos de prueba/documentación, no código de aplicación ni esquema. Avance técnico estimado se mantiene 68% (no porcentaje de filas migradas), producción 0%. La fase staging NO está cerrada. Próximo: ensayo de fichas completas elegibles en Woo local, lector físico para 2396, revisión de pendientes, corte actualizado de ambas fuentes y ensayo de recuperación; coordinar mejoras del otro chat antes del cierre. Sin producción, existencias, nuevos trabajos Woo, merge a main ni integración del otro chat.


### Dos familias adicionales en Woo local y recuperación verificada — 2026-10-03

Ensayo nativo desde UI de cinto 5738 y camisa 25814, con evidencia exacta de SICAR (5), catálogo y fuente Woo. Sólo habilitados para m9-local-2026-10-02; no modifica permisos API ni acceso a producción. Cinto: job 86dcdc66-24f1-444a-a5f3-a397260498c2, padre local 42, seis hijos 43–48, precio 490. Camisa: job 37bf73b5-807e-4837-a1c9-86e1c183ab18, padre local 52, cinco hijos 53–57, precio 890. Ambos SUCCEEDED; tres fotos por familia, texto y categorías jerárquicas verificadas, códigos originales en metadatos. Repetición de cada worker: cero solicitudes. Permanecen borradores.

El primer intento del cinto se detuvo al verificar el padre: WordPress convierte <br /><br /> en cierre/apertura de párrafo. Versión 0.62.0 corrige sólo esa equivalencia y finales de línea en verificación y comparación de actualizaciones; no elimina texto, atributos ni otras etiquetas para forzar coincidencias. No cambia los payloads de creación ni su identidad. Recuperación explícita del ID conocido 42 mediante reconcileKnownResult: sólo GET, cero escrituras; reanuda hijos pendientes sin recrear padre/fotos/categorías. El diario conserva el fallo original y la conciliación. Las pruebas rechazan texto faltante, salto simple y etiquetas adicionales. Un cambio sólo de precio no vuelve a enviar descripción equivalente.

148 unitarias, lint de archivos cambiados y tipos aprobados. Prueba de habilitación con rollback: dos paquetes completos. Comparación antes/después: catálogo 5e684a46289c462049570690bde64701, fuentes 5072f2618649b8792b3cdd9f7b8c6ca9, borradores 6942f0fca89c23eafbecd1c4dec90a8b y categorías de5f889a2393d7308f7f0ac1f8d0a0a1 intactos. 41 productos/64 variantes, siete fichas, seis trabajos SUCCEEDED acumulados; inventario/movimientos cero. Woo local confirma cron/correos/salidas/pagos/webhooks bloqueados, cero pedidos. Evidencia outputs/m9-dos-familias-woo-local-2026-10-03.

Avance técnico estimado 70% por ensayo ampliado y recuperación real, no porcentaje del catálogo. Staging NO cerrado: faltan lector físico, corte actualizado completo, ensayo de recuperación del corte, revisión comercial y coordinación de mejoras del otro chat. Sombrero incompleto y Nokota con departamentos mezclados no habilitados. No escrituras Woo/Supabase de producción ni importación de existencias. Publicación y CI de 0.62.0 pendientes de verificación al redactar esta entrada.
