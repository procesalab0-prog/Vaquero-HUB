# Decisiones de los dueños — 5 de octubre de 2026

Fuente: respuestas numeradas del usuario en este chat. Son confirmaciones de negocio, no evidencia de una nueva exportación ni autorización para escribir en producción. Complementan los registros anteriores; no cambian sus evidencias históricas.

| Caso | Decisión confirmada | Verificación o trabajo pendiente |
| --- | --- | --- |
| 1. Tombstone 30X Randa 1132, Woo 19746 | La talla 60 existe en el modelo, pero nunca llegó mercancía. La web muestra todas las tallas del modelo. | No crear variante física, código de barras ni existencias para la talla 60 a partir de esa opción web. La variante Woo 19816 sigue sin correspondencia SICAR confirmada. Se resuelve la explicación comercial; conservar la exclusión de la migración física hasta contar con una Clave 1 real. |
| 2. Nokota Lincoln Black Cherry, Woo 24939 | Todas las tallas pertenecen a CABALLERO. El dueño informa que ya corrigió el origen. | Comparar nueva exportación SICAR, especialmente Clave 1 `11201` (29) y `3280` (27), que antes figuraban en DAMA. No presentar la corrección como verificada ni cambiar la regla general de departamentos por variante para otras familias. |
| 3. West Point 8X Johnson Malboro beige, Woo 13560 | La descripción de la piedra roja corresponde al modelo y está aprobada. | Cerrada la duda del texto. Mantener las demás validaciones del lote antes de cualquier publicación. |
| 4. Amartigones, Woo 37102 | Se distinguen por talla; el color depende de disponibilidad. La ficha debe explicar que pueden cambiar de color y que se contacte a la tienda para un color específico. El usuario solicita exhibición sin compra. | Implementar y probar modo de exhibición: ficha visible, compra bloqueada también en servidor/carrito/checkout, no sólo ocultar el botón. Verificar tallas y códigos en fuente fresca; la representación histórica simple/Única no confirma el desglose solicitado. No inventar variantes por color ni repartir existencias. Mantener fuera del lote vendible hasta verificar este comportamiento. |
| 5. Etiqueta y lector | Ya confirmado previamente por el usuario: el lector localizó el sombrero talla 59 a $2,190, código `2396`. | No requiere repetir la pregunta. Esa prueba física está cerrada; no demuestra por sí sola el funcionamiento de todas las etiquetas. |
| 6. Cintos, Clave 1 `18057` y `18058` | El dueño informa que ya corrigió los dos productos: corresponden a tallas 40 y 42. | Obtener la exportación corregida para identificar cuál código corresponde a cada talla. La respuesta no especifica esa asignación. Conservar ambos códigos literalmente y no deducir el orden. |

## Siguiente corte reproducible

Usar una nueva exportación SICAR con el procedimiento existente de recepción y comparación contra `Plantilla_Productos (5).xlsx`. Revisar los cambios de departamento y talla con sus códigos originales. Las respuestas no sustituyen el archivo actualizado. Los casos que sigan sin correspondencia permanecen en revisión manual.

## Alcance de este registro

Sólo documentación local. Sin cambios de catálogo en staging, SICAR o WooCommerce; sin importación de existencias, publicación ni despliegue. El modo de exhibición del caso 4 es un requisito registrado, todavía no una funcionalidad implementada o validada por este cambio. Versión publicada: 0.67.0. No se incrementa el porcentaje por recibir respuestas; el cierre depende de comprobar los datos y el comportamiento pendiente.
