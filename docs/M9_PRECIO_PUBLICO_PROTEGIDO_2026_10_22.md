# Plan previo · Precio1 SICAR sólo en Mi Tienda · 22 octubre 2026

Base raíz `8e47cab`. Diez códigos cuyo único cambio literal entre SICAR19 y
SICAR22 es Precio1, de $980 a $1,150. Los otros once cambios siguen retenidos.
La sugerencia Woo20470 no es un vínculo actual ni una identidad aprobada. Este
adaptador no toma decisiones sobre agrupación o publicación web.

1. Reutilizar el comparador de cortes y fijar XLSX/reportes originales con SHA;
   repetir SELECT acotado de los diez códigos. Una entrada duplicada, contexto
   cambiado, costo definido, agrupación o nuevo vínculo Woo bloquea todo el lote.
2. `bulk_update_variant_prices` ya cambia precio con auditoría, pero es una API de
   operación general: no incorpora evidencia SICAR, proyección M9 ni compensación
   condicionada. Mantenerla intacta y preparar un adaptador privado invoker, sólo
   postgres y ADMIN autorizado en staging, sin grants de cliente.
3. Sólo actualizar `variants.price_cents` y
   `m9_rows.source_row.price_cents`. La fila M9 es proyección vigente; conservar
   `m9_rows.source_sha256`, cortes raw, registro provisional y su source_evidence
   original. Un recibo inmutable guarda contexto anterior/posterior, filas literales
   y procedencia nueva; no fingir que todo el catálogo fue reimportado de SICAR22.
4. Barreras Products EXCLUSIVE → Variants EXCLUSIVE antes de otros locks, y
   advisory común de catálogo. Revalidar identidad, código, fuente y proyección
   completa después de esperar. No exigir libros financieros vacíos ni cambiar
   ventas, saldos, stock, costos, asociaciones o imágenes.
5. Estos diez son provisionales sin source/draft/binding ni autorización web:
   conservar `web_release=false`. Rechazar una preparación posterior que agregue
   contexto web. No reescribir huellas ni fabricar elegibilidad o revisión Woo.
   En familias con guardas web existentes, el precio modifica su fingerprint y
   exige revisión separada; no usar este adaptador fuera del alcance acotado.
6. Eventos APPLY/REVERSE aditivos e inmutables, replay condicionado al estado
   posterior y compensación sólo ante contexto intacto. Restaurar sólo el precio
   y su proyección, conservando auditoría y tiempos reales de edición; no rebobinar
   updated_at ni borrar historial.
7. Ensayo aislado local: rechazos de cambios no esperados, permisos, rollback,
   replay, compensación con cambios manuales y dos carreras reales observables.
   Root revisa, crea forward y hace cualquier DDL/DML remoto. Este frente no escribe
   staging/producción ni Woo; entrega payload inerte y evidencia privada.

## Entrega y evidencia

SELECT real del **23 octubre 2026, 01:17:29 UTC** (22 de octubre en México):
los diez códigos mantienen precio98000, costoNULL, padre provisional individual,
UUIDs y códigos literales exactos. No tienen fuente/borrador/binding/fotos/colas
web; `web_release=false`. La sugerencia20470 sigue en los reportes como sugerencia,
sin crear ningún WooID o atributo inferido.

Se reutiliza el comparador anterior y se supera exclusivamente su reserva de
contexto Woo para el precio local, conforme a la fuente maestra SICAR ya
confirmada. El nuevo preparador exige que todos los campos literales, incluida
existencia, sean iguales entre ambos cortes excepto Precio1. No convierte la
reserva de agrupación/web en una aprobación. Los otros once cambios permanecen
en la sección `held` completa del plan.

El SQL draft instala un diario privado aditivo `m9_sicar_price_events`, un lector
de contexto y dos funciones invoker de mantenimiento. APPLY sólo cambia precio
nativo y su proyección M9; conserva el SHA original y la evidencia original del
registro provisional. El nuevo SHA del corte queda en el recibo, con las filas
literales y hashes de bytes seleccionados. No re-fecha ni altera los XLSX,
reportes o importaciones anteriores. Los eventos y la auditoría son inmutables;
REVERSE agrega otro evento y conserva tiempos reales de edición, sin restaurar
updated_at histórico. No cambia variantes, códigos, agrupación ni historia de
ventas o saldos. El contexto completo se compara después de los locks.

No se reutiliza la API general de precios porque no guarda esta procedencia ni
mantiene la proyección M9 o una compensación verificable. Se conserva sin cambios.
No se modifican guardas web: el adaptador sólo admite provisionales bloqueados y
sin contexto web. Si un usuario guarda una ficha o vincula Woo antes de aplicar,
se retiene todo el lote. Las guardas existentes de fingerprint siguen vigentes.

Validación:

- **24 pruebas unitarias** PASS: sólo Precio1, corte distinto, UUID/código,
  duplicados, costos, precio vigente, campos secundarios, stock, agrupación,
  nuevo contexto web, snapshots vencidos, procedencia y no sobrescritura.
- **24 controles SQL locales** PASS: precios10/replay/compensación10, fallo
  transaccional después de updates, drift de precio/descripción/fuente/registro,
  permisos anon/authenticated/service_role, rechazo de cambio manual antes de
  compensar y contención observada de otra conexión. El rollback exterior deja
  **166 tablas preexistentes idénticas**, incluidos los libros con sus fixtures.
- Carrera real con filas visibles a ambas conexiones: un writer toma FOR UPDATE
  sobre una variante exacta, BIND de precios espera, el writer cambia y COMMIT;
  se rechaza la precondición vieja sin crear eventos. Orden inverso: APPLY espera
  completa, el writer queda bloqueado, después cambia y COMMIT; la compensación
  se retiene para conservar el cambio manual. **Ambas esperas observadas con
  pg_blocking_pids; cero deadlocks.**
- Los ensayos comprometidos se limitaron al clon local propio
  `qa_m9_precios_block4_20261022`; sus diez fixtures quedaron inactivas, con
  historial QA preservado. No es Auth real ni aceptación con caja o inventario.
- Lint enfocado y diff check PASS. Tres preparaciones de las mismas entradas son
  idénticas en bytes. El generador exige directorio nuevo y archivos wx.

Expediente privado:
`outputs/m9-precio-publico-protegido-2026-10-22/`. Config, fuente literal verificada,
`estado.json`, consulta SELECT, tres preparaciones, `ensayo-1.json`,
`carreras-1.json`, manifiesto/verificador offline. La fecha fija del config
reproduce el análisis histórico; no renueva el snapshot. SQL verifica vigencia
antes del primer APPLY. Este frente **no ejecutó DDL/DML remoto**: Root revisa,
ensaya y genera la migración forward antes de aplicar en staging. Sin main,
producción, Woo, costos, existencias ni autorización de arranque.
