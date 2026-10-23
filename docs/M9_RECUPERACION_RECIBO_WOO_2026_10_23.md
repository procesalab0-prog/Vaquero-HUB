# M9 · Recuperar el recibo nativo sin reenviar una operación

Plan previo del 23 de octubre de 2026, desde `2366955`, rama
`codex/m9-woo-continuacion-20261023`. Root coordina y es el único escritor y
publicador remoto. No se usa navegador ni Woo real o de pruebas. La campaña
conectada sigue congelada en cinco ensayos y no se solicita otra sesión.

## Hueco concreto y alcance

El ciclo nativo sintético reserva→venta/pago/ticket→cancelación y las ocho
carreras POS/Woo ya tienen aceptación. Repetirlos sin un caso nuevo no aumenta
la conexión externa. El transporte de pasarela sigue sin autenticarse y no se
suplanta por un JSON que diga pagado.

El escritor existente `app.m9_woo_native_finance` exige ventana vigente y sesión
propia OPEN antes de consultar su recibo idempotente. Si se pierde la respuesta
y luego cierra la ventana/caja, el escritor falla aunque el efecto ya exista.
El libro web separado sí tiene consulta histórica; no corresponde al recibo de
esta venta nativa. No se habilita el escritor ni se reenvía para resolverlo.

Añadir sólo un lector privado SECURITY INVOKER sobre
`app.m9_woo_finance_receipts`, sin tabla, ledger, protocolo de pedido ni ruta
pública nuevos. Recibe exactamente el mismo paquete original POST/FULL_CANCEL.
Comprueba postgres, guardia de staging/QA, ADMIN activo y pos.sell antes de
parsear. Después exige dueño del recibo, paquete/hash exactos, asociación de
posting/venta y sucursal STORE activa con acceso del actor. La ventana y el
estado OPEN ya no son necesarios porque no ejecuta efectos. Una cancelación
puede pertenecer a un supervisor distinto del cajero original: el dueño es el
actor de su recibo, sin ampliar autorización del escritor.

Devuelve el recibo original inalterado dentro de una respuesta explícitamente
histórica y de sólo lectura, junto con el estado actual de la venta en la misma
instantánea. No devuelve comprador ni ticket completo, no refresca evidencia de
pago y nunca autoriza reposteo. Ausencia, operación en vuelo, dueño ajeno o hash
distinto devuelven indisponibilidad genérica: no significan que no hubo efecto.
No hay escaneo de recibos ni búsqueda por folio/nombre/importe.

## Ensayos y reversión

Primero, suite transaccional en el clon asignado
`qa_m9_woo_bloque7_20261023`, localhost:59432. Auditoría antes/después de todas
las tablas app/public y ROLLBACK completo de datos/DDL de la prueba. Reutilizar
los adaptadores y método M9_WEB_TEST/OTHER existentes; ninguna captura real,
CASH/CARD o coste inventado. Las semillas locales son explícitamente sintéticas
y no proceden de SICAR. Coste NULL se conserva.

Casos: POST, pérdida simulada de respuesta, cierre de ventana/caja, recuperación
sin reposteo; ticket/stock únicos; cancelación total con prueba física simulada
separada; recibos POST históricos después de cancelar; conflictos de hash,
actor, sucursal, forma, identidad o resultado; ausencia no concluyente; roles
anon/authenticated/service_role sin acceso; cero nuevos grants y escritor exacto.
La consulta no debe bloquear un POST todavía no confirmado ni presentar su
invisibilidad MVCC como ausencia definitiva.

Segundo, root autorizó un ciclo realmente COMMIT sólo en este clon con fixtures
propias. Dos conexiones permiten descartar el ACK del POST tras COMMIT, cerrar
la sesión/ventana y recuperar desde otra conexión. Cancelación compensatoria,
retiro de semillas por movimientos nativos aditivos y desactivación propia; se
conservan recibos/venta cancelada/historia. Este ciclo no se llama rollback global:
se auditan filas previas, deltas esperados de seis libros y saldo final cero.
Sin borrar, truncar, reiniciar secuencias ni esconder aperturas auxiliares de QA
por importe cero. No representan caja o pasarela del canal web operativo.

La concurrencia nueva verifica visibilidad del recibo antes/después de COMMIT y
reversión, sin cambiar locks ni repetir como nuevos los ocho escenarios anteriores.
Root revisará y decidirá una migración nueva sólo después de QA y auditoría.
Ninguna función/migración aplicada se reescribe. No se toca main ni producción.

## Estado de partida comprobado por SELECT

Staging `zsezjtswqeijboezvado`, 23 octubre 14:40 UTC: cinco connected_trials;
worker/captura/piloto stock/finanzas nativas/libro web false y sonda false.
Postings/recibos nativos, hechos/recibos del libro web y ambos outbox en cero.
Esta lectura no autentica una pasarela ni renueva el CSV completo del 19.
Evidencia privada nueva: `outputs/m9-continuacion-integral-2026-10-23/woo/`.

## Preparación y verificación disponible

Lector: `scripts/m9/woo-native-finance-receipt-read.sql`.
Runner: `scripts/m9/verify-woo-native-finance-recovery.mjs`, restringido a la URL
local exacta del clon asignado, sin parámetros de red o base alternativos. La
carpeta de salida debe existir y estar vacía; archivos se publican con `wx` y
modo600. El runner preserva su solicitud antes del COMMIT local y separa
`rollback-results.json` de `durable-results.json` y auditorías completas.

ESLint, sintaxis Node y diff-check aprobados. Regresión independiente de los
contratos existentes de pago/pedido: 151 pruebas correctas. Eso no prueba el SQL
nuevo. La lectura de metadatos del clon sí se completó: 168 tablas y métodos
anteriores disponibles, sin tocar datos.

Dos solicitudes de ejecución del runner no llegaron a crear proceso: la revisión
automática de permisos agotó su plazo. El reintento permitido también expiró;
no hubo un dictamen de acción insegura. Esa limitación inicial se conserva como
historia: root ejecutó la primera fixture y luego fue posible ejecutar `qa-2` y
`qa-3` desde este agente. Los resultados efectivos se registran abajo. La
aplicación remota sigue a cargo exclusivo del coordinador. No se reduce ninguna aserción para
conseguir un PASS ni se usan cantidades del piloto como fixtures.

Límite adicional conservado: el cancelador nativo exige OPEN en la sesión
original (`SALE_SESSION_CLOSED`). No se modifica. En la suite ROLLBACK el cierre
sintético se revierte antes de compensar. En el ciclo local duradero primero se
recupera POST tras cerrar la ventana; luego se compensa antes de cerrar la caja
y se recuperan ambos recibos históricos con la caja cerrada. No se reabre una
sesión cerrada ni se afirma resolver la operación web 24/7 mediante este lector.

### Corrección de la fixture tras ejecución del coordinador

Root consiguió ejecutar el runner en `qa-1`. Falló antes de los casos de prueba
porque el código de caja sintético incluía minúsculas. Se inspeccionó el
constraint real: exige `code = upper(btrim(code))` y valor no vacío; no limita a
doce caracteres. Se corrige sólo el código de fixture a `QAWR` + sufijo UUID en
mayúsculas, único dentro de su ubicación propia. No se cambia el constraint.
Consulta posterior del clon: las **168 tablas son idénticas** al baseline de
`qa-1` y el lector propuesto no quedó instalado; ROLLBACK confirmado. El error
original y la comprobación se preservan en `qa-1`. SQL del lector sin cambios.


### Resultado efectivo del clon asignado

`qa-2` identificó otra incoherencia de fixture antes de producir pagos: el
constructor vigente exige que `categories.name = m9_variant_details.section`.
Se leyó y conservó su definición/hash; se alineó sólo esa metadata sintética,
reutilizando el patrón del runner de carrera aceptado. No se cambió el constructor,
el writer ni una guarda. ROLLBACK de las 168 tablas confirmado y lector ausente.
Los fallos de `qa-1` y `qa-2` permanecen en sus expedientes; secuencias técnicas
pueden avanzar incluso al revertir, no se reinician.

`qa-3` completó ambas fases sobre el mismo clon:

- 7 invariantes y 29 rechazos reales SQL, incluyendo forma/identidad/hash,
  dueño ajeno, actor inactivo/no existente, permiso ausente, sucursal inactiva o
  no STORE, resultado alterado y ejecución denegada a tres roles clientes.
  El lector invoker/STABLE no recibe ningún grant público. Consulta repetida
  deja las 168 tablas idénticas a su snapshot; writer íntegro. La fase principal
  revierte todas las tablas exactamente al baseline.
- Regresión nativa POS→cancelación, reserva Woo→POST/ticket→FULL_CANCEL. CostoNULL,
  única deducción/reposición nativa y cero movimientos de caja no cero. Cierre
  de ventana y de sesión no impide recuperar el recibo exacto, y el POST histórico
  se distingue del estado actual CANCELLED después de su reversa.
- Ciclo realmente confirmado en otra fase: una conexión dejó el POST abierto;
  otra recibió indisponibilidad genérica antes de COMMIT sin esperar que éste
  ocurriera. Se descartó deliberadamente la respuesta de aplicación del POST,
  se confirmó la transacción, se cerró la ventana y se recuperó el recibo desde
  otra conexión. Esto simula un ACK perdido: no certifica un corte de red real.
- FULL_CANCEL sintético con recepción física explícitamente QA fue confirmado;
  se cerró la caja y ventana, y ambos recibos se leyeron sin repostear. Permanecen
  dos ventas propias CANCELLED (POS y Woo), dos pagos históricos de métodoOTHER y
  dos recibos financieros. Se retiraron las semillas por ajustes nativos,
  stock/reservas finales0 y sin inventar costos o efectivo.

En el ciclo COMMIT, todas las filas previas de las168tablas quedaron intactas;
los incrementos propios están limitados a tablas declaradas de fixtures y motores
existentes. El reporte conserva deltas de los seis libros de inventario/venta/
pagos/caja; no afirma que esos libros sean idénticos tras conservar historia.
No hubo nuevas filas de campaña conectada, worker, libro web, captura o disponibilidad.
Controles usados false al cierre, caja propia cerrada, productos/variantes/registro
propios inactivos. La ubicación QA se conserva activa para que el recibo histórico
continúe consultable bajo la misma guarda de sucursal; no tiene caja abierta ni
productos activos. No se añade otra sucursal real.

La definición del escritor se comparó byteexacta antes/después. El nuevo lector
queda instalado sólo en este clon local; no hay DDL/DML remoto. No repetir este
runner sobre el clon sin revisar las fixtures/historia ya conservadas. Auth y
Storage siguen siendo stubs locales, y no hay compra pública, gateway autenticado,
correo, publicación de stock ni sexta orden Woo conectada.

Expediente `outputs/m9-continuacion-integral-2026-10-23/woo/qa-3/`:
`rollback-results.json`, `durable-results.json`, `native-before.json`,
`native-after.json`, `durable-request.json`. La lectura staging previa se conserva
aparte en `staging-gates-before.json`. Root debe revisar y ensayar cualquier
forward en staging antes de decidir publicarlo; no se certifica ese paso aquí.
