# M9 · Bloqueo de salidas por cambio y aceptación de devoluciones

## Alcance

Continuación autorizada en Preview y Supabase staging `zsezjtswqeijboezvado`.
No se modifica main, producción ni WooCommerce. No se importan existencias.
Se conserva la venta QA cancelada LAP-V-000001 y sus movimientos históricos.

## Problema encontrado y corrección

La compuerta M9 cubría `sale_items` y `layaway_items`, pero no los renglones
`OUT` de `return_items`. La búsqueda de reemplazos tampoco consultaba la
revisión. Un código con existencias podía entregarse en un cambio sin estar
aprobado para el ensayo, aunque la venta directa estuviera bloqueada.

La migración `20261019213525_m9_exchange_review_guard.sql` agrega un disparador
privado para las salidas `OUT`, con el mismo control de evidencia, vencimiento
y lista autorizada que una venta. Con control activo exige actor válido,
`returns.create` y `pos.sell`. No agrega permisos de cliente ni modifica RLS.
Los controles existentes de PIN, libro inmutable, saldo de caja, cantidades,
reserva y existencias siguen vigentes.

`IN` no exige revisión vigente: una devolución de una venta histórica debe
poder recibirse aun cuando el catálogo esté retenido o el ensayo haya vencido.
La autorización del gerente y el plazo del ticket siguen siendo obligatorios.

La búsqueda compartida por las RPC v1/v2 filtra códigos no aprobados antes
del orden y límite. El servidor muestra mensajes específicos si una pantalla
vieja intenta entregar un artículo pendiente, modificado o vencido.

## Ensayo reproducible y auditoría

`scripts/m9/test-exchange-allowlist.sql` funciona sobre un historial existente;
no borra datos para exigir una base vacía. Requiere staging habilitado, una caja
ADMIN abierta y dos variantes QA con saldo cero. Los valores por defecto son
2396 y 1180; el ejecutor nativo selecciona sus propios códigos sintéticos.

Toda la prueba corre en una transacción que termina en ROLLBACK. El token de
supervisión de esta prueba SQL es una fixture temporal, expresamente distinta
de verificar PIN o Auth/PostgREST en el navegador. No establece contraseñas ni
guarda autorizaciones persistentes. Las restricciones diferidas se ejecutan
antes del rollback para comprobar los balances completos.

Los 15 controles comprueban búsqueda v1/v2, exclusión y límite; rechazo sin
autorización; rechazo de salida pendiente, evidencia cambiada y revisión
vencida; ausencia de efectos del intento rechazado; cambio aprobado;
devolución permitida después del vencimiento; repetición idempotente de cambio
y devolución; devolución restante, costo NULL y balance exacto de efectivo.

Resultados: PASS local y staging. Las huellas de catálogo, códigos, inventario,
ventas, caja, folios y autorizaciones volvieron a la base inicial. La única
diferencia concurrente fue un evento `app_users.update`, correspondiente al
PIN que el usuario creó directamente; no se consultó el hash ni el PIN.

También pasaron 166 migraciones, las regresiones operativas monetarias y de
concurrencia, 18 controles de agrupación, 717 pruebas unitarias, ESLint dirigido
y TypeScript. Auth/Storage nativos son fixtures; no equivalen a una aceptación
desde la interfaz. Los asesores mantienen los 64 INFO y 132 WARN anteriores,
sin nuevos privilegios. [Referencia de asesores](https://supabase.com/docs/guides/database/database-advisors).

## Publicación y ensayo desde el programa

Commit Preview `19f75c53cb1e443e25d48a2e686afd94fa2a8367`, árbol
`fda092170ea4edc00194b93bc0fb6dfa6621744c`, idéntico al commit local `2e627ea`.
Actualización con comparación del SHA remoto; no force push.
Despliegue `dpl_EfdvkdKMBYyhFsFfEiXxm35Pprso`, READY/Preview.
Alias: https://vaquero-hub-git-codex-m9-staging-review-procesa-lab.vercel.app

Run UI: `212c70e5-de81-4bc7-b469-d6a083df531c`.
Plan y preparación se ensayaron primero con rollback y huellas idénticas.
Después se autoriza únicamente 2396, con dos piezas sintéticas y vencimiento
de una hora. Se conserva precio 219000 centavos y costo NULL.

La interfaz cobró una pieza mediante escaneo y efectivo exacto, creando
LAP-V-000002 (`a0532d9c-7793-4bb4-a789-02343f81dc51`). SQL confirmó una sola
salida, un renglón de costo NULL e ingreso de 219000 centavos. El usuario
configuró su PIN sin compartirlo. La devolución completa queda preparada en
Tickets para que introduzca el PIN y autorice la operación.

No se declara todavía terminada esa devolución por interfaz. Al completarla
hay que verificar recepción de la pieza y reintegro por el método original,
retirar las dos piezas sintéticas, restaurar la fila original de la lista y
dejar vencida la revisión QA. Si no se completa, cancelar sólo esta venta QA
y hacer el mismo cierre; nunca borrar el historial ni falsificar una devolución.

## Alcance del porcentaje y siguiente etapa

Continúan 15,876 / 16,310 códigos SICAR cargados (97.3391% del catálogo), con
434 retenidos. Este bloque aumenta la cobertura operativa y la seguridad del
arranque; no aumenta el número de códigos cargados ni representa 97% de toda
la migración. Clave 1, costos desconocidos, familias provisionales e IDs
históricos se mantienen. Siguen pendientes la renovación de fuentes antes
del corte, reportes SICAR de actividad para archivar y autorización separada
de existencias reales y operación productiva.

Evidencia local: `outputs/m9-cambios-bloqueo-2026-10-19/`, fuera de GitHub.
