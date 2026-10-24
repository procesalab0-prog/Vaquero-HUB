# M9 · Cancelación web con la caja original cerrada

Plan previo, 23 de octubre de 2026, desde `4cf8731`, rama propia
`codex/m9-woo-cancelacion-cerrada-20261023`. Objetivo: preparar la aceptación del
2 de noviembre; ninguna fecha habilita producción o un sexto ensayo conectado.
Root es el único escritor/publicador remoto. Desarrollo y QA sólo en un clon
local asignado. No navegador, Woo, pasarela, credenciales o fuentes reales nuevas.

## Problema comprobado

`app.m9_woo_native_finance` exige una sesión OPEN del actor antes de POST o
FULL_CANCEL. Además, `app.cancel_sale_base` exige OPEN en la sesión original.
El método sintético web es OTHER/M9_WEB_TEST y no mueve efectivo; aun así,
la cancelación completa depende de que siga abierta la caja histórica. El lector
privado de recibos ya recupera una operación comprometida tras cerrar la caja;
no ejecuta ni permite reintentar una compensación que todavía no existe.

## Extensión propuesta antes de editar los escritores

Conservar el mismo escritor, evidencias, postings, recibos, outbox y motor nativo
de cancelación. No duplicar checkout, inventario, diario financiero o recepción.
POST y todas las rutas POS ordinarias permanecen intactas. Para FULL_CANCEL,
el escritor bloqueará la sesión ORIGINAL de la venta, en la misma sucursal;
la ventana debe apuntar a esa sesión, OPEN o CLOSED. No se exige abrir otra caja,
no se reabre la original y no se cambia su cierre, arqueo o saldo.

Cambiar sólo la rama cerrada del guard nativo por una aserción privada que
rechaza por defecto. Para admitir la excepción debe comprobar mantenimiento
postgres real y rol de sesión no degradado, staging, ADMIN activo con pos.sell y
sales.cancel, sucursal STORE activa y acceso, ventanas vigentes, posting y recibo
POST originales exactos, pago único M9_WEB_TEST/OTHER con importe/referencia
originales, evidencia FULL_CANCEL causal reciente por el total y recepción física
sintética explícita. No CASH/CARD/USD/CREDIT, pagos mixtos, quick lines,
devoluciones parciales, deuda ni asociación sólo por folio o importe.

Un GUC de binding no constituye autorización. Propuesta autorizada por root para ensayo local:
capacidad efímera pg_temp, creada SOLAMENTE dentro del escritor completo,
ON COMMIT DROP, dueño postgres y ACL sin clientes. Nonce aleatorio unido a backend,
transacción, actor, posting, venta, evidencia y hash exacto. El guard consume una
sola vez; no existe una función pública o privada separada que la emita. Se limpia
y restaura el contexto en éxito y excepción. Una llamada directa a cancel_sale
antes/después o un GUC forjado nunca basta para separar cancelación del posting.
No es un ledger ni contiene datos del comprador; no sobrevive a la transacción.

Se aplicarán preimágenes SHA exactas y reemplazos contados de definiciones
instaladas para evitar cambiar un motor que haya derivado. El cuerpo nativo de
movimientos, estado, permisos, recibo, auditoría y compensación conserva su lógica.
El ensayo debe comparar la definición anterior/siguiente y aislar los cambios.

## Riesgos y pruebas previstas

- Seguridad DEFINER: comprobar session_user y current_setting(role), no sólo
  current_user. Probar SET ROLE authenticated/anon/service_role con binding y
  nonce falsos; también llamadas directas de mantenimiento sin capacidad vigente.
- Consistencia: cancelar y producir recibo/order/outbox en la MISMA transacción;
  fallo entre movimiento/estado/recibo revierte todo y no deja una capacidad usable.
- Historial: no actualizar arqueo o cierre original, pagos históricos o recibo POST.
  La auditoría nativa identifica actor actual y conserva la venta/importe original.
- Inventario: restitución sólo tras prueba física completa; Clave 1 literal,
  variant_id y líneas exactas; costo NULL permanece desconocido. Un reembolso
  financiero sin recepción no habilita reposición.
- Concurrencia: mismo orden sale → sesión original → pedido → variantes/stock;
  carreras cierre/cancelación y doble FULL_CANCEL, pérdida de respuesta y replay.
  Ninguna deducción/reposición o ticket se duplica.
- Regresión: POS con caja cerrada sigue rechazado, POST aún necesita OPEN, importes
  mixtos y otros métodos siguen retenidos. No cambiar permisos/grants públicos.

QA principal con BEGIN/ROLLBACK y auditoría completa app/public idéntica.
Si root autoriza un ciclo local comprometido, debe ser sólo sintético y conservar
historia, cancelación final y saldos cero; se distinguirá de rollback global.
Auth/Storage locales son stubs: no certifican aceptación real Auth/PostgREST,
checkout, pago de banco ni prueba física. Root decide la aplicación en staging
sólo tras revisar SQL, resultados y crossreview. Compuertas remotas siguen false.

## Implementación y resultado comprobado

`woo-closed-cash-cancel-forward.sql` conserva las tablas/recibos existentes.
El guard privado ligado al posting consume la capacidad también con caja OPEN;
no se puede usar un binding GUC para ejecutar cancel_sale de forma independiente.
La excepción CLOSED consulta esa misma capacidad ya consumida. El cuerpo nativo
sólo cambia esa expresión de guarda. El writer cambia su declaración local,
selección de sesión para FULL_CANCEL y bloque de llamada nativa; POST permanece
igual. No hay tabla permanente, wrapper público, grant o autorización externa.

Preimágenes de definiciones instaladas, comprobadas antes de aplicar:

| Función | SHA256 anterior | SHA256 posterior en QA |
| --- | --- | --- |
| cancel_sale_base | 9922d44935542f8077413513d24200fa70d8590cbf97a29dd72b9b0934a02e2e | 95aa17669545b38fed970e6e9db537e2ce10f9aec14798ed792e3a4933b2dff6 |
| m9_woo_native_finance | db8309b1b0fef90b449d5474c1137f1a0341630bc946e7c2d2f31fc883e92971 | d2386c2ece57731a215087aeecbd3f5a82a323dbcb24adc5588100b6f0c312c6 |
| m9_woo_assert_finance_sale | bc055438080558e9240bf949fc2084a6a894eb061fd6612dcc4858208ab72c01 | ef2601ca291c8733262ea9541098e67e7059c7f3eb9ec2c29c1e9f541db3a5b4 |

El wrapper público cancel_sale conserva exactamente
`85951fb3c330aff9dde5bfa07036bfc2de34c5316b3e3fb2e698739818b96d11`.
El forward completo ensayado tiene SHA256
`0f8c39d93d8c2ff3f20a91f7e291d73ef64019dbf6eeea66b639e59a83dcbf17`.

Clon asignado: `qa_m9_woo_closedcash_20261023`, localhost:59432. SELECT inicial:
168 tablas app/public y **14 recibos financieros preexistentes**. El número dos
de una prueba previa era su delta propio, nunca el total del clon.

Runner: `scripts/m9/verify-woo-closed-cash-cancel.mjs`, restringido a esa URL
local exacta y carpetas privadas nuevas. Reutiliza los constructores de fixture
del runner aceptado de recuperación; no modifica aquel runner ni el constructor
m9_current_row. Sólo códigos/órdenes/sucursales identificados SYNTHETIC, sin datos
de SICAR o compradores. Ninguna orden se crea en Woo o en campaña conectada.

`qa-4` completó 40 controles y 34 rechazos SQL reales, con ROLLBACK de las
168 tablas y cuatro definiciones originales exactamente iguales al baseline.
Incluye POS cerrado todavía rechazado, POST todavía requiere OPEN, métodos
CASH/CARD/TRANSFER/USD y mixtos retenidos, permisos/actor/sucursal, GUC falso,
capacidad reentrante/reutilizada, colisión TEMP ajena sin sobrescribir y dueño
cliente rechazado. Un trigger sintético fuerza error después del consumo y al
empezar el movimiento nativo: la operación se revierte y ambos GUC y la ausencia
de TEMP se comprueban antes de abandonar ese ensayo.

Dos carreras adicionales se confirmaron realmente en transacciones locales:

1. **Cierre primero:** la cancelación espera el lock de la sesión original;
   al confirmar el cierre, cancela con esa misma sesión CLOSED sin cambiar su
   arqueo, estado o pagos. Un segundo FULL_CANCEL simultáneo espera la venta y
   devuelve el mismo recibo tras COMMIT. El lector recupera con la ventana apagada.
2. **Cancelación primero:** el cierre espera el lock de la sesión hasta confirmar
   inventario/estado/recibo completos. Después cierra normalmente; replay no
   añade filas y el recibo sigue recuperable con sesión y ventana cerradas.

En ambos casos se observó el bloqueo real mediante pg_blocking_pids, sin sleeps
que sustituyan la comprobación. Se conservan todas las filas previas de las
168 tablas y los 14 recibos originales. El delta propio conserva cuatro ventas
CANCELLED (dos POS de regresión y dos web), cuatro recibos, cuatro pagos históricos
OTHER y los movimientos nativos de reversión/retiro. Inventario/reservas finales
cero, costos desconocidos, cero movimientos no nulos de efectivo. Los dos
movimientos de caja añadidos son aperturas sintéticas por cero; no se ocultan.
Seis libros se comparan por deltas explícitos y preservación de filas previas;
este ciclo COMMIT no se llama rollback global.

Las tres compuertas locales usadas se dejan false; productos/variantes/registros
propios inactivos y cajas cerradas. Las ubicaciones técnicas quedan activas sólo
para permitir lectura histórica bajo su guard existente, sin caja/productos
activos. No se eliminan recibos, ventas, semillas previas ni secuencias.

`qa-1` y `qa-2` conservan fallos de expectativa del runner: can_access_location
rechaza sucursal inactiva o WAREHOUSE antes del nuevo selector y devuelve
WOO_FINANCE_DISABLED. Se corrigieron esas expectativas al contrato nativo; el
SQL no cambió. Baseline/funciones quedaron iguales tras revertir. `qa-3` pasó
39 controles/33 rechazos; `qa-4` añadió el caso de dueño TEMP ajeno y las carreras.
No se reejecuta el clon comprometido sin revisar la historia acumulada.

Evidencia privada original:
`outputs/m9-woo-cancelacion-cerrada-2026-10-23/qa-4/`.
Se entrega copia pinneada al expediente coordinado
`outputs/m9-arranque-integral-2026-10-23/woo/closedcash-local/` sin borrar el origen.
ESLint, sintaxis Node y diff-check correctos. Revisores independientes revisaron
el SQL exacto; sus dictámenes y lectura de recibos son adicionales a esta ejecución.

## Límites que permanecen

La cancelación con caja cerrada queda comprobada sólo para el ensayo sintético
OTHER/M9_WEB_TEST estrecho. No autentica un proveedor o pago real, no activa el
writer, y POST todavía depende de una sesión OPEN. No resuelve de forma general
Woo 24/7, reembolsos parciales, comisiones/impuestos/envío ni reposición sin
recepción física. Auth/Storage son stubs locales. No hubo DDL/DML remoto,
publicación, navegador, compras Woo, sexta campaña o apertura operativa nueva.

Root revisa SQL/crossreview/preimágenes y decide cualquier aplicación en staging.
Si sólo acepta positivo local y negativo remoto, el cierre se etiqueta como diseño
estrecho validado, no como prueba de compra o pasarela conectada. La prueba física,
la renovación de fuentes y las demás dependencias del objetivo2nov permanecen.
