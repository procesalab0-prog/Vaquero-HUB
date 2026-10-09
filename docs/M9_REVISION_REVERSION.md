# M9: revisión de reversión por campo

Herramienta offline `scripts/m9/inspect-rollback.mjs`, versión de entrega 0.64.0. Lee tres snapshots suministrados (antes, aplicado y actual) y genera un informe de revisión. No conecta a Woo, no escribe datos, no genera SQL ni un payload ejecutable. Sólo admite el laboratorio 127.0.0.1:9417 y su identificador conocido.

```sh
node scripts/m9/inspect-rollback.mjs ENTRADA.json REPORTE_NUEVO.json
```

Entrada: versión `m9-rollback-review-input-1`, store local, kind parent/variant, fields explícitos, before/applied/current con respuestas Woo completas. Para variantes requiere parent_id y tres parent_snapshots que acrediten pertenencia al mismo padre variable en borrador. Los snapshots son evidencia aportada, no autenticación ni lectura en vivo.

Campos admitidos: nombre, descripción, descripción corta y precio regular (sus nombres de API). No admite stock, promociones, publicación, categorías ni metadatos como objetivos de reversión. Verifica identidad literal: ID, SKU, código de barras, ID interno de variante y atributos; conserva ceros iniciales. Padres variables verifican también sus hijos. Una identidad dudosa requiere revisión manual.

Cada campo se clasifica:

- NOT_CHANGED_BY_THIS_OPERATION: la operación no lo cambió; conservar el valor actual.
- ALREADY_RESTORED: ya coincide con el valor anterior; no repetir.
- REVIEWABLE_REVERSAL: aún coincide con lo aplicado; candidato sólo a revisión humana.
- LATER_EDIT_CONFLICT: difiere tanto del anterior como del aplicado; conservar y revisar.

Si cualquier campo seleccionado tiene conflicto o cambia la identidad, se bloquea toda la propuesta del recurso. Incluso sin conflictos, production_allowed y automatic_rollback_allowed permanecen false. Los valores de campos no seleccionados quedan fuera del informe de reversión; no se propone restaurar el objeto completo.

Esto no resuelve la carrera entre una lectura y una escritura, ni demuestra ausencia de ediciones intermedias que volvieron al mismo valor. Una futura operación real necesita evidencia reciente, control de concurrencia, revisión comercial y autorización. No debe tratarse como reversión automática productiva.

Verificación: 16 pruebas específicas sobre conflictos, campos sin cambio, reversión ya hecha, identidad literal, duplicados, campos prohibidos y pertenencia al padre. Evidencia histórica real del ensayo de precio local: informa ALREADY_RESTORED sin candidatos. Dos ejecuciones generan informes idénticos en outputs/m9-revision-reversion-2026-10-03, fuera del repositorio. No se ejecutó un nuevo cambio de precio para esta verificación.
