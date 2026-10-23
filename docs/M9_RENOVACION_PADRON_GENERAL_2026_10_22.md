# Renovación histórica del padrón general SICAR

Fecha: 22 de octubre de 2026. Sólo staging. Este bloque permite preparar y archivar un corte nuevo completo en el mismo archivo histórico; no registra clientes operativos, no sustituye fuentes y no abre deuda.

## Contrato y alcance

El preparador existente admite el modo explícito `RENEWAL_ARCHIVE_ONLY`. El flujo v1, sin ese modo, conserva sus reglas y salidas anteriores. El SQL forward añade un despacho de protocolo inmediatamente después del guard de actor del archivador instalado; conserva el resto de su definición, incluida la reparación de alias ya aplicada.

La renovación separa dos hechos que antes compartían etiqueta:

- `present_in_prior_census`: la identidad exacta estaba en el archivo inmediatamente anterior, de 171 cuentas.
- `previously_registered`: existe en el registro vivo de staging fijado en `expected_context`, actualmente 114 cuentas. No reinterpreta el flag histórico de 61 del archivo anterior.

El contexto fija versión, proyecto, todas las parejas clave/ref del registro y una huella PostgreSQL de registro más fuentes. También fija la identidad, fechas y huella PostgreSQL del archivo anterior. El escritor vuelve a derivarlo bajo barreras antes de añadir la nueva fila histórica. Una deriva rechaza el plan; nunca actualiza fuentes o registro para acomodarlo.

Se exige listado terminal sin filtros, una captura con recarga por cada posición, UUID/URL/nombre exactos, fechas UTC canónicas y ventana máxima de 24 horas. La captura debe ser posterior al final del corte anterior. No se actualizan fechas de una captura vieja para aparentar renovación. El saldo utilizado debe observarse explícitamente; su ausencia continúa siendo `null` y retiene el archivo. Importes y documentos deben conciliar dentro del propio corte; una moneda ambigua, importe no contable, UUID repetido o saldo vencido mayor al utilizado lo rechazan.

Los cambios coherentes frente al corte anterior de saldo, conjunto de documentos o nombre se conservan como retenciones de revisión y se pueden **archivar**. No autorizan abrir ni reducir deuda operativa. Una cuenta ausente queda en `missing_from_visible_scope`; no se elimina ni se presume saldo cero, incluso si el corte anterior mostraba deuda positiva. Los nombres duplicados nunca se fusionan. Entregas y abonos detallados siguen sin acreditarse con este censo.

## Dos codificaciones de huella

`evidence.list_sha256`, `accounts_sha256`, `prior_payload_sha256` y `registry_snapshot_sha256` son SHA-256 de los **bytes exactos de los cuatro archivos privados** de entrada. El config fija sus rutas y hashes; el manifiesto privado identifica las preimágenes. Cambiar un byte rechaza la reproducción.

`expected_context.registry_sha256` y `expected_context.prior_archive.payload_hash` corresponden a la serialización JSONB de PostgreSQL y se recalculan dentro de la base. No deben compararse directamente con los hashes de los archivos JSON: sus codificaciones pueden diferir. El SQL valida formato de los pins de archivos y exige el contexto PostgreSQL exacto; la revisión de los bytes archivados pertenece al preparador reproducible y al ensayo supervisado.

## Preparación y ensayo

Usar el Node instalado en el entorno y rutas privadas absolutas. El config nuevo contiene `mode`, `assessment_at` e `inputs.list/accounts/prior/registry`, cada uno con `path` y `sha256`. Cada carpeta de salida debe ser nueva; la renovación no sobrescribe expedientes.

```sh
node scripts/m9/prepare-general-customers.mjs CONFIG_PRIVADO SALIDA_NUEVA
node scripts/m9/archive-general-census.mjs PLAN_PRIVADO SHA_PLAN ARCHIVO_NUEVO FECHA_UTC_CANONICA
```

El primer comando produce cinco archivos, incluidos `delta.json` y la cola de detalles. El segundo produce payload, ensayo con replay y `ROLLBACK`, y un candidato de carga distinto. Generar SQL no lo ejecuta. Root es el único escritor de staging y debe revisar actor y destino antes de ejecutar. Los expedientes privados usan carpetas 700 y archivos 600; no se versiona PII.

`scripts/m9/census-renewal.sql` es un draft forward, fuera de `supabase/migrations`. No crea tablas ni permisos públicos. Los nuevos helpers y el escritor siguen privados: sólo mantenimiento PostgreSQL con ADMIN activo, permiso `customers.manage` y guard de staging. El nonce usa el mismo dominio de v1. Barreras `NOWAIT` y handler exterior rechazan contención y liberan locks parciales. El replay exacto devuelve recibo histórico; no promete vigencia actual ni vuelve a registrar datos. Mismo identificador con cuerpo distinto se rechaza.

El ensayo debe auditar todas las tablas antes, durante y después. Sólo se permite una adición en el archivo de censos durante el ensayo; tras `ROLLBACK` deben quedar idénticas todas las filas. Después de un eventual commit, el archivo es inmutable: una rectificación se añade como otro corte genuino posterior; no se borra el histórico como compensación. Este bloque no necesita compensar libros porque no los modifica. La conservación del archivo anterior es una condición explícita del QA.

## Verificación del bloque

- 60 pruebas unitarias enfocadas: 27 anteriores y 33 de renovación.
- QA PostgreSQL local aislado: 40 rechazos adversariales y 9 rechazos de ACL.
- Compatibilidad del lector existente y replay v1; definición v1 preservada salvo despacho.
- Contexto de registro/prior, fechas imposibles, captura parcial, monedas, claves, importes, delta, holds nulos, deriva y replay histórico verificados.
- Sólo el archivo cambia durante el ensayo; otras 167 tablas permanecen idénticas. Tras rollback, las 168 tablas quedan idénticas.
- Contención real con dos conexiones: rechazo `CENSUS_RENEWAL_BUSY_RETRY` y liberación de barreras parciales.
- Lint y TypeScript correctos. Auth/Storage del clon local son stubs; esto no reemplaza aceptación con sesión real en Preview.

La captura nueva completa y su payload real se generan únicamente cuando estén disponibles las 172 capturas verificables. Tener un listado de 172 y algunas fichas no constituye un corte completo. Este cierre técnico no afirma una nueva apertura, una entrega, deuda vigente confirmada ni una renovación de Woo.
