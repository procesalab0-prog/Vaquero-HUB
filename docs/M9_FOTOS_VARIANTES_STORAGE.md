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

## Ajustes de la comprobación en navegador

0.76.1 corrigió el listado general: read_migration_galleries devuelve un JSON
agregado y no requiere paginación de filas; sólo el nuevo listado tabular se
pagina. 0.76.2 conserva las familias completadas en el contador tras actualizar
la página. El proceso de variantes usa hasta cuatro familias independientes en
paralelo, con pausa que espera las solicitudes en curso. Ruta POST del mismo
origen, JSON y UUID único, autorización y staging comprobados nuevamente en
la acción; nunca recibe archivos/URLs/precios del cliente. La galería general
conserva su proceso anterior. Build/tipos/lint repetidos tras estos cambios.

Piloto real:55variantes/9familias, repetición cero cambios. Se descargaron seis
archivos públicos desde Storage y sus bytes/SHA coinciden con la evidencia.
Comprobación visual de código416/talla22/$1,450: imagen cargada desde staging
Storage. Ampliación supervisada en curso; usar cierre.json para alcance final.
Publicación final: local7712926, remoto76d767cf1e177bd29187c347f534205385c26900,
árbol idéntico d7c1a6b3b579cdc15fd144b78b6320218f1479e6. No forzar historial.

Aviso informativo de tabla privada: [RLS sin políticas de acceso directo](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). El acceso autorizado se valida en el RPC; no se habilita acceso directo para eliminar el aviso.


### 2026-10-06 — Copia total de fotos propias de variantes conciliadas

Cierre0.76.2:5,815variantes/1,013familias con copias en staging Storage.1,037objetos comprobados por GET público:SHA256/bytes/MIME coinciden todos, cero fallos. Dos preparaciones idénticas; piloto55/9, ampliación autenticada1013/1013 y repetición completa5815:0altas/0auditoría extra.1,013auditorías de copia. Tabla de evidencia original conserva5,928filas;113sin foto no reciben imágenes inventadas y seis reservas siguen excluidas.

Catálogo/fuentes/borradores/categorías y colas conservan sus huellas/cantidades; cero inventario.475unitarias/66archivos,8controles SQL rollback,lint/tipos/build y CI307/run37561269888SUCCESS. Preview0.76.2 y foto416/talla22/$1,450 desde Storage comprobados. Detectados/corregidos en navegador el listado JSON y contador persistente.

Cobertura de catálogo sigue7,709/16,224=47.516%,8,515pendientes. Próximo: lectores complementarios599, envío independiente de fotos por variante a Woo de pruebas y conciliación retenida. Detalle[M9_FOTOS_VARIANTES_STORAGE.md](M9_FOTOS_VARIANTES_STORAGE.md); outputs/m9-fotos-variantes-storage-2026-10-06/verificacion.json,bytes-todas.json,cierre.json,conservacion.json,reporte.md y capturas. Local7712926/remoto76d767cf1e177bd29187c347f534205385c26900/árbol d7c1a6b3b579cdc15fd144b78b6320218f1479e6; documentación de cierre posterior local. Sin producción,Woo,existencias o merge.Sol suficiente;Astra para fase operativa.
