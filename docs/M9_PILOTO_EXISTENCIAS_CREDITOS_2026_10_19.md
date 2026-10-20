# M9 · Existencias y créditos de apartado consultados en SICAR

## Resultado y límite de aceptación

Autorización directa: consultar SICAR y avanzar el piloto sólo en staging,
sin tocar producción. Se consultaron los doce códigos del piloto, los créditos
de las 61 cuentas obtenidas al buscar APARTADO y un movimiento de inventario
enlazado con un documento pendiente. No se modificó SICAR, Woo, main ni ningún
cliente, crédito, abono, venta o producto de origen.

Resultado: 40 piezas de **existencia mostrada** entre doce códigos, de 1 a 14
por código, todas iguales al XLSX recibido. No se presentan como conteo físico,
reservas verificadas ni saldo autorizado para producción. Las consultas fueron
secuenciales, no una captura transaccional simultánea de una tienda abierta.

En staging pasó un ensayo técnico con esas cantidades observadas: doce
movimientos INITIAL_IMPORT transitorios mediante el libro existente, repetición
del lote sin otros movimientos, guarda de venta vencida e intacta y ROLLBACK.
Las 18 tablas auditadas quedaron idénticas. No se dejó inventario permanente,
se importaron reservas ni se habilitó una venta.

## Consulta SICAR y alcance de los apartados

La equivalencia Default → La Piedad ya había sido confirmada por Emmanuel.
En cada ficha se comprobó Clave 1 literal, descripción, precio público y
existencia de Default. Se conserva la evidencia de pantalla como texto y su
fecha por código: 2026-10-20T02:39:02Z a 02:39:32Z, todavía 19 de octubre en
México. No se cambió mínimo, máximo, almacén ni existencia.

Emmanuel ubicó los apartados en Clientes → Crédito. Buscar APARTADO requirió
cargar las páginas de la lista: 20, 40, 60 y finalmente 61 cuentas. Se abrió
Crédito en las 61, con el filtro No pagado y recepción Todos. Se conservaron
observaciones explícitas de tabla vacía, sin deducirlo sólo de saldo $0.

Se encontraron siete documentos pendientes en seis cuentas: diez líneas,
incluido un código genérico alfanumérico. Se revisaron todos esos documentos.
Ninguna línea coincide literalmente con los doce códigos del piloto. No se
asocia el código genérico por nombre ni se suman importes de abonos como piezas.
La extracción usa el árbol accesible, evitando duplicar el ticket oculto de
impresión que también existe en el DOM.

El alcance no cubre clientes que no tengan APARTADO en el nombre, documentos
pagados o mercancía pendiente de entrega física. Por tanto, cero coincidencias
en estos créditos **no autoriza reservar cero** en la migración. Se mantienen
physical_qty, reserved_qty y available_qty NULL en el expediente de evidencia.
La marca de cliente identifica un uso operativo; no transforma un crédito en
un registro nativo de reserva por código.

Se comprobó un ejemplo enlazando el folio del crédito con Historial → Existencia
del producto: aparece el movimiento Venta, cantidad y saldo resultante, en
Default. Esto demuestra que ese apartado sí tiene movimiento de venta en el
libro; no se debe restar ciegamente otra vez a la existencia exportada. No se
generaliza una sola muestra a todas las entregas o compromisos. Folios, UUIDs
de clientes y detalle de líneas permanecen en evidencia privada local; no se
publican datos personales o financieros de clientes en GitHub.

## Cruce reproducible

`scripts/m9/review-sicar-pilot-evidence.mjs` recibe por SHA256 renovación,
observaciones de inventario, consultas de clientes, detalle de documentos y
alcance. Requiere todos los códigos y cuentas del alcance declarado y detalle
para cada folio pendiente. Conserva códigos literales y ceros, rechaza código
numérico/duplicado, cambio de precio/descripción, almacén distinto, documentos
sin líneas y consulta incompleta. Sólo cruza códigos exactos; no agrupa ni
aprueba reservas por no encontrar resultados.

Dos corridas idénticas: revision.json, reporte.html y sha256.json. El HTML
presenta sólo el resumen de los doce productos; no muestra nombres o teléfonos
de clientes. No contiene un aplicador, red, credenciales o modo productivo.

## Ensayo técnico del libro en staging

`scripts/m9/pilot-ledger-technical-rehearsal.mjs` genera exclusivamente SQL de
ROLLBACK para staging zsezjtswqeijboezvado. Exige el cruce de sólo lectura,
observaciones originales fijadas por SHA256 y cantidades que coincidan con
esas observaciones; editar el número después del cruce impide generar SQL.
También exige doce identidades y saldos de destino comprobados, unidad PIECE,
costo NULL y auditoría completa. Rechaza saldo no cero o entrada que pretenda
presentarse como aprobación física/de reservas.

La captura de destino de 2026-10-20T03:05:15Z conserva una fila de saldo cero
para el sombrero con ocho movimientos históricos, y once filas ausentes.
El ensayo compara las 18 huellas, revalida proyección y vínculo real de Clave 1,
comprueba el entorno de staging, y usa un ADMIN de sesión de caja como fixture
SQL. No es otra aceptación de permisos Auth/PostgREST ni de PIN de supervisor.

Dentro de una transacción bloquea las tablas pertinentes, llama
app.apply_movement y comprueba cantidades, saldo anterior y posterior, reservas
de QA sin cambios y referencia determinista. Repetir el lote encuentra los
doce movimientos existentes y no los vuelve a insertar. No hay deshabilitación
de triggers, permisos nuevos, cambios de costos, control de venta o lista
autorizada. Todos los códigos siguen devolviendo M9_REVIEW_EXPIRED durante
el ensayo. No se crean tickets, abonos, ventas, devoluciones ni folios.

PASS real: 12 códigos, 40 unidades de entrada QA basadas en la observación,
12 repeticiones sin nuevos movimientos, historial financiero intacto y
ROLLBACK. El resultado dice TECHNICAL_ROLLBACK_NOT_STOCK_APPROVAL y mantiene
source_physical_stock_approved/source_reservations_imported/sales_activated
en false. El cero reservado del destino de QA no se presenta como reserva cero
de SICAR: las reservas de origen siguen sin importar ni certificar.

Después: las 18 huellas y conteos son idénticos, físico/reservado sigue cero,
dos ventas, una devolución y ocho movimientos previos conservados. Los IDs de
secuencia de movimientos pueden avanzar aun con rollback; no se reinician
secuencias ni se eliminan registros para ocultar esos huecos. No se modifica
un consecutivo comercial. La reversión del ensayo es su propio rollback.

PASS: 833 unitarias/105 archivos, 35 nuevas, ESLint dirigido y TypeScript.
Sin esquema/interfaz nuevos, despliegue web aceptado ni carga persistente.

## Reproducción y siguiente paso

```text
node scripts/m9/review-sicar-pilot-evidence.mjs CONFIG_FIJADA.json SALIDA_NUEVA
```

Repetir en otra salida y comparar manifiestos. El SQL técnico se compone con
pilotLedgerTechnicalRehearsal(review, snapshot, originalObservationBytes),
usando captura de máximo una hora, y siempre termina en ROLLBACK. Una actividad
concurrente que cambie la auditoría exige recapturar y regenerar; no borrar
historia, suprimir validaciones o cambiar a COMMIT.

Evidencia privada en outputs/m9-piloto-sicar-verificacion-2026-10-19/: doce
fichas observadas, 61 consultas de crédito sin nombres/teléfonos, siete
documentos con diez líneas, alcance y corte, muestra de historial, dos corridas,
captura/auditorías de staging, SQL/resultado técnico, pruebas y manifiesto.

Para un piloto operativo persistente falta acordar qué compromisos y entregas
deben conservarse además de estos créditos no pagados, clasificar su efecto en
el saldo y obtener un corte de inventario apto para operación. Después se
revalida el catálogo, se prepara el plan específico de saldos con referencias
y reversión y se prueba desde Preview lector → venta → ticket → devolución
→ caja, sin usar SICAR para registrar ensayos. El bloque actual ya prueba el
libro, pero no sustituye esa aceptación de saldos, reservas y recorrido completo.

Cobertura de catálogo sin cambio: 15,876/16,381 = 96.92%. La mejora de este
bloque es evidencia y ensayo de inventario, no nuevas altas o producción.
