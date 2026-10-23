# M9 · Corte y arranque · Bloque 3

22 de octubre de 2026. Continuación autorizada sólo en staging. Tres agentes
separados preparan categorías tras fotos, vínculos/entregas y evidencia de pagos.
El coordinador conserva la única escritura remota. No main ni Woo real.

Se descargó SICAR desde la sesión real: todos los departamentos y categorías,
almacén Default (La Piedad confirmado), precios con impuestos, sin paquetes.
Conservar el XLSX intacto, su fecha real y SHA. Repetir análisis y conciliación
contra el Woo anterior identificándolo como histórico, sin declararlo renovado.
Los cambios de existencia se observan; nunca se importan con el catálogo.

Para los dos códigos exactos de documentos de clientes ausentes del catálogo,
revalidar el corte nuevo y las reglas de provisionales existentes. Sólo si son
únicos, vendibles por pieza y con clasificación/precio válidos: plan de alta
independiente, Clave1 literal, costo NULL, sin atributos inferidos, sin ID Woo,
web_release=false. No usar el generador antiguo que exige libros vacíos: la
historia de ensayo existente se debe comparar, nunca borrar para satisfacerlo.
Ensayar alta/repetición con rollback, comprobar cada fila previa y la ausencia
de cambios en libros operativos. Después conservar sólo las altas revisadas.
No habilitar revisión vencida ni cobro. La vinculación documental es otro paso.

Las categorías sólo podrán revalidarse con evidencia pública nueva que coincida
exactamente con el binding, fuente, borrador, catálogo y fotos conservadas. Su
fecha no modifica Woo19. Plan, rollback y auditoría antes de conservar cambios.
Las observaciones de entregas no cambian stock ni deuda y UNKNOWN permanece tal.
El contrato de proveedor nunca convierte una firma QA en pago autenticado.

Publicar únicamente Preview después de integrar y probar los módulos. Mantener
un reporte privado reproducible, límites y pendientes concretos de arranque.

## Resultado conservado en staging

Fuente SICAR descargada de la sesión real el 22 de octubre: 16,396 códigos únicos,
SHA256 `b1e6e6700e74e73572f43ef4f63aff6eab1216bcab7df8324242a3b52388de93`.
Se conservó el archivo intacto y se repitió la conciliación: diez archivos
idénticos entre dos corridas. El Woo autenticado sigue siendo del 19 de octubre;
las siete consultas públicas de categorías tienen evidencia y fecha propias.

Frente a SICAR19: 15 códigos nuevos, ninguno ausente, 21 cambios de catálogo y
74 cambios de existencia. Un cambio aparece en ambos grupos. No se importó
ninguna existencia. El diagnóstico conserva sus errores y los casos retenidos.

Se ensayó y conservó el alta literal provisional de un código histórico ausente
y catorce de los quince nuevos: 15 altas, de 15,876 a **15,891 códigos** en staging.
Cada alta mantiene Clave1, un producto/variante, costo NULL, sin talla inferida,
sin ID Woo, sin inventario y `web_release=false`. El jabón y el nuevo accesorio
con clasificación conflictiva siguen retenidos. No se modificó ninguna fila
previa para cumplir el ensayo ni se vaciaron libros con historia.

El adaptador incremental verifica el conjunto completo de tablas ordinarias
app/public bajo barrera y cada fila anterior dentro de la misma transacción.
Alta/replay y auditoría exterior con ROLLBACK: primero 172 tablas, después 174.
En COMMIT únicamente crecen ocho tablas de registro/catálogo y seis eventos de
auditoría por código. Las secuencias pueden avanzar en un rollback; no se
rebobinan. No se promete borrar altas si ya acumularon historia operativa.

Se revalidaron siete bindings de categorías con evidencia pública nueva y
verificación exacta de fuente, borrador, catálogo, 49 evidencias y sus 49 copias.
Ensayo aplicar/replay/compensar con ROLLBACK: 174 tablas idénticas. COMMIT de siete
revisiones y replay sin duplicar, con recibo privado. Permanecen 5,984 evidencias
y 5,871 copias, sin cambios de fotos. Esto no autoriza publicar ni cobrar.

El diario privado de observaciones de entrega pasó observar/replay/anular/replay
en staging con ROLLBACK; quedó vacío. No se inventó ninguna entrega confirmada.
Hay 84 expedientes de revisión por documento, 183 líneas aún UNKNOWN y 60 cuentas;
no son 84 preguntas nuevas publicadas ni existe todavía una pantalla de captura
para este diario. El código genérico SX00000 no prueba cantidades físicas.

El plan de precios separa diez cambios sólo de precio público, uno con precios
secundarios y diez cambios de descripción/identidad. No aplica precios: retiene
el contexto Woo sin variante exacta. Es un bloqueo técnico de conciliación; no
se fabrica una aprobación de los dueños. Sus dos corridas son idénticas.

La cuarentena local de eventos sandbox verifica firmas QA y replays; no existe
un proveedor de pagos autenticado ni un receptor habilitado. Siguen cinco
ensayos conectados, worker/captura/stock/finanzas false y libro web vacío.
Una firma QA no acredita que Woo haya cobrado.
