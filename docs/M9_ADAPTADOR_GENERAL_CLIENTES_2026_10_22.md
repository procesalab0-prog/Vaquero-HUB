# M9 · Adaptador general de registro heredado · Plan previo al SQL

22 octubre 2026. Rama propia desde `a0ecc4e`. El coordinador es el único escritor
de staging y generará la migración CLI. Este frente prepara y prueba SQL forward,
sin DDL/DML remoto, aplicación, versiones, producción o acceso SICAR/Woo.

## Alcance y decisión

Usar el archivo privado inmutable de detalles ya conservado en staging por su
SHA256 y hash de payload. No reenviar nombres/contactos desde un JSON editable ni
crear otro padrón. Registrar exclusivamente cuentas de saldo positivo ausentes
y sus documentos OPEN completos. Lo ya existente se compara y se conserva; una
diferencia queda retenida y nunca causa UPDATE, baja, reducción de saldo o apertura.
El documento liquidado permanece en el archivo y no vuelve a ser deuda.

El alcance real candidato son 53 cuentas, 76 documentos abiertos, 85 antecedentes
de abono (dos cancelados), 168 líneas y $228,648 de saldo observado. Esto es
registro de origen; no son nuevos cargos ni cobros. Las siete aperturas anteriores
por $11,910, los 61 registros anteriores y la fixture independiente se preservan.

Reutilizar `m9_customer_batches`, `m9_customer_sources`, `m9_credit_documents`,
`m9_credit_source_payments`, `m9_credit_source_lines` y `m9_legacy_registry`.
Añadir un alcance de lote expresamente histórico, no aceptado por el cobrador
operativo anterior. Nueva bitácora privada e inmutable registra la procedencia,
filas añadidas/omitidas y su recibo idempotente. No teléfonos, email, Auth,
consentimiento, socio o cliente nativo fabricados.

## Compuertas y prueba

- Funciones privadas SECURITY INVOKER, mantenimiento postgres, ADMIN activo,
  permiso customers.manage y guardia exacta de staging. Sin EXECUTE de anon,
  authenticated o service_role; tablas RLS privadas sin grants.
- Payload sólo refiere archivo/hash y snapshot esperado de fuentes/aperturas.
  Rechazar snapshot cambiado, fuente distinta, IDs/códigos alterados, importes
  inconsistentes y metadata operativa inventada. Bloquear operaciones financieras
  sobre el lote general registrado hasta que otro plan y corte las autorice.
- Preservar fechas originales. Se admite archivo histórico para registrar origen;
  no se convierte en corte fresco ni en habilitación operativa.
- Política de adición únicamente: cuenta ya registrada no se actualiza; se
  conservan documentos/abonos/líneas y se deja su diferencia en el recibo de
  revisión. No mezclar una cuenta nueva con documentos huérfanos preexistentes.
- Repetición de request/hash devuelve el mismo recibo sin filas nuevas; request
  conflictivo o segundo request para el mismo archivo se rechaza. Locks coherentes
  con importador fuente/libro heredado. Ensayo con ROLLBACK antes de conservar.
- Ensayar en PostgreSQL local propio si está disponible: registro/replay, permisos,
  conflictos, fallos después de inserción, estados activos/cancelados, triggers de
  bloqueo financiero y hashes de tablas operativas antes/después. Preparar además
  SQL de ensayo real privado para que el coordinador lo ejecute en staging.
- Compensación del registro: preservar auditoría y referencias. El ensayo normal
  se revierte por ROLLBACK. Un retiro posterior requiere plan explícito y sólo
  puede retirar las filas creadas por este registro si no hay vínculos, cobros,
  reservas, aperturas o cambios; no borrar historia financiera.

Las entregas UNKNOWN y cantidades NULL permanecen así. Un registro administrativo
no autoriza operaciones sobre inventario. La apertura financiera futura necesitará
corte renovado y aprobación independiente; no se altera esa compuerta aquí.

## Implementación y aceptación local

SQL forward en `scripts/m9/clientes-general-adapter.sql`, sin nombre de migración
inventado. Tres funciones privadas invoker de snapshot, registro y retiro más
un trigger privado; todas sin EXECUTE para roles de aplicación. RLS sin grants
en la bitácora nueva. CHECK de alcance ampliado mediante DDL nuevo; los dos
alcances anteriores y sus datos permanecen intactos. Índices completos en ambas
FK de la bitácora, además de sus unicidades parciales y el índice del actor.

La instantánea compara hashes/conteos de 15 tablas fuente/financieras. No devuelve
PII. El payload real sólo contiene referencia del archivo, hash canónico del
payload, snapshot esperado, request y cantidades esperadas. El hash canónico se
calculó mediante un SELECT PostgreSQL local sin persistir el payload. En base se
vuelve a verificar el hash del archivo inmutable y las correspondencias literales.
Cualquier cambio de destino rechaza la operación; repetir exactamente el request
conserva el recibo. No se envían nombres nuevos desde JSON al adaptador.

El lote nuevo conserva las fechas 22 octubre 18:16:37.571–18:26:43.829 UTC;
no las reemplaza por la fecha de registro. `m9_legacy_finance_plan` no autoriza
esta fuente: el escritor heredado exige APARTADO. Además, triggers bloquean
cualquier inserción financiera heredada o nativa ligada al lote general, y hacen
inmutables sus filas de origen. Las restricciones de identidad nativa no cambian.

La compensación de este registro es **retiro lógico** con evento inmutable,
no DELETE: identidades, documentos y trazabilidad permanecen, continúa prohibida
la operación, y el request original ya no se puede repetir como registro activo.
Se rechaza si hubo vínculo/apertura/operaciones o cambian cantidades registradas.
Para deshacer un ensayo se usa ROLLBACK completo. Un borrado histórico no forma
parte de este adaptador ni de su SQL de compensación.

Ensayo PostgreSQL en la base QA propia aislada `qa_m9_clientes_block2_20261022`,
reconstruida previamente por el coordinador. No se intervino ninguna otra base.
Fixture sintética: una cuenta/apertura anterior preservada, dos cuentas/documentos
nuevos, un documento pagado no reabierto y un antecedente cancelado conservado.
Registro, replay, fallo después de inserciones y retiro lógico pasan. **24 rechazos
adversariales y 15 controles ACL PASS; 166 tablas de negocio idénticas después
de ROLLBACK.** La comparación incluye la historia sintética anterior, sin truncar.
Auth/Storage locales son stubs; esto no certifica Auth/PostgREST real.

30 pruebas unitarias nuevas del preparador PASS; ESLint y Prettier puntuales PASS.
El preparador `scripts/m9/clientes-general-registration.mjs` no usa red ni ejecuta
SQL. Reconstruye las cantidades del archivo y produce dos ensayos con ROLLBACK,
un payload inerte y un archivo de registro explícito con COMMIT, cuya ejecución
corresponde únicamente al coordinador. Dos corridas privadas idénticas.

Expediente privado fuera de Git:
`outputs/m9-adaptador-general-clientes-2026-10-22/`, corridas 1 y 2. Conserva el
payload real 53/76/85/168, el snapshot de la auditoría previa de staging, la fuente
fijada por SHA y el resultado SQL local. Ningún SQL remoto se ejecutó desde este
frente. El coordinador debe comprobar de nuevo el snapshot en staging, ensayar
con rollback, auditar y decidir la conservación del registro administrativo.
