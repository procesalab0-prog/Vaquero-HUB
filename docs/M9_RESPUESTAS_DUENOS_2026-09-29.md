# Respuestas de los dueños — 29 de septiembre de 2026

Reglas confirmadas para preparar la migración; no autorizan importaciones.

- Separar diseños y variantes que hoy comparten código. Mantener los códigos únicos existentes exactamente. Los códigos compartidos necesitan una transición que conserve su consulta y evite ventas ambiguas; no repartir existencias entre diseños.
- Las líneas niño/juvenil/adulto pueden tener publicaciones distintas. Conservar sus IDs y comparar atributos; no fusionar sólo por parecido del título.
- Separar búsqueda por palabras de clasificación real. “Hebilla” en una descripción de bolsa no cambia su departamento/sección. Los 14 casos de secciones distintas siguen pendientes por caso.
- D1/C1 parecen asignaciones incompletas: requieren destino confirmado, no una categoría inventada. La interpretación del dueño fue tentativa.
- Precio normal Woo igual al público general de tienda. Las promociones pueden diferir por fechas/canal. Estructura deseada: costo, mayoreo, medio mayoreo, menudeo. Correspondencia con columnas SICAR y fórmulas todavía no definida.
- MUESTRA significa exhibición. Buscar el código base debe permitir ver las variantes de la familia; no confundir código descriptivo con el código de barras Clave 1.
- Confirmadas notaciones de ropa T.M/T.S/T.XL y talla × largo. Los dígitos finales normalmente indican talla; cortes ambiguos de modelo continúan en revisión.

## Antes de implementar la separación de códigos compartidos

Propuesta pendiente: cada diseño recibe un código propio y el código antiguo permite localizar el grupo y elegir diseño. No se reemplazan los códigos únicos que ya identifican variantes. No se ha implementado ni aprobado ese flujo de selección, ni asignado nuevos códigos.

## Datos que aún faltan

1. Correspondencia de Precio1–Precio4 con menudeo, medio mayoreo y mayoreo; la jerarquía deseada no confirma qué contiene cada columna.
2. Identificación de diseños concretos bajo códigos compartidos y etiquetas disponibles para distinguirlos.
3. Destino de clasificaciones incompletas y casos de secciones realmente distintas.

No hace falta repetir las ocho preguntas. Son pendientes concretos a resolver sobre las reglas ya contestadas. Los reportes existentes corresponden a las reglas y capturas anteriores: no se han recalculado por estas respuestas. En particular, diferencias comerciales no equivalen por sí solas a errores cuando hay promociones.

Sin escrituras de catálogo, base de datos o WooCommerce; sin importación de existencias ni despliegue.
