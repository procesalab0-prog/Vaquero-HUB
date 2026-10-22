# M9 · Libro de liquidación web independiente de caja

Plan previo del 22 de octubre de 2026. Sólo staging de referencia
`zsezjtswqeijboezvado` y PostgreSQL QA local aislado. El agente entrega SQL
ensayable; el coordinador genera/aplica cualquier migración remota después de
revisar. No main, producción, pedido Woo nuevo, cron, trabajador, credenciales,
configuración de pasarela ni caja ficticia.

## Alcance contable de este bloque

Crear un libro privado de ensayo independiente de `cash_sessions`,
`cash_movements`, `sales` e inventario. No reemplaza el libro nativo de ventas,
no acredita banco, no cobra al cliente y no publica disponibilidad. Un JSON del
contrato documental anterior continúa sin autenticar al proveedor y **no puede
insertarse como CAPTURED operativo**. Sólo se aceptan fixtures rotuladas
`SYNTHETIC_TEST_ONLY`, en mantenimiento postgres, con actor ADMIN real/local QA,
guardia staging y ventana corta apagada por defecto. Sin función pública.

El diario es de doble partida y se conserva inmutable:

| Hecho sintético                     | Debe                 | Haber                |
| ----------------------------------- | -------------------- | -------------------- |
| Captura                             | PROVIDER_CLEARING    | ORDER_FUNDS          |
| Reembolso                           | ORDER_FUNDS          | PROVIDER_CLEARING    |
| Comisión del proveedor              | PROVIDER_FEE_EXPENSE | PROVIDER_CLEARING    |
| Reversión de esa comisión           | PROVIDER_CLEARING    | PROVIDER_FEE_EXPENSE |
| Liquidación declarada por proveedor | SETTLEMENT_PENDING   | PROVIDER_CLEARING    |

`SETTLEMENT_PENDING` conserva lo declarado por el proveedor en el ensayo: **no
es conciliación bancaria ni dinero contado en caja**. Las fees comerciales Woo
pertenecen al total del pedido y se guardan separadas de la comisión de pasarela.
Autorización/void y recepción física no crean apuntes monetarios. Reembolso no
reingresa mercancía; recepción no prueba reembolso. Cantidades y componentes
desconocidos se rechazan/retienen, nunca se rellenan como cero.

Conservar instantáneas comerciales por revisión, identidad literal de líneas,
subtotal/descuentos/impuestos/envío/fees comerciales y total. Congelar identidad
comercial cuando haya un evento; cambiar precios/códigos/cantidades después
requiere revisión, sin actualizar la evidencia original. Capturas parciales y
reembolsos parciales se registran sólo en el libro sintético con límites
acumulados; no habilitan venta/cancelación parcial nativa. Liquidación parcial
o no conciliada queda retenida en este primer motor.

Identidad completa: proveedor/cuenta/comercio/origen/pedido/moneda. Referencias
de evento únicas por proveedor/cuenta además de su alcance completo: reutilizar
una referencia en otro comercio o pedido no crea un segundo cobro. Las
autorizaciones y capturas pueden compartir referencia de transacción, usando
referencias de evento distintas y vínculo causal explícito.

Cada CAPTURE/REFUND/PROVIDER_FEE/FEE_REVERSAL/SETTLEMENT tiene además una
transacción monetaria única por proveedor/cuenta/tipo/transaction_reference.
Cambiar operation_id o event_reference no crea un cobro distinto. Cada
parcialidad requiere identificador monetario propio; el vínculo al pago o
autorización original se conserva en related_event_id. La clave del proveedor
debe representar la acción monetaria concreta, no un ID genérico reutilizado
de carrito o payment intent.

## Orden, reintentos y compuertas

1. Guardias de stage exacto (o marcador QA local propio) y mantenimiento; ADMIN
   activo, sin cliente privilegiado ni service_role. Validación estricta antes
   de producir recibo. No existe ruta de alta de evidencia autenticada real.
2. Serializar operación del actor y el alcance proveedor/cuenta/comercio/pedido.
   Evidencia, instantánea, apuntes y recibo se confirman juntos. Un fallo tras
   el diario revierte todo; referencia/operación únicas también limitan carreras.
3. Repetición del mismo paquete conserva recibo; cambio del mismo operation_id
   falla. El recibo se puede consultar con ventana cerrada y no repostea. No
   depende de una caja física abierta ni de un cajero en turno.
4. Recibo/consulta distingue importes capturados, reembolsados, comisiones,
   reversión de comisiones, neto declarado y saldo de clearing calculado. No
   llama a create_sale, cancel_sale, CONSUME o RESTOCK.
5. Cerrar compuerta tras los ensayos. Ninguna fila sintética operativa de caja,
   pedido Woo, stock o venta debe aparecer. Conservar evidencia de los ensayos
   locales; en staging root ejecutará sólo ROLLBACK antes de decidir persistir
   estructuras vacías/controlfalse.

## Verificación y reversión antes de integrar

SQL propuesto: `scripts/m9/woo-web-settlement.sql`. Tests sintéticos locales con
ROLLBACK: autorización distinta de captura, duplicación/cambio/referencia
reutilizada, límites de captura/reembolso/fees, componentes no cero conservados,
identidad comercial cambiada, recepción parcial independiente, neto de
liquidación calculado, fallos intermedios, replays después del cierre y ACL.
Carreras reales de dos conexiones deben observar bloqueo antes del commit; una
secuencia no se declara simultánea. RLS/tablas privadas/cero grants y triggers
inmutables. Sin pruebas que modifiquen `.next` ni datos remotos.

Auditoría esperada: todas las tablas previas idénticas, cero ventas/pagos nativos,
caja, folios, inventario o reservas nuevos. Sólo tablas propias en QA reciben
fixtures; pruebas remotas futuras se revierten enteras. No borrar ni truncar
historia para ocultar un ensayo. Controles propios false al cierre.

La siguiente integración externa requiere transporte servidor autenticado,
atestado de captura/reembolso/payout con referencias reales de proveedor,
ledger durable e idempotencia atomizada con la futura venta nativa web. Esta
base sintética no conecta automáticamente esos hechos ni decide pago real.

## Resultado local antes de entregar al coordinador

PostgreSQL QA `qa_m9_web_block2_20261022`, preparado por el coordinador con 197
migraciones y Auth/Storage stubs. Rol postgres no superusuario. Sin aceptación
Auth/PostgREST real. Se utilizó únicamente esta base del contenedor compartido;
no se cambiaron cron.database_name ni las demás bases.

Motor real ensayado: **13 invariantes, 50 rechazos, 3 replays** y tres esperas
concurrentes verificadas con backend PID distintos y `pg_blocking_pids`. Las
carreras comprueban recuperación al revertir el primer intento: misma operación,
mismo pedido con operaciones distintas y misma transacción monetaria en pedidos
distintos. Se observaron bloqueos de 16–22ms y el competidor recuperó el intento,
con replay posterior estable y duplicación monetaria rechazada. **Ambas
transacciones se revierten**; no se presenta esto como compra externa aprobada
ni como ensayo de ganador confirmado mediante COMMIT.

Se generaron dentro de ROLLBACK nueve hechos/14 apuntes/nueve recibos/una
instantánea. Autorización22620, capturas10000+12620, reembolso parcial1000,
comisión de proveedor700 (distinta de feeWoo500), reversión de comisión200 y
liquidación pendiente21120 dejan clearing0. Un reembolso posterior500 deja
clearing-500: obligación pendiente contra el proveedor, sin inventar banco ni
efectivo. Una recepción parcial de una pieza conserva su hecho separado y
rechaza sobre-recepción; no mueve inventario ni demuestra reembolso.

Un fallo provocado después del diario y antes del recibo revierte todo. Una
inserción financiera de mantenimiento sin apuntes falla al verificar las
restricciones diferidas. RLS de cinco tablas y denegación real de record/receipt/
SELECT para anon/authenticated/service_role comprobadas. Actor inexistente
rechazado; modo de proveedor autenticado, tipo parcial desconocido, códigos
numéricos, cantidades fraccionarias, datos de comprador y fechas ambiguas se
rechazan. Cierre de ventana no impide consultar el recibo ni repetirlo sin alta.

Al cierre, tablas propias de evidencia/diario/recibo/instantánea vacías;
controlfalse, actor y expiración NULL. **165 tablas previas conservan hashes y
conteos**, incluidas las ocho ventas QA canceladas preexistentes. No se abrió ni
modificó caja, venta, pago nativo, folio, stock o reserva. Los intentos iniciales
detectaron un acceso al campo NEW distinto entre triggers de evento/diario; se
corrigió sólo el SQL propuesto local, nunca una migración remota aplicada.
La revisión del coordinador detectó el riesgo de mismo cobro con eventref nuevo:
se añadió índice único monetario y bloqueo por transacción más siete rechazos
específicos. Es una corrección previa a despliegue, no evidencia borrada.

Un contenedor QA propio vacío se había creado antes de recibir la base asignada;
se detuvo sin cargarle migraciones ni fixtures y se conservó. No se instaló
software. El contenedor del coordinador queda con sus otros usos intactos.

Reproducción:

    QA_DATABASE_URL=<postgresql-local/qa_base> QA_OUTPUT_DIR=<expediente> node scripts/m9/verify-woo-web-settlement.mjs

El runner crea el SQL propuesto sólo si no existe el libro. Para iterar funciones
propias locales antes de integrar existe `QA_REFRESH_OWN_FUNCTIONS=1`, que exige
las cuatro tablas de hechos vacías y nunca admite URL remota, querystring,
fragmento, protocolo HTTP o base sin prefijo qa_. No usar esa opción en staging.
No se borra ni trunca ninguna fila. Artefactos privados:
`outputs/m9-libro-web-2026-10-22/rollback-results.json`, `native-before.json`,
`native-after.json` y `own-final.json`. La comparación es local; el coordinador
debe repetir ensayo/auditoría si decide aplicar una migración nueva a staging.
