# M9 · Preparación de existencias del piloto, sin importación

## Alcance y resultado

Autorización: avanzar todo lo posible en el piloto sin tocar producción y
explicar cómo confirmar el almacén default. Se añade preparación offline y una
comprobación SQL estrictamente de lectura en staging. No se implementa todavía
un escritor de saldos ni se activa venta, sincronización, Woo, main o producción.

La selección conserva los 12 códigos del piloto renovado, huella
`8fec1a4790dc93010b2de97a1ed208d531d6e79ebb5fe18a6cfc07921258998f`.
No incorpora códigos dudosos, nuevas altas ni provisionales. Clave 1, variant_id,
product_id, costo NULL y precio público permanecen iguales.

## Almacén SICAR: observado y pendiente

Consulta visual autenticada: VSM, menú con contexto VAQUERO SM / MARIANO
JIMENEZ. Ruta **Configuraciones → Productos → Almacenes**. La lista muestra
una entrada: **Default**. No se abrió su edición ni se cambió configuración.
La exportación recibida identifica ese almacén como `default`.

Eso no prueba que sus cantidades correspondan a la ubicación La Piedad del
programa. Quien lleva el inventario debe confirmar si concentra únicamente la
tienda/bodega de esa sucursal o mezcla otras ubicaciones, y si la columna
existencia expresa físico total o disponible después de apartados.
Si hay mezcla, se necesita un desglose; no se reparte por suposición.
No hay que renombrar ni crear almacenes para dar esta respuesta.

Una confirmación de equivalencia puede cubrir los doce códigos. La captura
del inventario y reservas debe estar fechada, identificada y respaldada por
reporte/conteo de ese mismo alcance. Para el ensayo se puede verificar sólo la
selección, sin pedir revisar todo el catálogo.

## Preparador y hoja de comprobación

`scripts/m9/prepare-pilot-stock.mjs` fija por SHA256 el resultado de renovación,
la captura viva de staging y, cuando exista, la evidencia cumplimentada. Es
offline; no usa credenciales, red ni cliente SQL. El destino propuesto es La
Piedad de staging, todavía sin afirmar equivalencia de origen.

Genera plan.json, captura-pendiente.json, reporte.html imprimible,
preflight-rollback.sql y sha256.json. La hoja muestra código, producto, talla y
precio con espacios para físico y apartados, fecha, responsable y evidencia.
Las cantidades del XLSX no se copian: NULL significa pendiente y sólo un cero
expreso, respaldado por evidencia, puede significar cero.

Rechaza duplicados, códigos numéricos, cambios de identidad, precio, costo,
atributos, datos SICAR, revisión, vínculo Woo o unidad, y destinos de tránsito.
Exige todas las filas de la selección, captura de destino no mayor de una hora
y evidencia de origen de máximo 24 horas al momento de evaluación. Estos
límites son controles elegidos para este ensayo; no certifican que una tienda
abierta no haya tenido movimientos entre capturas. Antes de cargar se repite
la captura/comparación y se acuerda el corte de la prueba.

La confirmación exige tienda única, físico que incluya apartados, responsable,
fecha con zona horaria y huella de evidencia. Cantidades: piezas enteras,
explícitas y no negativas; reservas no mayores al físico. Cualquier reserva
positiva queda pendiente de un plan específico para migrar sus compromisos.
No se crea reserva anónima, se ignora un apartado ni se inventa su cliente.
Un saldo no cero en destino exige un plan de diferencias separado.

Aunque la evidencia estuviera completa, el estado sólo sería
EVIDENCE_COMPLETE_REHEARSAL_STILL_REQUIRED. Ninguna salida autoriza carga,
activación o producción. La referencia determinista del lote sirve para el
futuro control de duplicados; no se presenta como idempotencia de un importador
que todavía no existe. Una huella de evidencia debe corresponder a un archivo
real revisado por el operador, no acredita por sí sola una confirmación humana.

## Captura y comprobación en staging

Captura completa de los doce códigos y sus saldos en La Piedad a
2026-10-20T02:20:52Z (19 de octubre, hora de México). Una fila de saldo existe
para 2396, con físico/reservado cero y sus ocho movimientos históricos;
once no tienen fila de saldo. Ausencia en destino se conserva explícitamente
como ausencia; no demuestra que el inventario SICAR sea cero.

SQL generado: BEGIN REPEATABLE READ READ ONLY, validaciones y ROLLBACK. Sin
INSERT/UPDATE/DELETE ni llamadas de ajuste o movimiento. Revalida entorno
staging permitido, guarda habilitada, vigencia de captura, ubicación completa,
identidades/proyecciones/revisión, código literal y existencia, valores y número
de movimientos del saldo anterior. No requiere libros vacíos ni borra historial.

PASS para la integridad de los doce destinos. El resultado real permanece
BLOCKED_MISSING_OR_CHANGED_EVIDENCE por almacén y existencias sin confirmar:
no se convierte ese bloqueo esperado en aprobación de carga. Dos pruebas
negativas de sólo lectura alteran únicamente los datos esperados del script:
STOCK_BASELINE_CHANGED y STOCK_CATALOG_CHANGED, ambas rechazadas como corresponde.
Auditoría de 18 tablas idéntica antes/después; guarda intacta, sin movimientos
nuevos. No se ejecutó carga de saldos ni una venta/devolución adicional.

Desde Preview con Auth real se buscaron los doce códigos exactos en Inventario.
Cada uno devolvió una sola variante correcta, talla correspondiente y físico,
disponible y reservas cero. No se pulsó Contar. Es aceptación de búsqueda y
lectura, no otro recorrido de cobro/fotos de las doce fichas.

PASS: 798 unitarias/103 archivos, incluidas 40 nuevas, TypeScript y ESLint
dirigido. Corridas finales 2/3 idénticas; corrida 1 intermedia conservada.
No hay nueva migración ni interfaz; no se declara otra prueba de despliegue.

## Reproducción, reversión y siguiente paso

```text
node scripts/m9/prepare-pilot-stock.mjs CONFIG_FIJADA.json SALIDA_NUEVA
```

Usar dos salidas nuevas y comparar manifiestos. El SQL de comprobación siempre
termina en rollback y además es read-only. Falla ante catálogo/saldo alterado o
captura vencida: renovar evidencia, nunca suprimir controles ni cambiar a COMMIT.
No existe carga persistente que revertir en este bloque.

Evidencia privada fuera de GitHub:
outputs/m9-preparacion-saldos-piloto-2026-10-19/: captura SQL/JSON de staging,
auditorías, corridas 2/3, resultados positivo/negativos, doce búsquedas reales,
capturas visuales de SICAR/Preview, pruebas y manifiesto. Los archivos contienen
datos del negocio y permanecen locales; GitHub recibe código/pruebas/docs.

Siguiente: confirmar equivalencia y significado de existencias, recibir evidencia
de físico/reservas de los doce al mismo corte, regenerar el plan y resolver sus
bloqueos. Implementar después el ensayo específico de carga con libro,
deduplicación y reversión, manteniendo la guarda del resto del catálogo. Sólo
tras ese ensayo se prueba lector → venta → ticket → devolución → saldo/caja
junto a SICAR. Conservar tickets y movimientos; nunca limpiar historia para
repetir el piloto. Producción sigue requiriendo autorización independiente.

La cobertura de catálogo no cambia: 15,876/16,381 = 96.92%. Este bloque aumenta
preparación y verificación operativa, no añade productos ni completa toda M9.
