# M9 · plan previo de renovación protegida de fotos · 22 octubre 2026

Desde `a0ecc4e`, sólo preparación local. Alcance fijado: 24 variantes / siete
familias del lote inerte del bloque anterior. Fuente maestra SICAR, Clave1
literal. Sin escrituras staging, Storage, Woo, producción o main por este agente.
El coordinador revisará y aplicará cualquier DDL/DML futuro de staging.

1. Revalidar hashes del expediente anterior y del Woo19oct. Leer únicamente los
   siete contextos completos y las25 evidencias/copias vigentes necesarias.
2. Obtener sólo siete URLs públicas exactas ya propuestas, mediante `fetchPhoto`
   existente (HTTPS, redirecterror,15s,4MiB por archivo), comprobar firma/MIME,
   SHA256 real y límites; guardar bytes en carpeta privada nueva y verificar
   nuevamente desde disco. No subirlos ni enviar códigos en las solicitudes.
3. Preparar paquete inerte con catálogo/fuente/borrador completos esperados,
   evidencia anterior completa y contenido nuevo observado. Un cambio de fuente
   no implica aprobación ciega: comprobar cada variante previa contra el Woo
   observado y el catálogo literal actual, incluyendo atributos e imagen.
4. Preparar función privada SECURITY INVOKER sólo mantenimiento postgres,
   stagingguard, bloqueos estables de catálogo/fuentes/evidencia/copias y
   expectativas exactas. Renovar únicamente images_woo de24 variantes en el
   snapshot, conservar el resto del origen y la galería sugerida/guardada.
   Revalidar25 evidencias, ajustar exclusivamente su source_fingerprint y
   evidence_hash de copias cuando todas las pruebas coincidan; nada más.
   Crear24 evidencias mediante importador ya existente tras el cambio.
5. Ensayar localmente aplicación y repetición, rechazos por identidad,
   publicación, atributo, portada manual, galería vacía, evidencia/copia o bytes
   cambiados y expectativas vencidas. Todo dentro de transacciones revertidas;
   conservar auditoría y demostrar que no cambia stock, precio, costo o códigos.
6. Compensación protegida: sólo si el estado final coincide exactamente con el
   recibo, no hay nuevas copias de las24 y ninguna edición posterior. Retirar
   únicamente las24 evidencias nuevas y restaurar fuente/huellas anteriores,
   conservando auditoría de aplicación y compensación. Sin borrado de archivos.

Mantener113 ausencias registradas, cinco variantes del padre33002 no publicado
y tres enlaces ausentes. Ninguna pregunta nueva a dueños. Plan no ejecutable;
paso de Storage y aceptación Preview requieren coordinación posterior.

La actualización puntual conserva `source_sha256` e `imported_at` de la base
histórica, sin fingir una captura completa nueva. Su nueva procedencia se guarda
en `packet.export_sha256`, el plan de lectura y el recibo privado; sólo cambian
las24 `images_woo` seleccionadas del snapshot. Los siete bindings de categorías
se invalidan mediante el trigger nativo y permanecen retenidos, incluso después
de una compensación, hasta revisión técnica explícita. No forzar el revisor
anterior de galerías, cuyo alcance sólo permite `image_urls` del padre.

## Preparación y ensayo cerrados

Se verificaron siete URLs públicas mediante el ejecutor existente, sin enviar
códigos, UUIDs, credenciales o precios en las solicitudes. 1,361,036 bytes en
siete archivos, header MIME + firma + SHA256 real y segunda lectura desde disco.
Máximo4MiB/archivo,64MiB/lote,20URLs,15s y redirects rechazados. No se hizo upload.
Preparatorias1/2 producen payload idéntico:
`c853e67699e2e923805ef4a5a2dbaee8aee726102569557f2f8ff10c40d5dd8d`.

Borrador forward `scripts/m9/catalogo-fotos-refresh-apply.sql`: tabla privada
con RLS y cero grants directos, tres funciones privadas de mantenimiento y
trigger de recibo inmutable. Únicamente la transición única `reversed_at`
NULL→fecha conserva los demás campos. No RPC pública, service_role, worker,
activación web o importación de existencias. La función privada bloquea catálogo,
fuente, borrador, evidencia/copias y objetos previos antes de revalidarlos.

Ensayo3 en PostgreSQL local aislado `qa_m9_fotos_block2_20261022`, creado por el
coordinador, con Auth/Storage stubs: **23 controles aprobados**. 24 altas de
evidencia/25 revalidaciones/7 categorías retenidas; replay sin cambio o auditoría
extra. Rechazos de identidad, publicación, atributos, contexto, portada manual,
vacío explícito, copia editada, metadatos de objeto y prueba de bytes incorrecta.
Fallo inyectado después de todas las mutaciones revierte el conjunto. Recibo
modificado rechazado; nueva copia de una de24 impide compensación. Se observó
otro PID esperando el bloqueo del editor de catálogo; tras el rollback final
actualiza cero filas porque las filas sintéticas ya no existen. No se presenta
como aceptación de edición manual en producción.

Compensación local: retira24 evidencias nuevas, restaura25 evidencias/copias y
las7 fuentes; categorías permanecen retenidas y auditoría preservada dentro del
ensayo. Rollback exterior retira fixtures y DDL;17 hashes de tablas examinadas
coinciden con los previos. No se escribe en otras basesQA. El ensayo no certifica
Auth/PostgREST, Storage real o ejecución remota: ésos corresponden al coordinador.

11 pruebas unitarias nuevas y lint dirigido aprobados. El verificador y el
preparador rechazan una carpeta previa y crean archivos con `wx`; no sustituyen
expedientes históricos. No contiene datos de clientes ni secretos en Git.

Expediente privado en workspace principal:
`outputs/m9-fotos-renovacion-protegida-2026-10-22/`: plan/configuración por SHA,
lectura acotada de7 familias+25 evidencias/copias, categorías actuales, bytes y
verificador, payloads1/2, ensayoSQL3 y manifiesto. El coordinador genera nueva
migración, verifica staging contra expectativas y decide aplicación/rollback.
Hasta entonces **cero evidencia nueva y cero copias cargadas en staging**.

## Corrección posterior a revisión independiente · sólo forward

El coordinador ya había instalado la DDL inicial, sin aplicar datos. Este parche
modifica únicamente el borrador SQL y el ensayo; el coordinador debe generar
una migración nueva `CREATE OR REPLACE`, sin editar la migración instalada.

Antes de revalidar cada evidencia previa se exige su `catalog_fingerprint`
igual al catálogo actual y atributos de la fila canónica SICAR actuales. Las22
con entrada guardada deben conservar también `attributes_sicar` exactos. Tres
legítimas (6980,6983,17089) son complementarias: se permite únicamente la
conjunción `supplemental=true` ya guardado, ausencia total de barcode e ID de
variación en el snapshot, huella de catálogo vigente, fila M9 literal/atributos
actuales y variante Woo exacta comprobada. No se inventa ninguna entrada.

APPLY y REVERSE adquieren primero `LOCK TABLE public.products IN EXCLUSIVE MODE`,
antes del resto de bloqueos, para esperar al escritor que ya tomó `FOR UPDATE`
sin bloquear su posterior inserción de copias. El estado esperado incluye ahora
las filas/metadatos de objetos previamente referenciados; el ensayo confirma que
metadatos cambiados bloquean la reversión. Se usan `SELECT FOR SHARE`, nunca DML
Storage, reparación de objetos o afirmaciones de restauración de bytes.

Ensayo local final `ensayo-guardas-2.json`: **29 controles aprobados**. Incluye
huella anterior incorrecta aun actualizando las expectativas del fixture,
atributos alterados sin cambiar ID/Clave1, complemento con flag falso, entrada
conflictiva, objeto modificado después de aplicar, replay y compensación. Dos
conexiones observaron bloqueo real en ambos órdenes: escritor con ROW SHARE
primero termina su INSERT antes de que avance mantenimiento; mantenimiento
primero retiene al siguiente `FOR UPDATE`, cuya relectura después del rollback
devuelve cero filas sintéticas. No hubo deadlock. Se conservan los límites de
stubs locales y rollback del expediente anterior. Sin escrituras remotas ni
nuevas descargas en esta corrección.
