# M9 · Evidencia sandbox firmada y cuarentena inerte

Plan previo, 22 de octubre de 2026, desde `a7c26e2`. Sin rutas HTTP públicas,
proveedor configurado, claves, órdenes, cron, conector, DDL/DML remoto, ventas,
caja o inventario. No se modifica el libro ya aplicado ni se presenta evidencia
local como captura operativa.

## Proveedor: qué se pudo acreditar

La evidencia local disponible **no acredita un gateway sandbox activo**:

- `scripts/m9/woo-remote/m9-test-isolation.php` versión1.6.0 devuelve lista vacía
  de gateways y bloquea red saliente, compra y correo en el origen test fijo.
- El preflight archivado de `m9-cola-fotos-variantes-2026-10-07` registra
  payment_gateways0. Es histórico; no se transforma en comprobación actual.
- `m9-pedido-finanzas-2026-10-21/woo-finance-live.json` conserva método
  m9_synthetic_no_payment, referencia vacía, is_paidfalse y fecha observada que
  no acredita cobro. Su plan conserva pagadoNULL y venta/stockfalse.
- El cierre Preview0.89.0 mantiene libro web vacío y controles apagados; proveedor
  autenticado sigue pendiente. No se inspeccionaron secretos ni `.env`.

No se elige Stripe/PayPal/MercadoPago por intuición ni por un plugin instalado.
No se implementa un supuesto protocolo oficial de un proveedor no acreditado.
El receptor de proveedor queda **deshabilitado, sin registro de proveedores
admitidos**. Cualquier solicitud real o sandbox que pretenda ser de uno se
rechaza antes de proponer un evento contable.

## Implementación autorizada

Crear un módulo puro de verificación Ed25519 **exclusivo de firmas locales QA**.
Las claves de prueba se generan efímeramente en memoria; nunca se guardan claves
privadas ni credenciales reales. Una firma local válida demuestra únicamente
que sus bytes corresponden al firmante QA fijado; no autentica una pasarela.
La API acepta una clave pública QA fijada fuera del payload, no una clave
declarada por el propio mensaje. No se admiten URL de claves ni descarga remota.

Firmar los bytes originales, con contexto, destino y metadatos dentro del cuerpo.
Verificar antes de parsear/normalizar; rechazar algoritmo distinto, firma
malformada, UTF-8 inválido, claves JSON duplicadas o cuerpo no canónico, tamaño,
fecha/nonce, origen/proyecto, sandbox/live, cuentas e identidades inconsistentes.
Ningún encabezado no firmado decide proveedor, ruta, moneda o importe.

Normalizar AUTHORIZATION/CAPTURE/REFUND/PROVIDER_FEE/FEE_REVERSAL/SETTLEMENT como
hechos distintos. La fee comercial Woo permanece separada de la comisión del
proveedor y el neto de liquidación declarado no significa banco conciliado.
Identificador monetario exacto por tipo/proveedor/cuenta, distinto del ID del
webhook. Un webhook nuevo no crea un pago nuevo.

Todos los mensajes aceptados criptográficamente quedan en **cuarentena local**,
sin generar SQL ni llamar al libro. Conservar recibo inmutable, hashes, tipo,
motivos, actor QA y comprobación de replay. El almacén local usará publicación
atómica sin sobrescritura y serialización entre procesos; si cae un proceso y
queda una barrera de escritura, falla cerrado sin borrar la barrera por tiempo.
La recuperación requiere revisar el almacén, nunca descartar historia.

QA adversarial: firma/cuerpo/algoritmo/clave alterados, live, faltantes, fechas,
replay, referencia monetaria reutilizada entre pedidos, fee confundida con pago,
eventos sin captura causal y concurrencia de dos procesos. Ningún resultado
devuelve authenticated_providertrue, sale/stocktrue ni un comando SQL.

Referencia de la primitiva criptográfica: documentación primaria de
[Node.js crypto.verify](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback).
No se pretende implementar la firma comercial de un gateway no identificado.

## Resultado y reproducción del puente inerte

Implementación: `scripts/m9/woo-sandbox-auth-quarantine.mjs`. El verificador del
expediente es `scripts/m9/verify-woo-sandbox-quarantine.mjs`. No leen `.env`,
sesiones, secretos ni configuración de pasarela. Tampoco importan Supabase ni
instalan rutas HTTP. `receiveSandboxProviderEvidence()` siempre rechaza; no tiene
un argumento de activación ni un perfil aportado por el solicitante.

56 pruebas nuevas aprobaron; suite completa **1,527 / 136 archivos**, lint y
formato de los archivos nuevos aprobados. Se verifican firmas Ed25519 reales
con claves efímeras locales y se rechazan firma/bytes/clave/algoritmo alterados,
claves autodeclaradas en el cuerpo, live, fechas, importes, referencias, claves
JSON repetidas y datos de comprador. Los mensajes sólo pueden usar nombres de
cuenta/comercio/referencia explícitamente SYNTHETIC.

Dos procesos Node distintos se detienen ante la misma barrera de escritura QA;
al liberarla ambos terminan y se conserva un solo recibo con el mismo ID, un
replay y esperas observadas en ambos. Esto comprueba serialización del almacén
local: **no es una carrera de cobros reales, PostgreSQL o Auth/PostgREST**. Si
existe una barrera abandonada, no se elimina por tiempo: la siguiente escritura
falla cerrada y exige revisión local.

El expediente conserva siete recibos: autorización, captura, reembolso,
comisión del proveedor, neto declarado, duplicación monetaria en otro pedido y
un reembolso cuyo padre no aparece. Las dos últimas incidencias se retienen;
la duplicación queda `QUARANTINED_CONFLICT`. Un replay exacto no genera octavo
recibo. Fee Woo500, comisión del proveedor700 y neto declarado17300 permanecen
separados, en centavos MXN; no hay banco conciliado.

Los recibos conservan los bytes firmados, la firma y la clave **pública**, con
huella del recibo. La API publica archivos de forma atómica sin sobrescribirlos.
No se guardó ninguna clave privada. Esta inmutabilidad pertenece a la API del
almacén local; no promete resistir que el propietario del disco reescriba el
directorio. La verificación histórica comprueba firma/hash sin renovar vigencia
ni acreditar una pasarela: `current_evidence_validity_rechecked:false`.

Todas las salidas conservan `provider_authenticated:false`,
`provider_receiver_enabled:false`, `can_record_book_event:false`,
`can_record_sale:false`, `stock_write_allowed:false`, `database_command:null` y
`book_event_proposal:null`. No existe conversión al protocolo SQL del libro.

    node scripts/m9/verify-woo-sandbox-quarantine.mjs --output <carpeta-nueva-privada>
    node scripts/m9/verify-woo-sandbox-quarantine.mjs --verify <carpeta-existente>

Cada creación usa una clave QA efímera nueva; se reproducen la comprobación y
sus reglas a partir del expediente firmado conservado, sin requerir que dos
creaciones produzcan las mismas firmas. El manifiesto cubre `proof.json` y los
siete recibos firmados; el log de unitarias se conserva por separado.

Evidencia privada de esta entrega:
`outputs/m9-puente-sandbox-cuarentena-2026-10-22/`. Verificador offline PASS.
No se usó base de datos, Docker, navegador ni servicio remoto. Libro web vacío y
controles remotos no se consultaron ni modificaron en este bloque.

## Integración externa todavía pendiente

1. Acreditar qué proveedor usa la tienda test, su cuenta/comercio sandbox y su
   protocolo oficial de firma/consulta. La presencia de un plugin no basta.
2. Implementar un verificador oficial independiente: claves fijadas y obtenidas
   mediante canal autorizado, lectura autenticada, rotación/revocación y
   referencias de acciones monetarias concretas. Nunca aceptar claves o URL de
   claves provenientes del propio webhook.
3. Crear una cuarentena privada de servidor revisada, con origen y autenticidad
   verificables, sin volver operativos los recibos LOCAL_QA. Volver a conciliar
   pedido Woo/variantes/componentes con el contrato de revisión anterior.
4. Someter la promoción de hechos al libro a revisión y autorización propias;
   conservar idempotencia monetaria, causales y ventana de mantenimiento. Seguir
   sin crear venta/stock sólo por estado, fecha, referencia o JSON firmado QA.
5. Ensayar el ciclo sandbox completo únicamente después de resolver esas
   compuertas y autorizar otro cupo explícito. Este bloque no resetea el límite
   de cinco ni instala una pasarela para conseguir un resultado positivo.
