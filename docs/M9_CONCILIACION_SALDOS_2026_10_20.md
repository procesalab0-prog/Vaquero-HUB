# M9 · Conciliación de existencias, créditos y entrega pendiente

## Especificación

Continuar sólo en lectura de SICAR y staging. Alcance: los doce códigos del
piloto y las 61 cuentas de la búsqueda APARTADO. El corte es secuencial en una
tienda abierta, no una captura transaccional ni un conteo físico. Se mantienen
las claves literales, los IDs de variantes, el costo NULL y los datos maestros.

Separar tres hechos: documento pagado/pendiente, movimiento de inventario y
entrega física. El filtro Recepción de pago y los abonos vinculados no prueban
entrega de mercancía. Un crédito pagado no se recrea como deuda; una salida ya
observada en el libro no vuelve a descontarse por migrar su compromiso. La falta
de movimiento en una consulta incompleta no demuestra que nunca se descontó.

El preparador offline exige fuentes por SHA256, ambos estados de cada cuenta,
detalle de cada documento, observaciones actuales de los doce códigos y captura
de staging. Identifica coincidencias exactas, sin nombre aproximado o códigos
inventados. La evidencia de movimiento debe coincidir por folio, código, cantidad
y almacén. Una muestra no se generaliza al resto de créditos.

El plan conserva cantidades observadas del libro de origen como referencia,
separadas de cantidades físicas, reservadas, disponibles e importables. Estas
últimas siguen NULL cuando no están acreditadas. Calcula diferencias sólo para
comparación, sin aplicarlas, y mantiene bloqueos globales y por código. Ninguna
entrada del archivo activa importación o venta. El preflight es READ ONLY y
ROLLBACK; un ensayo futuro de aplicación sigue usando el libro existente y
rollback, sin borrar historial o bajar protecciones.

No escribir en producción, main, SICAR, Woo, saldos, abonos o clientes. Los
detalles financieros permanecen en evidencia local privada; Git sólo conserva
código, pruebas y resumen sin identidades de clientes ni folios concretos.

## Resultado observado y límites

SICAR se consultó con la sesión renovada por el usuario, sin editar documentos.
El corte final recargó las 61 cuentas con ambos filtros, mensajes de vacío
explícitos y resultados ya cargados. La paginación de la búsqueda se comprobó
20 → 40 → 60 → 61. Se revisaron 66 documentos pagados y siete pendientes:
99 líneas, incluyendo folios históricos numéricos y un código genérico.
No se convierten saldo financiero cero o cuentas vacías en piezas reservadas cero.
Se conservaron consultas preliminares y se sustituyeron sus conteos por el corte
final: un icono de la tabla no cuenta como folio y un estado de carga no cuenta
como resultado vacío. No se usa la primera captura de 60 pagados como corte final.

Se renovaron las doce existencias: 40 piezas mostradas, todas iguales a la
exportación recibida, con precio y descripción actuales coincidentes. La única
coincidencia literal del piloto es la billetera 11920, una pieza en un documento
pagado de marzo de 2025. Esto no demuestra que hoy esté apartada ni pendiente
de entrega; tampoco certifica su entrega. Se prepara una sola pregunta concreta,
con tres opciones, y se mantiene fuera del siguiente lote candidato hasta
aclararlo. No se cambia su saldo observado de dos piezas ni se resta otra pieza.

Los otros once códigos no coinciden con las líneas revisadas y suman 38 piezas
observadas. Son candidatos de comparación/QA, todavía no una selección aprobada
para importar u operar. Quedan bloqueos generales por significado físico del
saldo, corte de compromisos y clientes sin etiqueta que este alcance no cubre.
Default → La Piedad sigue confirmado; no se vuelve a pedir esa equivalencia.

Se volvió a enlazar una línea de crédito pendiente con su historial: movimiento
Venta, mismo folio, código, cantidad y Default. Sólo esa línea se clasifica
SALE_DEBIT_OBSERVED y tiene descuento adicional cero; las otras 98 conservan
efecto desconocido. No se generaliza la muestra. Una búsqueda histórica de la
billetera no se utiliza para certificar ausencia de movimiento ni entrega.

## Plan reproducible y controles

`scripts/m9/reconcile-pilot-balances.mjs` exige ocho entradas por SHA256:
renovación, observaciones, cuentas, documentos, alcance, movimientos, captura de
staging y evidencia del almacén. Reutiliza las validaciones del catálogo y plan
de saldos anterior. Conserva ceros iniciales, IDs, unidad y costo NULL; rechaza
cuentas repetidas/incompletas, un estado financiero faltante, folios en dos
estados, documentos sin detalle, líneas inválidas, evidencia vencida y muestras
de movimiento que no coincidan con las columnas reales de la tabla.

Produce plan.json, preguntas.json, captura-pendiente.json, reporte.html,
preflight-rollback.sql, ensayo-libro-rollback.sql y manifiesto. Las dos corridas
finales 4/5 son idénticas; 1–3 quedan como iteraciones anteriores. El HTML no
publica nombres, teléfonos, UUIDs de clientes ni sus folios. Las cantidades
importables, físicas, reservadas y disponibles permanecen NULL. La diferencia
contra destino es comparativa; una fila ausente de destino no demuestra un cero
en origen. No contiene cliente SQL, credenciales, red ni opción de COMMIT.

El preflight real de staging comprobó los doce códigos y reportó honestamente
BLOCKED_MISSING_OR_CHANGED_EVIDENCE. Dos negativos de sólo lectura modifican
expectativas del script, no datos de la base: cambios de catálogo y saldo se
rechazaron con STOCK_CATALOG_CHANGED y STOCK_BASELINE_CHANGED.

El ensayo del libro se deriva del expediente completo, sin aceptar una lista
editable de códigos aprobados. Excluye toda coincidencia de crédito, incluida
la billetera; conserva las huellas de las observaciones seleccionadas y referencia
de la fuente completa. Usa el escritor legítimo ya probado, guarda habilitada
y vencida durante todo el ensayo, INITIAL_IMPORT transitorio y ROLLBACK.
PASS real: 11 códigos, 38 unidades QA observadas y 11 repeticiones sin otro
movimiento. No aprueba stock, migra reservas, habilita venta ni crea tickets,
deudas, abonos, autorizaciones o folios. No es otra aceptación Auth/PIN.

Auditoría de las 120 tablas idéntica antes/después de preflight, negativos y
ensayo: dos ventas, una devolución y ocho movimientos históricos conservados.
Las secuencias técnicas pueden avanzar; no se reinician. No quedaron saldos
permanentes ni se tocó producción, main, SICAR o Woo. Sin esquema o interfaz
nuevos; no se afirma otra aceptación de despliegue web.

## Reproducción y siguiente paso

```text
node scripts/m9/reconcile-pilot-balances.mjs CONFIG_FIJADA.json SALIDA_NUEVA
```

La captura de destino admite máximo una hora y la evidencia de origen 24 horas;
el corte secuencial no elimina ventas concurrentes. Para una nueva carga se
recaptura y concilia, sin editar fechas para extender vigencia. La reversión
del ensayo es el propio rollback. Un importador operativo persistente sigue
pendiente del plan de cantidades/compromisos acreditadas y de aceptación desde
Preview; no se promueve este ensayo técnico a producción.

Evidencia privada: outputs/m9-conciliacion-saldos-2026-10-20/. Incluye corte
completo, 73 documentos, 99 líneas, doce observaciones, muestra de libro, captura
y auditorías, corridas, SQL/resultados, pregunta consolidada y reporte final.
Cobertura catálogo sin nuevas altas: 15,876/16,381 = 96.92% en staging.

PASS final: 901 unitarias/107 archivos, 40 nuevas; ESLint dirigido, TypeScript y git diff --check.


## Alcance confirmado · Clientes, créditos y apartados · 20 de octubre

Emmanuel confirmó que los clientes de apartados y créditos también deben
pasarse al nuevo sistema. Este bloque queda incluido en la migración completa,
como una etapa distinta del catálogo y del saldo inicial de inventario.

Preparar: clientes y sus vínculos de origen, documentos vigentes, saldos
pendientes y abonos acreditados, artículos y cantidades comprometidas, y estado
de entrega respaldado por evidencia. Los documentos pagados se conservan como
historial de origen, sin recrearlos como deuda ni volver a cobrar. No generar
ventas retroactivas para copiar un saldo ni duplicar la salida de inventario
que SICAR ya haya registrado. Cuando la entrega o la identidad de un código
no sea comprobable, mantenerlo en revisión, sin inventar compromiso o cliente.

Distinguir historial documental de movimientos operativos nuevos. Definir por
adelantado cómo se representarán saldos de apertura y pagos/entregas posteriores
con referencias SICAR, deduplicación, conciliación y auditoría. Un movimiento de
reserva o salida adicional sólo procede con su plan de efecto explícito.

Estado: alcance confirmado; importador de clientes/créditos/apartados todavía
no implementado ni ejecutado. La consulta actual sólo cubre las 61 cuentas
APARTADO, no todos los clientes y créditos de SICAR. Para abarcar la etapa
completa hace falta un corte/exportación de clientes y documentos del alcance
acordado, sus abonos y compromisos; antes de operar, ensayo en staging con
rollback, controles de duplicados, sumas por cliente/documento y aceptación
de pagos/entregas con Auth real. Mantener la prohibición de tocar producción.
