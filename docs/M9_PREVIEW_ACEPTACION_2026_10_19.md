# M9 · Preview publicado y aceptación desde el programa · 19 de octubre

## Alcance autorizado

Emmanuel pidió publicar el ajuste en Preview y avanzar con las pruebas desde
el programa, sin tocar producción. Se mantuvo la rama codex/m9-staging-review,
el proyecto Vercel vaquero-hub del equipo procesa-lab y Supabase staging
zsezjtswqeijboezvado. Se verificó la URL pública efectiva con la CLI oficial.
No se cambiaron main, configuración productiva ni WooCommerce real o de prueba.

El conector Vercel no encontró el proyecto; la CLI oficial sí lo confirmó.
Git no tenía credenciales de envío. El conector GitHub publicó los árboles
exactos de los commits locales, con padre en la rama remota y comparación
contra su SHA esperado; no hubo force push ni sobrescritura de otras ramas.

## Publicación y prueba real de extremo a extremo

Preview: https://vaquero-hub-git-codex-m9-staging-review-procesa-lab.vercel.app

- 4e1fde452ab2bf4de8040b5d9f868e6336af230f publicó catálogo provisional,
  migraciones y manejo de costo desconocido ya ensayados.
- 9721dcb2e9a8ec40cb00f5c663baf13cde0be674 corrigió legibilidad y columnas de
  Reportes. Despliegue dpl_8DeL6SBL9zswzvok63y2xVtTzYf7, READY/Preview.

Con la sesión real abierta en el programa se probó:

1. Código 1180: rechazado por revisión pendiente, sin agregarlo al carrito.
2. Código 2396: agregó SOMBRERO TOMBSTONE 30X RANDA 1132, talla 59, $2,190.
3. Cobro exacto en efectivo: guardó LAP-V-000001 y generó su ticket.
4. La lectura independiente de staging confirmó una sola venta y un renglón,
   costo NULL, importe 219000 centavos y salida de una pieza.
5. Cancelación desde la pantalla con motivo QA y UUID del ensayo: devolvió la
   pieza y el efectivo a la misma caja. La auditoría confirmó status CANCELLED.
6. Reportes mostró costo «Sin definir», valuación «Incompleto» y subtotal conocido
   separado mientras hubo dos piezas sintéticas, sin presentar su precio como costo.
7. Después del cierre, el escaneo 2396 fue rechazado por revisión vencida.

Esto sí recorrió navegador → acción Next.js → Auth/PostgREST real → funciones
SQL → respuesta y ticket. No se sustituyeron respuestas ni se inyectó un éxito.
No hubo lector físico nuevo, impresión física ni devolución por interfaz; esas
comprobaciones no se declaran cubiertas por esta aceptación.

## Fallos encontrados en la pantalla y correcciones

El texto «Incompleto» se recortaba porque los textos adicionales podían ocupar
la columna del icono. Se fijó la columna de texto de las tarjetas y el tamaño
del estado. Se comprobó que su ancho de contenido no excede el ancho visible.

La tabla llamaba Departamento a una celda de categoría. Ahora muestra ambas
columnas separadas y toma department_name para Departamento.

El filtro UNISEX aún ocultaba el sombrero: el padre tenía departamento NULL y
la variante M9 conservaba UNISEX. La migración nueva
20261019171727_m9_report_department_fallback.sql permite a ambos reportes leer
el departamento literal reconciliado cuando falta en el padre. Una asignación
explícita en el padre mantiene prioridad. La lista de filtros usa los mismos
valores efectivos. No se deduce de nombres/categorías ni se actualiza catálogo.
La auditoría antes/después conservó hashes de variantes, padres, ventas, caja
e inventario. Se verificó la combinación UNISEX + SOMBRERO TOMBSTONE por UI.

Prueba local: 165 migraciones, regresiones monetarias y de concurrencia,
18 controles de agrupación y caso de departamento literal en ventas/inventario,
lista de clasificaciones y prioridad de una asignación explícita; con rollback.
El primer caso local omitió autorizar el código sintético y fue rechazado por
M9_VARIANT_PENDING_REVIEW; se corrigió el fixture sin desactivar la compuerta.

## Estado final del ensayo

Run QA: 2a1fb4e0-eb35-435d-a283-a454f1737f38.
Se ensayó primero la preparación con rollback, después se habilitó únicamente
2396 durante una ventana limitada; nunca toda la lista de 7,776 códigos.

Al cierre:

- Catálogo y padres idénticos. Continúan 15,876/16,310 códigos cargados (97.3391%).
- Caja neta cero, inventario físico/reservado cero y movimientos netos cero.
- Una venta CANCELLED, un snapshot de costo NULL y cuatro movimientos de stock
  auditados: alta sintética, venta, cancelación y retiro sintético.
- Sin ventas activas, apartados ni devoluciones nuevas. Cero agrupaciones guardadas.
- Fila original de lista autorizada restaurada exactamente. La revisión QA queda
  vencida y sin códigos coincidentes; no se desactivó el bloqueo.

A diferencia del ensayo SQL anterior, ahora el historial QA queda guardado en
staging: no se borran ventas/caja/movimientos para simular una base vacía.
Queda una fila de inventario con cantidad cero. Los ensayos antiguos que exigen
libros vacíos deben rechazar este estado; no se deben relajar ni borrar datos
para volver a ejecutarlos. Un siguiente ensayo requiere un plan con esta base.

## Verificación visual, evidencia y pendientes

Vista de computadora y teléfono de 393×852: «Incompleto» legible, filtros,
columnas separadas, costo sin definir y tabla con desplazamiento horizontal.
Página móvil sin desbordamiento horizontal: clientWidth=scrollWidth=393.
La parte inferior de la tabla se alcanzó sin quedar tapada por el menú.
Se restauró el tamaño del navegador. Consola de Venta y Reportes sin errores.
Esto es emulación de viewport, no una prueba en un teléfono físico.

Evidencia local: outputs/m9-preview-programa-2026-10-19. Incluye plan, preparación
ensayada/guardada, cierre, auditorías, capturas, consola y logs. No se publican
exportaciones ni archivos temporales de entorno en GitHub.

Asesores: los mismos 64 INFO de RLS privado, 131 advertencias existentes de
funciones definer y protección de contraseñas filtradas pendiente. No se amplió
ningún permiso. [Referencia de asesores](https://supabase.com/docs/guides/database/database-advisors).

La aceptación de cobro/cancelación de este bloque queda completada. No equivale
al corte productivo ni al cierre de toda M9. Siguen 434 códigos retenidos,
reportes SICAR de actividad pendientes, renovación de fuentes y autorización
explícita del inventario/corte real. No se prometen existencias ni sincronización
operativa con Woo real a partir de estas dos piezas sintéticas.
