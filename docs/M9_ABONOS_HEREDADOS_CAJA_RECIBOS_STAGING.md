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

La primera publicación falló por un selector global de impresión dentro de CSS
Modules. Se consultó el log concreto desde el dashboard Vercel y se limitó el
selector a body:has(.receipt). Ambos CSS nuevos pasan el parser pure de Next.
Build local webpack limitado por descarga DNS de Google Fonts; Turbopack no
admite el node_modules enlazado de este checkout. Son límites locales distintos
del error CSS corregido; se exige build remoto READY antes de aceptar UI.

## Aceptación de Preview con sesión real

Corrección publicada en commit a749c48af7dfd9ebc6128f206964724c3db60121,
deployment dpl_AupvUvwD9HKTdxn2qwJdsv1rBX1z READY, target null. Enlace probado
saldos→caja→recibo y regreso a saldos. Sesión real de Emmanuel ADMIN, misma
caja abierta de La Piedad. Sin extracción de credenciales/JWT ni claves de servicio.

Cuatro ensayos UI, todos revertidos: combinado $5,000 con $100 efectivo,
recibido $150/cambio $50, $2,000 tarjeta y $2,900 transferencia; tarjeta sola
$10 con efectivo cero; transferencia sola $0.01 con efectivo cero; liquidación
de $240 de cuenta sin teléfono, recibido $300/cambio $60, saldo simulado cero
y conservado $240. Recibos con folios SICAR, marca ENSAYO REVERTIDO, referencia
UUID única y consulta persistente de evidencia. Formulario rechaza referencia
faltante y sobrepago $600.01 contra $600. Folio temporal puede repetirse por
rollback, explicado al operador. No se imprimió físicamente en una impresora;
se verificaron pantalla y estilos print, sin declarar aceptación de hardware.

Auditoría de 137 tablas antes/después de UI: cambia únicamente
app.m9_legacy_cash_trials con cuatro evidencias. Cero recibos del motor, pagos,
asignaciones, cash_movements o folios/tipos de folio QA persistentes. Apertura
sigue $11,910, libro nativo cero y clientes nativos uno. La sesión sigue OPEN.
Todos los clientes fuente, caja, inventario y demás tablas anteriores intactos.
No se inventó un pago real ni se ejecutó una entrega.

Vista 390×844: formulario y recibo sin overflow (scrollWidth=clientWidth=390),
botón final 44px de alto, bottom664 con viewport844, visible encima del menú.
Viewport restaurado; capturas privadas de escritorio y teléfono. Replay del
núcleo y API comprobado por SQL; no se afirma repetición HTTP idéntica desde UI.
Advisors: 81 INFO de RLS sin policy (dos nuevas tablas deliberadamente privadas),
131 WARN definer y una WARN Auth anteriores sin incremento. Log de build fallido
consultado vía dashboard; no se afirma revisión completa de runtime logs.

El bloque de integración y ensayo queda aceptado en Preview. No hay acción de
cobro operativo habilitada. Para habilitarla se requiere plan de arranque,
renovación/conciliación del corte, aceptación de recibo/caja y reglas de reversión
de dinero realmente recibido; no convertir evidencias TRIAL en pagos. Continúa
padrón completo, entregas y conteos físicos acreditados, sin producción.
