# M9 · Búsqueda y resumen de todo el catálogo de inventario

## Alcance

Emmanuel autorizó un bloque amplio de búsqueda e inventario en Preview, sin
tocar producción. La migración nueva sólo crea consultas; no importa saldos,
modifica catálogo, libera pendientes ni escribe en WooCommerce.

## Problema y resultado implementado

Inventario descargaba las primeras 500 variantes y luego filtraba ese arreglo
en el navegador. Un código SICAR válido situado después del recorte no podía
encontrarse; un fragmento del SKU de otra fila podía aparecer en su lugar.
Inicio calculaba agotados y bajo inventario sobre el mismo recorte.

Ahora Inventario e Inicio usan la consulta completa de la base de datos. La
tabla recibe páginas de 50 variantes; total de coincidencias y páginas se
calculan antes del límite. Los totales generales siempre abarcan todo el
catálogo de la sucursal, independientemente de búsqueda, filtro o página.
Piezas, pares y otras unidades se presentan por separado. Las variantes que
aún no tienen una fila de saldo contribuyen cero, como en la consulta anterior.
Se conserva el alcance de catálogo que incluye variantes inactivas.

La búsqueda incluye nombre, marca, SKU, códigos de barras, código legado y
atributos como talla y color. Enter o «Código exacto» compara el código completo
como texto, sin convertirlo a número. En búsqueda por texto se prioriza una
coincidencia exacta de código sobre fragmentos de otros SKU. `%`, `_`, barras y
comillas son texto literal, no comodines ni SQL. Se permiten 120 caracteres.
El código mostrado prefiere Clave 1 de SICAR, aunque también haya un código
generado o un alias. No se modifica ninguno de esos identificadores.

«Disponible» incluye toda cantidad positiva, también una unidad; «1 unidad o
menos» sigue siendo el subconjunto positivo hasta una. Agotado es disponible
menor o igual a cero, conservando las reservas. La interfaz descarta respuestas
de una búsqueda anterior, muestra espera/error y ofrece reintentar.

Los selectores de conteo y nueva solicitud de traspaso consultan el catálogo
por separado: el contenido de una página de la tabla no limita sus búsquedas.
Los renglones elegidos para un traspaso se conservan al cambiar de búsqueda o
página. En conteos se distingue «página capturada» de contar todo el catálogo;
Enter en la búsqueda localiza un código, no guarda una cantidad para la
selección anterior. No se cambia el motor de ajustes, reservas o traspasos.

## Seguridad y migración

`20261019223019_inventory_catalog_pagination.sql` crea la función privada
`app.inventory_catalog` con identidad, permiso `inventory.read`, acceso a la
sucursal y ubicación activa distinta de TRANSIT. El envoltorio público
`get_inventory_catalog` es invoker. Sólo authenticated puede ejecutarlos;
anon y service_role no reciben acceso. No se amplían permisos de tablas.
La respuesta no incluye costos. Límites: página 1–1000000, tamaño 1–100; se
ajusta una página fuera del final al último resultado disponible.

El cálculo y la página se obtienen en una sola sentencia con la misma imagen
de datos. Las variantes sin movimientos se incluyen mediante LEFT JOIN; no se
necesitan filas de inventario inventadas para poder verlas. Se enriquecen
atributos y código visible sólo para las filas de la página.

## Verificación local y staging

PASS: 167 migraciones y regresiones operativas monetarias, de permisos y
concurrencia; 722 unitarias en 100 archivos; TypeScript y ESLint dirigido.

El ensayo local agrega 610 variantes sintéticas dentro de una transacción y
recorre siete páginas de 100 sin omisiones ni duplicados. Verifica la última
página, código con ceros iniciales, SKU, atributos con acentos, caracteres
literales, filtros de una unidad y agotado, reservas reales creadas con el motor
de apartados, unidades separadas, aislamiento de sucursal, límites y rechazo
sin identidad. Todo termina en rollback, sin relajar restricciones de identidad
ni del libro. Auth/Storage locales son fixtures.

En staging: 15,877 variantes operativas (15,876 gestionadas por M9), 318 páginas
de 50; la última contiene 27. Código 2396 encuentra exactamente SOMBRERO
TOMBSTONE 30X RANDA 1132, talla 59. Respuesta SQL medida: primera página 82.64 ms,
exacta 45.70 ms y última 101.50 ms en esta corrida; no es una promesa de tiempo
de carga del navegador. Los asesores mantienen los 64 INFO y 132 WARN previos,
sin nuevos privilegios. [Referencia de asesores](https://supabase.com/docs/guides/database/database-advisors).

El código 000007779 sigue conservado como texto en el catálogo pendiente;
todavía no es una variante cargada ni un código aprobado. El ensayo comprueba
que la búsqueda exacta conserva ese texto y no inventa una variante o saldo.
La coincidencia de una variante cargada con ceros iniciales se verificó en el
fixture local, no con un producto real nuevo en staging. Los 434 códigos
retenidos siguen fuera del inventario operativo. Para usuarios con permiso
de productos, Preview ofrece consultar el código en el catálogo pendiente.

La comparación de huellas antes/después conserva catálogo, códigos, ventas,
devoluciones, caja, saldos, movimientos, autorizaciones y controles M9.
Las cantidades de staging continúan en cero tras el cierre del ensayo previo.

## Publicación

Commit local c4f1c86; árbol 166e2a15be4b15919e98061dae391b6528fd5ee7.
Commit remoto Preview e76948c27522888a90f624c13c577ae253e1a50c, mismo árbol,
con comparación del padre esperado. No se actualiza main ni se usa force push.
Despliegue dpl_56cbRzW1sFnidr4iCf89L1wMeLwz READY, sólo Preview.
Aceptación con sesión real ADMIN0 y PostgREST: resumen 15,877, páginas 1 y 2 de
318, código exacto 2396/talla 59; texto TOMBSTONE devuelve 364 coincidencias en
ocho páginas. Disponible devuelve cero y conserva el resumen global, coherente
con el cierre anterior sin saldo sintético. Cambiar rápidamente de búsqueda no
muestra el resultado anterior. 000007779 abre su registro pendiente por código
literal, con «No habilitado para venta». El total bruto de esa pantalla es 437
registros por revisar; no equivale a los 434 códigos retenidos de la cohorte
16,310 usada para medir cobertura.

Inicio muestra los mismos 15,877 agotados y cero con hasta dos disponibles.
Traspasos abre su selector independiente, cero disponibles y envío desactivado;
Conteos indica que no hay conteos. No se inició un conteo ni se solicitó un
traspaso. La selección positiva con saldo y conservación entre páginas queda
cubierta por implementación/ensayo local; no se declara probada con mercancía
real en el navegador de staging. Pantalla de teléfono de 393×852 sin desborde
horizontal del documento; resultado y paginación inferior accesibles sobre el
menú. Se restauró el tamaño normal. Consola sin errores en esta aceptación.

Evidencia local: outputs/m9-inventario-completo-2026-10-19/, fuera de GitHub.
Esto aumenta la cobertura funcional; no cambia la cobertura SICAR de
15,876/16,310 (97.3391%) ni autoriza el corte productivo o inventario real.

## Reversión y límites del cierre

La consulta es de sólo lectura y no necesita reversión de datos. Ante una
regresión se puede devolver únicamente Preview al código anterior 3396cb2; la
función nueva es aditiva e independiente del código anterior. No retirar una
función que todavía usa el despliegue activo. El rollback del fixture SQL
conservó los datos previos y la comparación de 18 tablas de staging permaneció
idéntica antes/después, también tras la aceptación del navegador.

No se prueba ni habilita publicación masiva en Woo, importación de existencias,
corte productivo o archivo de productos. Siguen pendientes fuentes actualizadas
y validación de saldos reales para el arranque.
