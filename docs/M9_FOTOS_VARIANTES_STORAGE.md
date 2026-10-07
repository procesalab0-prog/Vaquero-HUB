# M9 — copia protegida de fotos de variantes

Continuación de 0.75.0. La versión 0.76.0 incorpora copia autenticada por familia
al bucket de staging product-images. Sólo registros ya conciliados del inventario
de evidencia: 5,815 variantes con foto en 1,013 familias; 113 sin foto propia no
reciben imágenes inventadas. No implica altas de productos ni aprobación de
identidades retenidas.

El planificador descarga sólo URLs públicas verificadas de vaquerosm.com,
comprueba SHA256 real, bytes, MIME mediante firma del archivo y límite de 4MB.
Deduplica por URL/huella dentro de la familia y limita 16MB por acción. Conserva
orden y alt por variante aunque compartan el mismo archivo. Reutiliza el guardado
existente sin upsert; ante archivo existente verifica bytes sin sobrescribir.
Las rutas son producto/SHA256.ext y no contienen códigos SICAR.

Migración 20261007020520: tabla privada web_variant_photo_storage, RLS y sin
acceso directo de clientes. RPC de copia exige sesión, products.update, staging,
identidades actuales y fuente original intacta. Bloquea producto, variantes y
fuente; compara catálogo y evidencia completos antes de vincular. Valida cada
URL exacta, alt, orden y existencia/tamaño/MIME de objetos en Storage. La prueba
de SHA256 de bytes sucede en el servidor antes del RPC; los metadatos de Storage
por sí solos no demuestran esa huella. No guarda filas de objetos con SQL.

Repetición idéntica no duplica enlaces ni auditoría. Lector conserva la evidencia
original y prioriza copias sólo cuando corresponden a la misma evidencia y los
objetos existen; si se retira un objeto vuelve a la referencia original. No
modifica el catálogo, precios, inventario, fuentes, borradores, categorías o colas.
No sincroniza fotos independientes de variantes hacia Woo todavía.

La página Fotos del catálogo conciliado añade un proceso separado para variantes,
con avance y detención después de la familia actual. Listados paginados para
cubrir las 1,013 familias sin el límite silencioso de mil filas; autorización
antes de lectura/acción. Cambios concurrentes se conservan y quedan en revisión.

Validación previa a publicación: 10 pruebas nuevas, suite 475/66; 8 controles SQL
con rollback usando archivos que ya existían, nunca objetos ficticios: contexto,
expectativa cambiada, paquete incompleto, origen incorrecto, creación, repetición,
lector y permisos. Build, tipos y lint dirigidos aprobados. La migración se aplicó
sólo en zsezjtswqeijboezvado. Asesor: nueva tabla privada RLS sin políticas,
aviso INFO intencional; avisos históricos separados. Evidencia de ejecución de
copia real y cierre cuantitativo se guardará en
outputs/m9-fotos-variantes-storage-2026-10-06/, workspace principal.

La suite remota anterior CI304 terminó SUCCESS. No confundir la preparación de
este flujo con haber copiado ya las 5,815 fotos. Comprobar resultados de staging
antes de afirmar el alcance ejecutado. Sin producción, Woo, inventario o merge.
