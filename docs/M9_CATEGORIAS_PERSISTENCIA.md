# Categorías por ID persistidas en staging — 2 de octubre de 2026

Se implementó la persistencia privada de evidencias de categorías y se cargaron las 7 familias candidatas. Segunda ejecución: 7 UNCHANGED, sin duplicar registros o auditoría. WooCommerce y producción no se modificaron.

## Diseño y alcance

Tabla app.web_category_bindings: producto interno, padre Woo, IDs/rutas, huella fuente, huella de evidencia, fecha de verificación e invalidación. RLS activado y permisos revocados para anon/authenticated/service_role. Sin RPC pública nueva. La función administrativa de preparación es SECURITY INVOKER, sólo ejecutable con privilegios internos y exige el control STAGING habilitado.

La carga bloquea producto y fuente, exige snapshot original exacto, hash correcto y ausencia de edición humana para la primera preparación. Se conserva snapshot; sólo se normalizan las categorías sugeridas como rutas separadas. No se aplican las tres correcciones editoriales ni se importan variantes adicionales. La texana 13560 y el amartigón 37102 no están incluidos.

Cambiar categorías en un borrador, categorías sugeridas, hash/snapshot fuente o vínculo m9_products/Woo invalida la evidencia. Borrar el borrador también la invalida. Restaurar el texto previo no la reactiva. Cambiar sólo título/texto/fotos no altera el vínculo de categorías. Hay auditoría de preparación e invalidación. La lectura interna comprueba adicionalmente el estado actual; send_allowed siempre es false. Una revisión invalidada requiere un procedimiento explícito nuevo de revisión; esta herramienta no la reactiva.

El mapa acredita la captura original, no la permanencia de las categorías remotas: antes de un envío futuro habrá que refrescar Woo y comprobar cambios. Departamento/sección SICAR continúa independiente.

## Validación

- 19 verificaciones SQL ejecutadas en staging y revertidas: integridad de la carga, permisos, idempotencia, duplicados, hash cambiado, primera edición igual/distinta, edición de título, invalidación, restauración, borrado, cambios de fuente y vínculo, entorno deshabilitado, edición humana y sugerencia desactualizada.
- 101 pruebas unitarias aprobadas; lint de archivos nuevos aprobado; generación repetida idéntica.
- 7 bindings válidos, 7 auditorías de preparación, 0 invalidaciones persistidas (los ensayos se revirtieron).
- Huellas de catálogo, snapshots originales y borradores humanos antes/después idénticas. 40 fuentes, 1 borrador humano ajeno a este lote, 0 inventory_by_location y 0 inventory_movements.

Migración local creada mediante CLI: 20261003000213_m9_web_category_bindings.sql. En el historial remoto de staging, apply_migration la registró como 20261003000437. No se repararon ni renombraron migraciones históricas. La fecha UTC del archivo corresponde al 2 de octubre en México.

Advisor: INFO RLS sin políticas esperado para la nueva tabla privada sin acceso de cliente. Persisten advertencias históricas sobre funciones definer autenticadas y protección de contraseñas; no se crearon funciones definer en esta entrega. Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Reproducción

Desde work/m9-ui:

```sh
node scripts/m9/persist-verified-categories.mjs ../../outputs/m9-categorias-preparadas-2026-10-02-v2 ../../outputs/m9-contenido-web-2026-10-01 ../../outputs/NUEVA_PERSISTENCIA
```

El SQL generado contiene escrituras exclusivamente de preparación staging, no un payload Woo. Confirmar proyecto antes de ejecutarlo. Para regresión, sustituir el COMMIT final por scripts/m9/test-category-bindings.sql seguido de ROLLBACK; requiere el piloto y un borrador con actor válido. La prueba está documentada para staging poblado, no para una base vacía. apply-staging.sql, manifest.json y verificacion.json se conservan en outputs/m9-categorias-persistencia-2026-10-02.

## Pendiente

Esta entrega es infraestructura interna m9-category-persistence-1. Preview continúa 0.56.0: aún no muestra IDs ni un indicador de verificación, y su aviso genérico de categorías no refleja la nueva tabla. No hay outbox, worker ni envío Woo. Próxima entrega de aplicación: lectura autorizada de este estado y señalización clara de categorías verificadas/invalidadas, con nueva versión visible y recorrido de navegador. Después, prueba de envío en Woo aislado con revisión comercial previa. No se publicaron fichas reales.
