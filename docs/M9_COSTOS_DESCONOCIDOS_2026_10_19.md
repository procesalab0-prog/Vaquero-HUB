# M9 · Cobro con costo desconocido y agrupación con ventas · 19 de octubre

## Resultado y alcance

Se corrigió el bloqueo detectado en el ensayo del 17 de octubre: el catálogo
aceptaba costo desconocido, pero sale_items.unit_cost_cents exigía un número.
La corrección está aplicada y ensayada únicamente en Supabase staging
zsezjtswqeijboezvado. No se escribió en producción ni en WooCommerce, ni se
importaron existencias. Todas las operaciones monetarias y de inventario de
los ensayos fueron sintéticas y se revirtieron.

La carga sigue en 15,876 de 16,310 códigos (97.3391% del catálogo del corte
12 de octubre), con 434 retenidos. Ese porcentaje no mide el cierre de toda la
migración. Este bloque elimina un impedimento operativo, sin sumar productos.

## Costos y valuación

- La venta de catálogo conserva NULL cuando el costo era desconocido al cobrar
  o entregar un apartado. No se sustituye por cero ni por el precio público.
- Capturar después un costo en el catálogo no reescribe ventas anteriores.
- Los costos conocidos, incluido cero legítimo, conservan su significado.
  Producto rápido mantiene su contrato anterior con quick_cost_recorded;
  no se reinterpretaron sus filas históricas ni se abrió acceso a sus costos.
- La valuación de inventario devuelve total NULL e incompleto si hay cantidades
  distintas de cero con costo desconocido. Añade subtotal conocido, conteos de
  variantes sin costo y bandera de integridad antes del límite de 500 filas.
  Categorías conservan el mismo tratamiento. Las cantidades por unidad,
  redondeos, filtros, autorizaciones y límites anteriores siguen vigentes.
- Cero existencia física puede valer cero sin asignar un costo unitario ficticio.
  El costo unitario de la variante sigue NULL.
- Primera recepción real sin saldo previo establece el costo desde la compra.
  Si hay saldo previo sin costo, el costo combinado sigue NULL y la recepción
  queda auditada como UNKNOWN_OPENING_BALANCE; no se inventa un promedio.
- Los reportes existentes de ventas muestran ingreso, descuentos y pagos, no
  calculan utilidad. No se agregó una utilidad estimada ni se tomó NULL como cero.

El ajuste de presentación de Reportes está preparado en esta rama: «Sin
definir», «Incompleto» y subtotal conocido. Aún NO se publicó el frontend de
Preview ni main. La validación alojada de este bloque fue SQL; no equivale a
haber comprobado esa presentación en la página publicada.

## Defecto adicional encontrado y corregido

El primer ensayo de venta → agrupación → devolución falló con
RETURN_PAYMENT_TOTAL_MISMATCH. La agrupación anterior ejecutaba SET CONSTRAINTS
ALL IMMEDIATE y alteraba las comprobaciones monetarias del resto de la
transacción. El ensayo fallido no dejó ventas ni agrupaciones guardadas.

Una migración nueva elimina los cambios globales de modalidad: inserta el
registro de agrupación antes de referenciarlo y completa su estado dentro de
la misma operación atómica. Desagrupar tampoco cambia las restricciones del
llamador. Se conservaron permisos privados, comprobaciones de evidencia,
idempotencia, bloqueos Woo y las validaciones monetarias existentes.

## Pruebas completadas

1. Reconstrucción aislada con 164 migraciones en PostgreSQL 17: cobro de catálogo
   y producto rápido, unidades, compras, promedio ponderado, concurrencia de dos
   conexiones y regresiones de dólares ya existentes. Dólares y asignación
   fraccionaria siguen desactivados en staging.
2. Aceptación local de costo NULL, cero conocido y costo conocido en el mismo
   cobro; repetición idempotente; devolución y cancelación; apartado pagado y
   entrega sin segundo cobro; costo posterior sin alterar la venta; recepción
   inicial, recepción con saldo desconocido y recepción con costo cero.
3. Ensayo alojado con Clave 1 literal 2396: venta de dos piezas, repetición,
   devolución parcial repetida, cancelación, apartado/entrega repetida, caja
   neta y valuación incompleta. Una variante provisional fuera de la lista
   autorizada siguió bloqueada para vender.
4. Dieciocho controles locales y alojados: venta provisional previa, agrupación,
   devolución posterior, reversión de agrupación y una nueva venta/devolución
   después de desagrupar. IDs, códigos literales, snapshots, pagos, saldos,
   movimientos y devoluciones se conservaron. Repeticiones no duplicaron actos.
   Atributos QA no representan una aprobación comercial de los modelos.
5. 717 pruebas unitarias / 99 archivos; lint dirigido, formato de scripts,
   generación de tipos y TypeScript sin errores.

Las pruebas SQL locales simulan Auth/Storage. En staging se usaron las funciones
reales con identidad de operador dentro de una transacción SQL. NO se declara
aceptación de cobro por navegador + Auth/PostgREST ni prueba con lector físico
nueva en este bloque.

## Auditoría y protección conservada

Huella idéntica antes/después para catálogo, variantes, productos, códigos,
registro provisional, lista autorizada y caja. Al cierre: cero saldos de
inventario, movimientos, ventas, renglones de venta, devoluciones y apartados.
No persisten eventos de agrupación de los ensayos. Sólo cambiaron las cuatro
funciones previstas y la nulabilidad/constraint del snapshot de costo.

La revisión de venta se habilitó temporalmente dentro de los ensayos y se
restauró mediante ROLLBACK. Su vencimiento original sigue siendo
2026-10-18T15:33:14.358764Z: el bloqueo operativo continúa vigente. No se liberaron
productos pendientes ni los 7,243 provisionales para vender desde la web.

Asesores revisados: INFO RLS sin políticas en 64 tablas privadas, 131 advertencias
existentes de funciones definer ejecutables y protección contra contraseñas
filtradas pendiente. No es una auditoría global limpia ni una ampliación de
permisos. [Referencia de asesores](https://supabase.com/docs/guides/database/database-advisors).

## Archivos y reproducción

Migraciones nuevas, sin editar ninguna aplicada anteriormente:

- 20261019161438_m9_unknown_sale_costs.sql.
- 20261019161826_m9_grouping_scoped_constraints.sql.

Los archivos se generaron con supabase migration new; después se conciliaron
sus versiones con el historial real del conector, conservando el SQL aplicado.

En una base LOCAL vacía qa_*, las pruebas reproducibles son:

```sh
QA_DATABASE_URL=postgresql://...@127.0.0.1:PUERTO/qa_costos node scripts/verify-operational-native.mjs
QA_DATABASE_URL=postgresql://...@127.0.0.1:PUERTO/qa_agrupacion node scripts/verify-m9-cost-grouping-native.mjs
```

Cada comando necesita su propia base vacía. Rechazan destinos remotos y bases
ajenas a qa_*. Los ensayos de staging viven en scripts/m9/test-unknown-cost-staging.sql
y test-provisional-sale-grouping.sql. Exigen staging y libros vacíos, contienen
su propio rollback y no deben adaptarse para producción.

Evidencia fuera de Git: outputs/m9-costos-desconocidos-2026-10-19, con estados
antes/después, error inicial, ensayos finales, recibos de migraciones, asesores,
logs y verificacion-final.json. El código queda en la rama local
codex/m9-reglas-provisionales. No hay publicación ni integración a main de este
bloque. La consulta Git de staging confirmó 7c0ac8e3; main avanzó a 96254b8.
No se sobrescribió ninguna mejora paralela.

## Siguiente bloque

Publicar el ajuste revisado en Preview, completar aceptación operativa por
interfaz/Auth/PostgREST y preparar una revisión vigente del lote a ensayar.
La reactivación persistente del ensayo no se hace implícitamente con esta
migración. Para el corte real: fuentes SICAR/Woo renovadas, inventario autorizado,
plan/diferencias/rollback y autorización productiva explícita. Siguen faltando
los reportes de actividad para proponer archivo y la revisión de los 434 retenidos.


### Actualización posterior del mismo día

El ajuste ya se publicó en Preview y pasó aceptación de cobro/cancelación por
navegador y Auth/PostgREST real. El cierre ahora conserva una venta QA cancelada
y su historial; stock y caja netos siguen cero. El registro anterior describe
el estado al terminar el ensayo SQL, no el estado posterior. Ver
[M9_PREVIEW_ACEPTACION_2026_10_19.md](M9_PREVIEW_ACEPTACION_2026_10_19.md).
