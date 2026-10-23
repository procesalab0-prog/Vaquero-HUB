# Vínculo documental literal posterior al alta provisional

Plan separado del bloque de entregas, desde `9576296`. El coordinador confirmó el alta de un código literal en staging; el agente sólo consultará el resultado y ensayará localmente.

1. Renovar la consulta exacta en staging, fijando variante, fila administrada, estado actual, documento y línea registrada. Conservar los manifiestos anteriores como evidencia anterior al alta.
2. Preparar un solo vínculo por Clave 1 literal. El documento y la línea históricos permanecen inmutables: no se cambia el `variant_id` del archivo ni de la fuente registrada.
3. Guardar la revisión de identidad en un diario privado aditivo, separado de observaciones de entrega. Anular mediante otro evento. Comparar archivo, documento completo, línea registrada y catálogo real antes del vínculo; rechazar duplicados, fuentes genéricas y cambios del destino.
4. Ensayar alta/replay, anulación/replay, cambios concurrentes y ACL sólo en la base local aislada. Auditar las tablas durante el ensayo y después de ROLLBACK. El coordinador revisará y decidirá cualquier escritura remota.

El vínculo expresa identidad documental y no entrega, reserva, costo ni deuda nueva. Mantiene `UNKNOWN` y los lectores operativos no lo consumen. No concede autorización operativa ni modifica agrupaciones del catálogo.

## Entrega

La consulta real posterior al alta encontró una única variante administrada para el código literal solicitado. La consulta adicional de las 23:56:16 UTC confirmó también el ID original del documento, folio, titular y clave de cuenta registrados; coinciden literalmente con el archivo histórico. El catálogo tenía 15,891 filas administradas en ese instante. El payload no fija ese conteo global: fija sólo el documento/línea y el estado exacto de la variante. No se renovó ni re-fechó la fuente de créditos.

El archivo conserva **166 líneas mapeadas y 17 sin mapear**. El plan propone **un vínculo documental adicional** por diario aditivo; después de su revisión y aplicación independiente serían **167 identidades documentales efectivas**. Quince líneas genéricas y un código retenido por categoría no se tocan. Las 183 entregas continúan `UNKNOWN`. Los lectores existentes no consumen todavía el nuevo diario y no se anuncia un cambio en sus conteos históricos.

SQL en `scripts/m9/clientes-archive-line-link.sql`: tabla privada con RLS denegada, escritor de mantenimiento ADMIN/`customers.manage`, idempotencia por solicitud y actor, revisión esperada y anulación aditiva. Usa el mismo bloqueo `sicar-catalog-sync` que las rutas de catálogo existentes y barrera de tablas antes de comprobar la fila actual. El lector privado invalida el vínculo si cambian la fuente o el catálogo; la compensación sigue disponible cuando el catálogo ya cambió. No actualiza fuentes históricas y ningún lector financiero o de stock consume este diario.

Validación: 24 pruebas unitarias nuevas (72 junto con las 48 del bloque anterior), ESLint y formato correctos. En la base local sintética aislada, 20 negativos y 12 rechazos ACL, contención real observada frente a un escritor de catálogo, vínculo/replay y anulación/replay, incluida anulación con catálogo cambiado. Durante el ensayo únicamente cambió el nuevo diario; las otras 167 tablas quedaron idénticas. Después de ROLLBACK las 168 tablas quedaron idénticas. Auth/Storage locales siguen simulados, sin aceptación Auth real para este flujo.

Artefactos privados en `outputs/m9-clientes-vinculo-literal-18275-2026-10-22/`: capturas fechadas, pines de fuente, plan y payload inertes, compensación y ensayo SQL con ROLLBACK. UUIDs y contenido de clientes permanecen fuera de Git. El coordinador es el único autorizado para revisar y aplicar el plan remotamente; este agente no creó el vínculo en staging.

## Corrección independiente antes de aplicar el borrador

La revisión de catálogo encontró una inversión posible: `SHARE` permite un `FOR UPDATE` previo, mientras el INSERT del vínculo necesita la FK de variante. Se corrigió antes de aplicar el SQL remoto: para BIND se toma primero el advisory común de catálogo, después `products EXCLUSIVE` y `variants EXCLUSIVE`, antes de cualquier `SHARE`. Las comprobaciones exactas y la compensación conservan sus límites. El preparador también rechaza directorios de expediente existentes y escribe archivos con `wx`, sin sobrescribir evidencia previa.

El ensayo normal con el fix volvió a pasar: 20 negativos SQL, 12 ACL y ROLLBACK con las 168 tablas idénticas. Las unitarias ahora son 25 nuevas, 73 combinadas con el bloque de entregas, incluyendo rechazo de sobrescritura.

En el clon local separado `qa_m9_entregas_race_20261022` se crearon dos variantes y documentos exclusivamente sintéticos, comprometidos antes del baseline para que otras conexiones pudieran bloquear la fila real. Se verificó una fila en cada `FOR UPDATE` y retención real mediante `pg_blocking_pids`:

- Writer primero: FOR UPDATE, BIND espera, writer UPDATE/COMMIT; BIND rechaza el catálogo anterior y no crea vínculo obsoleto.
- BIND primero: FOR UPDATE espera su COMMIT; después el writer UPDATE/COMMIT deja el vínculo `HELD_SOURCE_OR_CATALOG_CHANGED` y la compensación lo deja `REVOKED`.

No hubo deadlocks. Este ensayo de carrera conserva historia sintética comprometida, por lo que no se presenta como un ROLLBACK global: cambiaron únicamente el diario, el retiro lógico del registro, auditoría y los dos productos/variantes de prueba; las otras 163 tablas quedaron idénticas desde el baseline posterior al fixture. Los fixtures quedaron inactivos, el registro retirado lógicamente y los abonos, caja, inventario y deudas nativas no cambiaron. UNKNOWN y archivos de origen se conservaron. No se borró ni truncó historia. Todo ocurrió en el clon local; Auth/Storage continúan simulados y no autoriza cobros o entregas.

Los recibos anteriores se conservan. El expediente corregido se entrega en `outputs/m9-clientes-vinculo-literal-18275-2026-10-22/lock-fix/`; el payload real mantiene exactamente sus bytes y selección de una línea.
