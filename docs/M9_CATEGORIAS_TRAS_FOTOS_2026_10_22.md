# M9 · plan previo de categorías tras fotos · 22 octubre 2026

Base `a7c26e2`, rama propia. Alcance exclusivo: siete bindings retenidos por
`SOURCE_CHANGED` después del refresh `d54ce08a-dcd9-4dba-824a-95164888ead7`.
Sin nuevas reglas comerciales, permisos de publicación o escrituras Woo.
Root conserva la responsabilidad de toda DDL/DML remota; este frente sólo hace
SELECT de staging y GET públicos autorizados de los siete IDs Woo.

1. Capturar contexto actual acotado de fuentes/borradores/catálogo/bindings,
   recibo inmutable del refresh y evidencias/copias49. Conservar el origen del
   Woo19oct y agregar una evidencia pública nueva con fecha real separada.
2. Leer categorías públicas únicamente de 7981,11949,21265,35045,36300,37110 y
   38374, sin códigos SICAR, UUIDs, precios, stock o credenciales en solicitudes.
   Verificar IDs/nombres/rutas canónicas contra mappings anteriores y borrador.
3. Preparar plan determinista de revalidación técnica: sólo si la única causa
   de invalidación fue el cambio de24 `variants.images_woo` acreditado por el
   recibo, conservando identidad, texto comercial, categorías y fotos49 actuales.
   Un cambio semántico, galería manual, catálogo o evidencia distinta retiene.
4. Adaptador SQL privado de mantenimiento invoker, guardas staging/postgres,
   expectativas completas y bloqueo inicial products EXCLUSIVE. Nunca activar
   una categoría inválida por otra causa ni usar la API general anterior fuera
   de alcance. Sin worker, captura o envíos. Replay condicionado y auditoría.
5. Ensayo QA local propio con rechazo de cambios concurrentes, fuente distinta,
   datos incompletos, antigüedad/fecha falsa, mappings parciales y vínculo de
   fotos incorrecto. Ensayar aplicación/repetición/rollback y compensación
   condicionada, sin modificar migraciones aplicadas ni datos remotos.

## Resultado preparado, sin aplicación remota

La captura nueva terminó el **2026-10-22T23:45:43.983Z**. Fueron únicamente
siete GET públicos de `id,categories`, sin autenticación, cuerpo ni datos internos.
Los siete productos conservan los mismos IDs de categorías y las mismas rutas
canónicas: catorce términos únicos, incluidos todos los ancestros necesarios.
No se usó el nombre del producto para decidir identidad. Los permalinks publicados
permiten reconstruir la jerarquía por IDs; un ancestro ausente retiene el lote.

El preparador deja **7 revisiones técnicas listas y 0 retenidas** en este alcance.
Verifica las **49 evidencias y 49 copias** actuales, el recibo exacto del refresh,
las 25 copias previas y el contexto completo de catálogo, fuentes y borradores.
No renueva la fecha ni el SHA de la importación base del 19 de octubre. Guarda una
captura pública independiente, con fechas reales, JSON original y SHA por respuesta.
Dos ejecuciones con las mismas entradas producen exactamente los mismos tres
archivos. Los directorios y archivos de salida deben ser nuevos; no sobrescriben
un ensayo previo. La captura expira a las 24 horas para la aplicación SQL.

`catalogo-categorias-review.sql` es un borrador forward de mantenimiento, fuera de
migrations. Agrega una tabla privada de recibos y dos funciones invoker exclusivas
de postgres en staging. RLS y revocación explícita excluyen anon, authenticated y
service_role. El recibo es inmutable salvo la marca única de compensación. El
adaptador no recibe decisiones comerciales ni activa una API genérica: sólo acepta
los siete bindings `SOURCE_CHANGED` acreditados por aquel refresh. Relee el recibo
bajo lock, compara todo el contexto esperado y verifica de nuevo catálogo SICAR,
fingerprints, vínculos de variantes, fotos y objetos Storage. Primero toma la
barrera `products EXCLUSIVE`, luego el resto de locks y `FOR SHARE` sobre objetos.

La aplicación sólo puede actualizar los siete bindings con la nueva evidencia
pública y el fingerprint actual de fuente. Conserva mappings, paths y borradores;
no modifica catálogo, fuente, fotos, inventario, costos ni Woo. Un replay requiere
el mismo packet y estado posterior intacto. La compensación repone el bloqueo
anterior únicamente si el estado posterior completo, incluidos metadatos Storage,
permanece exacto; un cambio concurrente exige un nuevo plan. No restaura ni borra
bytes de Storage. Los recibos y eventos de auditoría permanecen.

## Validación local

- **19 pruebas unitarias**, lint enfocado y revisión de espacios: PASS.
- **23 controles SQL locales**: identidad y recibo incorrectos, captura vieja o
  futura/incompleta, bytes JSON alterados, categorías o nombres cambiados, mappings
  parciales, invalidación ajena, borrador/copia/objeto editado; todos rechazan antes
  de dejar cambios. El cambio de membresía/nombre se prueba como una respuesta
  pública nueva coherente, además del caso separado de bytes manipulados.
- Aplicación de siete, replay sin nueva auditoría, siete bindings válidos y
  compensación a siete bloqueados: PASS. Falla inyectada después de los siete
  updates revierte toda la operación. Cambio de metadatos bloquea compensación.
- Contención real de otra conexión `FOR UPDATE` observada en la barrera inicial;
  finaliza sin deadlock tras el rollback. No se afirma una prueba completa de
  concurrencia distribuida ni Auth real a partir de este ensayo.
- Rollback exterior verificado por huellas de **166 tablas preexistentes**, incluida
  `storage.objects`; también conserva los once productos fixture previos del QA.
  Base propia: `qa_m9_categorias_block3_20261023`, en el contenedor local de QA.
  Auth y Storage son stubs locales; no equivalen a aceptación con sesión real.

Expediente privado fuera de Git:
`outputs/m9-categorias-tras-fotos-2026-10-22/`.
Entrega vigente: `config-2.json`, `captura-2/captura.json`,
`preparacion-2/payload.json`, `preparacion-3/`, `ensayo-2.json`, `manifest.json`
y `verificar.mjs`. Se conservan captura y ensayo anteriores como historia.

Root debe revisar el draft, crear su migración forward, ensayar la misma entrada
con sus controles y aplicar exclusivamente en staging. **Este commit no resuelve
los bindings remotos**. No habilita captura, worker, publicación ni compra. Las
113 ausencias deliberadas, cinco variantes del padre33002 y tres sin vínculo
siguen fuera de alcance y retenidas según sus reglas previas. No requiere nuevas
preguntas a los dueños: si cambian las categorías o la identidad, el lote retiene.
