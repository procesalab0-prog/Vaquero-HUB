# M9 · Paquete inerte para el siguiente ensayo nativo Woo

Plan del 23 de octubre desde `7e615df`, Preview `ea17357`. Sólo el checkout propio
`m9-paralelo-woo`; root integra y es el único escritor/publicador remoto. El usuario
aclaró que la renovación es de la tienda real vaquerosm.com y ya inició sesión en
WordPress. Root observa el panel; el exportador nativo sigue en blanco tras abrir
y recargar y todavía no hay CSV nuevo. La revisión automática rechazó guardar
una captura con credenciales y se respetó. Este frente no pide accesos, no usa
navegador, red, SQL ni Docker. El daemon
local no responde; no se intenta iniciarlo. No cambia main, guardias, funciones,
permisos o compuertas existentes. La campaña conectada permanece en cinco casos.

## Avance útil y autorización acotada

La cadena nativa sintética y las carreras ya quedaron comprobadas localmente:
POST, cancelación con sesión original CLOSED y recuperación idempotente. En
staging sólo se instaló el forward y se probaron rechazos, con 179 tablas intactas;
no hubo una operación financiera positiva remota. Repetir esa evidencia como otra
compra no aumenta la conexión externa.

El siguiente artefacto útil es un paquete determinista revisable que permita
ensayar esa misma cadena, en una transacción reversible y con datos técnicos
nuevos claramente sintéticos. Root autorizó **prepararlo**, sin ejecutarlo:

> «Apruebo preparar paquete SQL INERTE determinista… no ejecutar ni ampliar
> guardias… Root ni agente ejecutarán positivo en este bloque sin plan/QA local
> disponible».

Archivos nuevos y exclusivos: `scripts/m9/prepare-woo-integral-rehearsal.mjs`,
`tests/unit/m9-woo-integral-rehearsal.test.mjs` y este documento. No otro motor,
ledger, importador, protocolo de pedido, ruta pública o constructor instalado.

## Entrada, pins y límites

El preparador sólo lee archivos locales expresamente fijados por SHA256. Usa la
misma auditoría app/public, controles, cinco gates explícitos, cinco definiciones
existentes y cuerpo/definición/owner/ACL del helper instalado. Nueve servicios de
apoyo reciben pins propios: kernel de reserva, constructores de evidencia/paquete,
proyección M9, movimiento nativo, apertura/cierre de caja, create_sale y su engine.
No inventa un hash si falta esa captura.

SICAR completo conservado: 22octubre, SHA `b1e6e670…88de93`; Woo autenticado completo
conservado: 19octubre, CSV SHA `8d212b77…1dd26`. Se rehashan sus bytes; el módulo no
modifica, interpreta o publica las exportaciones. La conservación de esos bytes
**no renueva el corte ni acredita su vigencia actual**. Una fuente nueva requiere
revisión de sus pins; no entra silenciosamente en este paquete.

Config privado con forma exacta: `protocol`, `mode=PREPARE_ONLY_NO_EXECUTION`,
`project_id`, `origin`, `actor_id`, `namespace`, `as_of` e `inputs`. Cada input es
`{path,sha256}`: `audit`, `controls`, `gates`, `definitions`, `helper`, `support`,
`sicar`, `woo`. Rutas locales absolutas, no variables de credenciales, URLs o
conexiones. No se imprime el contenido de las fuentes o contactos. Un error del
conector, JSON/UTF8 inválido, fechas imposibles, campos adicionales, faltantes,
nulls o discrepancias impide preparar el paquete.

Actor es un UUID existente, nunca una cuenta inventada. El SQL futuro comprobará
ADMIN activo, permisos y que no tenga otra sesión OPEN; no tomará una caja real
para acomodar el ensayo. IDs y códigos de fixtures se derivan determinísticamente
del namespace SYNTHETIC y de la huella de fuente/baseline. Hay detección de
colisiones antes de insertar. UUIDs de ventas, recibos y evidencias siguen siendo
emitidos por sus motores nativos; no se reservan ni simulan sus resultados.

## Qué contiene el SQL preparado, no ejecutado

El encabezado declara falta de autorización/aceptación y ausencia de una compra
externa. Después, BEGIN obligatorio, guard de staging, proyecto fijo, rol de
mantenimiento real, actor/permisos, snapshot de hasta 15minutos, preimágenes,
cinco campañas y controles inicialmente false. Barreras NOWAIT antes del baseline
completo de 179 tablas retienen cualquier actividad concurrente o deriva. Este
ensayo requiere un intervalo tranquilo en el staging compartido; no se bloquea
esperando que otro trabajo termine ni se fuerza una excepción.

La revisión independiente detectó que ALTER OWNER o GRANT EXECUTE no cambia el
hash de pg_get_functiondef. El paquete final vuelve a comprobar en ejecución
owner postgres, invoker, volatilidad, search_path exacto y los tres permisos
efectivos de clientes en false, antes de cualquier fixture. Ese ajuste no concede
permisos ni cambia el helper instalado.

La transacción usaría tres controles temporalmente para una sucursal y una sesión
propias: rehearsal, stock pilot y native finance. Worker, captura de disponibilidad
y libro de liquidación no se activan. Esto es una propuesta de alcance transitorio
que necesita su propia aprobación; no se afirma que los controles no se tocarían.

1. Dos variantes técnicas con costo NULL, Clave1 literal SYNTHETIC y precio/qty
   explícitamente ficticios. Misma proyección M9, allowlist, vínculos y movimientos
   INITIAL_IMPORT usados por el runner aceptado; no son inventario de La Piedad.
2. RESERVE en el kernel existente, evidencia PAYMENT `SYNTHETIC_TEST_ONLY`, POST
   con M9_WEB_TEST/OTHER y replay idéntico. Una deducción, sin efectivo bancario.
3. Cierre nativo de la sesión ORIGINAL por cero. POST cerrado debe seguir
   rechazándose; el recibo original se consulta sin repostear ni reabrir.
4. Evidencia FULL_CANCEL causal con recepción física explícitamente sintética,
   cancelación nativa con esa misma sesión CLOSED y replay sin otra reposición.
   Arqueo/cierre y pago original se comparan exactamente.
5. Retiro compensatorio de semillas por movimientos nativos, cantidades/reservas
   finales cero y costo desconocido. Se cierran los controles transitorios y se
   leen ambos recibos históricos, separando POST original de venta CANCELLED.
6. **ROLLBACK obligatorio**, guard de staging otra vez y auditoría completa
   comparada contra el baseline original. No semillas, ventas, recibos, cuentas,
   tickets o controles durables nuevos.

No hay COMMIT, DELETE, TRUNCATE, setval, migración, gateway, trabajador, correo,
llamada HTTP, sexta campaña o comando de ejecución en la salida. No se genera
aprobación de dueños ni autorización operativa de un JSON de cliente.

## Reversión y secuencias: excepción explícita

La auditoría de las 179 tablas no cubre secuencias, Auth o bytes Storage.
`nextval` y las identidades de auditoría pueden avanzar incluso tras ROLLBACK.
El paquete propone lecturas de pg_sequences antes/después y prohíbe resetear o
ocultar huecos. Cantidad durable cero se refiere a filas/negocio de las tablas
comparadas, **no** a que toda la base quede byteidéntica. Si root no acepta ese
efecto técnico acotado, el paquete se conserva inerte.

## Preparación y verificación disponibles

La API pura `prepareWooIntegralRehearsal(input)` devuelve plan y texto SQL;
no tiene cliente PostgreSQL, fetch, comandos shell, lectura de secretos o modo
EXECUTE. El CLI recibe sólo config y una carpeta nueva, crea archivos 600 en
carpeta700 y no sobrescribe. Produce `plan.json`,
`ensayo-preparado-NO-EJECUTADO.sql` y manifest de hashes. Dos preparaciones con
los mismos inputs deben resultar byteidénticas.

Las pruebas puras comprueban formas, proyecto/origen, actor/namespace, fechas,
179tablas, unicidad, null/no finitos, preimágenes, datos de apoyo faltantes, fuentes,
gatesfalse estrictos, declaración de secuencias, rollback obligatorio, controles
acotados y parser MCP. No ejecutan PostgreSQL y **no acreditan que el SQL pase**.
El primer ajuste de pruebas corrigió dos verificaciones de texto de comentarios;
no se quitó una barrera SQL para obtener aceptación.

El futuro ejecutor debe detenerse ante cualquier error y conservar el log y las
auditorías completas. El JSON de resumen al final no sustituye la revisión de
esa evidencia ni demuestra por sí solo una aceptación positiva.

## Bloqueos reales antes de utilizarlo

- Recuperar QA PostgreSQL aislada de forma autorizada y aceptar el SQL positivo
  generado con rollback y auditoría, sin arrancar servicios por nuestra cuenta.
- Renovar snapshot/preimágenes y resolver si el actor puede usar su sesión propia
  de ensayo; un paquete histórico de 15minutos caduca deliberadamente.
- Revisión cruzada y autorización root específica para un positivo técnico remoto.
  Este bloque autoriza sólo preparar; no se encadena al conector por sí mismo.
- Exportación Woo completa renovada, proveedor sandbox acreditado, autenticidad de
  pago y transporte servidor siguen pendientes para una compra conectada real.
- POST aún necesita una sesión OPEN; envío/impuestos/comisiones, parcialidades y
  reembolso sin recepción física no quedan resueltos por este paquete.
- Un DO de una sola transacción no prueba pérdida real de ACK, desconexión,
  visibilidad desde otra conexión o comportamiento 24/7. Las carreras locales
  previas se citan por separado; no se vuelven a contar como nuevas.

La meta del2noviembre se mantiene como aceptación integral pendiente, sin subir
un porcentaje global por producir este preparador.

## Entrega de preparación offline

63 pruebas puras correctas; ESLint, sintaxis Node y diff-check correctos. Root
aportó por SELECT/READONLY los nueve hashes de apoyo; este agente no hizo
consultas remotas. Dos preparaciones con los mismos ocho inputs reales producen
los tres archivos byteidénticos. Rehash de SICAR/Woo preserva los pins anteriores;
no se accedió al navegador ni se renovó una fuente con el mero reproceso.

Expediente privado nuevo: `outputs/m9-preparacion-corte-integral-2026-10-23/woo/`.
`preparacion-1/` y `preparacion-2/` conservan la primera versión sin reescribirla.
`preparacion-3/` y `preparacion-4/` contienen el paquete final con el guard de ACL.
`verificar-preparacion-2.mjs` comprueba ocho pins, tres parejas idénticas y etiquetas
de no ejecución/aprobación; no ejecuta SQL. `reproducibilidad.json` deja separados
el primer resultado; `reproducibilidad-2.json` documenta la versión final y la
falta de aceptación PostgreSQL. El verificador anterior fija su productor original
y no se presenta como válido para una versión de código posterior.

Plan SHA256 `36f22e2f4c532e493160e35bce02281015762132d929bac6ec1844ae8fab37b2`;
SQL preparado final SHA256 `e1f8de03917eed47d3ed8136118a81c382f4432078ef19d2f5f5dc21e063a123`.
El as_of `2026-10-24T01:04:23.000Z` corresponde deliberadamente al snapshot
histórico conservado. No es hora de generación ni renovación. El guard temporal
rechazará su ejecución cuando venza: hace falta snapshot nuevo, revisión y QA
local del paquete antes de solicitar un positivo técnico remoto.
