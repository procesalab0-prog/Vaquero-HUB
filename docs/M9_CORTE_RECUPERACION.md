# M9 — ensayo de corte y recuperación local (0.63.0)

Este procedimiento no autoriza producción ni importa existencias. SICAR conserva la identidad literal de Clave 1, precio1 público y clasificación; Woo complementa contenido y variantes. Las coincidencias técnicas no sustituyen la revisión comercial.

## Evidencia del 3 de octubre de 2026

- Respaldo consistente del Woo local: 9,976 archivos, SQLite con 57 tablas e integridad correcta. Manifiesto SHA256: `19b2e747088d1ae5f2efa8d48868b41563a54a53f08a940fb397950465b4072b`.
- Recuperación en otro directorio y puerto 9427: seis padres, 23 variantes y 19 imágenes comparados con el laboratorio original del puerto 9417. Todos siguen como borradores. Dos familias son sintéticas; los otros cuatro padres proceden del piloto nativo.
- Repetir los dos trabajos ya completados desde el diario recuperado hizo cero solicitudes: no recreó productos.
- Ensayo reproducido dos veces con archivos idénticos: 64 filas staging coinciden con SICAR (5), tres altas nuevas requieren revisión y 68 filas con variaciones de existencias quedan excluidas. No hubo cambios de precio en las filas compartidas de estas fuentes.
- De 41 familias del piloto, 36 tienen alguna reserva estructural, principalmente variantes todavía fuera del piloto. No son 36 errores nuevos. La talla 60 del sombrero 19746 y los departamentos mezclados del Nokota 24939 siguen pendientes.
- Fuente Woo autenticada del 1 de octubre; SICAR (5) congelado. Es un ensayo con esas fuentes, no el corte actualizado definitivo de una tienda que sigue vendiendo.

Evidencia local: `outputs/m9-corte-y-recuperacion-2026-10-03`, relativa a la carpeta raíz de trabajo, fuera del repositorio. Archivos principales: `restauracion-final.json`, `repeticion-restaurada.json`, `staging-snapshot.json`, `corte/ensayo.json` y `corte-repeticion/ensayo.json`.

## Repetir el respaldo y la recuperación

Desde el repositorio, usar destinos nuevos, nunca sobrescribir un laboratorio:

```sh
python3 scripts/m9/woo-test/recovery.py snapshot RUNTIME_LOCAL RESPALDO_NUEVO
python3 scripts/m9/woo-test/recovery.py restore RESPALDO_NUEVO COPIA_NUEVA SHA256_MANIFIESTO
node scripts/m9/woo-test/start-local.mjs COPIA_NUEVA --recovery
node scripts/m9/woo-test/verify-recovery.mjs COPIA_NUEVA RESPALDO_NUEVO REPORTE_NUEVO.json
```

El respaldo contiene WordPress, SQLite mediante su API de copia consistente y el diario privado. Contiene credenciales **exclusivamente locales**: permisos restringidos, no subirlo al repositorio ni compartirlo. Rechaza destinos existentes, enlaces simbólicos, archivos corruptos y trabajos sin resolver. Se comprueban todas las huellas antes de arrancar la copia.

`node_modules` y los binarios no se respaldan. La copia necesita el runtime existente fijado a `@wp-playground/cli@3.1.56` y Node; en este ensayo se enlazó el `node_modules` del laboratorio original. No es un respaldo autónomo de producción ni un respaldo de Supabase.

La copia marcada sólo puede arrancar con `--recovery`, escucha en 127.0.0.1:9427 y admite por HTTP únicamente el catálogo de consulta, diagnóstico de aislamiento y laboratorio; bloquea métodos de escritura y el administrador. Imágenes estáticas se sirven localmente. Los procesos internos de WordPress pueden mantener datos técnicos: esta protección es de acceso HTTP, no un montaje de disco inmutable. Correos, pagos, webhooks, cron y conexiones externas siguen desactivados.

## Repetir el ensayo de exportaciones

```sh
node scripts/m9/prepare-cutover-rehearsal.mjs REPORTE_ANTERIOR REPORTE_ACTUAL SNAPSHOT_STAGING.json WOO_AUTENTICADO.json SICAR.xlsx SALIDA_NUEVA
```

La herramienta comprueba huellas de las fuentes, cambios y ausencias; no genera SQL ni instrucciones de importación. Una ausencia nunca implica borrar automáticamente. `staged_review_required: 0` sólo expresa coincidencia con las fuentes del ensayo; no aprueba comercialmente las familias ni permite publicar.

## Avance y pendientes

Estimación técnica de M9: **80%**, por añadir recuperación comprobada y ensayo repetible de corte a la conciliación, piloto y envíos locales ya verificados. Es una estimación de hitos, no un porcentaje de productos migrados ni una certificación de producción. Producción continúa sin migrar.

Staging sigue abierto. Para el tramo restante: lector físico con etiqueta 2396; decisiones comerciales; nuevas exportaciones completas próximas al corte; integración y regresión de las mejoras del otro chat; respaldo y reversión específicos del entorno real; lote final revisado y autorización expresa de producción. La recuperación local no cubre esos últimos requisitos.
