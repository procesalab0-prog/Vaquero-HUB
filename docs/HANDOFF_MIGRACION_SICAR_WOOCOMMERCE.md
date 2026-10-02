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
