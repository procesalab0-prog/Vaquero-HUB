# M9 · Pagos Woo: revisión independiente y contrato de elegibilidad

22 de octubre de 2026. Frente paralelo desde `07b2aa4`, aislado en
`codex/m9-paralelo-woo-20261022`. No despliegue, migración SQL, escritura remota,
pedido Woo nuevo, pasarela, cron, correo ni modificación de producción.

## Resultado y límite

Se implementó el contrato puro de revisión documental del siguiente ensayo
conectado, su reporte por lote y 123 pruebas nuevas. La suite local completa
aprobó **1,314 pruebas / 128 archivos**; también lint de los archivos nuevos.
El lector financiero anterior continúa intacto y sus pruebas siguen aprobando.

**Ningún resultado de este módulo autoriza contabilizar.** Incluso un candidato
sin diferencias devuelve `source_documents_authenticated:false`,
`authenticated_provider_adapter_installed:false`, `can_record_sale:false`,
`can_issue_sale_ticket:false`, `stock_write_allowed:false`, `database_command:null`
y `synthetic_sql_evidence_allowed:false`.

Un documento que diga `CAPTURED`, un hash y una marca sandbox pueden ser
fabricados por quien entrega el JSON. El módulo comprueba consistencia, no la
identidad criptográfica del proveedor. El transporte autenticado aún debe
instalarse y aceptarse por separado. No se trata un resultado técnico como un
pago liquidado ni como una venta operativa autorizada.

## Revisión adversarial del servicio actual

Se revisaron el plan financiero, el plan atómico y la carrera POS/Woo; el lector
`woo-remote/finance-read.mjs`, protocolo técnico, servicio
`app.m9_woo_native_finance`, ensayos SQL y aceptación local de concurrencia.
Se contrastaron reglas de fuentes, Clave 1 y cierres vigentes en handoff/plan.
No se encontró un bypass crítico confirmado dentro del alcance sintético.
Esto no certifica el resto de las RPC ni las pasarelas externas.

La consulta SELECT independiente de staging comprobó:

- `m9_woo_native_finance`, `m9_woo_assert_finance_sale` y
  `m9_woo_block_retail_return` son invoker, con `search_path` vacío y sin EXECUTE
  para anon, authenticated o service_role.
- Las cinco tablas financieras privadas tienen RLS y no conceden lectura ni
  escritura directa a esos tres roles.
- Controles financiero y piloto de stock deshabilitados, expiraciones NULL.
- SHA256 de la definición financiera:
  `db8309b1b0fef90b449d5474c1137f1a0341630bc946e7c2d2f31fc883e92971`.

La consulta reproducible está en `scripts/m9/woo-payment-review-readonly.sql`.
Sólo devuelve definición/permisos/compuertas; no trae clientes, referencias,
importes de caja ni datos de compradores. El conector devuelve sólo el último
resultset si se envían los tres SELECT juntos; para obtenerlos todos hay que
ejecutar cada SELECT por separado. No se ejecutó DDL/DML ni ensayo SQL remoto.

Las siguientes barreras son deliberadas y no deben quitarse para conectar Woo:

| Barrera actual                                                 | Consecuencia para la integración                                                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidencia `SYNTHETIC_TEST_ONLY` y referencia `SYNTHETIC-*`     | Nunca cambiar la etiqueta de un pago externo para insertarlo aquí. Hace falta otro contrato y autorización del servidor.                                        |
| Método transitorio `M9_WEB_TEST/OTHER`                         | No representa liquidación de pasarela ni efectivo. Prohibido sustituirlo por CASH/CARD/TRANSFER para simular cobro.                                             |
| Sesión de caja propia y abierta                                | Es válida para el ensayo supervisado; el canal Woo 24/7 necesita un diseño contable explícito que no dependa de una caja de mostrador abierta.                  |
| Reintento exige sesión y ventana habilitadas                   | Si ya vencieron se retiene la operación aunque exista recibo. No duplica, pero la recuperación operativa debe consultar el recibo sin forzar una segunda venta. |
| Sólo precio público íntegro, sin componentes no cero           | Envío, impuestos, cupones, comisiones y descuentos deben conservarse y quedar retenidos hasta ampliar el motor con pruebas de conservación.                     |
| Cancelación total exige reembolso y todas las piezas recibidas | No sirve para devolución parcial, mercancía en tránsito ni reembolso sin recepción. No inventar recepción ni encadenar RESTOCK.                                 |
| Hash de evidencia es un dato aportado por mantenimiento        | No demuestra procedencia bancaria. La verificación del proveedor debe hacerse fuera del navegador y guardar su procedencia inmutable.                           |
| Referencia sintética globalmente única                         | En el contrato externo la identidad incluye proveedor, cuenta, comercio, origen, pedido y moneda; no basta la referencia aislada.                               |

La deducción atómica existente continúa usando venta nativa única; no se añade
`CONSUME`. Su cancelación continúa usando cancelación nativa única; no se añade
`RESTOCK`. Se conservan costos NULL y la Clave 1 literal.

## Contrato puro implementado

Archivo `scripts/m9/woo-payment-eligibility.mjs`:

    reviewWooPaymentCandidate({
      first, second, evidence, reservation, policy, ledger,
      physical_receipt, now
    })

Todas las formas tienen claves exactas. El ejemplo íntegro está en
`scripts/m9/woo-payment-fixtures.mjs`: es ficticio, sin proveedor instalado,
pedido real, comprador, costo o credencial. **No usar esa fixture como prueba de
pago ni enviarla a una RPC.** No hay adaptador SQL en este módulo.

`first/second` son dos lecturas de un mismo pedido test fijo, con protocolo,
origen, ID, moneda, modificación/observación UTC, estado, indicios de pago,
componentes, líneas y desglose de envío/comisiones/cupones/reembolsos. Deben ser
iguales salvo la hora de observación. No se aceptan campos de comprador.

Cada línea conserva `line_id/product_id/variation_id/variant_id/barcode/quantity`;
barcodes numéricos, espacios, controles y coerciones se rechazan. No se normalizan
ceros iniciales, acentos o mayúsculas. Variantes duplicadas, IDs Woo duplicados,
fracciones, cantidades no finitas y cambios de identidad se retienen. La reserva
debe tener exactamente las mismas líneas y su precio público vigente.

`policy` restringe proyecto/origen de pruebas y proveedor/cuenta/comercio/método
explícitos. Sólo SANDBOX y `live_mode:false`; efectivo, CARD, TRANSFER, COD,
transferencia bancaria manual y métodos de ensayo sin pago no son pasarelas.
Estas etiquetas verifican forma/configuración, no autentican un servidor externo.

`evidence` enlaza el ID y hash completo del pedido, moneda, importe capturado o
reembolsado, referencia, referencia original, estado y fecha del proveedor y
huella de la respuesta fuente. AUTHORIZED no equivale a CAPTURED. Los indicios
Woo deben ser consistentes, pero por sí solos nunca son evidencia. Lecturas de
pedido/proveedor deben ser recientes (5 minutos, tolerancia futura 5 segundos)
y ordenadas. Las fechas deben ser ISO UTC canónico con milisegundos y calendario
válido. El reloj explícito hace reproducible el reporte; **el futuro servicio
deberá usar su reloj servidor, no el `now` enviado por un cliente**.

Los importes entran como decimales canónicos de dos lugares, reutilizando
`decimalCents` del lector actual. Se operan en centavos enteros y se detectan
desbordes. Se concilian subtotal de artículos, descuentos/cupones, impuestos por
línea, impuestos de comisión, impuestos de envío, envío, comisiones, total y
reembolso. Los impuestos no se suman dos veces. La comisión Woo es un concepto
del pedido; **no equivale a comisión de la pasarela ni a liquidación bancaria**.

Los componentes comerciales no cero se verifican y **se conservan en el reporte**,
con un HOLD por cada componente que el servicio nativo aún no admite. Los
desgloses ausentes, negativos no soportados o diferencias aritméticas se retienen;
no se descuentan ni se convierten en precio artificial del producto.

`ledger` requiere un índice completo de referencias y operaciones ya resueltas.
Detecta referencia reutilizada para otro pedido/comercio/importe/hash, doble
captura y doble reembolso. El replay sólo remite a la huella del resultado
anterior y sigue sin producir escritura. La versión operativa deberá mantener
estas unicidades atómicamente en base; un array local no evita una carrera.

Para FULL_CANCEL se exige pago original coincidente, reembolso total confirmado
en los documentos y un comprobante independiente de recepción de todas las
líneas. El ejemplo de recepción es SANDBOX_TEST_ONLY. Aun cumpliéndolo devuelve
HOLD: el servicio externo de reembolsos y su conciliación no están instalados.
No se repone inventario basándose sólo en dinero reembolsado.

## Reporte reproducible por lote

`scripts/m9/woo-payment-report.mjs` recibe hasta 500 casos explícitos y produce
JSON, HTML, manifest SHA256 y verificador en una carpeta nueva privada. No
sobrescribe expedientes, no copia los documentos originales ni contactos al
reporte, rechaza UTF-8 inválido y conserva su huella. Un lote con referencias
repetidas o dos capturas del mismo pedido retiene **todos** los casos afectados,
aunque sus índices locales individuales dijeran estar vacíos.

    node scripts/m9/woo-payment-report.mjs --input <lote-local.json> --output <carpeta-nueva>
    node <carpeta-nueva>/verificar.mjs

La raíz del lote es `{protocol:'m9-woo-payment-review-batch-1',
operational_import_allowed:false,cases:[{key,input}]}`. La entrada puede
conservarse en un expediente privado, nunca en el repositorio si contiene fuentes.

Expediente de este bloque:
`outputs/m9-woo-pagos-paralelo-2026-10-22/`. Dos corridas de seis casos ficticios
producen JSON idéntico: un candidato documental y cinco retenidos (falta de
proveedor, componentes comerciales, referencia doble y vigencia). Cero ventas
autorizadas y cero conexiones de red desde el preparador. Los permisos de
staging quedan documentados separadamente por SELECT. No es lectura nueva de
pedidos 53/54 ni sexta orden del piloto.

## Orden exacto pendiente para el siguiente ensayo conectado

1. Elegir/verificar el proveedor instalado **sandbox** y sus identificadores de
   comercio/cuenta. Documentar sus estados de autorización/captura/reembolso y
   autenticación de consulta con documentación primaria. No inventar proveedor
   ni pedir claves a los dueños para un diseño que aún no está aceptado.
2. Preparar transporte servidor de sólo lectura: dos consultas Woo autenticadas,
   consulta autenticada a la pasarela, timeout/reintento acotados, TLS/orígenes
   fijos, protección de credenciales y de datos de comprador. Rechazar JSON
   ambiguo/duplicado antes de convertir a este contrato. Webhook es aviso; no
   decide importe, destino, método ni pago por sí mismo.
3. Persistir evidencia verificada inmutable y ledger de referencia separado de
   SYNTHETIC_TEST_ONLY; unicidades por proveedor/cuenta y enlace completo a
   comercio/origen/pedido/moneda. Comparar lectura fresca y versión bajo los
   bloqueos transaccionales del servicio. Nada externo se inserta directamente
   en la tabla sintética ni habilita una compuerta por su cuenta.
4. Definir el libro de liquidación web y su relación con caja/cierre sin fingir
   efectivo ni depender de la sesión de un cajero. Resolver dónde se conservan
   comisiones de pasarela/liquidación neta, que no son las fees del pedido.
5. Ampliar por migración nueva, plan y ensayo local con rollback: totales
   comerciales no cero, cortes de red, pago confirmado sin venta local,
   referencia duplicada, pedido cambiado entre lectura y commit, eventos fuera
   de orden y reintentos después de cerrar sesión/ventana. Probar concurrencia
   otra vez si se altera el orden de bloqueos.
6. Diseñar reembolso parcial y recepción física como hechos independientes con
   compensaciones auditables. Mientras no esté listo, retenerlos; no ejecutar
   cancelación total ni RESTOCK para simular una parcialidad.
7. Sólo con esas compuertas aprobadas: actualizar conector test bajo coordinación,
   autorizar un nuevo cupo de ensayo explícito sin resetear el límite de cinco,
   crear una compra sandbox supervisada y verificar Woo→venta/pago/ticket/stock
   y replay desde Preview. Conciliar antes/después y cerrar las compuertas.

Este frente no modifica main/Preview, las 165 tablas de staging, pedidos remotos,
el porcentaje de catálogo96.92%, ni confirma operatividad de pasarela. La entrega
del chat coordinador decide la integración de archivos y el siguiente alcance.
