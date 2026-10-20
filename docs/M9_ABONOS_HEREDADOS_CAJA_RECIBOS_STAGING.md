# Abonos heredados con caja y recibos · staging

20 octubre 2026. Autorizado: integrar y probar desde Preview, sin producción,
main, SICAR/Woo o dinero real. Continuación de
M9_APERTURA_SALDOS_HEREDADOS_STAGING.md. Se conserva la apertura de siete
documentos/seis cuentas por $11,910 y el padrón heredado, sin inventar contactos,
consentimientos, costos, existencias, pagos históricos o entregas.

## Plan de efecto y reversión

Motor privado transaccional asociado al UUID heredado y su sesión de caja.
Exige ADMIN/customers.manage/credit.collect, sesión abierta propia, sucursal
accesible igual a la de la apertura, importes positivos en centavos y saldo
suficiente. Sólo CASH, CARD y TRANSFER activos; sin crédito, puntos o dólares.
Efectivo recibido debe cubrir la parte aplicada; el cambio nunca suma a caja.
Tarjeta y transferencia requieren referencia; no se conecta ningún banco ni se
procesa un cobro externo. Deuda/asignaciones se aplican por vencimiento y clave.

Recibo inmutable de ensayo con cliente de origen, referencia heredada, métodos,
importe, recibido/cambio, saldo anterior/posterior y folios SICAR exactos. Folio
ENSAYO por sucursal con contador nativo; puede repetirse entre pruebas porque el
contador se revierte, la referencia UUID identifica cada ensayo. No emitirlo
como recibo válido de pago. Consulta restringida al autor ADMIN y su sucursal.

Se usa cash_movements CREDIT_PAYMENT para el efectivo aplicado, referencia
M9_LEGACY_PAYMENT_TRIAL; no se suma tarjeta/transferencia ni se crea venta. El
corte nativo lee ese mismo libro. No se modifica la rutina normal de caja ni sus
protecciones de conteo ciego, privacidad o crédito. El contexto UI no revela el
efectivo esperado antes del conteo.

La única API de aplicación ejecuta ensayo con rollback de subtransacción: llama
al motor, repite la misma solicitud, comprueba efectivo y revierte deuda,
asignaciones, caja, contador, recibo y audit_log transitorios. Sólo guarda la
evidencia en app.m9_legacy_cash_trials. Un recibo de esa evidencia puede abrirse
luego e imprimirse con la marca «ENSAYO REVERTIDO · NO VÁLIDO COMO PAGO».
No hay acción COLLECT, alta de socio o consentimiento ni endpoint de cobro real.

Tablas privadas app.m9_legacy_cash_receipts y app.m9_legacy_cash_trials: RLS sin
grants de datos, eventos inmutables. RPC público invoker y dispatcher privado
con autorización en cada acción. Motor privado no ejecutable por authenticated.
Reintento por UUID/hash/actor sin duplicar recibo, folio, deuda o caja; la lectura
del recibo no recalcula pagos ni modifica datos. Sin claves privilegiadas en UI.

## Implementación y pruebas de base

Migraciones 20261020223026, 20261020223057 y 20261020223250. Se corrigió un error
de sintaxis antes de aplicar la primera (transacción fallida, sin esquema/datos
parciales). El primer ensayo funcional detectó el catálogo FK de tipos de folio;
la segunda migración registra ese tipo sólo dentro de la transacción del ensayo.
La tercera fija los folios de origen dentro de la evidencia inmutable. No se
reescribieron migraciones aplicadas ni se conservó contador/tipo de folio QA.

24 negativos PASS: formato, importes, efectivo insuficiente, referencias,
métodos no permitidos/duplicados, sobrepago, nonce cambiado, sesión inexistente,
propiedad ajena, sesión cerrada, recibo inexistente, acción operativa denegada,
motor privado/anon e inmutabilidad. Positivos: efectivo/liquidación, tarjeta,
transferencia y combinado de $5,000 ($100 efectivo/$2,000 tarjeta/$2,900
transferencia), recibido $150/cambio $50, FIFO $4,700/$300.

El mismo ensayo ejercita preview_cash_close y close_cash_session nativos con
conteo expresamente sintético dentro de rollback: diferencia cero y rechazo de
abono tras cerrar. La sesión abierta queda restaurada; ningún conteo se presenta
como conteo físico realizado. Replay del motor y wrapper; receipt API igual al
recibo original. 137 tablas idénticas antes/después del ensayo completo.

Generador offline scripts/m9/prepare-legacy-cash-trial.mjs: plan SHA256 fijado,
actor/cuenta/sesión explícitos y modo synthetic_test_only; referencias ENSAYO.
Valida cuenta/importes contra el corte fijado y produce sólo SQL ROLLBACK, sin
opción COMMIT. Dos corridas idénticas y ejecución authenticated con replay PASS.
No equivale a sesión real del navegador; esa aceptación se registra por separado.
966 unitarias/115 archivos, TypeScript, ESLint, Prettier y diff-check PASS.

Rutas /clientes/heredados-sicar/caja y /caja/recibo dentro de heredados-sicar,
enlazadas desde saldos. Evidencia privada fuera de Git:
outputs/m9-abonos-heredados-caja-recibos-2026-10-20/.
Pendiente aceptar publicación/UI; los cobros operativos siguen deshabilitados.
