# Plan previo · Referencias SICAR retenidas

Base `764f742`. Alcance: consulta ADMIN en Preview de las435referencias del corte
SICAR22 todavía sin catálogo activo. No crear productos/variantes, precios, costos,
existencias, vínculos o envíosWoo. El archivo no cambia cobertura activa ni
habilita ventas. Root conserva cualquier DDL/DML remoto y el despliegue.

## Reutilizar lo conservado

El archivo existente `m9_pending_review` conserva8515referencias del7octubre,
con su corte/hash original; actualmente437no tienen código administrado.
434pertenecen a las435reservas del22:433conservan exactamente Clave1,descripción,
departamento,sección yPrecio1. En9184 cambió únicamente la referencia literal de
precio1790→1990;18329 no está en aquel archivo.4481,9069,9075son referencias
históricas ajenas al corte22 y no deben reaparecer como reservas actuales.

No duplicar esos433datos originales ni actualizar el archivo histórico. Crear
un índice inmutable pequeño del corte22:435códigos/motivos, puntero/hash a434
registros existentes y sólo dos deltas de proyección (9184y18329). Guardar fuente
SICAR22/hash y evidencia del índice, sin reenviar información aWoo ni PII nueva.
Una referencia vieja cambiada inesperadamente retiene la consulta de su detalle.
Compensación mediante retiro lógico aditivo del índice; nunca borrar fuentes.

## Motivos y decisiones

Las categorías de retención se superponen:316exhibición,86taxonomía,
40precioinválido y3conflictos de categoría, sobre435códigos únicos. Partición:
307sóloexhibición,9exhibición+taxonomía,76sólotaxonomía,1taxonomía+precio,
39sóloprecio,3conflictos. No sumarlas como445productos ni deducir tallas.

Preparar cuatro tarjetas con ejemplos. Exhibición es política ya confirmada y
no necesita435nuevas preguntas ni volver a confirmar la misma regla. Para las
otras tres, presentar decisión por tipo y corrección de origen en grupos;
no publicar otra tanda de preguntas individuales ni guardar respuestas aquí.

## Secuencia y validación

1. Verificar reportes y hashes originales, lista435exacta frente al catálogo y
   existencia/huellas de referencias anteriores. Conservar textos/códigos literales.
2. Importador privado invoker sólo postgres/ADMIN/staging, sin grants de cliente.
   Plan completo y revalidación bajo locks, recibos inmutables, replay y retiro
   lógico idempotente. Sólo índice+eventos+auditoría; ninguna tabla operativa.
3. Lector específico ADMIN+products.read y guardia de staging. Ruta nueva
   `/migracion/retenidos`, búsqueda literal/código, filtros por motivo que muestran
   todos los solapamientos, páginas pequeñas, sin acciones de venta/stock/Woo.
   Procedencia histórica y corte de índice separados explícitamente.
4. QA local aislada: rollback de tablas previas, ACL, archivo modificado, código
   duplicado/manipulado, intersección inesperada con catálogo, replay/retiro,
   sobreconteos por motivos y estados sin fuentes. Root revisa antes de conservar.

## Resultado preparado

SELECT acotado del23octubre,01:55UTC (todavía22octubre enMéxico):434enlaces al
archivo existente. Índice435con lista y motivos fijados por SHA,433sin duplicar
la proyección histórica,1delta de precio literal para9184 y1referencia nueva
para18329. No se copian8515filas ni se altera aquel corte. El índice guarda
solamente punteros/huellas de PostgreSQL y deltas de cuatro campos documentales.
El preparador verifica también la huella normalizada del reporte que produjo
las435retenciones y el conjunto literal contra los15961códigos ya conservados.

Las316deexhibición no reciben variante, precio operativo, existencia ni WooID.
Se distinguen38Precio1 con decimales extra y2ceros dentro de40reservas de precio;
se conservan cadenas originales como `6299.99944`, sin redondear ni convertirlas
en centavos válidos. Los ejemplos de precio muestran ambas clases separadas.
Una regla de normalización futura requeriría otro plan y validación; no está
aprobada ni aplicada por este índice.

La ruta `/migracion/retenidos` es una consulta ADMIN de staging con búsqueda
literal/texto, cuatro filtros inclusivos, veinte resultados por página y cuatro
tarjetas por tipo. Exhibición se explica como política confirmada. Las otras
tres reúnen próximos pasos y ejemplos; todavía no capturan respuestas ni envían
nuevas preguntas. Se indica que los motivos se superponen y que archivar no
incrementa el catálogo activo. Se conserva por separado la fecha del índice22
y el archivo histórico7. La ruta antigua de pendientes puede seguir mostrando
437históricas:4481,9069,9075ya no pertenecen al corte22;18329es nueva.

El draftSQL instala dos tablas privadas append-only (índice y retiro lógico),
importador/compensador invoker de mantenimiento y lector acotado definer detrás
de wrapperinvoker. Todos usan guardia de staging; el lector exige ADMINactivo y
products.read. Anon/service_role no pueden leer; authenticated no accede a las
tablas ni a escritores. No se elevan permisos operativos. Búsquedas y filtros
son sólolectura. La lista435,shaSICAR22yhashesdeorigen se revalidan bajo locks.
Si cambia una referencia anterior tras guardar, el lector oculta su detalle y
marca la retención; no presenta el dato alterado como original.

Retirar el índice agrega un evento inmutable y lo oculta del lector; no borra
filas ni restaura fuentes. Repetir la misma operación no agrega otra fila; el
índice retirado no se reactiva con replay. Los recibos conservados son evidencia
histórica, nunca autorización de venta, stock, costos, agrupación o publicación.

## Validación y entrega

- **41 pruebas unitarias**: tipos/contrato del lector, código literal con ceros,
  filtros, permisos declarados, límites, proyección distinta, motivos solapados,
  SHA de procedencia, duplicados, nuevas asociaciones y separación de precios.
- **39 controles SQL locales**: importar/repetir/retirar/repetir, falla trasinsert,
  referencia original modificada, código incorporado al catálogo, índice alterado,
  retiro y replay histórico, lectura de22páginas sin duplicados, cuatro grupos
  completos,38decimales/2ceros exactos, ACL y rechazo de usuario ausente,
  ADMINinactivo/noADMIN, guardstageapagada y protección UPDATE/DELETE de eventos.
- ROLLBACK exterior sobre **166 tablas previas idénticas**, incluida la evidencia
  histórica8515. Durante el ensayo sólo cambian el índice/retiro nuevos y auditoría;
  productos, variantes, precios, costos, inventario, deudas, caja y Woo intactos.
- Lector con rol authenticated y actor ADMIN local verificado. Auth/Storage del
  clon son stubs: falta aceptación de sesión real en Preview por root.
- Typecheck y lint enfocado PASS. Build local y aceptación Preview se registran
  al cierre correspondiente; no se despliega desde este frente.

Expediente privado `outputs/m9-referencias-retenidas-2026-10-22/`: entradas y
consultas anteriores, `config.json`, dos preparaciones finales idénticas
(`preparacion-2/`,`preparacion-3/`), payload435idéntico a la preparación inicial,
`ensayo-3.json`, manifiesto/verificador offline y reporte. La carpeta inicial se
conserva como historia; los generadores no sobrescriben salidas.

Root debe revisar el draft, generar su forward y aplicar/ensayar con auditoría
completa en staging antes de publicar Preview. **CeroDDL/DMLremotos por este
frente**. Ningún porcentaje global o100%activo se deduce de esta conservación.

Cierre local: build optimizado PASS, con `/migracion/retenidos` compilada como
ruta dinámica; tipos y lint PASS. La primera compilación no pudo obtener fuentes
de Google dentro del sandbox; la repetición autorizada con red completó el build.
No es aceptación visual/autenticada de Preview, que corresponde al coordinador.
Consulta final de sólolectura23oct02:18UTC:0filas de barcode ya existentes para
estos435códigos, sin asociarlos a variantes del programa.
