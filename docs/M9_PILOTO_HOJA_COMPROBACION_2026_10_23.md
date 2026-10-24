# Hoja de comprobación del piloto · 23 octubre 2026

Plan previo desde `4cf8731`, para la visita objetivo del 2 de noviembre. Sólo
staging y Preview; root integra y publica. Sin consultas remotas ni navegador por
este agente. No se añade inventario, importador, ledger, tabla, permiso o RPC.

La hoja existente `/clientes/heredados-sicar#piloto` ya conserva doce códigos,
36 cantidades desconocidas, fuente y declaración por campo. El hueco es práctico:
necesita definiciones de captura, progreso que distinga cantidad de evidencia
vigente y una hoja imprimible sin datos personales de clientes.

Se reutiliza `m9_legacy_registry_read` para una exportación de sólo lectura,
protegida por staging, sesión, permiso de conteo y controles existentes del RPC.
La exportación fija los doce códigos literales, UUIDs, sucursal, revisión y
referencia SICAR; todas las casillas de captura empiezan vacías, aunque exista un
borrador. La fecha de generación no renueva la fecha de la referencia SICAR.

Definición **del nuevo conteo**, no de la columna SICAR: físico incluye toda pieza
presente, incluso mercancía guardada o separada. Vendido y guardado y separado sin
venta son subconjuntos disjuntos. Una pieza no puede registrarse en ambos.
Folio/abono/saldo no acredita presencia, entrega ni descuento previo. Identificar
documento y línea sin nombres de clientes; comprobar el efecto de inventario
anterior por separado. Si falta esa evidencia, registrar la duda, no restar ni
crear una reserva. La revisión documental de entregas del otro frente no rellena
estas cantidades físicas.

El progreso contará UNKNOWN, borrador sin evidencia, retenido y declaración
vigente vinculada a la cantidad/huella/revisión/actor. Nunca importable ni
certificado. Se conserva el escritor y sus guardas; no se guardará ninguna
cantidad real o sintética desde Preview en este bloque.

QA prevista: doce códigos/36 casillas, NULL frente a cero explícito, evidencia
retenida/mismatched, sucursal/identidad/duplicados y HTML seguro; reproducibilidad
byte a byte de dos hojas desde la misma fuente y fecha, ausencia de PII de clientes
y límites servidor antes del RPC. Sin SQL nuevo, no se requiere clon de base.
Reversión: retirar la exportación/ayuda de interfaz; no hay datos que revertir.

## Entrega y medición

La misma pantalla muestra los campos desconocidos, sin atribución, retenidos y
declarados vigentes. Para este último exige coincidencia exacta de cantidad y
huella de fuente, catálogo/saldo vigentes, revisión válida, actor, fecha y fuente
declarada. La comparación física sigue oculta si falta cualquiera. No expresa
aptitud de carga ni certificación. Se corrigió durante la revisión independiente
la aceptación de fechas imposibles: el calendario UTC se valida por roundtrip,
conservando el texto y microsegundos originales.

El enlace de impresión abre `/clientes/heredados-sicar/hoja`; se imprime con la
opción del navegador. Reutiliza únicamente `m9_legacy_registry_read`, exige
staging y `inventory.count` antes del RPC y conserva ADMIN/customers.manage y
sucursal en la base. No hay claves privilegiadas, scripts, recursos externos o
caché compartida. Sólo se proyectan las filas de stock, nunca cuentas/nombres de
clientes, teléfonos, saldos o abonos. La hoja incluye referencias documentales
vacías sin nombres para que una pieza no se asigne a V y S simultáneamente.

`scripts/m9/prepare-pilot-count-worksheet.mjs CONFIG SALIDA_NUEVA` prepara la misma
hoja sin red. Configura proyecto de staging, modo
`READ_ONLY_BLANK_COUNT_WORKSHEET`, entrada de filas con SHA256 y metadata cerrada
con `generated_at`, `source_kind` y `source_label`. No puede sobrescribir carpeta
ni archivos anteriores. La hoja JSON conserva códigos/UUIDs/sucursal/revisión y
procedencia; el HTML deja siempre 36 casillas vacías, incluso con borrador previo.
La fuente SICAR no se copia ni se convierte en conteo cero.

Dos preparaciones privadas idénticas utilizan la lectura ya archivada el 22 de
octubre, sin reobservarla ni afirmar vigencia al 23: 12 códigos, 36 NULL y cero
declaraciones. Se fijan el archivo MCP original y la derivación de sus filas. Las
doce fichas nuevas que root leyó en SICAR el 23 se concilian en otro expediente;
no sustituyen el borrador antiguo ni acreditan físico/compromisos.

QA enfocada: **58 pruebas en cuatro archivos** correctas, de NULL/cero,
evidencia sin atribución/retención/deriva,
calendario, identidad y sucursal, HTML escapado, carpeta/pins/reproducibilidad y
frontera servidor con permisos antes del lector. Se verifica el render de la
pantalla y la respuesta de impresión con mocks; no es aceptación visual o Auth
real. Tipos y ESLint correctos. La hoja requiere todavía revisión en Preview y
conteo humano; no se ejecutó SQL, mutación RPC, navegador ni escritura remota.

Expediente privado: `outputs/m9-arranque-integral-2026-10-23/catalogo/`, permisos
700/600. `hoja-1` y `hoja-2` conservan JSON/HTML/resumen/manifiesto idénticos y
`verificar.mjs` comprueba hashes, preimagen histórica y casillas desconocidas.
