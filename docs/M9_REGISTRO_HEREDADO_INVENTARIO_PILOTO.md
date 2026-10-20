# Registro heredado y hoja de inventario del piloto

Diseño previo al cambio · 20 octubre 2026. Autorizado sólo staging/Preview,
sin main, producción, SICAR o Woo. Se mantiene Clave 1 literal, coste desconocido
NULL y guardas operativas. No crear cantidades, consentimientos o entregas.

El registro heredado recibe un UUID propio y referencia estable a empresa/cliente
SICAR. No es un socio, Auth o cliente nativo ni concede crédito nuevo, portal,
marketing o puntos. Esto permite conservar los once registros sin teléfono y
los nombres repetidos sin fusionarlos ni relajar public.customers. Se carga
el alcance acreditado de 61 cuentas, no todo el padrón. Source hash y lote quedan
fijados; otro corte requiere conciliación expresa. El saldo continúa como dato
de origen, no se crea otro libro financiero ni se activa deuda.

Hoja digital privada para doce códigos, asociada a variante exacta y La Piedad.
Existencia observada en SICAR se muestra como referencia; físico total presente,
ya vendido pendiente de entrega y separado sin venta empiezan NULL. Guardar es
un borrador con revisión optimista, identidad de catálogo y saldo destino fijados,
responsable de edición y eventos inmutables. No es un conteo certificado ni una
carga al libro. Sólo cantidades enteras explícitas; casilla vacía no significa cero.
Los compromisos no pueden superar el total físico. Si los tres campos existen,
puede mostrarse disponibilidad física comparativa; sigue prohibida su importación.

Tablas privadas RLS sin grants; mantenimiento invoker para registrar lote/semilla.
RPC público invoker + dispatcher privado con actor ADMIN, customers.manage,
inventory.count para editar, sucursal accesible y staging. Sin endpoint de alta
nativa, consentimiento, apertura, cobro, autorización de venta o movimiento.

Ensayar registro, replay, rechazo de cambios y borradores sintéticos en una
transacción con ROLLBACK. Comparar todas las tablas anteriores. Después conservar
registro/semilla reales sólo en tablas privadas y verificar exclusividad de cambios.
Aceptar búsqueda y borrador vacío desde Preview con sesión real; las cantidades
QA nunca se guardan en las doce filas reales. Publicar exclusivamente Preview.
Reversión: ensayo rollback; retirar la ruta si hiciera falta, conservar referencias
y eventos del registro, sin borrar historial ni reiniciar IDs/secuencias.

## Resultado de datos y ensayos

Migraciones de staging `20261020184122` y `20261020184435`: registro privado,
hoja de borradores y eventos inmutables, con helper de actor/identidad/saldo.
La segunda conserva antes/después de cada borrador; no se reescribe la primera
ya aplicada. Ninguna modificación a restricciones, triggers o permisos de
public.customers; el UUID heredado no es un member_number ni un customer_id nativo.

61 registros preservados en app.m9_legacy_registry con sus source keys/lote/hash.
Once siguen sin teléfono; nombres iguales conservan IDs distintos. Doce filas
en app.m9_pilot_stock_drafts con variante/ubicación exactas y referencias SICAR
observadas de 40 piezas. Los tres campos físicos/compromisos permanecen NULL.
Una entrada REGISTER_SEED registra la operación; replay no duplica nada.

14 negativos SQL PASS: payload de replay cambiado, revisión vencida, cinco
formatos inválidos de cantidad, compromisos mayores al físico, mantenimiento
desde authenticated, baseline cambiado, registro/evento inmutable, actor ausente
y anon. Ensayo inicial y repetición tras carga terminaron ROLLBACK. Borradores
con cantidades sintéticas y su historial nunca salieron de esa transacción.
Guardar NULL preserva NULL, no genera ceros. Recibos de ensayo/borrador tienen
count_certified=false/import_allowed=false.

129 tablas anteriores idénticas después del ensayo y de conservar registro/
semilla. Auditoría extendida de 132 tablas tras repetir el ensayo: todas idénticas.
Tras la carga sólo las tres nuevas tablas contienen 61/12/1 filas. Clientes nativos
siguen uno; ningún cargo, cobro, venta, reserva, consentimiento o stock nuevo.
Advisors sin WARN nuevos; tres INFO esperados por tablas privadas RLS sin políticas
y sin grants directos. API sólo ADMIN y permisos; no es una concesión genérica
por pertenecer al rol authenticated.

957 unitarias/113 archivos, ESLint y TypeScript PASS. Preparador offline
scripts/m9/prepare-legacy-pilot.mjs exige cuatro entradas SHA256 (plan de origen,
semilla fijada, observaciones y selección de códigos), request/actor explícitos.
No usa red, no aplica COMMIT ni concede permisos; revalida referencia literal y
vigencia de la evidencia. Dos corridas byte a byte idénticas. Su SQL generado
se ejecutó en staging con ROLLBACK y confirmó replay del registro ya conservado.

Evidencia privada fuera de Git: outputs/m9-heredados-inventario-piloto-2026-10-20/.
Publicación/aceptación de UI comprobada en el apartado siguiente.
Sigue completar padrón fuera de APARTADO, acreditar conteo físico/compromisos,
planear el servicio de cobro para identidades heredadas o su vinculación nativa
cuando exista evidencia válida, y renovar el corte antes de activar deuda/stock.
Registrar clientes heredados no elimina por sí solo ese pendiente financiero.

## Aceptación real de Preview

Código `3d48fc252f87d596a7ccb9e5d9bb02de066b86e7`, deployment
`dpl_7kwUditx7YK9zDejK71Dn2nYH3xg` READY. La primera consulta UI detectó
ambigüedad entre la variable d y el alias de la tabla de borradores. Se corrigió
exclusivamente en staging con `20261020213421_m9_legacy_list_alias_fix.sql`, sin
reescribir las migraciones anteriores. Se incorporó LIST al ensayo SQL final.
Consulta authenticated 61/12 y nueva repetición de los 14 negativos PASS, rollback.
La API se volvió a probar con la sesión real después de la corrección.

Entrada desde la revisión, listado con 61 IDs distintos y once contactos faltantes,
búsqueda por prefijo de ID y regreso al listado completo. Doce formularios con sus
36 campos de cantidades vacíos. Se rechazó en UI un borrador incompatible (físico
1 y vendido pendiente 2); no se guardaron esas cantidades. Se guardó únicamente
la nota «Hoja preparada; conteo físico y entregas pendientes.» en el código 2396.
Revisión 1→2, antes/después auditados, nota conservada tras recargar y cantidades
NULL. Es una nota de preparación, no un conteo hecho ni una firma del operador.

Auditoría tras navegador: sólo cambian app.m9_pilot_stock_drafts y su evento nuevo
en app.m9_legacy_pilot_events; registro de IDs y las 129 tablas anteriores intactos.
Los doce renglones conservan las tres cantidades NULL; un cliente nativo y libro
de deuda vacío, sin nuevos movimientos financieros o físicos. Hay dos eventos
privados: registro/semilla y borrador vacío. A 390px: scrollWidth=clientWidth=390;
viewport restaurado. No se copiaron cantidades SICAR a físico ni se reabrió QA.

Tablas privadas con RLS y cero grants de datos a public/anon/authenticated/service_role;
RPC público invoker, mantenimiento privado no ejecutable por authenticated. El actor
y los permisos se comprueban en servidor y base; no se usó una clave privilegiada
en el navegador. El ensayo SQL de rol no se declara prueba de otro empleado real;
no había fixture activo no ADMIN. Logs remotos del conector no disponibles en los
bloques previos; no se afirma revisión de logs sin errores. Main/producción intactos.
