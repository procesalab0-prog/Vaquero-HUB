# M9 — fotos por variante del catálogo cargado

Bloque 2026-10-06, posterior a la revisión técnica integral. Se preparó el
cruce de fotos para **las 7,709 variantes cargadas**, no sólo las seis referencias
que habían cambiado en la última exportación. Se verificaron **1,029 URLs**:
5,329 referencias de variantes y 1,026 archivos únicos por contenido.

Es evidencia local reproducible. **No se subieron estas fotos al programa ni
se modificaron fichas, vínculos, Woo, producción o inventario.** La ficha web
actual guarda galerías del producto, no una galería independiente por variante;
no se agregó silenciosamente una foto de talla al padre.

## Cruce y controles

`scripts/m9/prepare-variant-photos.mjs` reutiliza `auditStagedCatalog` contra
el corte canónico SICAR6/Woo del 6 de octubre. Exige staging y cero inventario,
catálogo current/stored coherente, Clave1 literal y única, UUID de variante único,
parent ID y variation ID exactos, enlace de fuente guardada y registro de cada
variante en esa fuente. Las variaciones Woo deben ser únicas globalmente y
pertenecer al padre correcto. Publicación o identidad cambiada queda retenida.
No normaliza códigos, inventa equivalencias ni sobrescribe precio1/atributos.

Sólo acepta HTTPS vaquerosm.com/wp-content/uploads/, sin credenciales, query,
fragmento o destinos ajenos. Parser conserva comas dentro del nombre de archivo
y separa listas Woo sólo ante un nuevo URL. Ausencia de foto propia no se
reemplaza automáticamente por portada del padre. Las imágenes compartidas se
deduplican por bytes para el cache; **sus variantes nunca se fusionan**.

Verificación pública sólo GET, sin autenticación ni transmisión de datos SICAR:
seis lecturas simultáneas, timeout 20 segundos, redirects rechazados, máximo
4 MiB por imagen / 512 MiB total, MIME JPEG/PNG/WebP y firma de bytes. SHA256
de descarga y archivo guardado deben coincidir. Cinco URLs reutilizaron evidencia
local ya verificada; las restantes se descargaron. Ninguna falló. Se leyeron
189,102,844 bytes de red; 1,026 archivos guardados en cache local.

Los dos análisis definitivos produjeron siete archivos idénticos y volvieron a
leer/verificar todos los archivos usados como prueba. Las huellas de filas y
fuentes quedan en cada referencia para rechazar en una futura aplicación
expectativas vencidas. Son SHA256 de JSON estable, **no** las huellas MD5 de los
procedimientos SQL: no intercambiarlas ni usar el diagnóstico como payload RPC.
Todos los indicadores import_allowed/send_allowed son false.

## Resultado completo

| Estado | Variantes |
| --- | ---: |
| Fotos propias con bytes comprobados y vínculo exacto | 5,329 |
| Sin foto propia de variante | 1,407 |
| Productos simples: corresponde galería del producto | 368 |
| Retenidas por evidencia o publicación | 605 |
| Total | 7,709 |

De las 5,329 referencias comprobadas, 4,584 coinciden con la portada del padre y
745 difieren. Eso no cambia su identidad ni implica que deban fusionarse. Las
seis diferencias de foto de variante del corte anterior siguen identificadas;
el cache por URL también sirve a otras variantes que comparten legítimamente
esa imagen (21 referencias con las cinco pruebas iniciales).

Las 605 retenidas se separan así:

- **599 variantes / 159 familias:** catálogo canónico correcto, pero su evidencia
  web guardada todavía no contiene la variante con ese código. Se agrupan como
  trabajo técnico de completar fuente/vínculo, no como 599 productos nuevos ni
  como preguntas nuevas para los dueños. Antes de aplicar hay que conservar
  datos previos, variantes no seleccionadas, categorías y ediciones de borrador.
- **Cinco reservas ya conocidas:** códigos 1132, 1133, 1134, 16566 y 2521;
  Woo 33002 está draft. No se autoriza publicación ni se elimina catálogo.
- **Código 11755:** falta evidencia guardada de padre/variante; permanece reservado,
  sin deducir el enlace ni crear otro producto.

No se altera la agrupación de identidades pendientes SICAR_ONLY. Cobertura de
catálogo sigue **7,709 / 16,224 = 47.516%**, 8,515 filas pendientes. Este avance
de fotos no incrementa la carga del catálogo.

## Validación y evidencia

Diez pruebas nuevas: código literal/precio/inputs conservados, ausencia de
herencia automática, cambio de publicación/vínculo/precio, IDs duplicados,
orígenes inválidos, prueba de bytes falsa/MIME incorrecto/vacío/límite,
imagen compartida sin fusionar variantes, staging e inventario. Suite completa
**465 pruebas / 65 archivos** y lint dirigido aprobados.

Raíz del workspace principal:
`outputs/m9-fotos-variantes-completo-2026-10-06/`.

- `preparar.mjs`: reproduce contra inputs con hashes SICAR/Woo fijados.
- `verificar-archivos.mjs`: sólo descarga pública y cache; no importer.
- `archivos-verificados.json` / `archivos/`: evidencia de 1,029 URLs / 1,026 archivos.
- `corrida-1` / `corrida-2`: siete archivos idénticos, sin payload ejecutable.
- `cerrar.py` / `verificacion.json`: rehash, partición y conservación de identidades.
- `vinculos-tecnicos-a-completar.json`: 159 familias / 599 variantes y seis reservas.
- `archivos-compartidos.json`: URLs distintas con bytes iguales, sin fusionar productos.
- `sha256-ejecucion.json`: huellas de evidencia final, salvo sí mismo.

El snapshot usado es el cierre verificado del bloque anterior; no se hizo una
nueva lectura de base ni se afirma vigencia del catálogo hasta el corte operativo.
La lectura pública comprueba archivos de imágenes actuales, no una nueva
exportación autenticada de productos.

## Siguiente aplicación

Implementar almacenamiento/lectura de fotos por variante con permisos y control
de concurrencia, separar el alcance del padre y la variante y conservar la foto
manual existente. Completar primero las 159 evidencias de familias mediante
revisión protegida; no actualizar sus snapshots con un reemplazo masivo. Ensayar
una aplicación y repetición en staging antes de cargar el conjunto. El adaptador
remoto actual no promete sincronización independiente de imágenes de variantes;
necesita su propio recorrido probado. No enviar este diagnóstico a Woo.

Sin migraciones, cambios de permisos, cola, despliegue o versión frontend.
Sol suficiente para este bloque; Astra en pedidos, devoluciones, inventario
central y auditoría operativa final.
