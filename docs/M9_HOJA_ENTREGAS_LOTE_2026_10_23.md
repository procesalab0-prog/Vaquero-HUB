# M9: hoja documental por lote de entregas

Fecha: 23 de octubre de 2026. Alcance: Preview de staging, preparación de la aceptación de La Piedad del 2 de noviembre.

## Hueco y cambio

La pantalla existente mostraba cada expediente como una tarjeta larga. Revisar una tanda exigía recorrer todos los productos y controles para comparar folios. Se conserva `/migracion/entregas`, su consulta paginada de ocho documentos, sus filtros ejecutados en servidor y su escritor actual. La misma información ahora se presenta en una hoja con tres columnas: procedencia/productos, estado y límites, y una declaración por folio.

Los renglones y referencias se amplían por documento. Cada fila monta un solo formulario y conserva su revisión, huella, documento y dos identificadores de solicitud independientes. El selector compacto comienza vacío; confirmar exige escoger una respuesta y marcar la confirmación. No hay guardado masivo ni respuestas predeterminadas. En pantallas estrechas, cada fila se apila y sus controles conservan el ancho disponible.

## Límites conservados

- La fuente histórica conserva UNKNOWN. Una declaración documental, incluso «todo entregado», no es observación física ni autorización para entregar o mover inventario.
- La hoja cuenta renglones, nunca suma sus cantidades para producir piezas comprometidas. Los conceptos genéricos conservan su tratamiento especial; no se convierten en mercancía.
- Sólo una declaración concreta vigente y de un documento sin conceptos genéricos se presenta como concreta. Las observaciones parciales, desconocidas, revocadas u obsoletas siguen requiriendo revisión.
- La aptitud para abrir saldo aparece como **no evaluada en esta hoja**. No se infiere deuda, pago, liquidación, reserva, entrega o descuento a partir de estas respuestas.
- Los vínculos documentales adicionales mantienen su identidad y procedencia separadas del archivo original; identificar una variante no prueba entrega.
- Se conservan el control de staging, ADMIN y `customers.manage`, el único RPC de lectura y la Server Action existente. No hay DDL, nuevos permisos, nuevas tablas, cambios en escritores ni movimientos operativos.

## Verificación

69 pruebas en cuatro suites: hoja derivada, captura, página y frontera servidor/cliente. Incluyen estados obsoletos/revocados, cantidades genéricas, identidades distintas, ocho documentos con dieciséis nonces únicos y una sola consulta, selector sin respuesta inicial, confirmación requerida y conservación del contexto. ESLint, TypeScript y `git diff --check` correctos.

Las pruebas son locales con datos sintéticos y renderizado de componentes; no representan aceptación con Auth/PostgREST ni revisión visual en navegador. No se consultó ni escribió staging o producción. La verificación visual y funcional con sesión real corresponde al integrador, después de publicar Preview. No se capturaron respuestas humanas ni se modificó la retención de ningún expediente.
