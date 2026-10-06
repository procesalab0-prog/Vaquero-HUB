MI TIENDA SM — CONTEXTO MAESTRO DEL PROYECTO

1. Descripción general

Proyecto: Mi Tienda SM
Cliente: Vaqueros SM
Desarrollador: ProcesaLab
Ubicación actual del negocio: La Piedad, Michoacán, México.

Mi Tienda SM será un sistema propio de gestión para Vaqueros SM que sustituirá progresivamente las funciones de SICAR que actualmente utiliza el negocio.

No se busca copiar absolutamente todas las funciones existentes de SICAR. Se busca reemplazar correctamente las funciones que Vaqueros SM realmente utiliza, documentarlas y posteriormente mejorarlas.

El sistema deberá integrar en una sola plataforma:

- Punto de venta.
- Inventario.
- Productos y variantes.
- Códigos de barras.
- Compras.
- Proveedores.
- Caja.
- Devoluciones/cancelaciones.
- Apartados.
- Usuarios y permisos.
- Sucursales.
- WooCommerce.
- Reportes.
- Auditoría.
- Futuras funciones de clientes/lealtad.

El sistema debe construirse pensando en crecimiento y operación real de retail.

⸻

2. Situación actual

Vaqueros SM vende:

- Botas.
- Botines.
- Zapatos.
- Tenis.
- Pantalones.
- Camisas.
- Chamarras.
- Trajes.
- Bolsas.
- Vestidos.
- Texanas.
- Sombreros.
- Gorras.
- Cinturones.
- Artículos para caballo.
- Carteras.
- Otros productos relacionados.

Actualmente utilizan:

SICAR
para POS, inventario, códigos y operación física.

WooCommerce
para la tienda online.

La tienda WooCommerce ya contiene productos relacionados con SICAR.

Un dato MUY IMPORTANTE:

Los productos de WooCommerce utilizan los mismos códigos que SICAR.

Esto deberá aprovecharse como pieza central de la migración.

⸻

3. Problema principal

SICAR funciona actualmente, pero Vaqueros SM tiene problemas principalmente con la captura y administración de mercancía.

Ejemplo:

Una bota puede existir en:

- talla 25
- talla 25.5
- talla 26
- talla 26.5
- talla 27
- talla 27.5
- talla 28
- etc.

Actualmente la captura puede resultar lenta y repetitiva.

Mi Tienda SM deberá permitir crear:

PRODUCTO PADRE

Ejemplo:

Bota Cuadra Modelo X

y posteriormente sus VARIANTES:

- Negro / 25
- Negro / 25.5
- Negro / 26
- Negro / 26.5
- etc.

Cada variante puede tener:

- código de barras
- SKU/código
- existencia
- costo
- precio
- ubicación
- información WooCommerce

El objetivo es reducir drásticamente la captura repetitiva.

⸻

4. Volumen actual

Existe un Excel exportable desde SICAR.

Un archivo observado anteriormente contenía aproximadamente:

15,000 filas.

No asumir que 15,000 filas equivalen a 15,000 productos únicos.

Muchas pueden representar variantes de un mismo producto.

Antes de migrar deberá realizarse:

- limpieza
- normalización
- detección de duplicados
- agrupación de variantes
- validación de códigos
- detección de códigos vacíos
- espacios accidentales
- ceros iniciales
- inconsistencias

### 4.1 Primera exportación real de SICAR — 4 de septiembre de 2026

Se recibió y analizó `Plantilla_Productos.xlsx`, exportación real con una hoja,
32 columnas y **15,872 renglones de producto o variante**. Este archivo
desbloquea el análisis de M9, pero todavía no autoriza una importación directa
a producción.

División actual por departamento:

| Departamento  | Renglones |
| ------------- | --------: |
| Caballero     |     7,496 |
| Dama          |     2,896 |
| Unisex        |     2,633 |
| Niño          |     1,633 |
| Juvenil       |       499 |
| Accesorios    |       400 |
| Niña          |       157 |
| Art. caballo  |       112 |
| Art. limpieza |        39 |
| D1            |         5 |
| Bebidas       |         1 |
| Adhesivos     |         1 |

La exportación contiene **299 categorías**. Las de mayor volumen incluyen
Cintos Vaquero SM (1,381), Pantalones Wrangler (967), Botas Vaquero SM (592),
Botas Rey Welt (558), Botas Cuadra (538), Camisas Wrangler (428), Camisas
Rodeo West (425), Botas Nokota Horse (422) y Pantalones KAJM (413).

Hallazgos que M9 debe tratar como compuertas de importación:

- `clave1` está presente en todos los renglones y no tiene duplicados. Todas
  las claves son numéricas, pero una conserva ceros iniciales
  (`000007779`); por eso se importarán como texto y nunca como número.
- Falta comprobar con una etiqueta física si `clave1` es el código que lee el
  escáner o sólo la clave interna de SICAR. `clave2` está vacía en 15,503
  renglones y no puede asumirse como fuente principal.
- El negocio aclaró el 16 de septiembre de 2026 que **la talla viene al
  final de la descripción compacta**, no codificada en el código de barras. El
  ejemplo confirmado es `BTILEGALPETCA27.5`: bota/botín, Ilegal, PET,
  Caballero y talla `27.5`; además se conservan `CABALLERO` como
  departamento y `BOTINES ILEGAL` como categoría. M9 podrá proponer la talla
  a partir del sufijo numérico decimal y usar departamento/categoría como
  contexto, pero deberá validar muestras por familia y enviar excepciones a
  revisión. No asumirá que sombreros, cinturones, ropa o accesorios siguen la
  misma regla ni adivinará silenciosamente el producto padre.
- Hay 28 descripciones repetidas, equivalentes a 34 renglones adicionales.
  Una descripción repetida no prueba que sean duplicados: se debe comparar la
  clave, categoría y atributos antes de agrupar o rechazar.
- Todos los renglones usan unidad `PIEZA`, son inventariables y no son granel.
  La existencia no contiene fracciones, lo que confirma conteos enteros para
  este catálogo.
- La suma exportada es **22,598 unidades**: 8,483 renglones con existencia
  positiva, 7,334 en cero y 55 con existencia negativa. Los negativos deben
  conciliarse en SICAR o quedar como excepciones explícitas antes del corte.
- 15,043 renglones tienen costo cero y sólo 829 costo positivo. Dos tienen
  `precio1` en cero. Los costos faltantes no se sustituirán por precio ni por
  cero silencioso; requieren una fuente o decisión de negocio.
- `precio1` es el precio operativo en 15,870 renglones. `precio2`, `precio3` y
  `precio4` sólo aparecen en 33, 29 y 28; `mayoreo2`, `mayoreo3` y `mayoreo4`
  están vacíos en todo el archivo. Las escalas mayoristas requieren otra
  exportación o confirmación del negocio.
- La hoja trae una sola columna `existencia`; `localización 1`, `localización
2` y `localización 3` están vacías. El negocio confirmó el 16 de septiembre
  de 2026 que esta exportación corresponde a **una sola ubicación de origen**.
  Ese saldo sólo podrá cargarse en la ubicación confirmada durante el corte; no
  se repartirá entre sucursales presentes o futuras.
- No vienen proveedores asociados por renglón, imágenes ni identificadores de
  WooCommerce. Esos datos se obtendrán de exportaciones separadas y se unirán
  mediante identificadores verificables, nunca sólo por nombre.

Siguiente entregable de M9: mapeo de las 32 columnas a Mi Tienda SM,
clasificador de renglones importables o en conflicto y corrida en seco en
staging. La importación reportará conteos, claves y suma de existencias antes y
después; no escribirá nada si quedan errores sin clasificar.

### 4.2 Segunda exportación y prueba de cambios — 6 de septiembre de 2026

Se comparó `Plantilla_Productos (1).xlsx` contra la exportación del 4 de
septiembre usando `clave1` como identidad de comparación, sin escribir en
SICAR ni en Supabase. La segunda fotografía contiene **16,009 renglones** y
**22,985 unidades**. `clave1` continúa completa y sin duplicados.

En dos días se observaron cambios reales:

- **140 claves nuevas** y **3 ausentes** respecto de la primera exportación;
  las tres ausentes tenían existencia cero.
- **270 claves existentes cambiaron de saldo**: 108 bajaron 131 unidades y
  162 subieron 259, para un cambio neto de +128 sobre el catálogo común.
- Las claves nuevas aportaron 259 unidades; el total general pasó de 22,598 a
  22,985, una diferencia neta de **+387 unidades**.
- Entre las claves comunes también cambiaron cinco precios, un costo, una
  descripción y un departamento. El sincronizador no puede limitarse a altas
  ni a existencias.
- La segunda fotografía contiene **56 saldos negativos** y **15,177 costos en
  cero**. Son datos heredados reales que requieren conciliación o una excepción
  explícita; nunca se corregirán o inventarán silenciosamente al importar.

La comparación de fotografías detecta **qué cambió**, pero no demuestra la
causa. Una disminución puede provenir de venta, ajuste, devolución, traspaso u
otra operación de SICAR. Por ello, ningún delta entre archivos se registrará
como venta ni con un motivo inventado. Para reconstruir causas se necesitarán
los reportes de ventas o el kardex del mismo periodo.

Consecuencias obligatorias para M9:

- Conservar cada exportación con fecha y huella del archivo para que el proceso
  sea repetible y auditable.
- El modo catálogo será incremental e idempotente: distinguirá altas, cambios
  de datos o precio y claves ausentes, sin interpretar una ausencia como
  eliminación automática.
- El modo de existencias conciliará la fotografía final contra el saldo de Mi
  Tienda SM mediante movimientos explícitos de importación o conciliación;
  nunca editará directamente el saldo ni falsificará ventas históricas.
- Costos cero, saldos negativos, claves dudosas y cambios incompatibles se
  enviarán a una cola de excepciones. Un cero heredado no sobrescribirá un costo
  válido sin una regla aprobada.
- Como SICAR continúa cambiando durante la operación, habrá corridas periódicas
  de ensayo y una última exportación con la tienda cerrada. El reporte final
  deberá cuadrar conteos, claves y existencias antes de autorizar la apertura.

Con estas dos fotografías, M9 ya no está bloqueado para construir el analizador,
el mapeo de columnas y la corrida en seco. Continúan pendientes la comprobación
física de `clave1` y su simbología, la fuente que explique los movimientos y
las decisiones del negocio sobre costos cero e inventario negativo.

⸻

5. Regla crítica sobre códigos

NO cambiar códigos existentes.

Los códigos utilizados actualmente por SICAR deberán conservarse.

Además:

WooCommerce y SICAR utilizan los mismos códigos.

Por lo tanto:

Código SICAR
↕
Código Mi Tienda SM
↕
Código WooCommerce

deben representar la misma variante.

Nunca realizar matching de productos únicamente por nombre.

Debe existir una relación explícita.

Ejemplo conceptual:

internal_variant_id
legacy_sicar_code
barcodes.code (source = SICAR)
woocommerce_product_id
woocommerce_variation_id
woocommerce_sku/code

El código heredado será fundamental para realizar el matching inicial.

⸻

6. Migración SICAR

La migración NO deberá hacerse apagando SICAR inmediatamente.

Proceso esperado:

SICAR + WooCommerce actuales

↓

Exportación SICAR

↓

Auditoría y limpieza

↓

Importación Mi Tienda SM

↓

Matching WooCommerce

↓

Validación

↓

Operación paralela

↓

Reconciliación

↓

Migración definitiva

↓

Retiro progresivo de SICAR

Durante las pruebas SICAR continuará funcionando.

⸻

7. Prueba paralela

Antes de sustituir SICAR, Mi Tienda SM deberá probarse en una tienda real.

Durante la prueba:

Una venta real puede registrarse tanto en SICAR como en Mi Tienda SM únicamente con fines de comparación.

NO significa cobrar dos veces.

Al final del turno se deberán comparar:

- ventas
- productos
- cantidades
- inventario
- efectivo
- tarjetas
- transferencias
- devoluciones
- cancelaciones
- cortes

El objetivo es demostrar que ambos sistemas producen resultados equivalentes.

⸻

8. WooCommerce

WooCommerce deberá integrarse directamente con Mi Tienda SM.

La página actual puede continuar funcionando.

Mi Tienda SM deberá comunicarse con WooCommerce mediante API y webhooks.

El objetivo final es que Mi Tienda SM sea la fuente principal de verdad para inventario y operación.

WooCommerce será un canal de venta.

Conceptualmente:

TIENDA FÍSICA
↓
MI TIENDA SM
↓
INVENTARIO CENTRAL
↑
WOOCOMMERCE

⸻

9. Alta automática en WooCommerce

Cuando se cree un producto nuevo en Mi Tienda SM deberá existir una opción como:

[✓] Publicar también en tienda online

El sistema podrá:

1. Crear producto en Mi Tienda SM.
2. Crear variantes.
3. Generar/asignar códigos.
4. Crear inventario.
5. Crear producto en WooCommerce.
6. Crear variaciones.
7. Asignar SKU/código.
8. Asignar precios.
9. Asignar stock.
10. Guardar IDs devueltos por WooCommerce.

Inicialmente es preferible permitir:

Crear como borrador en WooCommerce

en lugar de publicar automáticamente.

De esta manera puede revisarse:

- fotografías
- descripción
- SEO
- presentación
- contenido comercial

antes de publicar.

Posteriormente se puede permitir publicación automática.

⸻

10. Sincronización de inventario

Una venta en cualquier canal debe terminar reflejándose en el inventario central.

Ejemplo:

Stock:

Bota X talla 27 = 3

Se vende una en POS.

Mi Tienda SM:

3 → 2

Después:

WooCommerce:

3 → 2

Si ocurre una venta online:

WooCommerce
↓
Webhook
↓
Mi Tienda SM
↓
Movimiento de inventario
↓
Stock actualizado

Los eventos externos deberán ser IDEMPOTENTES.

Un webhook repetido NO puede descontar inventario dos veces.

⸻

11. Inventario

NO implementar inventario simplemente como:

stock = stock - 1

Toda modificación deberá generar un movimiento auditable.

Ejemplo:

inventory_movements

Campos conceptuales:

id
variant_id
location_id
movement_type
quantity
previous_stock
new_stock
reference_type
reference_id
user_id
timestamp
metadata

Tipos posibles:

INITIAL_IMPORT
SALE
RETURN
PURCHASE
TRANSFER_OUT
TRANSFER_IN
ADJUSTMENT
CANCELLATION

Nunca borrar movimientos históricos para corregir inventario.

Utilizar movimientos compensatorios/reversiones.

⸻

12. Inventario por ubicación

El inventario deberá diseñarse por ubicación desde V1.

Actualmente existe una sucursal.

Sin embargo:

- segunda sucursal esperada en próximos meses
- tercera sucursal aproximadamente dentro de un año

Por lo tanto NO utilizar simplemente:

products.stock

Diseñar:

locations
inventory_by_location
inventory_movements

Esto permitirá posteriormente:

Sucursal 1
Sucursal 2
Sucursal 3
Bodega
En tránsito

⸻

13. Transferencias entre sucursales

Preparar arquitectura para transferencias.

Estados posibles:

REQUESTED
APPROVED
PREPARED
IN_TRANSIT
RECEIVED
CANCELLED

Solicitud de mercancía entre tiendas:

- Desde su sucursal, un empleado autorizado podrá buscar o escanear un
  producto/variante, consultar qué otras tiendas tienen existencia disponible
  y solicitar una cantidad a una tienda origen específica.
- La solicitud conservará tienda solicitante/destino, tienda origen,
  producto, variante, cantidad, prioridad o nota operativa, solicitante y
  fecha/hora.
- La tienda origen tendrá una bandeja de solicitudes pendientes y podrá
  aprobar la cantidad completa, aprobar parcialmente o rechazar con motivo.
  La tienda solicitante podrá consultar el estado y la respuesta sin llamar
  para confirmar manualmente.
- Una solicitud en estado `REQUESTED` no mueve ni promete inventario por sí
  sola. Antes de aprobar y nuevamente antes de enviar se validarán existencia,
  permisos y estado vigente; el movimiento físico continuará usando el flujo
  `APPROVED → PREPARED → IN_TRANSIT → RECEIVED`.
- El sistema notificará dentro de Mi Tienda SM a la tienda origen cuando llegue
  una solicitud y a la tienda solicitante cuando cambie de estado. Una falla de
  notificación no deberá cambiar ni duplicar el traspaso.
- Solicitar, aprobar, rechazar, preparar, enviar, recibir o cancelar dejará
  auditoría con actor, sucursal, fecha, cantidades y motivo. RLS impedirá que
  una tienda actúe sobre solicitudes ajenas a su origen o destino.
- Los permisos para solicitar y aprobar serán distintos. La asignación exacta
  por rol se confirmará con Vaqueros SM; la interfaz nunca sustituirá la
  validación del servidor.

Una mercancía en tránsito NO deberá aparecer simultáneamente como disponible en origen y destino.

⸻

14. Punto de venta

Mi Tienda SM deberá incluir POS.

Funciones esperadas:

- escaneo de código
- búsqueda manual
- carrito
- cantidades
- descuentos autorizados
- promociones futuras
- efectivo
- tarjeta
- transferencia
- pagos externos
- impresión de ticket
- devolución
- cancelación
- apartados
- apertura de caja
- cierre de caja
- cortes
- movimientos de caja
- ventas/tickets en espera para suspender un carrito y cobrar otro

Operación rápida del POS:

- Deberán existir atajos de teclado para abrir las funciones frecuentes,
  como Ventas, Productos, Consultas y Clientes, además de acciones comunes
  dentro del cobro cuando no entren en conflicto con la captura activa.
- Los atajos serán visibles, configurables cuando corresponda y nunca
  deberán omitir permisos, confirmaciones críticas ni validaciones del servidor.
- Un ticket en espera deberá conservar artículos, cantidades, cliente y
  empleado que lo dejó, y podrá recuperarse sin bloquear la caja para cobrar
  otra venta.
- El carrito en curso se guardará automáticamente cuando el empleado cambie
  de módulo o ventana dentro de Mi Tienda SM y se restaurará al volver al POS,
  sin obligarlo a convertirlo manualmente en ticket en espera.
- El carrito guardado quedará aislado por empleado, caja y sesión activa; no
  deberá aparecer a otro usuario ni sobrevivir indebidamente al cierre de caja
  o de sesión. Una venta completada lo eliminará para evitar cobros repetidos.
- Poner un ticket en espera no equivale a cobrarlo: no moverá caja ni
  inventario definitivo. Al recuperarlo, el sistema deberá volver a validar
  precios, disponibilidad y permisos antes del cobro.

Entrega digital de tickets:

- Al terminar una venta, el empleado podrá imprimir el ticket, abrir su vista
  real o descargar un PDF de 80 mm equivalente al comprobante impreso.
- En teléfono y iPad el PDF se compartirá después desde Archivos, Descargas o
  la aplicación elegida por la persona. Mi Tienda SM no abrirá una conversación
  ni enviará datos a WhatsApp por sí sola en la primera versión.
- El envío automático por SMS o correo será opcional y quedará desacoplado mediante un proveedor externo por definir.
- No habrá enlaces públicos de ticket en la primera versión. El PDF se genera
  localmente y el sistema no guarda una copia pública ni el destinatario.
- El ticket de regalo tendrá su propio PDF y seguirá ocultando precios, totales
  y formas de pago.
- Si la venta está ligada a un cliente con cuenta, aparecerá automáticamente en
  su historial autenticado de Mi Vaquero y podrá descargarla desde ahí.
- Una falla de WhatsApp, del menú Compartir, de SMS o de correo nunca deberá cancelar, duplicar ni revertir una venta ya cobrada.
- El envío transaccional del comprobante y el consentimiento para promociones se tratarán como decisiones distintas. Compartir un ticket no habilita marketing.
- Las descargas iniciadas por empleados dejarán auditoría mínima de canal,
  estado, actor y fecha, sin copiar teléfonos, correos, destinatarios ni el
  contenido completo del ticket a los logs.
- Cuando una venta se pague con varios métodos, el ticket impreso y digital
  mostrará cada método y el importe aplicado por separado; en pagos
  electrónicos también conservará su referencia según los permisos definidos.

⸻

15. iPad como POS

El cliente puede operar principalmente desde iPads.

Por ello Mi Tienda SM deberá diseñarse touch-first y funcionar correctamente en Safari/iPadOS.

Preferentemente como:

Web App / PWA

El usuario podrá instalarla en pantalla de inicio.

Experiencia deseada:

MI TIENDA SM

↓

Login empleado

↓

Abrir caja

↓

POS

No diseñar una interfaz desktop y simplemente hacerla responsive.

Diseñar específicamente para interacción táctil.

Considerar:

- botones grandes
- carrito visible
- búsqueda rápida
- teclado numérico
- pocos pasos para cobrar
- buena operación horizontal y vertical
- estados claros
- prevención de doble toque/doble cobro

Captura repetitiva y cantidades:

- Las existencias, conteos, ajustes y movimientos de mercancía que se vende
  por pieza deberán capturarse como **enteros**. Las flechas de un campo
  numérico aumentarán o disminuirán de uno en uno; no usarán pasos como
  `0.001`. Sólo una unidad de medida configurada expresamente para venta
  fraccionada podrá aceptar decimales.
- Un conteo físico deberá favorecer el recorrido continuo: escanear o elegir
  una variante, escribir la cantidad, confirmar con teclado y avanzar al
  siguiente renglón sin abrir y cerrar formularios por cada producto.
- Cuando una operación segura se repita sobre varios elementos —por ejemplo
  elegir tallas y colores, contar variantes, imprimir etiquetas o actualizar
  datos comunes— la interfaz ofrecerá selección múltiple, matriz, captura en
  tabla, pegado desde una lista o acciones en lote según corresponda.
- Los valores compartidos se capturarán una sola vez y se heredarán a las
  variantes seleccionadas, permitiendo corregir excepciones antes de guardar.
  Las acciones masivas mostrarán un resumen previo y conservarán permisos,
  validaciones y auditoría; rapidez no significa saltarse controles.
- El alta de producto conservará la selección múltiple de tallas y colores y
  la matriz editable ya definida. No deberá obligar a crear cada combinación
  individualmente ni repetir costo, precio u otros datos idénticos.
- Tallas y colores se presentarán como una **lista o tabla continua**, visible
  de una sola vez siempre que el tamaño de pantalla lo permita. El empleado
  podrá marcar varias opciones de corrido, seleccionar o limpiar un rango y
  recorrer la matriz con teclado o toque sin abrir un selector independiente
  por cada talla o color.

Ergonomía como compuerta de calidad:

- La ergonomía es uno de los criterios principales del proyecto, al mismo
  nivel operativo que seguridad, integridad de inventario y exactitud de caja.
  No se tratará como decoración ni como una limpieza para el final.
- A partir de M5, cada módulo operativo deberá pasar una revisión ergonómica
  antes de darse por cerrado. Se medirán pasos, toques, tiempo, capturas
  repetidas, cambios de contexto, errores evitables y claridad del lenguaje.
- La revisión se ejecutará al menos en teléfono vertical, iPad horizontal y
  computadora con teclado. Incluirá los recorridos frecuentes completos, no
  sólo la apariencia aislada de cada pantalla.
- La primera auditoría ergonómica formal se hará inmediatamente después de la
  interfaz de cambios de M5 y antes de acumular los siguientes módulos. Tendrá
  como focos iniciales el alta continua de tallas y colores, conteos rápidos,
  traspasos, venta, tickets en espera y acciones en lote.
- Los hallazgos se registrarán en la cola con evidencia y prioridad. Un flujo
  frecuente que obligue a repetir capturas, esconda acciones necesarias o no
  pueda completarse correctamente en un dispositivo objetivo bloqueará el
  cierre de la entrega correspondiente.
- La auditoría se repetirá antes del piloto y durante éste con empleados
  reales. Lo observado en operación manda sobre suposiciones del equipo.

Apariencia y modo nocturno:

- La interfaz ofrecerá los modos **Claro**, **Oscuro** y **Automático**, con
  un control accesible desde los ajustes y un cambio rápido desde la sesión.
- En Automático podrá seguir la preferencia de apariencia del dispositivo o
  un horario configurable de inicio y fin, usando la hora local de la sucursal.
- La preferencia se conservará por usuario y dispositivo; el cambio de tema no
  deberá cerrar modales, borrar capturas ni perder el carrito en curso.
- Ambos temas mantendrán contraste accesible, estados distinguibles mediante
  texto o iconos y los colores semánticos definidos para confirmación, alerta y
  acciones destructivas. El sistema evitará mostrar primero un destello del
  tema incorrecto al abrir la PWA.
- Tickets térmicos, etiquetas y documentos impresos conservarán su plantilla
  clara de alto contraste, independientemente del tema usado en pantalla.

⸻

16. Hardware POS

Hardware potencial:

- iPad
- soporte para iPad
- lector de códigos Bluetooth
- impresora térmica compatible
- cajón de dinero
- impresora de etiquetas
- conexión estable
- respaldo 4G/5G
- UPS/no-break cuando aplique

Para checkout se prefiere lector físico sobre cámara.

La cámara del iPad puede utilizarse para:

- inventario
- consulta
- recepción
- conteos

El lector Bluetooth deberá poder enviar códigos al sistema como entrada tipo teclado cuando el hardware lo permita.

⸻

17. Compatibilidad con códigos actuales

Durante el piloto:

MISMO CÓDIGO FÍSICO

debe poder funcionar tanto en:

SICAR

como en:

Mi Tienda SM.

NO imprimir doble código para mantener ambos sistemas.

⸻

18. Productos nuevos

Para productos nuevos Mi Tienda SM podrá:

- generar código
- generar SKU
- crear variantes
- generar etiquetas
- imprimir etiquetas
- registrar inventario
- opcionalmente crear producto WooCommerce

Diseñar una experiencia especialmente rápida para mercancía con tallas.

- El alta deberá presentar tallas y variantes como una lista continua de
  selección múltiple, para marcar varias de corrido sin cerrar ventanas ni
  repetir los datos generales del producto.
- Para usuarios autorizados, cada producto/variante mostrará costo, precio de
  menudeo y los niveles de mayoreo **Precio 1, Precio 2 y Precio 3**. El costo
  seguirá oculto para roles sin permiso.
- Antes de activar los niveles de mayoreo en una venta deberá definirse quién
  puede usarlos, cómo se asignan a clientes y si dependen de cantidad; el
  sistema no inventará esas reglas de negocio.

Ejemplo:

Crear producto:

Bota X

Seleccionar:

☑ 25
☑ 25.5
☑ 26
☑ 26.5
☑ 27
☑ 27.5
☑ 28

y generar variantes automáticamente.

⸻

19. Compras y proveedores

Mi Tienda SM deberá contemplar:

SUPPLIERS

PURCHASES

PURCHASE_ITEMS

RECEIVING

Flujo esperado:

Crear compra

↓

Proveedor

↓

Productos/cantidades

↓

Recibir mercancía

↓

Detectar diferencias

↓

Crear movimientos de inventario

↓

Generar/imprimir etiquetas

No incrementar stock hasta registrar correctamente la recepción.

⸻

20. Apartados

Las reglas confirmadas, controles de concurrencia y decisiones todavía abiertas
viven en [`specs/M7_APARTADOS.md`](specs/M7_APARTADOS.md). Esa especificación es
la fuente de verdad para implementar M7.

Los apartados contemplan:

layaways
layaway_items
payments
balance_remaining
status

Estados conceptuales:

OPEN
PARTIALLY_PAID
PAID
COMPLETED
CANCELLED

El vencimiento no cancela el apartado: sólo produce avisos amarillo y rojo. Un
usuario con permiso decide si lo cancela. No asumir las reglas que la
especificación todavía marca como pendientes.

⸻

21. Devoluciones y cancelaciones

Toda devolución/cancelación deberá:

- conservar venta original
- generar referencia
- generar movimiento inverso cuando corresponda
- conservar usuario
- conservar fecha
- conservar motivo
- mantener auditoría

En un ticket con varios artículos se podrá seleccionar un solo renglón —o una
cantidad menor de ese renglón— para devolverlo. La venta original permanecerá
intacta y la devolución parcial se registrará como un documento relacionado,
con su movimiento de inventario y dinero correspondiente. La cancelación total
de la venta seguirá siendo una operación distinta y controlada.

Nunca eliminar una venta histórica para simular una cancelación.

⸻

22. Caja

Diseñar:

cash_registers
cash_sessions
cash_movements
sales
payments

Una sesión de caja deberá tener:

opening_amount
expected_amount
actual_amount
difference
opened_by
closed_by
opened_at
closed_at

La caja deberá permitir configurar por sucursal o caja un límite operativo de
efectivo. Al acercarse o llegar al límite mostrará un aviso claro para realizar
un corte o retiro preventivo autorizado. El umbral no estará fijo en el código;
el aviso, el retiro y el corte conservarán actor, fecha, caja e importes en la
auditoría. La respuesta operativa exacta —corte completo o retiro parcial— se
confirmará con Vaqueros SM antes de hacerla obligatoria.

⸻

23. Usuarios y permisos

No todos los empleados deberán poder hacer todo.

Roles iniciales posibles:

ADMIN
MANAGER
CASHIER
WAREHOUSE

Permisos específicos deberán poder controlar:

- descuentos
- cancelaciones
- devoluciones
- ajustes de inventario
- cambios de precio
- reportes
- compras
- transferencias
- usuarios

Implementar correctamente RLS en Supabase.

NO desactivar RLS para resolver problemas de desarrollo.

⸻

24. Auditoría

Acciones sensibles deberán registrarse.

Ejemplos:

- cambio de precio
- ajuste de inventario
- devolución
- cancelación
- descuento
- cambio de permisos
- cierre de caja
- transferencia
- recepción

Guardar:

usuario
acción
entidad
ID entidad
valor anterior
valor nuevo
fecha
metadata

Para altas de producto y movimientos de inventario, la consulta de auditoría
deberá responder de forma legible quién realizó la acción, qué producto y
variante afectó, qué agregó o rebajó, cantidad anterior y nueva, motivo, fecha,
hora, sucursal y documento de origen. No bastará con guardar un evento técnico
difícil de interpretar.

24.1. Consultas de ventas

Las consultas de ventas deberán permitir filtrar por rango de fecha y hora,
sucursal, cajero, categoría, producto y variante. Por ejemplo, se podrá elegir
del día 9 al 14, filtrar únicamente la categoría Botas y conocer cada venta con
su folio, día, hora, producto, variante, cantidad, precio aplicado y método de
pago. La vista deberá ofrecer tanto resumen agregado como detalle trazable al
ticket original, respetando los permisos y el alcance por sucursal.

Cuando existan muchos datos, la consulta permitirá agrupar o dividir la
información por **día, semana, mes o año**, además de usar un rango
personalizado. Los periodos respetarán la zona horaria de la sucursal y la
interfaz cargará resultados por páginas o bloques para no intentar mostrar
miles de registros a la vez. Cambiar de resumen a detalle conservará los
filtros seleccionados.

⸻

25. Arquitectura tecnológica preferida

Stack actual previsto:

Frontend:
Next.js / React

Hosting:
Vercel

Backend / DB:
Supabase

Database:
PostgreSQL

Auth:
Supabase Auth

Storage:
Supabase Storage cuando sea necesario

Repositorio:
GitHub

Integraciones:
WooCommerce REST API + Webhooks

Desarrollo:
Claude Code + OpenAI Codex + supervisión humana.

⸻

26. Supabase

Para producción utilizar como mínimo Supabase Pro.

Actualmente el proyecto es pequeño en relación con la capacidad esperada:

- aproximadamente 15k registros/filas de inventario provenientes de SICAR
- una sucursal inicialmente
- pocos empleados
- WooCommerce
- crecimiento futuro

No existe un límite conceptual de “número de sucursales”.

Diseñar correctamente y escalar compute posteriormente si aumenta la concurrencia.

IMPORTANTE:

Clientes almacenados en una tabla CRM NO son necesariamente usuarios Auth.

Sólo cuentan como usuarios Auth si realmente inician sesión mediante Supabase Auth.

⸻

27. Entornos

OBLIGATORIO separar:

DEVELOPMENT

STAGING

PRODUCTION

Los agentes de IA NO deberán modificar directamente producción.

Cambios de esquema:

siempre mediante migrations.

⸻

28. Seguridad

La seguridad deberá formar parte de la arquitectura desde el inicio; no se agregará al final como una capa aislada.

Principios obligatorios:

- Aplicar correctamente RLS y permisos en Supabase. Nunca desactivar RLS para “hacer que funcione”.
- Separar roles y privilegios, como mínimo administrador, gerente, cajero y almacén, aplicando siempre el principio de mínimo privilegio.
- Nunca exponer `service_role`, claves privadas, credenciales de WooCommerce ni otros secretos en el frontend, el repositorio o el código cliente.
- Mantener secretos únicamente en variables de entorno y servicios seguros apropiados para cada entorno.
- Validar del lado servidor la identidad, el rol, los permisos, el alcance de sucursal y las reglas de negocio de toda operación crítica.
- No confiar en botones ocultos, rutas no enlazadas ni otras restricciones de interfaz para proteger acciones sensibles.
- Ventas, devoluciones, cancelaciones, descuentos, cambios de precio, movimientos de inventario y operaciones de caja deberán producir registros de auditoría trazables.
- Proteger autenticación, sesiones y endpoints contra accesos no autorizados, abuso, repetición de solicitudes y escalamiento de privilegios.
- Mantener dependencias actualizadas y revisar vulnerabilidades periódicamente.
- Mantener backups, logs y monitoreo suficientes para detectar, investigar y recuperar incidentes.
- Antes del piloto y de releases importantes, realizar una revisión específica de seguridad que intente encontrar vulnerabilidades antes de producción.

Principio de seguridad:

Asumir que usuarios internos o externos pueden intentar realizar acciones que no tienen permitidas. El sistema debe impedirlas desde la arquitectura y el backend, no solamente ocultarlas en la interfaz.

Responsabilidad de los agentes:

Claude Code y Codex deberán cuestionar activamente cómo una funcionalidad sensible podría explotarse, abusarse o utilizarse de forma incorrecta. Codex actuará también como revisor de seguridad y no aprobará una protección basada únicamente en la interfaz.

⸻

29. Concurrencia

Especial cuidado en:

- última pieza disponible
- dos cajas vendiendo mismo producto
- WooCommerce + POS vendiendo simultáneamente
- devoluciones
- transferencias
- recepción
- ajustes
- apartados

Operaciones críticas deberán ser transaccionales/atómicas.

Ejemplo crítico:

Stock = 1.

Caja A intenta vender.

Caja B intenta vender al mismo tiempo.

Sólo una operación puede consumir correctamente esa última unidad si no se permite inventario negativo.

⸻

30. WooCommerce Webhooks

Todos los webhooks deberán:

1. verificar autenticidad
2. registrar evento
3. detectar duplicado
4. procesar
5. marcar resultado
6. permitir reintentos seguros

Guardar identificadores externos cuando existan.

Nunca asumir que un webhook llegará exactamente una vez.

⸻

31. Modo contingencia / offline

Vaqueros SM opera 7 días por semana.

El POS no debería quedar completamente inutilizable ante una caída breve de internet.

No implementar offline complejo sin diseñarlo correctamente.

Primero diseñar estrategia.

Posible arquitectura futura:

PWA
↓
cola local
↓
operaciones pendientes
↓
reconexión
↓
sincronización

Especial cuidado con:

- IDs
- ventas duplicadas
- inventario
- pagos
- timestamps
- conflictos

No implementar offline improvisado.

⸻

32. WooCommerce como canal, no como base central

Objetivo futuro:

MI TIENDA SM = fuente principal operacional

WooCommerce = canal online

No permitir que múltiples sistemas modifiquen inventario sin reglas claras.

Definir ownership de cada campo.

Ejemplo:

Mi Tienda SM:

- stock
- códigos
- variantes
- precio operativo cuando se acuerde

WooCommerce:

- contenido comercial
- SEO
- fotografías/descripciones si así lo decide el negocio

Esto deberá documentarse.

⸻

33. CFDI

Si Vaqueros SM requiere facturación:

NO construir infraestructura fiscal propia.

Integrar un PAC/API autorizado.

El proveedor exacto se definirá posteriormente.

Mantener CFDI desacoplado del núcleo del POS.

Una falla temporal del proveedor fiscal no debería corromper una venta ya realizada.

⸻

34. Pagos

No construir procesamiento de tarjetas desde cero.

Utilizar proveedor/terminal externo.

Mi Tienda SM deberá registrar:

- método
- referencia
- monto
- estado

y posteriormente permitir conciliación si existe integración.

⸻

35. Clientes y lealtad

Puede agregarse posteriormente.

Las reglas confirmadas de apartados y crédito viven respectivamente en
[`specs/M7_APARTADOS.md`](specs/M7_APARTADOS.md) y
[`specs/M7_CREDITO.md`](specs/M7_CREDITO.md). Puntos, recompensas y niveles
se realizarán en una etapa posterior por decisión del negocio y no bloquean la
entrega de apartados y crédito.

Módulo iniciado en 0.54.0; la especificación vigente está en
[`specs/M7_LEALTAD.md`](specs/M7_LEALTAD.md).

Estructura:

customers
loyalty_accounts
loyalty_transactions

Funciones futuras:

- QR
- puntos
- historial
- recompensas
- promociones
- niveles
- expiración
- Wallet
- WooCommerce

NO forma necesariamente parte del núcleo V1.

⸻

36. Estrategia de desarrollo

No intentar construir todo simultáneamente.

Orden recomendado:

FASE 1
Arquitectura, auth, DB, sucursales.

FASE 2
Productos, variantes, códigos, importación SICAR.

FASE 3
Inventario y movimientos.

FASE 4
POS, ventas y caja.

FASE 5
Devoluciones/apartados/compras según funciones reales utilizadas.

FASE 6
WooCommerce.

FASE 7
Migración completa de datos.

FASE 8
Pruebas.

FASE 9
Piloto paralelo.

FASE 10
Migración operacional.

FASE 11
Revisión visual posterior al piloto y rediseño moderno opcional.

Esta fase no sustituye las auditorías de ergonomía que acompañan cada
milestone. Se realizará cuando los flujos principales estén estables y exista
evidencia del uso real, para decidir si conviene conservar, refrescar o
rediseñar la interfaz sin poner en riesgo la operación.

⸻

37. Cronograma conceptual

Objetivo aproximado:

8–12 semanas para llegar a un piloto sólido.

No prometer apagado completo de SICAR exactamente en 12 semanas.

Prioridad:

CORRECTITUD > VELOCIDAD.

⸻

38. Estrategia Claude + Codex

Claude Code será principalmente:

IMPLEMENTADOR.

Codex será principalmente:

REVISOR / SEGUNDO INGENIERO.

Flujo:

Claude propone/implementa

↓

Codex revisa

↓

tests

↓

correcciones

↓

revisión humana

↓

merge

No permitir que ambos agentes modifiquen simultáneamente las mismas partes sin coordinación.

⸻

39. Instrucciones para Claude Code

Antes de implementar:

1. Leer este documento completo.
2. Proponer arquitectura.
3. Proponer modelo de datos.
4. Identificar riesgos.
5. Proponer milestones.
6. Identificar dudas de negocio.
7. Identificar funciones que NO deberían estar en V1.

No comenzar construyendo toda la aplicación.

Trabajar mediante cambios pequeños y revisables.

Cada cambio importante deberá incluir:

- qué se modificó
- por qué
- riesgos
- tests
- migraciones
- impacto

⸻

40. Instrucciones para Codex

Actuar como revisor independiente.

No asumir que la implementación de Claude es correcta.

Buscar específicamente:

- race conditions
- inconsistencias de inventario
- duplicados
- errores monetarios
- problemas de RLS
- problemas WooCommerce
- pérdida de historial
- problemas de migración
- problemas de concurrencia
- problemas offline
- errores de caja
- permisos incorrectos
- escalamiento de privilegios y controles aplicados sólo en la interfaz
- exposición de secretos, sesiones inseguras y endpoints sin autorización suficiente
- abuso, repetición o manipulación de operaciones sensibles

Para cada módulo crítico preguntar:

“¿Cómo podría romperse esto en una tienda real?”

Y para cada operación sensible preguntar:

“¿Cómo podría explotarse o utilizarse incorrectamente, incluso por un usuario interno?”

⸻

41. Reglas obligatorias para ambos agentes

1. Nunca modificar/regenerar códigos heredados de SICAR.
1. Nunca modificar inventario sin movimiento auditable.
1. Operaciones financieras e inventario deben ser atómicas.
1. Eventos WooCommerce deben ser idempotentes.
1. Nunca modificar producción directamente.
1. Schema mediante migrations.
1. Nunca borrar historial para corregir contabilidad/inventario.
1. Código crítico requiere tests.
1. Nunca debilitar RLS para resolver un bug.
1. Nunca exponer service_role al cliente.
1. Separar dev/staging/prod.
1. Explicar cambios arquitectónicos.
1. No agregar dependencias innecesarias.
1. No sincronizar productos por nombre.
1. No asumir reglas de negocio no confirmadas.
1. Nunca depender únicamente de la interfaz para autorizar una operación sensible.
1. Diseñar con mínimo privilegio, validación del servidor y auditoría desde el inicio.
1. Entender el proceso humano real antes de automatizarlo o rediseñarlo.
1. Reducir trabajo repetitivo y prevenir errores sin debilitar reglas de negocio ni seguridad.
1. Tratar la ergonomía como criterio de aceptación desde cada milestone; medirla y auditarla antes del piloto, no dejarla como pulido final.

⸻

42. Casos mínimos que deben probarse

Inventario

- stock normal
- stock = 1
- stock = 0
- venta concurrente
- devolución
- cancelación
- ajuste
- compra
- transferencia
- producto sin código
- código duplicado

POS

- efectivo
- tarjeta
- transferencia
- pago mixto si se habilita
- descuento autorizado
- devolución
- cancelación
- ticket
- doble toque en botón cobrar

WooCommerce

- venta online
- webhook duplicado
- webhook atrasado
- webhook inválido
- producto inexistente
- variación inexistente
- stock simultáneo POS/Web
- error API
- timeout
- reintento

Migración

- código duplicado
- código vacío
- ceros iniciales
- producto sólo SICAR
- producto sólo WooCommerce
- producto en ambos
- diferente stock
- diferente precio
- diferentes nombres pero mismo código

⸻

43. Observabilidad

Producción deberá tener:

- logs
- errores
- auditoría
- backups
- monitoreo básico
- capacidad de rastrear una operación

Ante una diferencia de inventario deberá poder responderse:

¿Quién?

¿Qué hizo?

¿Cuándo?

¿Desde dónde?

¿Qué documento/venta lo originó?

¿Cuánto había antes?

¿Cuánto quedó después?

⸻

44. Experiencia del usuario

Mi Tienda SM debe adaptarse a la forma natural de trabajar de las personas y de Vaqueros SM; no deberá obligar a las personas a adaptarse innecesariamente al software.

Antes de desarrollar un proceso importante, se deberá entender cómo trabaja realmente el usuario y después diseñar la solución.

Principios obligatorios:

- Reducir pasos innecesarios y evitar capturas repetitivas.
- Utilizar lenguaje que los empleados entiendan y no exponer complejidad técnica innecesaria.
- Priorizar las acciones más frecuentes.
- Diseñar especialmente para operación rápida y táctil en iPad/POS.
- Prevenir errores humanos cuando sea posible, en lugar de limitarse a mostrar errores después.
- Automatizar tareas repetitivas cuando sea seguro y auditable.
- Pedir confirmaciones principalmente cuando exista una consecuencia importante.
- Observar el comportamiento real durante el piloto y modificar los flujos que provoquen confusión, lentitud o trabajo innecesario.
- No replicar una mala experiencia de SICAR únicamente porque así funciona actualmente.
- Mantener las reglas de negocio necesarias, pero buscar la interacción más sencilla para cumplirlas.

Mi Tienda SM debe ser más fácil de usar que SICAR para los procesos cotidianos.

Especial prioridad:

- alta de mercancía
- variantes
- códigos
- venta
- consulta de stock
- recepción
- etiquetas

No sacrificar simplicidad por agregar funciones.

### Movimiento y animación — mejora programada antes del piloto

Las animaciones se revisarán dentro de la auditoría ergonómica previa al
piloto, cuando los recorridos operativos principales estén estables. No serán
una capa decorativa agregada a todas las pantallas.

- Las microinteracciones ligeras de la propia interfaz podrán confirmar toque,
  carga, éxito y cambio de estado sin retrasar la siguiente acción.
- Higgsfield podrá producir piezas breves de identidad para bienvenida,
  capacitación inicial, estados vacíos, demostraciones y momentos especiales
  de marca.
- Cobro, pagos, devoluciones, autorizaciones, conteos, captura repetitiva y
  mensajes de error no dependerán de video ni de animaciones llamativas.
- Ninguna animación ocultará controles, bloqueará el desplazamiento, moverá un
  botón mientras se intenta tocar ni demorará una operación.
- Los recursos deberán cargarse sólo cuando se necesiten, funcionar de forma
  razonable con conexión limitada y contar con una alternativa estática.
- Se respetará la preferencia de reducir movimiento del dispositivo y no habrá
  reproducción automática con sonido.
- La aceptación se comprobará en teléfono, iPad y computadora, midiendo que no
  empeore el tiempo del recorrido, la claridad, el consumo ni la respuesta de
  la PWA. Si una animación estorba, se simplifica o se elimina.

### Rediseño visual basado en Mi Vaquero SM

La PWA terminada de **Mi Vaquero SM** quedó aprobada como referencia visual de
Mi Tienda SM. La migración será incremental y comienza por el sistema visual,
el acceso y la navegación; los módulos operativos se validarán uno por uno sin
esperar al final del proyecto. La especificación y los límites están en
[`specs/REDISENO_MI_TIENDA.md`](specs/REDISENO_MI_TIENDA.md).

Después del piloto se mantendrá una revisión integral para comprobar con
empleados y responsables del negocio si la nueva dirección necesita ajustes,
no para volver a decidir desde cero la identidad.

La revisión abarcará identidad de marca, jerarquía visual, tipografía, color,
iconografía, densidad de información, navegación, componentes, estados vacíos,
tema oscuro, accesibilidad y consistencia entre teléfono, iPad y computadora.
También comparará la percepción de modernidad con la velocidad y claridad
medidas durante el piloto.

- Primero se documentarán los hallazgos y se separarán problemas funcionales,
  ergonómicos y únicamente estéticos.
- No se rediseñará por moda ni se reemplazarán recorridos que ya funcionen sin
  una mejora demostrable para el usuario.
- Se conservarán permisos, validaciones, auditoría, atajos, foco de teclado,
  compatibilidad táctil y continuidad del carrito o captura en curso.
- Las propuestas se probarán como prototipos y después de forma incremental;
  las pantallas críticas de Venta, Caja, Inventario y Devoluciones requieren
  comparación antes/después con usuarios reales.
- Ningún cambio podrá empeorar tiempos, número de toques, legibilidad,
  accesibilidad, respuesta de la PWA ni desempeño en equipos modestos.
- La identidad de Mi Vaquero se comparte como sistema de diseño; no se copian
  sus pantallas de cliente dentro de los flujos internos.

**Entregable:** migración incremental con capturas y métricas, alcance
priorizado y comparación antes/después. Cada bloque tendrá pruebas visuales y
funcionales antes de llegar a producción.

Principio humano:

Si un empleado necesita aprender una forma innecesariamente complicada de trabajar únicamente porque así fue programado el sistema, primero debe cuestionarse el diseño del sistema.

Objetivo:

Mi Tienda SM debe sentirse construido alrededor de la operación de Vaqueros SM, no hacer que Vaqueros SM tenga que adaptar toda su operación a Mi Tienda SM.

⸻

45. Identidad del sistema

Nombre:

MI TIENDA SM

Sistema interno desarrollado para Vaqueros SM.

Puede utilizarse visualmente:

MI TIENDA SM

Powered by ProcesaLab

Posibles módulos:

Mi Tienda SM POS
Mi Tienda SM Inventario
Mi Tienda SM Web
Mi Tienda SM Clientes
Mi Tienda SM Compras
Mi Tienda SM Sucursales
Mi Tienda SM Analytics
Mi Tienda SM Admin

⸻

46. Modelo comercial

Propuesta actual de ProcesaLab:

Desarrollo inicial: $120,000 MXN

Forma conceptual de pagos:

1. $30,000 — inicio, análisis y arquitectura.
2. $30,000 — catálogo, inventario, variantes y códigos.
3. $25,000 — POS funcional.
4. $20,000 — integraciones y preparación para piloto.
5. $15,000 — implementación/piloto.

Total:

$120,000 MXN

Mensualidad posterior:

$2,400 MXN / mes

La mensualidad comienza cuando el sistema entra formalmente en operación.

Puede incluir:

- licencia
- mantenimiento
- corrección de errores
- monitoreo básico
- soporte
- actualizaciones necesarias
- ajustes menores

NO incluye desarrollo ilimitado de módulos nuevos.

⸻

47. Infraestructura

Servicios externos deberán mantenerse separados del precio de desarrollo/mantenimiento cuando corresponda.

Ejemplos:

- Supabase
- Vercel
- PAC/CFDI
- APIs externas
- mensajería
- correo
- dominio/subdominio

Idealmente las cuentas productivas deberán ser propiedad del cliente y ProcesaLab tendrá acceso administrativo/técnico.

⸻

48. Sucursales adicionales

La arquitectura deberá soportarlas desde el principio.

Comercialmente se ha considerado como referencia:

Implementación adicional por sucursal:
$10,000–$15,000 MXN

Mensualidad adicional:
$500–$800 MXN

Estos precios aún pueden ajustarse comercialmente.

⸻

49. Principio central del proyecto

Mi Tienda SM NO debe ser simplemente:

“otro SICAR”.

Debe conservar las funciones que Vaqueros SM necesita actualmente, pero resolver mejor sus principales problemas y crear una plataforma que pueda crecer.

La visión es:

SICAR actual +
WooCommerce +
procesos manuales

↓

MI TIENDA SM

Una sola plataforma operacional para:

TIENDA
INVENTARIO
WEB
SUCURSALES
CLIENTES
DATOS

⸻

50. PRIMERA TAREA PARA LOS AGENTES

NO escribir inmediatamente toda la aplicación.

Primero entregar:

1. Arquitectura propuesta.
2. Diagrama conceptual.
3. Modelo inicial de PostgreSQL.
4. Lista de tablas.
5. Relaciones principales.
6. Estrategia de inventario.
7. Estrategia de migración SICAR.
8. Estrategia de integración WooCommerce.
9. Estrategia de POS para iPad/PWA.
10. Estrategia de seguridad/RLS.
11. Estrategia de testing.
12. Riesgos principales.
13. Información que todavía debemos solicitar al cliente.
14. Alcance recomendado de V1.
15. Qué dejar explícitamente fuera de V1.
16. Plan de desarrollo por milestones.

No implementar hasta que esta propuesta sea revisada y aprobada.

OBJETIVO

Construir un sistema retail confiable, auditable y escalable que pueda operar diariamente en Vaqueros SM, sustituir progresivamente SICAR y centralizar la operación física y digital sin poner en riesgo la continuidad del negocio.

⸻

51. REGISTRO VIVO DEL PROYECTO

Este documento vive dentro del repositorio y deberá actualizarse cuando una entrega cambie el alcance, la experiencia, la arquitectura, las reglas operativas o el estado de un módulo.

Reglas de mantenimiento:

- Claude Code y Codex deben leer este documento antes de proponer o implementar cambios relevantes.
- Cada entrega visible deberá incrementar `APP_VERSION` y actualizar `APP_RELEASE` en `lib/release.ts`.
- El campo `version` de `package.json` deberá mantenerse sincronizado.
- El resumen de entrega deberá incluir versión, cambios, pruebas, riesgos y elementos todavía simulados.
- No convertir comportamientos simulados de interfaz en reglas definitivas de negocio sin validación del cliente.
- Las decisiones críticas de inventario, caja, pagos, migración, seguridad y WooCommerce siguen sujetas a las reglas obligatorias de este Plan Maestro.

Estado actual antes de la entrega 0.6.0:

- Aplicación Next.js 16 con App Router desplegada en Vercel.
- Rutas actuales: Inicio, POS, Productos, Inventario, Caja, Tickets, Etiquetas, Ajustes y Más módulos.
- Datos todavía simulados y guardado local para algunas preferencias de diseño.
- Sin Supabase, autenticación real, WooCommerce, procesamiento de pagos ni hardware conectado.
- PWA con nombre Mi Tienda SM, iconos ladrillo, imagen social y navegación táctil móvil.
- Usuario visible de demostración: Salomon.
- El avatar S abre la versión instalada y el crédito de ProcesaLab.
- Los códigos heredados mostrados en la interfaz no se regeneran.

Decisión de diseño 0.6.0 — Ergonomía touch-first:

- Mantener la base hueso, blanco, café oscuro y ladrillo del brief.
- Usar color por significado y nunca como decoración arbitraria.
- Ladrillo: acción principal.
- Verde: confirmación, efectivo y entradas.
- Morado: regalos.
- Ámbar: advertencias y últimas piezas.
- Rojo: retiros, cancelaciones y acciones destructivas.
- Azul: información, movimientos y sincronización.
- Mantener una sola acción dominante por pantalla.
- Áreas táctiles mínimas de 48 px; acciones críticas de 56–64 px.
- El carrito del POS deberá convertirse en bandeja móvil accesible sobre la barra PWA.
- Cobro, descuentos y corte de caja deberán usar flujos guiados y prevenir doble toque.
- El alta de productos con tallas deberá favorecer selección múltiple y generación de variantes.
- Ningún estado dependerá únicamente del color; deberá incluir texto o icono.

Historial de entregas visibles:

- 0.5.0 — PWA táctil, barra inferior ampliada y versión visible en avatar.
- 0.5.1 — Crédito “Creado por ProcesaLab” dentro del panel de versión.
- 0.6.0 — Revisión ergonómica completa de POS, Inicio, Caja, Productos, Inventario y PWA.

Detalle de entrega 0.6.0:

- POS: categorías funcionales, catálogo con imágenes aprobadas, feedback táctil, carrito móvil en bandeja, total y cobro reforzados, teclado de efectivo, cálculo de cambio y bloqueo de doble cobro.
- POS: descuento, regalo y apartado conservan flujos independientes y visibles por color semántico.
- Inicio: métricas con jerarquía visual y accesos diarios más notorios.
- Caja: métodos de pago diferenciados y corte guiado con efectivo esperado, monto contado, diferencia y confirmación destructiva explícita.
- Productos: búsqueda, filtros de existencia, miniaturas y matriz táctil para crear varias tallas.
- Inventario: búsqueda, filtros por estado, miniaturas, conteos y estados visibles con texto y color.
- PWA móvil: barra inferior aumentada de 82 a 92 px y carrito flotante colocado arriba de la zona segura.
- Recursos visuales: las imágenes de sombrero, cinturón, bota y modelo con camisa fueron recortadas de `IMG_3636.png` y `IMG_3635.png`, archivos entregados y aprobados por el usuario. No se usaron imágenes generadas.
- Continúa simulado: ventas, caja, productos nuevos, inventario, tickets, usuarios y preferencias. No existe persistencia operativa ni conexión con servicios externos.
- Pruebas completadas para 0.6.0: ESLint sin observaciones; build de producción y TypeScript correctos; 13 rutas prerenderizadas.
- Verificación en navegador: Inicio en escritorio y POS, Productos, Inventario y Caja en móvil a 390 × 844, sin errores de consola, sin overlays y sin desbordamiento horizontal.
- Flujos comprobados: carrito móvil, apertura de cobro, efectivo exacto y cambio; matriz de 14 tallas; filtro de última pieza; corte de caja cuadrado; barra PWA móvil de 92 px.
- Hallazgo corregido durante pruebas: el carrito móvil interceptaba inicialmente el modal de cobro. La bandeja ahora se cierra al cobrar y los modales usan una capa superior.

Detalle de entrega 0.6.1 — Tickets térmicos editables:

- Se implementaron las plantillas del brief para impresora térmica monocromática de 80 mm.
- El ticket de venta incluye marca, sucursal, domicilio, teléfono, folio, fecha, cajero Salomon, Caja 01, artículos, variantes, códigos heredados, cantidades, subtotal, descuento, total, forma de pago, efectivo/cambio, código visual y política de cambios.
- El ticket de regalo usa un folio `R-…`, no muestra precios ni forma de pago e incluye la política de cambio de talla o modelo.
- Después de completar una venta, “Ver e imprimir ticket” y “Ver ticket de regalo” abren una vista previa real antes de ejecutar la impresión del navegador.
- En Tickets y comprobantes se puede alternar entre venta y regalo, revisar la plantilla completa y después imprimir la vista seleccionada.
- Las reimpresiones muestran fecha y hora de reimpresión debajo del folio.
- Regla de impresión: sólo el comprobante de 80 mm se hace visible en papel; navegación, botones y resto de la aplicación quedan excluidos.
- Continúa pendiente de confirmación del cliente: vigencia definitiva, uso parcial, cambios entre sucursales y conexión física con la impresora.
- Pruebas completadas para 0.6.1: ESLint, TypeScript y build correctos; venta en efectivo hasta confirmación; vista previa normal y de regalo; reimpresión histórica; estilos de impresión de 80 mm; sin errores de consola ni desbordamientos móvil/escritorio.
- Los patrones gráficos de código de barras y QR son todavía representaciones visuales del brief; deberán sustituirse por códigos escaneables ligados a identificadores persistentes cuando se conecte el backend.

Detalle de entrega 0.6.2 — Zona segura del carrito móvil:

- La bandeja “Venta en curso” queda separada 10 px de la barra inferior y respeta `safe-area-inset-bottom` en iPhone/PWA.
- La altura máxima del carrito se calcula descontando navegación, zona segura, separación y margen superior; su contenido hace scroll sin mover la página.
- La barra principal usa una capa superior a la bandeja para que nunca pueda quedar tapada y se mantiene disponible para navegación.
- El fondo atenuado termina exactamente arriba de la barra inferior, por lo que no bloquea sus cinco accesos.
- Pruebas completadas para 0.6.2: 375 × 667, 390 × 844 y 430 × 932; separación medida de 10 px, navegación de 92 px por encima de la bandeja, sin errores de consola ni desbordamiento horizontal.

⸻

52. ARRANQUE DE IMPLEMENTACIÓN DEL BACKEND

La propuesta técnica solicitada en la sección 50 fue entregada por Claude Code y aprobada por el usuario el 31 de agosto de 2026 para ejecución progresiva. Vive en `docs/PLAN_CODEX.md`; sus especificaciones detalladas viven en `docs/specs/` y el procedimiento de migración vive en `docs/RUNBOOK_CORTE.md`.

Orden aprobado:

M0 → M1 → M1B → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9.

Infraestructura contratada:

- Organización Supabase Pro de ProcesaLab.
- Proyecto `Mi Tienda SM` en `us-east-1`.
- PostgreSQL 17; proyecto activo y saludable al momento del alta.
- Proyecto inicialmente vacío: sin tablas, migraciones ni ramas remotas.
- Desarrollo mediante Supabase local y migraciones versionadas.
- Staging existe como rama aislada y debe recibir y validar cada migración antes
  de promoverla.
- Producción sólo recibe migraciones versionadas ya verificadas, con autorización
  explícita del usuario y una comprobación posterior de esquema, RLS y operación.

Estado de M0:

- M0 fue fusionado a `main` mediante el PR #1 el 31 de agosto de 2026; commit squash `e24caac`.
- CI, migración limpia, pruebas de integración, build de producción y E2E móvil/escritorio quedaron en verde antes del merge.
- Se conserva la interfaz existente; M0 agrega infraestructura sin reemplazar el diseño funcional.
- Clientes de Supabase separados para navegador, sesión de servidor y administración privilegiada.
- Código nuevo usa llaves `publishable` y `secret`; las llaves heredadas `anon` y `service_role` no forman parte de la interfaz de configuración.
- La clave secreta queda protegida con `server-only` y una prueba impide importarla desde componentes cliente.
- Supabase CLI, migración inicial, seed, Vitest, Playwright y CI quedan incorporados en M0.

Estado de M1:

- La base de identidad y RLS fue fusionada a `main` mediante el PR #2 el 31 de agosto de 2026; commit squash `6e0600d`.
- La rama de staging de Supabase está activa y aislada de producción; M0 fue aplicado y validado ahí.
- M1 y las migraciones posteriores se ensayan primero en staging. El 2 de septiembre
  de 2026, las 23 migraciones existentes se promovieron y verificaron en `main`.
- M1 comienza por la capa de seguridad: sucursales, empleados, roles, permisos, asignaciones, auditoría, funciones privadas y RLS deny-by-default.
- El autorregistro de empleados queda deshabilitado; el primer administrador se crea con un script de servidor que nunca expone la clave secreta.
- La verificación de PIN devuelve estados controlados en vez de lanzar una excepción para credenciales inválidas. Esto permite que PostgreSQL confirme el contador de intentos, el bloqueo y la auditoría; lanzar una excepción revertiría esas escrituras.
- La web 0.6.2 es la base obligatoria de M1. Autenticación y administración se integrarán a su navegación, sistema visual, ergonomía touch-first y PWA sin reemplazar ni romper Inicio, POS, Caja, Productos, Inventario, Tickets, Etiquetas o Ajustes.

Entrega visible 0.7.0 — Acceso y administración segura:

- El inicio de sesión usa Supabase Auth con correo y contraseña; no existe autorregistro público.
- Las rutas operativas refrescan y validan la sesión mediante `getClaims()` en el proxy. Un usuario autenticado sin perfil activo de empleado no obtiene acceso.
- La barra y el avatar existentes muestran la identidad, rol y sucursal reales; si un empleado tiene varias sucursales puede seleccionar la ubicación activa desde la cabecera.
- El módulo Administración se integra a Más módulos y Ajustes con cuatro vistas: empleados, sucursales, matriz de roles/permisos y bitácora.
- Crear y editar empleados y sucursales exige validación explícita de permiso en una Server Action y vuelve a pasar por las políticas RLS. La creación de una identidad de Auth utiliza la clave secreta sólo en servidor.
- La bitácora se presenta como sólo lectura; la interfaz no ofrece editar o borrar eventos.
- La edición masiva de permisos permanece deliberadamente de sólo lectura hasta implementar una operación transaccional que no pueda dejar un rol parcialmente actualizado.
- Sin variables de Supabase, la web conserva el modo demostración 0.6.2. Cuando
  existen, activa el acceso real.
- Desde el 2 de septiembre de 2026, Vercel Production apunta exclusivamente a
  Supabase `main` (`drubkjlmfbdeglucakmg`). Vercel Preview debe apuntar
  exclusivamente a la rama `staging` (`zsezjtswqeijboezvado`).
- Las credenciales se guardan como variables protegidas de Vercel y no forman
  parte del repositorio. Nunca se reutiliza la clave secreta de un entorno en el
  otro.
- El 2 de septiembre de 2026 se restauraron en Vercel Preview la URL, clave
  pública y clave secreta propias de staging. La clave privilegiada se rotó y
  las credenciales anteriores de staging fueron revocadas; Producción no fue
  modificada durante esa rotación.
- El ambiente de staging cuenta con la sucursal inicial `LAP` (La Piedad) y el primer administrador `SALOMON` (Salomon), asignado a esa sucursal. Su contraseña temporal se entrega fuera del repositorio y deberá rotarse.
- El autorregistro quedó deshabilitado también en la configuración alojada de Supabase Auth, no sólo en la configuración local.
- La integración real fue validada de extremo a extremo en la web publicada: inicio de sesión, sesión protegida, identidad y sucursal, Administración, rol ADMIN con 29 permisos y bitácora de auditoría. No se observaron errores de consola durante la verificación.

Entrega visible 0.7.1 — Identidad y datos de tienda:

- Inicio, Caja, tickets de venta y tickets de regalo toman el nombre del empleado autenticado y la sucursal activa; se eliminan las referencias operativas fijas a Salomon.
- La dirección y el teléfono de cada ticket provienen de la ubicación activa en Supabase. La Piedad queda registrada como `Av. Mariano Jiménez 706, Col. Jardines del Carmen, C.P. 59389, La Piedad de Cabadas, Michoacán`, teléfono `352 145 6880`.
- Ajustes reutiliza la misma ficha de negocio y sucursal para evitar diferencias entre configuración, tickets y documentos.
- El alta de empleados distingue correo existente, datos inválidos, configuración, perfil y asignación de sucursal; los errores del servidor dejan registro técnico sin exponer contraseñas ni secretos.

Entrega visible 0.8.0 — Clientes e identidad segura (M1B, primera entrega):

- Se incorpora el módulo real de Clientes con alta, edición y una búsqueda única por teléfono, últimos cuatro dígitos, número de socio, nombre o correo.
- El teléfono se normaliza en PostgreSQL a E.164 mexicano; formatos como `3531234567`, `+52 353 123 4567`, `0052…` y `01…` chocan contra la misma restricción única y no pueden dividir a una persona en cuentas duplicadas.
- Cada cliente recibe un número de socio de ocho dígitos con verificador Luhn. PostgreSQL valida el dígito y rechaza números alterados.
- `customers` usa RLS deny-by-default. `customers.manage` permite atención individual a ADMIN, MANAGER y CASHIER; `customers.export` queda separado y se concede inicialmente sólo a ADMIN. No existe permiso de borrado físico.
- Alta y edición se ejecutan por RPC del servidor con autorización real. La auditoría registra actor, entidad y campos modificados sin copiar teléfono, correo, nombre ni fecha de nacimiento a la bitácora.
- El POS permite asociar un cliente desde el carrito mediante el mismo campo de búsqueda. Las ventas continúan simuladas hasta M4, por lo que esta selección todavía no genera historial ni puntos.
- Consentimiento del programa y marketing se guardan por separado. El alta exige registrar la versión exacta del aviso entregado; el aviso legal definitivo sigue pendiente del cliente y no debe sustituirse por texto inventado.
- Continúa pendiente dentro de M1B: PWA de cliente en subdominio separado, OTP por SMS/correo, QR y código 1D reales, tarjeta disponible sin sesión y pruebas físicas con lector 2D en iPhone/Android. No se activan puntos, redención, niveles, cumpleaños, crédito ni apartados porque sus reglas siguen sin confirmar.

Entrega visible 0.9.0 — Mi Vaquero y tarjeta digital (M1B, segunda entrega):

- Se incorpora la PWA independiente **Mi Vaquero**, preparada para un subdominio dedicado y disponible provisionalmente en `/mi` mientras se configura el dominio del cliente.
- El acceso sin contraseña por correo funciona exclusivamente para clientes ya registrados. La identidad Auth se crea y vincula del lado servidor; la respuesta pública es genérica y existe un límite de frecuencia por cliente. El acceso por teléfono queda desactivado hasta configurar y validar un proveedor de SMS.
- La tarjeta genera un QR y un código CODE128 reales con el mismo número de socio de ocho dígitos. El personal puede abrir Mi Vaquero desde Clientes para explicar o probar el flujo.
- La PWA conserva sin conexión únicamente la versión del formato y el número de socio; nombre, teléfono, correo, sesión y datos operativos no forman parte de la tarjeta offline.
- El cliente autenticado sólo puede leer su propia tarjeta mediante una RPC dedicada. No puede consultar directamente `customers`, perfiles de empleados ni la búsqueda interna.
- El service worker sólo guarda el shell y recursos estáticos de Mi Vaquero; nunca cachea API, Supabase ni respuestas con datos personales.
- Continúan pendientes antes del piloto: dominio/DNS de cliente, proveedor y plantilla SMS, aviso de privacidad definitivo y prueba física del QR/CODE128 con los lectores reales en iPhone y Android. No se implementan puntos, recompensas, niveles ni historial hasta aprobar sus reglas.
- Se integró la revisión adversarial de Claude Code en `docs/AUDITORIA_SPECS.md`: sus nueve hallazgos quedaron resueltos o especificados antes de M2/M3. Las preguntas que requieren respuesta de Vaqueros SM viven consolidadas en `docs/PREGUNTAS_CLIENTE.md`, sin duplicar las reglas canónicas.

Corrección operativa 0.9.1 — Enlace de acceso a Mi Vaquero:

- Se corrigió el permiso de uso del esquema privado `app` para `service_role`. Sin ese permiso, el trigger de actualización de `customers` rechazaba con 403 el enlace entre el cliente y su identidad Auth, por lo que la operación se revertía antes de solicitar el correo mágico.
- El permiso se limita a `USAGE` del esquema: no concede acceso nuevo a tablas, funciones ni datos. Las operaciones continúan sujetas a sus permisos explícitos y el secreto permanece exclusivamente en servidor.

Corrección operativa 0.9.2 — Correo passwordless y CI:

- Las identidades de clientes destinadas exclusivamente a acceso por enlace mágico se crean como correo o teléfono confirmado, según la recomendación de Supabase para usuarios passwordless importados. Esto permite mantener deshabilitado el autorregistro público sin que Auth confunda el primer acceso con un alta.
- Las identidades ya vinculadas se sincronizan y confirman del lado servidor antes de solicitar el OTP. Recibir el enlace o código continúa siendo la prueba de posesión del canal; ninguna credencial privilegiada se expone al cliente.
- El CI aplica el formato pendiente que detenía el job antes de lint y pruebas. La actualización de Checkout, Setup Node y PNPM Setup para eliminar la advertencia de Node 20 queda pendiente de una credencial GitHub con alcance `workflow`.

Corrección operativa 0.9.3 — Migración reproducible en CI:

- La migración del índice `customers_updated_by_idx` ahora usa `if not exists`, porque el índice ya forma parte de la migración base de clientes.
- Esto permite levantar una base local limpia en GitHub Actions sin fallar por intentar crear dos veces el mismo índice.
- El ajuste es idempotente y no altera datos ni permisos en producción.

Corrección operativa 0.9.4 — Auditoría de clientes en integración:

- La prueba de privacidad valida todos los eventos de auditoría de un cliente, no sólo un supuesto registro único.
- Se reconoce como comportamiento correcto que existan eventos separados al crear el cliente y al vincular su identidad de acceso.
- Cada evento debe conservar `before_data` y `after_data` vacíos y no incluir el teléfono del cliente en sus metadatos.

Configuración operativa de Auth — Redirección de Mi Vaquero:

- Supabase `main` usa `https://vaquero-hub.vercel.app` como `Site URL` y
  `https://vaquero-hub.vercel.app/mi` está registrada explícitamente en
  `Redirect URLs`.
- Staging debe autorizar el dominio de Preview que se use para probar correos;
  el enlace jamás debe apuntar a producción por accidente durante una prueba.
- No debe restaurarse `http://localhost:3000` como destino del entorno publicado: cuando una URL solicitada no está autorizada, Supabase usa el `Site URL` y el enlace de un solo uso puede consumirse antes de llegar a la PWA.

Corrección operativa 0.9.5 — Sesión persistente y acceso multidispositivo:

- Cada dispositivo conserva su propia sesión de Mi Vaquero mediante el almacenamiento persistente de Supabase; cerrar y volver a abrir la PWA no exige autenticarse de nuevo mientras la sesión siga vigente.
- Supabase mantiene habilitadas sesiones simultáneas: `Enforce single session per user` está apagado y los límites de duración e inactividad están en `0` (`never`). Nunca deben copiarse access tokens o refresh tokens entre dispositivos.
- Para acceder desde otro equipo, el cliente solicita un código nuevo en ese dispositivo. La plantilla de correo de Mi Vaquero incluye el OTP de seis dígitos y mantiene como alternativa el enlace de un solo uso.
- La plantilla canónica vive en `supabase/templates/magic-link.html` y la configuración local la declara en `supabase/config.toml`; el proyecto hospedado debe mantener el mismo asunto y HTML en Auth > Email Templates.

Cambio de identidad 0.9.6 — Mi Tienda SM:

- El nombre público y operativo del sistema cambia de su denominación anterior a **Mi Tienda SM**.
- El nuevo nombre debe utilizarse en interfaz, acceso de empleados, PWA, metadatos, vista previa al compartir, tickets, correos y documentación.
- **Vaquero SM** continúa siendo la identidad del negocio; Mi Tienda SM es el nombre del sistema de operación.
- Los identificadores técnicos ya desplegados —URL de Vercel, `project_id`, claves de almacenamiento, nombre del paquete y nombre de este archivo maestro— se conservan por compatibilidad y no deben renombrarse sin una migración específica.

Entrega visible 0.10.0 — M2, catálogo real y generador de variantes:

- Se incorpora el modelo versionado de marcas, categorías, escalas de talla,
  atributos, productos padre, variantes y múltiples códigos de barras.
- Los importes se guardan como centavos enteros. El producto padre no tiene
  precio ni existencia; esos datos pertenecen a cada variante.
- Los códigos internos heredados y los códigos de barras provenientes de
  SICAR quedan protegidos por disparadores de PostgreSQL y no dependen de que
  la interfaz oculte un botón.
- La pantalla Productos deja de simular altas cuando Supabase está conectado.
  Una sola captura crea varias tallas en una transacción: si una variante
  falla por duplicidad o datos inválidos, no se guarda ninguna.
- Categoría, color, costo, precio, marca y código base forman parte del alta;
  el inventario se muestra como pendiente de M3 para no inventar existencias.
- La búsqueda real acepta nombre, marca, SKU, código SICAR o cualquier código
  físico asociado. El cajero recibe precio y atributos, pero nunca costo.
- La migración base y su corrección de búsqueda fueron aplicadas primero al
  staging `zsezjtswqeijboezvado` y registradas en su historial. La prueba
  remota generó y encontró ocho variantes dentro de una transacción que fue
  revertida; no dejó datos de prueba.
- El 2 de septiembre de 2026, la cadena completa de 23 migraciones se aplicó en
  orden a Supabase `main`; se comprobaron 17 tablas públicas con RLS activo,
  las funciones críticas y los catálogos de roles y permisos.
- La verificación móvil automatizada confirma una superficie táctil mínima de
  48 px para las tallas, ocho selecciones desde una sola captura y ausencia de
  desbordamiento horizontal.
- Continúan pendientes dentro de M2: agregar tallas a productos existentes,
  matriz talla por color editable, carga masiva con corrida en seco, cambio de
  precios en lote, etiquetas persistentes y prueba de escaneo con hardware
  real.

Corrección de seguridad 0.10.1 — Clientes, correo y continuidad:

- Se integró la revisión de Claude Code sin duplicar el esquema de M2. Sus
  documentos de M4, M5 y continuidad quedan como contexto permanente del
  repositorio.
- El destino del enlace mágico ya no se deduce del host de la petición. En
  cualquier despliegue publicado exige `CUSTOMER_APP_URL`; producción usa la
  ruta completa `https://vaquero-hub.vercel.app/mi`.
- La ruta configurada se conserva completa. No debe reducirse al origen del
  sitio, porque eso enviaría al cliente a la aplicación operativa en vez de a
  Mi Tienda SM para clientes.
- Las solicitudes de acceso mantienen el límite por cliente y agregan un
  segundo límite por origen usando un HMAC irreversible; la dirección IP no
  se almacena en PostgreSQL.
- El rol ADMIN obtiene una operación explícita para anonimizar clientes. La
  fila y el número de socio se conservan para el historial contable, pero se
  eliminan nombre, teléfono, correo, fecha de nacimiento, consentimiento y
  vínculo de Auth. La bitácora nunca copia los valores personales anteriores.
- La migración se validó en staging mediante transacciones reversibles: se
  comprobó la anonimización completa y que el limitador permite exactamente
  diez solicitudes por ventana antes de rechazar las siguientes.
- La validación desde una base vacía corrigió dos datos de prueba: las tallas
  enteras ya se guardan como `25`, `26`, etc., sin punto final, y el teléfono
  temporal de anonimización usa exactamente diez dígitos mexicanos.
- Deuda reconocida: si Supabase Auth falla después de anonimizar la fila, hace
  falta una cola de reintento para borrar la identidad huérfana sin perder la
  trazabilidad del trabajo pendiente.

Entrega visible 0.11.0 — M2.2, matriz e identidad automática:

- Se integró la revisión de Claude Code que reserva `legacy_sicar_code`, los
  identificadores de WooCommerce y los códigos con origen `SICAR` únicamente
  para el importador M9. El alta manual ya no puede poblar esos campos.
- Cada variante recibe dentro de PostgreSQL un serial privado, un SKU con
  dígito verificador y un EAN-13 generado. El navegador no puede elegir ni
  reservar estas identidades.
- Los SKU y códigos generados quedan inmutables. Si en el futuro se reemite
  una etiqueta, se agrega otro código a la variante sin romper el anterior.
- El alta permite seleccionar varios colores y varias tallas, muestra la
  matriz completa y deja excluir combinaciones antes de guardar.
- La generación se valida primero en staging. La activación en la base
  operativa definitiva continúa condicionada a comprobar la exportación de
  SICAR para descartar colisiones con el prefijo interno.
- M2.2 continúa con edición de producto y `add_variants_to_product(...)`; no
  se deben recrear variantes que ya puedan adquirir historial.

Entrega visible 0.11.1 — desplazamiento en computadora e iPad:

- El área principal del sistema tiene desplazamiento vertical propio cuando
  usa la navegación lateral de computadora o iPad horizontal. Todo el contenido
  inferior debe ser alcanzable aunque la pantalla tenga poca altura.
- En móvil se conserva el desplazamiento natural del documento y el espacio de
  seguridad para la barra inferior de la PWA.

Entrega visible 0.12.0 — ampliar variantes sin perder identidad:

- Productos permite elegir un artículo existente y agregarle nuevas tallas o
  colores con la misma matriz táctil del alta inicial.
- Las combinaciones ya existentes aparecen bloqueadas para prevenir capturas
  duplicadas; PostgreSQL vuelve a validarlas como control definitivo.
- `add_variants_to_product(...)` genera SKU y EAN-13 dentro de una sola
  transacción y nunca modifica las variantes anteriores.
- La comprobación de combinación se serializa por producto para impedir que dos
  usuarios concurrentes creen el mismo artículo físico con identidades distintas.
- Las migraciones deben aplicarse y probarse en staging antes de promoverse a
  `main`. La promoción de esta entrega a `main` quedó completada el 2 de
  septiembre de 2026.

Entrega visible 0.13.0 — códigos externos y reimpresión segura:

- Productos permite registrar por variante un código del proveedor o uno de
  reimpresión, con una captura táctil que también acepta la entrada de un lector.
- PostgreSQL valida permiso `products.update`, variante activa, origen permitido,
  formato EAN-13 o CODE 128 y unicidad global. La interfaz no puede crear códigos
  con origen SICAR ni hacerse pasar por el generador interno.
- El código nuevo se vuelve principal dentro de una transacción. Todos los
  anteriores permanecen asociados y siguen encontrando la misma variante.
- El mismo código de proveedor no puede asignarse a dos tallas; el fallo conserva
  intacto el código principal de la segunda variante.
- La operación es idempotente y deja bitácora mediante los disparadores de
  `barcodes`. Se cubren permisos, checksum, duplicidad, reintento y búsqueda por
  códigos anteriores en pruebas de integración.
- Claude Code dejó como obligatoria la validación física con cámara y con códigos
  impresos. Esa prueba de hardware sigue pendiente y no se sustituye con pruebas
  aritméticas o de navegador.

Entrega visible 0.14.0 — navegación ágil y adaptable:

- El layout y cada página protegida comparten, dentro de la misma petición, una
  sola validación de sesión y una sola lectura del perfil. La caché es por
  petición y nunca mezcla identidades entre usuarios.
- Cada cambio de sección muestra un estado de carga inmediato. Administración
  consulta únicamente la pestaña visible en lugar de descargar empleados,
  sucursales, permisos y bitácora en cada visita.
- Teléfono, iPad vertical, iPad horizontal y computadora usan un área principal
  de desplazamiento predecible. El contenido inferior conserva espacio para la
  barra PWA y respeta las zonas seguras del dispositivo.
- La barra móvil muestra los seis destinos operativos, incluido Inventario, con
  áreas táctiles de al menos 48 px. Tablas anchas permiten desplazamiento
  horizontal sin ensanchar toda la página.
- Los modales se limitan a la altura visible, desplazan su contenido y mantienen
  sus acciones accesibles. Los controles de formulario usan 16 px en teléfono
  para evitar el zoom automático de iOS.
- Nuevo producto ya no supone que la primera categoría es la correcta: exige
  elegirla antes de presentar la escala de tallas.
- Verificación automatizada: lint, tipos, unitarias, build de producción y 18
  recorridos de navegador. La revisión visual no encontró desbordamiento
  horizontal ni errores de consola en 390×844, 768×1024 y 1440×800.
- Continúan simulados los módulos marcados como pendientes en cada milestone;
  esta entrega no cambia reglas de inventario, venta, caja ni códigos.

Corrección visible 0.14.1 — controles de catálogo aplicados donde importan:

- Dos correcciones nuevas, sin reescribir migraciones ya fusionadas, llevan el
  candado de combinaciones concurrentes a las bases alojadas y reservan los
  prefijos EAN-13 `20`–`29` exclusivamente para el generador interno.
- Staging se actualizó primero y producción después. En ambos entornos se
  comprobaron cero combinaciones duplicadas, cero campos SICAR prematuros y
  cero códigos externos dentro del rango reservado.
- La interfaz traduce el rechazo del prefijo a una explicación clara y ninguna
  operación fallida cambia el código principal anterior.
- El dueño confirmó el 16 de septiembre de 2026 que los 18 códigos
  `GENERATED` creados durante el desarrollo son pruebas y no representan
  mercancía real. Por su inmutabilidad no se borrarán: se darán de baja antes
  del corte y quedarán excluidos de venta e importación. La compuerta para
  operación real sigue abierta hasta demostrar que los códigos heredados no
  usan `20`–`29`.
- La revisión de Claude queda consolidada en `docs/PENDIENTES.md`, incluyendo
  responsables, decisiones bloqueadas y el orden de trabajo posterior.

Entrega visible 0.15.0 — escaneo con cámara:

- Productos incorpora un lector de cámara para consulta rápida por código y
  para capturar códigos físicos antes de registrarlos. No se incorpora a Cobro:
  el lector Bluetooth sigue siendo la herramienta definida para la fila del POS.
- El componente usa `BarcodeDetector` cuando el navegador lo soporta y carga
  ZXing bajo demanda como respaldo para Safari/iPhone. Reconoce EAN-13, CODE 128
  y QR sin enviar ni almacenar imágenes.
- La lectura analiza sólo la región guía, solicita permiso después de explicar
  su uso, ofrece linterna cuando el dispositivo la expone, confirma con sonido y
  vibración y detiene la cámara después de una lectura para no duplicarla.
- Un código leído se resuelve contra el catálogo real mediante una Server Action
  que vuelve a exigir `products.read`. Un código inexistente muestra una salida
  clara para darlo de alta; el navegador no recibe costo ni privilegios nuevos.
- Si el permiso fue denegado se explican los pasos de recuperación para iPhone y
  Android; si no existe cámara se conserva la captura manual o lector Bluetooth.
- Las pruebas automatizadas cubren permiso previo, lectura, filtrado, código
  inexistente y permiso denegado. La aprobación física sigue pendiente: PWA
  instalada en iPhone/Android y coincidencia de códigos en pantalla e impresos.

Entrega visible 0.16.0 — edición segura de catálogo:

- Productos permite editar datos generales del producto, costo/estado de una
  variante y precio de venta desde una sola ventana táctil, en bloques separados
  para que quede claro qué alcance tiene cada guardado.
- PostgreSQL expone tres funciones `SECURITY DEFINER` de propósito limitado.
  Datos y estado requieren `products.update`; el costo exige además permiso para
  verlo; el precio exige `products.price_update`.
- SKU, código principal, talla y color se muestran como identidad protegida de
  sólo lectura. Las firmas no aceptan SKU, códigos, `legacy_sicar_code` ni IDs de
  WooCommerce, y los disparadores de inmutabilidad permanecen como segunda capa.
- Cada actualización conserva actor, antes y después en `audit_log`. Cajero,
  almacén y sesión anónima no pueden usar las funciones de edición.
- La interfaz conserva objetivos táctiles de 44–48 px, desplazamiento interno
  del modal y una sola columna para la identidad en teléfono.

Entrega visible 0.17.0 — carga masiva segura de catálogo:

- Productos permite descargar una plantilla propia de Mi Tienda SM en CSV o
  XLSX. La hoja incluye los catálogos vigentes y conserva el código físico como
  texto para no perder ceros iniciales.
- El flujo separa revisión y confirmación: la corrida en seco no escribe nada,
  enumera la fila y causa de cada problema, y sólo permite confirmar un archivo
  completamente válido.
- PostgreSQL vuelve a validar dentro de la transacción definitiva y serializa
  la operación. Si una fila cambió, se duplicó o entró en conflicto, no se crea
  ningún producto ni variante del archivo.
- El núcleo detecta códigos vacíos, duplicados, existentes, numéricos con ceros
  perdidos, espacios accidentales, prefijos internos reservados, catálogos
  inexistentes, tallas ajenas a su escala e importes inválidos. Los SKU y EAN
  internos siguen generándose exclusivamente en la base.
- Esta carga sólo admite códigos de proveedor y nunca recibe campos de SICAR o
  WooCommerce. La migración heredada continúa reservada para M9 y permanece
  bloqueada hasta revisar la exportación real.
- La descarga, revisión y confirmación exigen `products.create`; las funciones
  revocan acceso anónimo, rechazan clientes y dejan una entrada de auditoría
  resumida. Los archivos se limitan por tamaño y filas; XLSX además se revisa
  contra expansión excesiva, rutas inválidas, fórmulas y celdas no admitidas.
- Las tres migraciones de esta entrega se aplicaron y probaron primero en
  staging. Las dos migraciones correctivas conservan el historial alojado en
  lugar de reescribir una migración ya aplicada.
- Después de CI verde se promovieron las mismas tres migraciones a producción
  y se verificaron permisos, endurecimiento y publicación de la versión 0.17.0
  en Vercel. La pantalla real mostró el recorrido completo sin usar datos de
  demostración ni dejar una importación de prueba.
- La interfaz mantiene un recorrido táctil de tres pasos y cancela claramente
  ante errores. La siguiente entrega de M2 es M2.5: selección en lote y
  plantillas de etiquetas desde la computadora de trastienda.
- La base técnica se actualizó a Next.js 16.2.11 y el árbol de dependencias de
  producción quedó sin vulnerabilidades conocidas en la auditoría del gestor
  de paquetes al momento de la entrega.

Entrega visible 0.18.0 — M2.5, acciones en lote y etiquetas:

- Productos permite seleccionar variantes y activarlas, desactivarlas, cambiar
  su precio o enviarlas a la cola de etiquetas. Ninguna acción borra SKU,
  códigos ni identidad histórica.
- El cambio de precio muestra una vista previa exacta y exige que los precios
  observados sigan vigentes al confirmar. Si otra sesión cambió uno, el lote
  completo se cancela. Cada variante modificada deja su propio renglón en la
  bitácora; la prueba remota de 300 variantes produjo 300 registros.
- Las plantillas de etiqueta son registros persistentes con dimensiones,
  distribución y campos visibles controlados. RLS permite consultarlas a quien
  ve productos y sólo `products.update` permite administrarlas; no se almacena
  HTML ni CSS arbitrario.
- Las etiquetas usan el logotipo de Vaqueros SM, medidas físicas y un código de
  barras SVG real. Reimprimir conserva el código existente y la cola limita la
  cantidad para evitar bloquear el navegador o mandar miles por error.
- Las funciones críticas viven en PostgreSQL, vuelven a validar permisos,
  bloquean las filas en orden estable y revocan ejecución anónima. La interfaz
  no es la barrera de seguridad.
- Las migraciones se probaron primero en staging con RLS, permisos, cambio de
  precio desactualizado, estado, persistencia de plantilla y transacción
  reversible de 300 variantes. Los índices correctivos se agregaron en una
  migración nueva para conservar el historial aplicado.
- M2 queda funcionalmente construido. Para cerrarlo falta imprimir y escanear
  una etiqueta con el equipo real, además de probar la cámara instalada como
  PWA en los teléfonos definidos. M3 puede comenzar en paralelo sin inventar el
  resultado de esas pruebas físicas.

Entrega visible 0.19.0–0.19.1 — núcleo de inventario verificado:

- El saldo existe por variante y sucursal, y sólo puede cambiar junto con un
  renglón del libro inmutable de movimientos dentro de la misma transacción.
- La existencia disponible descuenta reservas. Ventas y salidas usan un
  `UPDATE` condicional que impide vender por debajo de lo comprometido.
- Dos ventas paralelas sobre una sola pieza producen una venta, un rechazo y
  saldo cero. Veinte ventas concurrentes también conservaron la igualdad entre
  libro y saldo.
- Ajustes físicos exigen motivo, saldo observado vigente, permiso y sucursal;
  conservan responsable, cantidad anterior y cantidad nueva.
- La pantalla Inventario ya consulta Supabase y permite cambiar entre las
  sucursales asignadas sin mostrar datos simulados cuando la base falla.

Entrega visible 0.20.0 — cierre de M3 con conteos y traspasos:

- Los conteos son sesiones auditadas. Cada captura conserva quién contó y
  cuándo; al cerrar, el sistema bloquea la sesión y el saldo, calcula la
  diferencia contra la existencia vigente y crea movimientos compensatorios.
- Los traspasos recorren `SOLICITADO → APROBADO → PREPARADO → EN TRÁNSITO →
RECIBIDO`. No se puede cancelar mercancía que ya salió y quien aprobó no puede
  recibir el mismo documento.
- El envío descuenta el origen y coloca la mercancía en la ubicación técnica
  `TRANSITO`. El destino no puede venderla antes de recibirla. Una diferencia
  de recepción permanece visible en tránsito y nunca se absorbe sola.
- Los documentos sólo cambian mediante funciones autorizadas del servidor.
  Cada transición conserva actor, fecha y auditoría; RLS limita la consulta a
  las ubicaciones permitidas y las tablas rechazan mutaciones directas.
- Los recorridos de varias filas toman candados consultivos y procesan
  variantes en orden estable. Las pruebas concurrentes confirman que dos
  traspasos simultáneos conservan el total global y que libro y saldo siguen
  coincidiendo.
- La interfaz de conteos y traspasos se adapta a computadora, iPad y teléfono.
  TypeScript, lint, build, migraciones desde cero, integración y 30 pruebas de
  navegador quedaron verdes antes de promover staging a producción.
- Las migraciones se aplicaron primero en staging y después en producción. La
  verificación posterior encontró cero descuadres, cero conteos abiertos y cero
  traspasos activos previos; Vercel publicó correctamente el merge de `main`.
- M3 queda terminado en software. Sigue pendiente la validación física de M2:
  imprimir y escanear una etiqueta y probar la cámara dentro de la PWA instalada.

Entrega visible 0.21.0–0.22.0 — cierre de M4 e inicio seguro de M5:

- El POS registra ventas atómicas con pagos en efectivo, tarjeta,
  transferencia o combinación; caja admite varias terminales, apertura,
  movimientos y corte realmente ciego.
- Tickets dejó de ser una demostración: consulta las ventas persistidas de los
  últimos 30 días, permite filtrar por periodo y buscar folio, producto, SKU o
  cajero, además de reimprimir el comprobante real.
- `cancel_sale` exige permiso, motivo y que la sesión original continúe
  abierta. Restaura inventario y efectivo en una sola transacción, conserva la
  venta histórica y rechaza intentos repetidos. Después del corte sólo procede
  devolución, por decisión del dueño del 4 de septiembre de 2026.
- Quien despacha un traspaso no puede confirmar su recepción. La separación
  vive en una restricción y un disparador de PostgreSQL, no sólo en la pantalla.
- La bitácora general quedó sellada contra actualización y borrado, incluso con
  acceso privilegiado. La cajera tampoco puede reconstruir el efectivo esperado
  antes de declarar su conteo.
- M5 comenzó con `returns`, `return_items` y `return_payments` como libro
  inmutable. El primer flujo admite cambio parejo con ticket, en la misma
  sucursal y con mercancía revendible; devuelve una variante y descuenta la
  otra atómicamente sin modificar la venta original.
- La diferencia de precio, reembolso, mercancía dañada, otra sucursal y
  devolución sin ticket permanecen deshabilitados hasta que Vaqueros SM defina
  sus reglas. El sistema devuelve un error explícito en vez de inventarlas.
- Las migraciones y pruebas transaccionales de esta entrega se ejecutaron
  primero en staging. Se comprobaron restauración de caja e inventario,
  idempotencia, concurrencia, inmutabilidad y rechazo después del corte.

Entrega visible 0.23.0 — carrito persistente y tickets en espera:

- El carrito activo se guarda automáticamente en Supabase y se recupera al
  volver al POS, incluso desde otro dispositivo, siempre dentro del mismo
  empleado, caja y sesión abierta.
- El cajero puede dejar varios tickets en espera, cobrar a otra persona y
  recuperar el anterior. Ningún borrador reserva inventario ni mueve caja.
- La base impide consultar o recuperar borradores ajenos. Al recuperar se
  vuelven a comprobar artículos activos y, al cobrar, precio, existencia,
  permisos y cualquier descuento.
- La venta confirmada consume el carrito activo dentro de PostgreSQL; cerrar
  caja elimina los borradores restantes. Guardar, recuperar y descartar deja
  auditoría sin copiar datos personales a los logs.
- Como el catálogo actual se maneja por pieza, conteos, ajustes y traspasos
  avanzan de uno en uno y el servidor y la base rechazan milésimas. Una futura
  venta fraccionada requerirá primero modelar explícitamente su unidad.
- Producción conserva dos movimientos históricos con milésimas que dejaron el
  saldo final entero. No se reescriben ni se borran: la restricción se agrega
  `NOT VALID` para respetar la bitácora y bloquear sólo movimientos nuevos.

Entrega visible 0.24.0 — cambio parejo desde Tickets:

- Desde una venta real, el personal con permiso puede seleccionar una pieza
  devuelta y otra variante disponible del mismo valor.
- La búsqueda usa la sucursal de la caja abierta y filtra precio y existencia
  del lado servidor, aun con el catálogo completo de SICAR.
- La venta original permanece intacta. El documento de cambio y ambos
  movimientos de inventario se registran juntos, con auditoría e idempotencia.
- Los casos con diferencia, reembolso, daño, otra sucursal o sin ticket siguen
  deshabilitados hasta definir sus reglas de negocio.

Entrega visible 0.25.0 — auditoría ergonómica intermedia M5.5:

- El alta de producto permite marcar todos los colores o tallas, limpiar la
  selección y elegir un rango continuo Desde–Hasta sin tocar cada talla.
- Los conteos físicos avanzan de forma continua: Enter guarda, conserva el
  foco y prepara la siguiente variante sin recargar la pantalla. Incluyen
  búsqueda por nombre, SKU o código y progreso visible.
- Las solicitudes de traspaso permiten buscar mercancía aun con un catálogo
  grande y conservan las cantidades elegidas al cambiar el filtro.
- Los recorridos se verifican en teléfono vertical, iPad horizontal y
  computadora. La evidencia, interacciones y pendientes físicos quedan en
  `docs/AUDITORIA_ERGONOMIA.md`.
- El siguiente trabajo de software sin bloqueo es M9: analizador repetible,
  mapeo y corrida en seco de las exportaciones reales de SICAR.

Entrega visible 0.26.0 — primera entrega ejecutable de M9:

- `pnpm sicar:analyze` analiza archivos XLSX reales de SICAR en modo de sólo
  lectura, valida las 32 columnas y registra nombre, hoja y huella SHA-256 de
  cada fotografía para hacer el proceso repetible y auditable.
- El reporte conserva `clave1` como texto, cuenta claves, existencias,
  departamentos, costos y precios, y clasifica altas, ausencias, cambios de
  catálogo y cambios de saldo. Ninguna ausencia se convierte en baja automática.
- La corrida real entre el 4 y 6 de septiembre reprodujo 140 altas, 3 ausencias,
  6 cambios de catálogo y 270 cambios de saldo. Cada delta conserva causa nula:
  no se inventan ventas, devoluciones, ajustes ni traspasos.
- La herramienta bloqueó cualquier escritura por 56 saldos negativos, 3 precios
  inválidos y la comprobación física pendiente de `clave1`. Los 15,177 costos
  cero se reportan como advertencias y nunca sustituyen un costo válido.
- La herramienta no contiene credenciales ni llama a SICAR o Supabase. El
  siguiente paso de M9 es el sincronizador idempotente de catálogo sólo en
  staging; existencias, producción y WooCommerce siguen cerrados hasta cumplir
  el runbook del corte.
- Se eliminó la simulación peligrosa de “Apartar”: el botón ahora declara que
  está pendiente de M7 y no vacía el carrito ni fabrica folios. Se verificó que
  la impresión conserve ancho de 80 mm sin fijar una altura inválida; el papel
  continuo depende del controlador y aún requiere validación física.
- Sigue pendiente confirmar si una misma persona puede despachar y recibir un
  traspaso. La política de devoluciones ya quedó decidida e implementada en M5.

Entrega visible 0.27.0 — cierre de M5:

- El plazo de cambios y devoluciones se configura por sucursal entre 0 y 365
  días, se imprime en el ticket y se aplica en PostgreSQL.
- Todo cambio o devolución requiere gerente mediante código y PIN; la
  autorización dura cinco minutos, pertenece al cajero solicitante y se consume
  una sola vez.
- Se permite devolver una parte del ticket y cambiar por mercancía de precio
  distinto. Si falta dinero se cobra la diferencia; si sobra se devuelve por
  los mismos métodos originales, proporcionalmente cuando el pago fue dividido.
- Tarjeta y transferencia exigen referencia nueva de reembolso. El efectivo
  sale de la caja abierta del día y queda incluido en su corte.
- La mercancía revendible regresa a existencia. La dañada registra primero la
  entrada y después la merma, conservando ambas evidencias sin dar permiso de
  ajuste general al cajero.
- La venta y sus pagos originales permanecen inmutables. Idempotencia, candado
  de renglón, libro inmutable y auditoría evitan doble devolución o doble pago.
- La función anterior de cambio parejo quedó revocada para empleados, evitando
  que una llamada directa pueda saltarse la autorización de gerente.
- El ticket usa un CODE 128 real y puede localizarse con lector conectado,
  teclado o cámara del teléfono. Sin ticket y entre sucursales permanecen fuera
  de V1.

Entrega visible 0.28.0 — cierre ergonómico y control de efectivo de M5:

- Venta muestra una acción principal de cambios y devoluciones que abre
  directamente la captura del ticket, sin duplicar la lógica sensible.
- Un administrador puede guardar el PIN de su propia cuenta sin poder cambiarse
  de rol ni desactivarse. Los PIN nunca se muestran ni se almacenan en texto.
- Una devolución en efectivo se serializa contra la sesión de caja y se rechaza
  si el cajón no contiene el importe; la operación completa se revierte sin
  alterar inventario, autorización ni libros.
- La impresión declara rollo continuo de 80 mm y mantiene pendiente la prueba
  física con los modelos reales de impresora.

Entrega visible 0.29.0 — sincronizador seguro de catálogo SICAR:

- M9 ya prepara exportaciones por lotes en tablas privadas y confirma todo el
  catálogo dentro de una sola transacción. Una falla revierte altas y cambios.
- Cada corrida conserva SHA-256 del Excel y del reporte, evidencia de la prueba
  física, simbología y administrador aprobador. Repetir el mismo archivo devuelve
  el resultado anterior y no crea duplicados.
- El modo catálogo agrega o actualiza por la identidad heredada, respeta claves
  con ceros iniciales, no toca existencias, no desactiva ausentes y nunca deja que
  un costo cero sustituya un costo válido.
- La herramienta y la base rechazan proyectos que no sean staging. La migración
  nace deshabilitada y necesita una confirmación explícita del entorno; no fue
  aplicada a producción.
- Las pruebas reversibles en staging comprobaron idempotencia, actualización de
  precio, preservación de costo, producto propio intacto y rollback completo ante
  choque con un código interno reservado.
- El Excel real conserva 16,009 claves únicas, pero no se importó: las claves
  `11420`, `12189` y `17878` tienen precio de venta cero y falta confirmar con una
  etiqueta impresa si `clave1` se lee como CODE128, EAN13 u otra simbología.
- La pantalla de cambios ahora interpreta los objetos de error de Supabase y
  muestra causas útiles en vez del mensaje genérico; el servidor registra el
  código técnico sin guardar PIN ni contenido del ticket.

Entrega visible 0.30.0 — compras, proveedores y recepción:

- Compras permite registrar proveedores, crear órdenes por sucursal y capturar
  productos, cantidades y costo por pieza en una lista continua.
- La orden no mueve inventario. Sólo confirmar una recepción crea movimientos
  `PURCHASE`; una recepción parcial deja visible cuánto falta.
- La operación es atómica e idempotente. La orden se bloquea antes de revisar
  pendientes para impedir que dos recepciones simultáneas ingresen más de lo
  pedido.
- Cada recepción conserva responsable, fecha, sucursal, costo documental y
  detalle. Las tablas de órdenes y recepciones no admiten cambios o borrado
  directo y el cajero no puede consultarlas.
- Desde el historial se preparan etiquetas por la cantidad exacta recibida.
- El costo vigente del producto no se modifica todavía: se conserva el costo
  de compra y se espera la decisión entre promedio ponderado o último costo.

Corrección visible 0.30.1 — ventanas táctiles y avisos accesibles:

- Todas las ventanas operativas comparten un límite basado en la altura visible
  del dispositivo y desplazamiento táctil interno, incluso en teléfonos de poca
  altura y con la PWA instalada.
- Campos, selectores y botones respetan el ancho disponible; las filas de
  acciones pueden reorganizarse sin encimarse ni salir de la pantalla.
- Los avisos de venta, errores de cobro, caja y compras se muestran en la parte
  superior y por encima de cualquier ventana abierta. Ya no es necesario cerrar
  el flujo para conocer el resultado de una operación.
- La verificación automática recorre Producto, Conteos, Proveedores, Caja y el
  cobro dividido en teléfono compacto, iPad vertical y computadora; comprueba
  alcance del contenido inferior, ausencia de controles encimados y orden
  correcto de capas.

Entrega visible 0.31.0 — alta rápida, fotos y etiquetas desde Compras:

- Nueva orden permite crear un producto faltante sin abandonar la captura. La
  misma alta genera en PostgreSQL sus SKU y códigos protegidos, y devuelve todas
  las tallas y colores seleccionados a la orden con cantidades editables.
- El alta de productos admite una fotografía comercial opcional JPG, PNG o
  WebP de hasta 4 MB. Supabase Storage limita tipo y tamaño; RLS exige permisos
  de catálogo y la base conserva únicamente la ruta del entorno correspondiente.
- Las fotografías aparecen en Productos y en Venta; si la carga falla, el
  producto y sus variantes permanecen creados y el sistema informa que la foto
  quedó pendiente.
- Confirmar una recepción abre Etiquetas con la cantidad exacta de cada variante
  ya preparada. No se recortan silenciosamente lotes mayores de 99; imprimir
  todavía requiere confirmación humana para evitar desperdicio de material.
- La orden continúa sin mover existencia. Sólo la recepción confirmada crea los
  movimientos `PURCHASE`; esta mejora no debilita inventario ni códigos SICAR.
- La revisión responsive cubre también los flujos reales reportados: Registrar
  proveedor y Agregar cliente desplazan su propio contenido en teléfono, y en
  iPad el carrito de Venta abre como cajón sobre el catálogo en vez de apilarse
  debajo de él. Las pruebas verifican que los controles finales sean alcanzables.

Corrección visible 0.31.1 — desplazamiento táctil aislado en ventanas:

- Mientras una ventana emergente está abierta, la pantalla de atrás queda
  inmóvil y el gesto vertical se entrega únicamente al contenido de la ventana.
- En teléfono, las ventanas usan una altura táctil definida con respeto por las
  áreas seguras de la PWA; el contenido inferior puede alcanzarse sin que el
  desplazamiento se escape al fondo.
- Una prueba automática abre Registrar proveedor, desplaza desde dentro de la
  ventana y comprueba simultáneamente que el cuadro avanza y el fondo no cambia.

Entrega visible 0.31.2–0.31.3 — hardware confirmado y prueba sin venta:

- Se documentaron los modelos físicos existentes: BIXOLON SRP-330II para
  tickets térmicos de 80 mm y SICAR EVA58 para etiquetas de hasta 58 mm.
- Se retiró una regla CSS de tamaño de página que los navegadores descartaban;
  el largo continuo del rollo se configura en el controlador de la BIXOLON.
- Más módulos incluye una prueba de impresión con ticket normal y de regalo.
  La muestra no crea ventas, no consume folios y no modifica caja ni inventario.
- La guía de primera impresión registra márgenes, escala, corte y lectura del
  código para cerrar la validación física antes del piloto.

Entrega visible 0.32.0 — M8.1, reportes operativos reales:

- Reporte de ventas por día, semana, mes o año, filtrable por sucursal,
  producto, SKU, talla o color. Cada renglón conserva ticket, día, hora y
  cajero para responder consultas concretas de la operación.
- Sin búsqueda de producto, la venta neta debe cuadrar contra la suma de los
  métodos cobrados. Con búsqueda, el sistema muestra sólo el valor de los
  renglones coincidentes y evita atribuirles pagos mixtos de otros artículos.
- Reporte de inventario con existencia, reservado, disponible, faltantes,
  variantes bajas y valor a costo/menudeo para usuarios autorizados.
- Las vistas auxiliares permanecen en el esquema privado y sin permisos
  directos. Las funciones validan identidad, permiso, sucursal, rango máximo de
  366 días y longitud de búsqueda en el servidor.
- M8 continúa después con cotizaciones, PDF local de tickets e historial
  privado para clientes autenticados en Mi Vaquero. M7 ya tiene reglas de
  crédito cerradas; apartados conserva las
  decisiones puntuales enumeradas en su especificación.

Entrega visible 0.33.0 — M8.2, cotizaciones reales:

- Una cotización recibe folio propio por sucursal, cliente opcional, notas y
  una vigencia opcional elegida por el usuario. No se impone un plazo que el
  negocio no haya decidido.
- Sus estados son borrador, enviada, convertida y vencida. Se puede buscar por
  folio, cliente, producto o SKU.
- Crear o enviar una cotización no reserva mercancía, no modifica existencias
  y no genera movimientos de caja.
- “Cobrar en Venta” carga los renglones al POS. El cobro vuelve a validar en el
  servidor precio, disponibilidad, sucursal y vigencia, y usa `create_sale`
  dentro de una conversión atómica. Dos cajas no pueden generar dos ventas de
  la misma cotización.
- Si el precio o el producto cambió, no se cobra silenciosamente con otro
  importe: se rechaza y se prepara una cotización actualizada.
- La conversión parcial continúa pendiente de decisión del negocio. Por ahora
  se cobra el documento completo o se crea uno nuevo.

Entrega visible 0.34.0 — M7.1, autorización de crédito:

- Administración y gerencia pueden autorizar crédito y definir un límite
  global por cliente desde Clientes. Caja no puede cambiar esa autorización.
- La pantalla muestra límite, saldo y disponible sin obligar a navegar a otro
  módulo. Desactivar crédito o reducir el límite por debajo de un saldo futuro
  queda rechazado en el servidor.
- La cartera y su libro contable nacen cerrados al acceso directo, con RLS,
  permisos separados y auditoría del motivo, autor, valor anterior y nuevo.
- El POS sólo obtiene un resumen mínimo de disponibilidad; no recibe permiso
  para editar cuentas. El libro rechaza edición, borrado e inserciones directas
  incluso con acceso privilegiado.
- Esta entrega no finge ventas ni abonos: M7.2 conectará la venta a crédito y
  el cobro de saldos a la caja real. Apartados continúa después, respetando las
  decisiones abiertas de `specs/M7_APARTADOS.md` §6. Lealtad sigue pospuesta.

Corrección visible 0.34.1 — tipos de folio extensibles:

- Los tipos de documento dejan de vivir en una restricción con una lista que
  cada módulo debía reescribir completa. Ahora se validan mediante una tabla
  referenciada: agregar un tipo es insertar un renglón y no puede borrar por
  accidente venta, devolución o cotización.
- La corrección es una migración nueva hacia delante. Las migraciones que ya
  entraron a un ambiente no se vuelven a editar para ocultar diferencias.

Entrega visible 0.35.0 — M7.2, ventas a crédito y abonos:

- Venta permite dejar todo o una parte del ticket a crédito únicamente cuando
  existe un cliente asociado, autorizado, sin atraso y con límite suficiente.
  La fecha de vencimiento propone un mes y puede cambiarse antes de cobrar.
- La comprobación del límite se serializa por cliente dentro de PostgreSQL: dos
  cajas simultáneas no pueden aprobar juntas más crédito del disponible.
- La parte pagada conserva efectivo, tarjeta o transferencia; sólo el efectivo
  real entra al cajón. La parte a crédito genera un cargo en el libro de cartera
  y no infla el corte de caja.
- Clientes permite recibir abonos parciales y combinar métodos. Cada abono
  genera folio, sucursal, caja, empleado, referencias y aplicación FIFO a los
  cargos más antiguos. Repetir una solicitud no duplica saldo ni dinero.
- El saldo se obtiene del libro inmutable; los comprobantes, partes y
  aplicaciones están cerrados al acceso directo y protegidos además por
  restricciones diferidas que exigen conciliación exacta.
- Desde 0.37.0 las devoluciones reducen primero la deuda y sólo reembolsan el
  excedente realmente pagado. Nunca se trata crédito como efectivo.
- Desde 0.38.0 la excepción administrativa por atraso es explícita, de un solo
  uso y auditable; no modifica límite, vencimiento ni historial. En 0.39.0 la
  cancelación compensada cierra M7.2; luego M7.3 implementará
  apartados con las decisiones abiertas de su especificación.

Entrega visible 0.36.0 — estado de cuenta y comprobantes de abono:

- Clientes muestra el libro real de cartera con cargos, abonos, folios,
  sucursal, empleado, vencimiento y saldo, sin habilitar edición directa.
- Cada abono abre su comprobante real con el desglose de efectivo, tarjeta y
  transferencia, y se puede imprimir en rollo de 80 mm.
- La consulta del comprobante valida sesión, permiso y acceso a la sucursal en
  el servidor. No expone las tablas cerradas ni confía en el identificador que
  llega desde la URL.
- El envío externo del comprobante no se habilita todavía: antes se debe
  definir el contenido mínimo, el destinatario y el consentimiento para no
  compartir saldo o datos personales por accidente.
- Se integra la corrección estructural de 0.35.1: los tipos del libro de caja
  pasan de una lista reescribible a una tabla referenciada y se revocan los
  permisos de tabla que Supabase concede por omisión. La misma mejora del libro
  de inventario se hará junto con apartados, no como cambio aislado.

Entrega visible 0.37.0 — devoluciones de crédito conciliadas:

- Una devolución aplica primero su importe al saldo pendiente del cargo
  original. Sólo el sobrante que el cliente sí pagó se devuelve como dinero.
- Los abonos FIFO se rastrean hasta sus métodos reales. Si fueron mixtos, el
  reembolso conserva efectivo, tarjeta y transferencia en centavos exactos.
- El cajón sólo disminuye por la porción realmente devuelta en efectivo y
  conserva la protección que impide dejarlo en negativo.
- El POS explica antes de confirmar cuánto reducirá deuda y cuánto se
  reembolsará; después muestra ambos importes por separado.
- La conciliación queda en un libro inmutable, con RLS, mínimo privilegio,
  auditoría y restricción diferida entre venta, devolución, cargo y ajuste.
- La cancelación antigua se niega de forma atómica para ventas con crédito:
  no puede restaurar mercancía dejando una deuda huérfana. La cancelación
  compensada completa permanece como el siguiente subbloque de M7.2.

Entrega visible 0.38.0 — excepción administrativa ante atraso:

- Una cuenta vencida sigue bloqueando el crédito ordinario, pero el POS permite
  solicitar la autorización puntual sin perder el carrito ni volver a capturar
  los métodos divididos.
- Sólo un ADMIN con `credit.override` puede autorizar. El token dura cinco
  minutos, pertenece al cajero que lo solicitó, se consume una vez y se liga a
  la venta real.
- La excepción no altera la cuenta: el vencimiento y el saldo atrasado siguen
  visibles. La auditoría conserva autorizador, operador, cliente, montos,
  fechas y operación permitida.
- La ruta normal de venta a crédito permanece intacta. La excepción usa una
  función adicional protegida para limitar el radio de una falla.
- La administración global ya es consistente dentro de los módulos:
  Inventario, Clientes y Compras usan la misma lista de tiendas activas que la
  cabecera. Un ADMIN que elige La Piedad Prueba ya no ve contenido ni selector
  calculados con su antigua asignación individual a La Piedad.

Entrega visible 0.39.0 — cancelación compensada de venta a crédito:

- Cancelar una venta a crédito crea primero una devolución completa por las
  unidades que todavía no hubieran regresado. No reutiliza el reverso M4 y por
  eso no duplica inventario ni efectivo.
- El importe extingue primero la deuda del cargo original. Únicamente el dinero
  realmente recibido se devuelve por su método real, con referencia electrónica
  y protección de efectivo disponible en el cajón.
- Desde 0.40.0, la persona dueña de la caja puede ejecutarla con
  `returns.create`; la autoridad sigue siendo un gerente mediante autorización
  de devolución de un solo uso. También exige motivo y caja abierta en la
  sucursal del ticket.
- La venta se marca cancelada sólo después de que devolución, cartera, pagos,
  inventario y caja concilian. Todo el recorrido es atómico, idempotente y deja
  la relación con el documento compensatorio en auditoría.

Entrega visible 0.40.0 — inicio de M7.3, apartados reales:

- Venta habilita nuevamente “Apartar”, ahora conectado a PostgreSQL. Exige
  cliente, fecha de vencimiento y caja propia abierta; no fabrica folios ni
  vacía el carrito si la operación falla.
- El apartado inicia sin enganche, por la regla confirmada de que no existe un
  mínimo. Crear el documento no registra una venta ni mueve dinero de caja.
- La mercancía queda reservada de forma atómica y deja de estar disponible para
  venta. La existencia física no se altera: un libro inmutable independiente
  registra cada cambio del saldo reservado con anterior, nuevo, actor y folio.
- Dos cajas que intentan reservar las últimas piezas no pueden ganar juntas.
  La idempotencia evita que un reintento duplique documento o reserva.
- El módulo Apartados permite consultar por folio, nombre o número de socio y
  muestra vigentes, próximos a vencer y vencidos sin cancelación automática.
- La incompatibilidad de una sola caja detectada al revisar M7.2 quedó resuelta:
  la persona dueña de la sesión ejecuta la cancelación de crédito y el gerente
  conserva la autoridad mediante PIN y token de un solo uso. La auditoría
  distingue operador y autorizador.
- Continúan para los siguientes bloques de M7.3: abonos y comprobantes,
  cancelación con penalización, sustituciones, liquidación y entrega. La
  interfaz no presenta estas operaciones como terminadas antes de existir.

Entrega visible 0.41.0 — abonos reales de apartados:

- Apartados recibe abonos parciales o totales desde la misma ficha, con efectivo,
  tarjeta, transferencia o combinación exacta de los tres métodos.
- PostgreSQL vuelve a calcular el saldo bajo candado. Un reintento devuelve el
  mismo comprobante y dos cajas no pueden cobrar por encima del saldo restante.
- Sólo el efectivo incrementa el cajón. Tarjeta y transferencia conservan su
  referencia; el historial de pagos y sus partes no se edita ni se borra.
- El comprobante registra folio del abono y del apartado, cliente, caja, empleado,
  desglose por método, saldo anterior y nuevo, y se imprime a 80 mm.
- Liquidar cambia el estado a `PAID`, pero no libera ni entrega mercancía. La
  cancelación, sustitución y entrega siguen bloqueadas hasta sus operaciones
  atómicas correspondientes.

Entrega visible 0.42.0 — cancelación segura de apartados vencidos:

- Apartados permite cancelar manualmente un documento vencido con permiso y
  motivo obligatorio. No existe cancelación automática al llegar la fecha.
- Todo lo abonado se conserva como penalización según la regla confirmada; el
  saldo restante queda documentado y la operación no inventa retiros ni
  devoluciones de caja.
- Las piezas reservadas vuelven a disponibilidad de forma atómica. Cada cambio
  se escribe en el libro inmutable de reservas y una inconsistencia revierte la
  cancelación completa.
- La idempotencia y los candados impiden que un reintento o dos operadores
  liberen dos veces la misma mercancía o dupliquen la penalización.
- La pantalla anticipa el efecto antes de confirmar y comunica por separado
  penalización, saldo cancelado y mercancía liberada.
- La cancelación de un apartado todavía vigente se rechaza hasta definir qué
  excepciones devuelven abonos y por cuál método. Sustitución y entrega siguen
  como los siguientes bloques de M7.3.

Entrega visible 0.43.0 — sustituciones atómicas en apartados:

- La ficha de cada apartado muestra sus productos reales. Administradores y
  gerentes pueden elegir una línea, buscar por producto, talla, color, SKU o
  código y sustituirla sin volver a capturar el documento.
- La autorización se separa en `layaways.modify`; el permiso operativo general
  de una cajera no le permite cambiar mercancía por omisión.
- PostgreSQL libera la reserva anterior, comprueba y reserva la nueva variante,
  actualiza el renglón y recalcula total, saldo y estado como una sola operación.
- Los abonos históricos permanecen intactos. Un producto de mayor precio aumenta
  el saldo; uno que dejaría el total por debajo de lo pagado se rechaza porque
  todavía no se ha definido cómo devolver ese excedente.
- Cada sustitución registra variantes, precios, cantidades, totales, saldos,
  motivo y actor en un historial inmutable. Reintentos y operaciones simultáneas
  no pueden aplicar dos cambios sobre la misma versión del renglón.
- Continúan para cerrar M7.3 la liquidación y entrega, la política excepcional de
  devolución y la entrega en otra sucursal mediante traspaso confirmado.

Entrega visible 0.44.0 — liquidación y entrega de apartados:

- Apartados permite entregar mercancía sólo cuando el saldo llegó exactamente a
  cero y el documento está `PAID`. La persona operadora debe tener
  `layaways.deliver`, `pos.sell`, acceso a la sucursal y su propia caja abierta.
- La entrega crea una venta real, conserva cliente, artículos, precios y el
  desglose histórico de métodos de pago; el ticket queda disponible para
  consulta e impresión.
- Los abonos no se cobran otra vez ni generan un segundo movimiento de caja. El
  vínculo inmutable entre apartado y venta permite demostrar de dónde salió
  cada importe.
- Existencia y reserva se descuentan juntas; los libros de inventario y reservas
  registran la relación entre folio de apartado y folio de venta. Una falla
  revierte venta, entrega e inventario completos.
- La idempotencia y el candado del apartado garantizan una sola venta aun cuando
  dos dispositivos confirmen al mismo tiempo.
- La entrega en una sucursal diferente no se simula. Continúa pendiente definir
  quién solicita y autoriza el traspaso y exigir su recepción física antes de
  permitir la entrega.

Corrección visible 0.32.1 — traspasos y sucursales operables:

- Más módulos deja de anunciar los traspasos como pendientes y enlaza al flujo
  real de Inventario: solicitud, aprobación, preparación, despacho y recepción.
- El alta de una sucursal se vuelve atómica. Además de guardar sus datos, asigna
  acceso al administrador que la crea y abre Caja 01 cuando es una tienda.
- La clave de la sucursal queda inmutable porque forma parte de los folios
  históricos. La ubicación técnica de tránsito tampoco puede editarse.
- La escritura directa de sucursales se revoca para empleados; el único camino
  expuesto valida `locations.manage`, registra auditoría y evita altas a medias.
- La comprobación reversible en staging confirmó que la sucursal aparece de
  inmediato en traspasos y que un gerente sin el permiso no puede crearla.
- La migración se promovió a producción con autorización explícita y repitió la
  prueba reversible sin dejar sucursales de prueba ni cambios residuales.

Corrección visible 0.32.2 — sucursal activa y recepción clara:

- La sucursal elegida se conserva durante la navegación y se resuelve siempre
  contra las ubicaciones realmente asignadas al empleado. Venta, Caja,
  Inventario, Compras, Tickets y Reportes comparten la misma selección.
- Crear una tienda la convierte en la sucursal activa del administrador. La
  operación sigue naciendo completa: acceso para quien la crea y Caja 01 propia.
- Administración permite asignar una o varias sucursales a cada empleado. El
  reemplazo es transaccional, exige `users.manage`, conserva al menos una
  ubicación activa y no permite que el administrador cambie su propio acceso.
- La cabecera distingue la sucursal seleccionada de la caja realmente abierta;
  dejó de afirmar siempre “Caja 01”. Los tickets imprimen el nombre real de la
  caja que registró la venta.
- Si una caja está abierta en otra sucursal, Venta lo detecta también cuando la
  ubicación proviene de la preferencia guardada y no sólo de la URL.
- La recepción de traspasos mantiene separación de funciones: quien aprobó o
  envió no puede recibir. La interfaz lo explica antes del intento y los errores
  de Supabase ya no se degradan al mensaje genérico “guardar el ajuste”.
- El traspaso real #1 quedó en tránsito hacia La Piedad Prueba: Emmanuel lo
  solicitó, aprobó y envió, por lo que debe recibirlo otro empleado autorizado
  en el destino. No se alteró el documento ni el inventario para evadir el
  control.

Corrección visible 0.37.1 — administración global por sucursal:

- El rol `ADMIN` puede seleccionar y operar todas las tiendas activas del
  negocio sin depender de una asignación individual en `user_locations`.
- Gerentes, cajeros, almacén y los demás roles conservan el principio de mínimo
  privilegio: sólo operan las sucursales que les fueron asignadas.
- La ubicación técnica de tránsito queda fuera del selector y no se convierte
  en una sucursal operable.
- El alcance se valida también en PostgreSQL mediante
  `app.can_access_location`; no depende únicamente de mostrar la sucursal en la
  interfaz.
- La separación de funciones de traspasos permanece intacta. Un administrador
  global puede recibir en el destino sólo si no fue quien aprobó o despachó el
  mismo traspaso.
- Caso real que motivó la regla: Salomón, con rol Administrador y acceso
  individual sólo a La Piedad, debe poder cambiar a La Piedad Prueba y recibir
  el traspaso enviado por Emmanuel sin crear asignaciones manuales para cada
  tienda nueva.

Entrega visible 0.46.0 — cancelación anticipada de apartados:

- Administradores y gerentes pueden cancelar un apartado antes de vencer con
  permiso específico, motivo y una decisión explícita sobre devolución y
  penalización. Una cajera conserva abonos, pero no obtiene esta autoridad.
- Los abonos originales permanecen inmutables. Un documento compensatorio
  separa cuánto se devuelve, cuánto se retiene y qué saldo pendiente se cancela.
- El reembolso se reparte proporcionalmente entre los métodos efectivamente
  abonados. Tarjeta y transferencia exigen referencia nueva; ningún pago
  electrónico se convierte silenciosamente en efectivo.
- La devolución en efectivo exige una caja propia y abierta. El candado de la
  sesión y el control estructural de caja impiden que dos operaciones gasten el
  mismo dinero o que el cajón quede negativo.
- Liberación de reserva, documento financiero, movimiento de caja y auditoría
  se confirman juntos. Un fallo revierte todo y la idempotencia impide repetir
  la devolución o liberar las piezas una segunda vez.
- M7.3 continúa abierto únicamente para sustituciones cuyo nuevo total quede
  debajo de lo ya abonado y para entrega en otra sucursal mediante un traspaso
  físicamente recibido. No se simula ninguno de esos dos recorridos.

Entrega visible 0.47.0 — gerencia autoriza sin ocupar una segunda caja:

- La regla general de mostrador queda confirmada: la persona dueña de la caja
  ejecuta la operación monetaria y un gerente o administrador la autoriza con
  código y PIN. No se mueve el dinero a un cajón administrativo ficticio.
- La cancelación anticipada de apartados adopta el mismo patrón que la
  cancelación de crédito. La autorización dura cinco minutos, está ligada al
  ejecutor y se consume una sola vez dentro de la misma transacción.
- El documento y la bitácora distinguen al ejecutor del autorizador. La caja
  usada, el reembolso, la penalización, la liberación de mercancía y el consumo
  de la autorización confirman juntos o se revierten juntos.
- La interfaz muestra esta operación a quien administra apartados, pero el
  backend exige tanto el permiso operativo como la capacidad excepcional de
  gerencia; la seguridad no depende de esconder botones.

Entrega visible 0.48.0 — apartados entregables entre sucursales:

- Desde un apartado liquidado, una persona con permisos de entrega y traspasos
  puede solicitar que todas sus piezas viajen a otra tienda. La solicitud usa
  el documento real de traspaso y aparece en Inventario para continuar su ciclo.
- La tienda origen aprueba, prepara y despacha; la tienda destino recibe con la
  separación de funciones ya establecida. No se acepta cantidad parcial para
  mercancía prometida a un cliente.
- Existencia y reserva se trasladan juntas del origen a tránsito y del tránsito
  al destino. El apartado queda inmóvil mientras el traspaso está activo y su
  sucursal sólo cambia después de una recepción física completa.
- La venta final se genera en la sucursal destino desde su propia caja, conserva
  los abonos históricos y no vuelve a cobrar. Auditoría enlaza apartado,
  traspaso, actores, ubicaciones y ticket.
- M7.3 queda pendiente únicamente de la política financiera para sustituir por
  mercancía cuyo nuevo total sea menor que lo ya abonado; el sistema continúa
  bloqueando esa operación en vez de inventar un reembolso.

Entrega visible 0.49.0 — comprobantes claros y operación vertical:

- La operación diaria debe completarse en teléfono vertical. La prueba de
  regresión recorre Inicio, Venta, Productos, Inventario, Clientes, Caja,
  Tickets, Apartados, Reportes, Administración y Ajustes a 390 × 844; valida
  ancho y desplazamiento completo de cada ruta.
- El ticket de regalo usa un código de barras real. Se elimina cualquier cuadro
  decorativo que parezca QR sin contener información verificable.
- El comprobante de abono se imprime como ticket térmico de 80 mm con logotipo,
  sucursal, caja, métodos, saldo pendiente, folio y código escaneable.
- Registrar un abono confirma explícitamente el importe aplicado y el saldo
  restante calculado dentro de la transacción.
- Confirmar la entrega de un apartado abre directamente la venta generada en
  Tickets para imprimirla o descargarla; el historial sigue siendo la fuente
  permanente para reimpresiones.

Entrega visible 0.50.0 — calibración física de tickets y etiquetas:

- La medida real de la etiqueta del mostrador es **51 × 25 mm**. Esa medida se
  convierte en la plantilla predeterminada tanto en instalaciones nuevas como
  en bases existentes mediante una migración hacia delante.
- La etiqueta usa menos margen y un logotipo mayor, pero conserva producto,
  variante, código de barras, código legible y precio dentro de un único
  troquel. La configuración de la EVA58 debe usar también 51 × 25 mm, sin
  márgenes y a escala 100 %.
- Los tickets impresos y los PDF aumentan su tipografía y la presencia del
  logotipo para acercarse al comprobante de SICAR validado en la tienda. El
  código de barras propio permanece para búsqueda y reimpresión.
- La evidencia física prevalece sobre tamaños supuestos: si cambia el insumo,
  se mide primero y se calibra la plantilla antes de imprimir un lote.
- El lector USB ya fue validado físicamente. En la pantalla Tickets, el código
  escaneado abre de inmediato el comprobante correspondiente, incluso si el
  buscador no tenía el foco; Enter y Tab se aceptan como terminadores del lector.

Entrega visible 0.50.1 — segunda calibración con evidencia física:

- La plantilla de 51 × 25 mm debe optimizar el área visible del logotipo, no el
  rectángulo transparente del archivo PNG. Logotipo, variante, barras y código
  legible deben quedar contenidos en una sola etiqueta; el área imprimible no
  puede continuar en el siguiente troquel.
- La impresión térmica de tickets ofrece un modo opcional **Todo en negritas**
  para equipos cuyo cabezal pierde trazos delgados. Se aplica igual a vista,
  impresión y PDF de mostrador, y se recuerda por computadora.
- El modo en negritas no sustituye la calibración de densidad del controlador:
  si los trazos gruesos también salen incompletos, se corrige la oscuridad de la
  BIXOLON y se revisa el cabezal antes de seguir cambiando el diseño.

Entrega visible 0.51.0 — aprendizaje presencial y documentos comerciales:

- La validación en La Piedad confirma que `clave1` del archivo SICAR es el
  valor impreso en las etiquetas actuales. Mi Tienda SM lo conserva como
  `legacy_sicar_code` y lo usa en etiqueta cuando existe; su SKU y código
  propio siguen siendo independientes para no quedar atados a SICAR.
- La etiqueta física es 51 × 25 mm, incluye clave de tienda, logotipo,
  descripción, talla/color, precio, barras grandes y `clave1` legible. La
  sucursal debe poder reconocerse sin consultar la base.
- Un lector USB actúa como teclado: códigos de producto buscan/agregan producto;
  folios `…-V-…` y tickets de regalo `R-…-1` abren la venta original. La
  distinción se valida antes de navegar para no confundir `17996` con un folio.
- Ticket térmico y PDF de mostrador refuerzan siempre las líneas críticas que
  el cabezal perdió. El modo **Todo en negritas** queda disponible para el resto
  del contenido.
- Venta y Cotizaciones disponen además de un PDF formal, separado del ticket de
  rollo, con identidad, cliente, partidas, descuentos, totales, vigencia y
  observaciones para compartir con empresas.
- La interfaz permite escala de texto pequeña, normal, grande y extra grande,
  teclado físico para efectivo y una acción Regresar consistente. Estas
  preferencias de lectura no alteran documentos impresos.

Corrección visible 0.52.1 — clave corta de sucursal en etiquetas:

- El código operativo de una sucursal (`LAP`, por ejemplo) permanece inmutable
  porque ya forma parte de folios históricos. No se reutiliza como dato visual.
- Cada tienda o bodega tiene una clave exclusiva para etiquetas, de una a cuatro
  letras o números. Las existentes reciben `VSM1`, `VSM2`, `VSM3` y así
  sucesivamente; Administración permite personalizarla sin alterar ventas.
- La etiqueta imprime esa clave corta y la sesión la obtiene de la sucursal
  activa. El backend normaliza mayúsculas, evita duplicados, audita los cambios
  y asigna una clave segura a las sucursales nuevas si el administrador la deja
  vacía.

Entrega visible 0.51.1 — impresión y lectura física confiables:

- Etiquetas carga el archivo directo del logotipo con prioridad y espera a que
  imagen y tipografías estén listas antes de abrir el diálogo de impresión. La
  hoja térmica no puede adelantarse y dejar el espacio del logotipo en blanco.
- El lector USB permanece activo mientras está abierta la ventana de cámara de
  Tickets. Desde Venta, un folio navega al comprobante; desde Cambios /
  devoluciones, el mismo escaneo abre la compra sin exigir cerrar la ventana.
- Las pruebas de navegador verifican que el logotipo tenga dimensiones reales
  al imprimir y que el folio abra el ticket desde ambos puntos de operación.

Corrección visible 0.51.2 — lector USB con distribución distinta:

- La lectura física observada `LAP'V'000016` se interpreta como el folio real
  `LAP-V-000016` antes de consultar la venta. La normalización también cubre
  tickets de regalo y se aplica desde Tickets, Venta y Cambios / devoluciones.
- La sustitución de apóstrofes se restringe al analizador de folios; códigos de
  producto como `clave1` conservan su contenido original.

Subfase financiera aprobada — recepción de dólares:

- La referencia automática será el tipo FIX **SF43718** publicado por Banco de
  México en SIE. La consulta se hace exclusivamente en servidor y el token de
  Banxico nunca llega al navegador.
- Fines de semana, días inhábiles o indisponibilidad usan el último valor válido
  almacenado, mostrando fecha y origen. No se inventa ni sustituye en silencio.
- Gerencia puede definir un ajuste comercial sobre la referencia; el sistema
  conserva quién lo autorizó, motivo, referencia, ajuste y tasa final.
- Cada venta guarda una instantánea inmutable: dólares recibidos, tasa aplicada,
  equivalente MXN y cambio. Efectivo USD y MXN se concilian por separado; el
  cambio se entrega en MXN salvo una política futura explícita.
- Esta subfase exige migración hacia delante, RLS/permisos, operación atómica de
  caja y pruebas de concurrencia. Hasta cumplirlas no se presenta como método de
  pago activo.

Entrega visible 0.53.0 — creación de cuentas desde Mi Vaquero:

- El diseño aprobado de Mi Vaquero incorpora “Ya tengo cuenta” y “Crear
  cuenta”. El cliente captura nombre, teléfono, correo, fecha de nacimiento
  opcional y consentimientos sin intervenir en el acceso del personal.
- La cuenta se completa sólo después de verificar el correo. La operación final
  pasa por servidor, valida la sesión y registra exactamente la versión del
  aviso publicada; el navegador no puede inventar ese dato.
- Un correo verificado puede vincular un cliente ya existente. Un teléfono no
  verificado que ya pertenece a otra persona se detiene para conciliación en
  tienda y nunca se usa para tomar su cuenta.
- Una identidad presente en `app_users` se rechaza: cuentas de empleados y de
  clientes permanecen separadas aunque compartan el mismo proveedor Auth.
- La creación es idempotente, genera el número de socio y deja auditoría sin
  duplicar datos personales. El autorregistro global de Supabase permanece
  cerrado.
- Marketing es una autorización opcional aparte. El formulario sólo se habilita
  cuando el aviso aprobado tenga versión y URL configuradas. Puntos,
  recompensas y redenciones siguen pospuestos hasta definir sus reglas.

Entrega visible 0.52.3 — hoja de estilos legible y reglas móviles vivas:

- La reparación de codificación que siguió a 0.51.0 dejó `app/globals.css`
  minificado en una sola línea. No se perdió ninguna regla, pero sí el
  whitespace que en CSS es significativo, y con él tres cosas que el navegador
  descarta en silencio: la consulta `@media (min-width: 601px) and
  (max-width: 820px)` completa, 17 declaraciones con `calc()` y dos
  combinadores descendentes.
- El bloque muerto era exactamente el del iPad del mostrador: carrito como
  cajón táctil, fondo, botón flotante y contador de piezas. Las declaraciones
  `calc()` descartadas eran la aritmética de barra inferior y área segura en
  teléfono e iPad.
- Regla operativa que deja esta revisión: una corrección de codificación no
  puede reescribir el formato del archivo. Si un archivo sale de una corrección
  con otra forma, se compara regla por regla contra la última versión buena
  antes de darlo por bueno.
- `format:check` no cubre `app/`, así que CI siguió en verde con la hoja de
  estilos rota. Extender la cobertura queda registrado en la cola de trabajo
  como tarea propia; reformatear archivos que hoy nadie formatea no debe
  mezclarse con una corrección.
- Verificado ejecutando: Chromium reporta `not all` para la consulta sin
  espacio y calcula 0 para `calc(var(--a)+ var(--b))`; `next build` omitía el
  bloque `@media` compuesto del CSS emitido y ahora lo incluye.

Entrega visible 0.52.3 — identidad visible y claves de etiqueta claras:

- El acento de la identidad definido en `app/workspace-brand.css` vuelve a ser
  el que se ve. La preferencia de color sólo se aplica cuando alguien la eligió,
  y entonces mueve los cuatro tokens juntos: acento, hover, presionado y suave.
  Elegir un color se puede deshacer con la opción **Identidad**.
- Regla operativa que deja esta revisión: la paleta vive en un solo archivo
  (`lib/accent.ts`). Cuando dos archivos describen la misma paleta, uno termina
  pisando al diseño sin que nadie lo note.
- La clave corta de sucursal que se imprime en la etiqueta es un identificador
  físico: no se reacuña sola, su choque con otra sucursal tiene nombre propio
  (`LABEL_CODE_TAKEN`) y Administración explica cada rechazo en lugar de decir
  sólo que no se pudo guardar.
- Regla operativa para impresión: todo lo que se imprime fija su tipografía.
  El ticket térmico ya lo hacía; la etiqueta la heredaba de la pantalla, y el
  rediseño acababa de cambiarla. Una calibración física no puede depender del
  tema visual.
- Verificado ejecutando: las 94 migraciones aplican limpias sobre una base
  vacía; el disparador de claves conserva la existente ante un nulo, acuña sólo
  en altas nuevas y sigue rechazando duplicados; `upsert_location_v2` conserva
  `NOT_AUTHORIZED`, `LOCATION_CODE_TAKEN` y `LOCATION_CODE_IMMUTABLE`; 45
  pruebas unitarias y 114 de navegador en verde; medición en la aplicación real
  a 390 × 844, 768 × 1024, 1024 × 1366 y escritorio sin desplazamiento
  horizontal ni controles perdidos.


## Registro vivo — revisión del piloto y contenido web (2026-10-01)

### Sombrero de etiqueta incorporado al catálogo staging — 2026-10-03

Padre Woo 19746 SOMBRERO TOMBSTONE 30X RANDA 1132: seis coincidencias exactas de SICAR (5), códigos 2391–2396 / tallas 54–59 / precio público 2190.00 / UNISEX / SOMBRERO TOMBSTONE. La captura Woo del 1 de octubre tiene siete hijos: talla 60 (19816) sin fila SICAR conciliada, excluida en revisión manual. No es familia web completa; no se habilitó envío Woo ni se inventó Clave1 o stock. Los seis códigos confirmados se incorporaron exclusivamente al catálogo de staging.

Preparación reproducible en outputs/m9-sombrero-etiqueta-2026-10-03/prepare.mjs: verifica huellas de reporte/fuente, vínculo único por código, atributos literales, nombres/base y comprobaciones comerciales. Dos payloads idénticos, SHA256 8ecb76a9e8a326e1dbc6cdc355b3639318ae261db066d901b1963e563132ca99. Plan privado sin errores, ensayo transaccional rollback: seis altas, repetición sin cambios, preservación de catálogo previo/fuentes/borradores/cola/inventario. Aplicación real a zsezjtswqeijboezvado: 6 creadas, 0 actualizadas; repetición real 0 creadas, 0 actualizadas, 6 sin cambios. Piloto: 41 productos / 50 variantes. Costos NULL y mayoreos sin definir.

Producto staging eae132eb-8111-418a-b30c-86a199934e62; variante 2396: 6da4feb2-7146-4d4d-b865-6af14cc02a9b. Lectura final preserva huellas del catálogo previo 0b383408d10c27de98fdf51768b5f677 y snapshots b30594ca2e87a49a4427eb0407e0a031. Inventario y movimientos cero. UI Productos: búsqueda escrita 2396 devuelve sólo talla 59 a $2190.00, evidencia busqueda-2396.jpg. Esto no acredita captura con cámara/USB; la foto ya fue decodificada en el turno anterior. physicalBarcodeVerified permanece false hasta prueba física completa.

Preview 0.61.0 sin cambio de código ni despliegue en esta entrega. Avance técnico estimado se mantiene 68%; la ampliación del piloto no sustituye escaneo físico, revisión comercial o corte final. Siguiente: prueba física de 2396, revisión de talla 60 y preparación de contenido web complementario sin habilitar familia incompleta. No hubo producción, importación de existencias ni integración de mejoras del otro chat. Staging aún no cerrado.


### Revisiones de envío independientes del texto — 2026-10-03

Implementada 0.61.0: el número de envío avanza independientemente de la revisión editorial. La cola compara contenido/catálogo revisado, conserva el recibo anterior y bloquea repeticiones sin cambios. Reclamar revalida todos los campos salvo el siguiente número calculado; cambios de texto, fuente o evidencia siguen dejando SUPERSEDED. La lectura de estado ordena por secuencia para evitar empates de fecha transaccional. Productos simples también exigen fila SICAR revisada coincidente; familias conservan sus controles de evidencia. Nuevas funciones privadas, sin permisos API.

27 comprobaciones SQL de staging con rollback: simples y variables, precio sin edición, revisión administrativa previa, idempotencia, doble solicitud, cambio posterior, segundo precio, texto después de precios y permisos. Se detectó y corrigió el orden de estados empatados en una segunda migración independiente (20261003154946), conservando la primera (20261003154512). 144 unitarias, tipos y lint aprobados. Ensayo Woo real exclusivamente local sobre familia sintética 23/hijo 24: 820→821→820, texto intacto, cuatro hermanos sin cambios y repetición cero solicitudes. No modifica el padre nativo 33 ni registra esos precios ficticios como importación SICAR.

Catálogo y snapshots staging conservan huellas 0b383408d10c27de98fdf51768b5f677 y b30594ca2e87a49a4427eb0407e0a031; cuatro jobs reales anteriores, 44 variantes, inventario/movimientos cero. Evidencia outputs/m9-precio-local-2026-10-03. Captura SICAR (5) no trae cambios reales de precio: el ensayo es sintético y reversible. Falta probar un nuevo cambio comercial real cuando exista una exportación que lo contenga, ampliar lote revisado y coordinar mejoras del otro chat antes de cerrar staging. Producción sigue 0%. Estimación técnica 68%; no equivale a porcentaje de catálogo importado. Despliegue/CI de 0.61.0 pendiente de verificación al escribir esta entrada.


### Nuevo corte SICAR (5) verificado — 2026-10-03

Recibida Plantilla_Productos (5).xlsx, preservada sin cambios; SHA256 58efc810c7c8031b1d47fbaa721b7d5658870bcd10fa220d2b369f8fb2e9e61e. Conciliación con las mismas reglas m9-readonly-5 y captura Woo autenticada del 1 de octubre. 16133 filas: tres altas (18056, 18057, 18058), cero ausencias y cero cambios de precio/campos de catálogo existentes. Los dos últimos comparten descripción CINCUARESSTANEG40; mantener códigos separados en revisión, sin afirmar duplicación física. 18056 sólo carece de coincidencia en esa captura Woo, no se verificó ausencia en vivo.

Delta: 16062 UNCHANGED, 45 RECONCILIATION_CHANGE_ONLY, 23 INVENTORY_ONLY_EXCLUDED y 3 NEW_MANUAL_REVIEW. Las 45 alertas cambian exclusivamente por existencias comparadas con Woo histórico (42 aparecen, tres desaparecen); identidad y demás comprobaciones no cambian. 68 filas compartidas con inventario modificado, excluido. Lectura en vivo de staging: 44/44 variantes mantienen código, descripción, departamento/sección, precio, atributos e IDs Woo coincidentes; costos NULL e inventario/movimientos cero. Ninguna escritura ni importación.

Dos generaciones idénticas, doce archivos verificados contra SHA256 y byte por byte. Evidencia outputs/m9-reporte-sicar5-2026-10-03, outputs/m9-delta-sicar5-2026-10-03 y directorios de repetición; reporte-avance.md, staging-read.json y verificacion.json en el delta. Preview sigue 0.60.0. Avance técnico estimado 65%, producción 0%; análisis de un corte nuevo no cierra staging ni el ensayo pendiente de precio sin edición editorial. Próximo hito: separar revisión de envío/texto, probar actualización de sólo precio en staging/local, revisar altas y refrescar Woo antes de ampliar. Mejoras del otro chat no integradas.



Preparada versión 0.55.4, aún no publicada, en work/m9-ui (rama codex/m9-staging-review, base 5366bd4). Consulta nativa /productos/migracion: permiso products.read, búsqueda exacta/textual, clasificación por variante, paginación y costos NULL protegidos. Migración 20261001235334 aplicada sólo a staging. 18 comprobaciones SQL con rollback y 40/40 filas origen/destino correctas; inventario intacto. 65 pruebas unitarias, lint, tipos y build aprobados. Avatar S local muestra 0.55.4; muestra estática del componente revisada en teléfono e iPad. NO confundir esa muestra con sesión nativa autenticada: Preview, recorrido completo y lector físico del piloto siguen pendientes.

Corregido costo vacío tanto en formulario como en servidor, evitando convertirlo en cero. Clave 1 se conserva exactamente en barcodes.source=SICAR; SKU interno independiente. Precio1 es público; mayoreos siguen sin definir. SICAR continúa maestro antes del corte.

Se avanzó después a scripts/m9/prepare-web-content.mjs: paquete local reproducible de textos, fotos, IDs, atributos y promociones para 40 padres/40 variantes. Todos tienen descripción larga e imágenes en la exportación; 38 familias tienen variantes adicionales que deben preservarse. IDs de categorías requieren correspondencia explícita. No es un importable, no crea productos Woo ni implementa todavía el alta web completa.

Detalle: docs/M9_REVISION_UI_Y_CONTENIDO_WEB.md en work/m9-ui. Evidencia en outputs/m9-revision-ui-2026-10-01 y outputs/m9-contenido-web-2026-10-01. Sin producción, Woo ni existencias. No hay despliegue, merge o push. Pendiente integrar las herramientas de work/m9 con la rama reciente, desplegar Preview y verificar sesión staging; después completar captura/persistencia de ficha web y reintentos en entornos de prueba.


## Registro vivo — Preview M9 desplegado (2026-10-01)

Publicado exclusivamente Preview 0.55.4 desde b7086e3fec5eae4278d1bffdbba86f65210b87be. PR borrador #87: https://github.com/procesalab0-prog/Vaquero-HUB/pull/87. Pantalla: https://vaquero-hub-git-codex-m9-staging-review-procesa-lab.vercel.app/productos/migracion. Vercel confirma entorno Preview y la variable pública apunta a zsezjtswqeijboezvado; no se tocaron variables ni producción.

CI #255 aprobado completo: instalación congelada, formato, lint, tipos, base vacía/migraciones, pruebas unitarias e integración, build y 128 pruebas E2E. La rama remota tiene exactamente el árbol local probado (9332287d1e58bd7ea6452ecbb33039474915859c). Git sin credencial de escritura local; se utilizó el conector autorizado de GitHub. No se fusionó main.

Acceso anónimo probado: redirige a login, sin mostrar catálogo. Solicitada sesión del usuario en staging para cerrar el recorrido autenticado de revisión del piloto; pendiente, junto con lector físico. No reutilizar credenciales de SICAR/WordPress. Sin cambios Woo, producción ni existencias. La documentación anterior que dice “no publicada” describe el checkpoint anterior a este despliegue. Evidencia local: outputs/m9-preview-2026-10-01/despliegue.json.


## Registro vivo — sesión staging y corrección de filtros (2026-10-01)

La sesión real del usuario permitió verificar el recorrido Preview → autenticación → RPC → catálogo: 40 variantes únicas en dos páginas, código exacto 10 con precio público $910, consulta 010 sin equivalencia con 10, departamento JUVENIL y sección BOTAS DE TRABAJO RHINO con una coincidencia. Costos sin capturar y mayoreos sin definir. Vista móvil 390×844 sin desbordamiento horizontal. Lector físico pendiente.

Se corrigió la incompatibilidad del esquema de staging con la consulta del perfil: faltaba locations.label_code. Se aplicaron solamente en zsezjtswqeijboezvado las migraciones existentes 20260920220152_location_label_codes.sql y 20260921183000_location_label_code_guardrails.sql. El historial remoto asignó respectivamente 20261002004009 y 20261002004019; no se renombraron archivos históricos ni se reparó masivamente el historial. La Piedad/LAP tiene VSM1 y TRANSIT permanece NULL. Después: 40 filas M9, 0 inventory_by_location, 0 inventory_movements.

La revisión viva descubrió que Limpiar filtros renovaba los resultados pero retenía el selector de búsqueda anterior por defaultValue. Corrección 0.55.5, commit 336e9194f97bcd87a3d1624f0eefe2db44fcf6b6: remontar el formulario al cambiar la consulta/página. 13 pruebas unitarias de revisión y lint aprobados. Publicada únicamente en la rama Preview del PR borrador #87. Primer build falló en módulos de fuentes Google; se reintentó sin caché. Resultado del despliegue y regresión final se registran en outputs/m9-preview-2026-10-01/sesion-verificada.json.

Sin escrituras WooCommerce, producción ni existencias. Sigue pendiente desarrollar y probar la ficha web nativa; el paquete de contenido no equivale a alta automática.


También faltaba products.image_path: Productos caía en su modo de demostración anterior y ocultaba el enlace M9. Se aplicó la migración existente 20260908011917_m6_product_images.sql sólo a staging, registrada remotamente como 20261002004914. Antes se comprobó que no existía el bucket product-images ni archivos en él; se creó vacío para fotografías comerciales según la migración original, sin subir contenido. Productos volvió a mostrar el catálogo real y el enlace del piloto.

Los dos intentos de build Turbopack fallaron; el commit 86f376cddf7670dbfbaf6edeb6e3944767d8849f configura next build --webpack, coherente con la compilación ya verificada en CI. Compilación y TypeScript locales aprobados.

Advisors: permanecen avisos de funciones SECURITY DEFINER autenticadas, incluidos set_product_image y upsert_location_v2 recién habilitados por las migraciones originales. Ambas verifican identidad y permisos internos; no se concedieron accesos a anon. No declarar auditoría global limpia. Referencia: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable. Sigue previo aviso de protección de contraseñas filtradas: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.


La CI #257 pasó 126/128 E2E y detectó que Webpack resolvía el manifiesto global sobre el de /mi. Se corrigió en 0.55.6, commit c56d0500d2ac9cd1276fbffab9edd0cf0b145613: el manifiesto POS conserva URL y contenido mediante Route Handler explícito, permitiendo que el metadata del layout /mi seleccione su manifiesto propio. Fundamento: https://nextjs.org/docs/app/api-reference/functions/generate-metadata (los metadatos basados en archivos tienen prioridad). Build, tipos y lint aprobados; navegador local de producción confirma /mi/manifest.webmanifest. Servidor local detenido. La nueva CI es #258; consultar evidencia final, no reutilizar el estado fallido de #257 ni declararlo aprobado.


Cierre de esta revisión: Preview 0.55.6 READY en c56d0500d2ac9cd1276fbffab9edd0cf0b145613; sesión autenticada y avatar verificados, piloto 40 variantes, manifiestos separados comprobados en Preview. CI #258 / job 110656233726 aprobado completo, incluidas las pruebas E2E. Evidencia final: outputs/m9-preview-2026-10-01/sesion-verificada.json. PR #87 permanece borrador; sin merge ni escrituras de producción/Woo/inventario. Próximo trabajo: ficha web nativa en staging y lector físico pendiente.


## Registro vivo — fichas web nativas (2026-10-01, 0.56.0)

Se implementó la captura editorial con fotos y variantes consultables, persistencia privada en staging, reintentos idempotentes y protección ante cambios simultáneos. El alta nueva puede guardar producto y ficha en una sola transacción. 40 fuentes comerciales cargadas de forma reproducible; no cambian códigos, precios, inventario ni Woo. Detalle, hashes, pruebas y límites en [M9_FICHAS_WEB.md](M9_FICHAS_WEB.md). Preview y CI de esta versión se verifican antes del cierre; PR #87 continúa borrador y sin merge. Categorías Woo/familias completas y envío real siguen pendientes.


### Evidencia de navegador y CI — 0.56.0

Preview READY en commit 7691e7d507074bea2ebb8477f658ca5c7b36b85b (código funcional cfd6dda, dos ajustes posteriores sólo de fixtures). Navegador autenticado: guardado y recarga de la ficha SICAR 10, revisión 1, 7 fotos cargadas, código/talla 22/precio $910/SKU/IDs Woo intactos. Una URL ajena fue rechazada conservando la captura; luego se guardó el contenido de origen. El formulario normaliza saltos LF a CRLF, sin cambio editorial. Avatar 0.56.0 confirmado y ancho móvil 390 sin desborde. Alta con checkbox de ficha inspeccionada sin insertar productos ficticios.

77 unitarias y 165 integraciones aprobadas en CI #261. Su primer intento falló después en next/font, aunque build local y Preview pasaron; se reintentó el mismo commit. Pendiente resultado de E2E. La sesión del navegador venció durante la prueba de subida de foto: al recargar apareció login, el bucket sigue con 0 objetos. Solicitada nueva sesión; no declarar la subida aprobada todavía. Evidencia y capturas en outputs/m9-fichas-web-2026-10-01-v3/verificacion.json.


Cierre técnico: CI #261, intento 2 / job 110669362578, aprobada completa (formato, lint, tipos, reset, unitarias, integración, build y E2E) en commit 7691e7d507074bea2ebb8477f658ca5c7b36b85b. No quedan fallos de CI abiertos de esta entrega. Subida de archivo pendiente de recuperar la sesión del usuario; no hubo objeto subido ni cambio de galería durante ese intento. Versión Preview 0.56.0. Las categorías y el envío Woo siguen pendientes y desactivados.


### Subida de fotos verificada tras recuperar sesión

Cerrado el pendiente de upload en Preview 0.56.0: el archivo descargado IMG_7873-Photoroom.jpg contenía WebP. La validación rechazó correctamente su MIME/extensión JPEG. Se copió sin transformar bytes a IMG_7873-Photoroom.webp, se subió desde el selector, se guardó y se recargó la ficha SICAR 10. Revisión 2 con siete fotos; la portada usa ahora su copia en product-images de staging y las otras seis URLs siguen iguales. No se duplicó la portada. Objeto bf18e88d-e704-423f-8354-1f73ac25a4fa.webp asociado al producto 68f8c842-47dd-4e95-84f1-b378110fd807. Todas las imágenes cargaron; talla 22, precio $910, SKU 1000074-3 e IDs Woo 7995/11235 intactos. Un objeto de Storage, cero existencias y cero movimientos. Evidencia: outputs/m9-fichas-web-2026-10-01-v3/verificacion.json y foto-subida-verificada.jpg. Sin cambios de código: se mantiene 0.56.0 y la CI aprobada. Próximo paso: correspondencia de categorías Woo por ID y revisión de familias completas antes de habilitar envíos.


### Categorías Woo y revisión completa de familias del piloto — 2026-10-01

Herramienta offline m9-web-family-review-1: captura pública sólo GET de 159 categorías y pertenencia de los 40 padres, contrastada por ruta completa e ID con el CSV autenticado. 40/40 categorías de familia verificadas; 378 miembros Woo completos (338 fuera del piloto preservados), 287 vínculos exactos y 91 pendientes (57 sin vínculo confirmado, 34 en revisión canónica/comercial). 31 familias tienen pendientes; las otras 9 requieren aún revisión editorial/aprobación. Además, 16 filas SICAR candidatas permanecen manuales en 11 familias. No equivale a aprobar categorías editadas por humanos ni a importar familias completas.

87 pruebas unitarias y lint aprobados; dos corridas byte a byte idénticas. Evidencia: outputs/m9-familias-web-2026-10-01-v2 y m9-taxonomia-publica-2026-10-01. Detalle y comandos en [M9_CATEGORIAS_Y_FAMILIAS_WEB.md](M9_CATEGORIAS_Y_FAMILIAS_WEB.md). Códigos SICAR intactos, sin escrituras Woo/producción/staging/inventario. No hay nueva versión de app: Preview sigue 0.56.0. Envíos desactivados; siguiente fase: revisión agrupada de pendientes y correspondencias aprobadas en staging antes de outbox/worker en Woo de pruebas.


### Desglose de pendientes por causa — 2026-10-01

Añadido scripts/m9/triage-web-families.mjs, m9-web-family-triage-1. De los 91 miembros pendientes, 33 sólo tienen observaciones de existencias, 1 diferencia de precio y 57 carecen de vínculo confirmado. No se reclasifica el reporte canónico ni se aprueba importar los 33. De las 16 filas candidatas: 8 muestras conservan la regla de exhibición, 6 tienen prefijos solapados, 1 talla no equivalente automáticamente y 1 existencia inválida con identidad aún sin confirmar. Los candidatos pueden solaparse con miembros Woo sin vínculo; no sumar como productos distintos.

Preguntas concentradas: cinto cocodrilo negro talla 42 (SICAR 10520, público 2690 frente a Woo regular 2390 sin rebaja capturada); Nicol Minnick bicolor/natural (23965/23966, seis códigos SICAR con base SOMNICOLMINIKBIC); camisa Rodeo West lisa negra (17787, XXL frente a 2XL). Estas hipótesis no son decisiones. Las 57 variantes permanecen en lista detallada para obtener código SICAR exacto o decisión de conservar sin vínculo. No aplicar equivalencia XXL/2XL a todo el catálogo.

Evidencia: outputs/m9-pendientes-familias-2026-10-01/{revision.md,pendientes.json,sha256.json}. 91 pruebas unitarias aprobadas, lint y dos ejecuciones idénticas verificadas. Fuentes conservadas y huellas comprobadas. Ninguna escritura en Woo, producción, staging ni inventario; Preview sigue 0.56.0.

Reproducir desde work/m9-ui:

```sh
node scripts/m9/triage-web-families.mjs ../../outputs/m9-familias-web-2026-10-01-v2 ../../outputs/m9-fuentes-2026-10-01/woo-authenticated.json docs/M9_DECISIONES_NEGOCIO.json ../../outputs/NUEVOS_PENDIENTES
```


### Lote candidato de revisión editorial — 2026-10-02

Implementado prepare-candidate-review.mjs (m9-candidate-review-1), offline con fuentes verificadas por SHA-256. Selecciona sólo familias completas sin conflictos del diagnóstico y valida cada precio SICAR contra el regular Woo sin igualar precios entre tallas. Resultado: 9 familias, 50 miembros (9 del piloto inicial, 41 aún fuera de staging). Cero cambios remotos propuestos: productos ya existentes, conservar IDs, categorías, imágenes, códigos y precios. No confundir baseline exportado con comparación de las fichas humanas staging ni con estado Woo actual.

Revisión legible local: outputs/m9-lote-candidato-2026-10-02/revision.html; detalle lote.json y sha256.json. HTML de origen escapado y CSP sin scripts/red. Una familia con formato HTML requiere revisión editorial: Woo 24939 Bota Nokota Lincoln; el título dice BLANCK CHERRY y el cuerpo BLACK CHERRY, contiene marcado de hoja de cálculo y una comilla final. No se corrigió automáticamente. Las otras ocho también necesitan revisión visual/editorial, no están aprobadas para publicar.

95 pruebas unitarias aprobadas, lint limpio, reproducción byte a byte idéntica. No se escribió staging, Woo, producción ni inventario. Preview permanece 0.56.0; esta entrega es herramienta local. Próximo paso: revisar contenido completo y comparar borradores humanos con este baseline antes de preparar prueba de envío; falta entorno Woo de pruebas y prueba de reintentos. Las tres dudas previas y 57 variantes sin vínculo siguen pendientes.

Reproducir desde work/m9-ui:

```sh
node scripts/m9/prepare-candidate-review.mjs ../../outputs/m9-familias-web-2026-10-01-v2 ../../outputs/m9-fuentes-2026-10-01/woo-authenticated.json ../../outputs/NUEVO_LOTE_CANDIDATO
```


### Revisión editorial de páginas Woo — 2026-10-02

Consultadas nueve páginas del lote en navegador, sin mutaciones. Inspección de texto/precio visible/portada y miniaturas; no todas las fotografías ampliadas ni propiedades físicas. Preparadas tres propuestas locales con antes/después y huella fuente: espacio AMARILLO EN (5630), ASA y espacio INTERNO. EL (19771), BLACK CHERRY y limpieza del HTML de hoja de cálculo/comilla final (24939). Sin aplicación ni aprobación. Dos comprobaciones comerciales: toquilla de piedra roja descrita en texana 13560, no distinguible en portada; colores distintos de amartigón 37102 bajo código único, sin inferir separación o selección.

Evidencia y generación repetible: outputs/m9-revision-editorial-2026-10-02/{revision.md,revision.json,sha256.json,generar.py}. Segunda generación idéntica; fuente lote intacta. No se modificó código de aplicación, staging, Woo o inventario: Preview 0.56.0. No se compararon borradores humanos staging ni se aprobó galería completa/materiales. Las comprobaciones comerciales y prueba Woo aislada siguen pendientes; no presentar revisión parcial como permiso de publicación.


### Galerías completas y lectura staging — 2026-10-02

Consulta Supabase en transacción READ ONLY al proyecto staging zsezjtswqeijboezvado. No se actualizó ninguna tabla ni se guardaron borradores.

- 9/9 snapshots coinciden estructuralmente con el paquete de contenido original; SHA-256 fuente correcto.
- 9/9 códigos base y listas ordenadas de imágenes coinciden.
- No hay borradores humanos guardados en estas 9 fichas; no significa que no existan borradores en otras familias.
- Las categorías verificadas por ID del reporte todavía no están incorporadas en staging: category_ids sigue NULL y los campos editoriales contienen propuestas textuales. No usar esos textos como IDs.
- 40 imágenes revisadas en navegador, mostradas completas a 340 px de alto (incluye detalles e interiores, no sólo portadas). Todas se visualizaron. Esto no prueba composición, autenticidad, medidas o correspondencia con mercancía física.

La texana presenta una cinta del mismo color y adorno lateral pequeño; no se distingue la piedra roja que menciona la descripción. Confirmación comercial pendiente. El amartigón muestra dos juegos de color/diseño (café/negro y negro con figura clara), bajo una sola ficha sin selector. No separar códigos ni declarar venta surtida sin confirmación.

Las otras siete galerías no muestran una mezcla evidente de modelos en esta inspección. Siguen pendientes aprobación comercial y las tres propuestas de texto locales. No se han aprobado envíos, importado las 41 variantes fuera del piloto ni activado sincronización Woo.

Siguiente implementación: incorporar correspondencias verificadas de categorías en la preparación staging, preservando snapshots y controlando revisiones; mantener las dos fichas comerciales dudosas fuera del primer ensayo de envío. Se requiere Woo de pruebas para validar creación/actualización/reintento sin duplicados. Las siete restantes son candidatas técnicas, no publicaciones autorizadas.

Evidencia: lectura.json (consulta restringida al lote), comparacion.json y galerias/*.html. Las galerías referencian las imágenes públicas remotas, no son copias permanentes de los archivos. Preview sigue en 0.56.0, sin despliegue ni cambio de código funcional.



### Preparación de categorías y preflight alojado — 2026-10-02

7 familias: 5630, 5738, 8059, 13440, 19771, 24939 y 25814. Texana 13560 y amartigón 37102 excluidos por dudas comerciales.

La preparación conserva cada ID Woo con su ruta completa; por ejemplo, Bota y Caballero > Bota siguen separados. Departamento/sección SICAR no se sustituye por esa clasificación web. Los textos de categorías propuestos se separan en elementos individuales, sin modificar la evidencia original.

Comprobación READ ONLY en staging: 7/7 fuentes y contenidos sugeridos intactos, ausencia de borradores humanos y validación de contenido correcta. 98 pruebas unitarias y lint aprobados; dos generaciones idénticas.

Límite: el modelo actual del editor sólo admite categorías de texto. La correspondencia numérica está en categorias.json; NO está persistida como vínculo verificado en staging. No se guardaron sugerencias, no se actualizaron snapshots ni se habilitaron envíos. Tampoco se aplicaron las tres correcciones editoriales pendientes.

Siguiente implementación: persistencia separada de categorías por ID y su huella fuente, con invalidación al editar categorías y control de revisiones, seguida de pruebas en staging. No introducir IDs en el campo de texto ni tratar la propuesta como aprobación comercial. La app continúa en 0.56.0; herramienta m9-verified-categories-preparation-1.


Reproducir: `node scripts/m9/prepare-verified-categories.mjs LOT_DIR FAMILY_REPORT_DIR STAGING_READ_DIR NEW_OUT`. Evidencia vigente: outputs/m9-categorias-preparadas-2026-10-02-v2. El primer preflight devolvía sólo la última consulta en el conector; v2 reúne los siete resultados con UNION ALL, todos comprobados.


### Persistencia de categorías verificada en staging — 2026-10-02

Completada m9-category-persistence-1: 7 correspondencias Woo por ID/ruta guardadas en app.web_category_bindings, RLS cerrado sin API pública. Categorías sugeridas separadas por ruta; snapshots intactos. Triggers invalidan cambios de categoría/fuente/vínculo; restaurar texto no reactiva. Segunda carga 7 UNCHANGED. 19 verificaciones SQL con rollback, 101 unitarias, lint y reproducción idéntica. Huellas de catálogo/snapshots/borradores conservadas, cero inventario/movimientos. Texana y amartigón excluidos.

Detalle: [M9_CATEGORIAS_PERSISTENCIA.md](M9_CATEGORIAS_PERSISTENCIA.md). Evidencia outputs/m9-categorias-persistencia-2026-10-02. Migración local 20261003000213, registrada en staging 20261003000437. Sin Woo/producción; sólo infraestructura interna. Preview permanece 0.56.0, todavía sin indicador/IDs en UI: falta lectura autorizada y señalización de estado antes de la prueba Woo aislada. No presentar esta carga como publicación ni aprobación comercial.


### WooCommerce local aislado y conector probado — 2026-10-02

Por autorización expresa del usuario, se creó una instalación nueva de WordPress/WooCommerce sólo en 127.0.0.1:9417, sin copiar clientes/pedidos/credenciales ni modificar vaquerosm.com. WordPress 7.0.6, Woo 11.1.2 y PHP 8.3.33 mediante Playground 3.1.56; correo, pagos, red saliente, cron y webhooks bloqueados. Instalación activa en work/m9-woo-runtime-verified (directorio de esta tarea); datos persistentes y credenciales exclusivamente locales.

Conector m9-woo-local-worker-1: compilador de ficha completa, diario persistente, ID devuelto, bloqueo local, revisión/huella, verificación GET y recuperación por ID explícito. Escrituras inciertas quedan en revisión sin volver a crear a ciegas. Ensayo real por API: padre ficticio 11 con variantes 12/13, creación como borrador y actualización de texto/precio M; XL intacta, código 000007779 exacto. Repeticiones y reinicio: cero solicitudes nuevas; campos de existencias intactos. 122 unitarias (21 nuevas), lint y formato aprobados.

Detalle y límites: [M9_WOO_LABORATORIO_LOCAL.md](M9_WOO_LABORATORIO_LOCAL.md). Evidencia outputs/m9-woo-local-2026-10-02-v6. Es WooCommerce real local con datos ficticios y una vista auxiliar de revisión, no una copia completa de los plugins/tema de producción. La app Preview sigue 0.56.0; no se conectó aún el formulario ni una cola autenticada de staging. Sin despliegue, merge, publicación comercial, escrituras Supabase ni inventario. Próximo paso: integrar el formulario y cola con este conector y mostrar resultados/IDs en staging, manteniendo revisión comercial y producción cerrada.


### Ensayo supervisado desde ficha web — 2026-10-02

Versión de aplicación 0.57.0: solicitud autenticada desde la ficha guardada y consulta de estado/ID local. Cola privada de staging con idempotencia, revisión y huella de catálogo; antes de reclamar se revalida el contenido y evidencia de categorías. Una solicitud por producto; sólo creación de borrador simple habilitado expresamente. Cambios previos al procesamiento dejan SUPERSEDED; respuestas inciertas requieren revisión. Los IDs locales viven en la cola, nunca sustituyen los IDs de Woo real.

Puente administrativo supervisado: `scripts/m9/woo-test/staging-bridge.mjs CLAIM_JSON RUNTIME_DIR OUTPUT_DIR`. Se reclama mediante función privada, se ejecuta contra 127.0.0.1:9417 y se registra el recibo después de verificar. No es un trabajador automático permanente ni integración de producción. Fotografías por GET público con límite 4 MB y sin redirecciones; categorías y adjuntos sólo se crean en laboratorio con diario persistente y bloqueo ante incertidumbre. No envía existencias, promociones ni credenciales de producción.

Resultado comprobado: bolsa Cuadra Woo real 19771, código SICAR 10521, solicitud 3648c7e3-5b73-4540-a19c-8474f14387e2 creada desde la UI autenticada, revisión 1, SUCCEEDED; borrador Woo local 18 con cuatro fotografías, descripción/código base y precio público 8695.00. La UI muestra su resultado e ID local y el avatar confirmó 0.57.0. Repetición del trabajo: cero solicitudes de escritura, sin segundo producto. Se mantienen Woo real 19771 y barcode 10521 en staging; inventario y movimientos cero.

Evidencia: outputs/m9-staging-woo-2026-10-02 (claim, diario de adjuntos/categorías, entrada y resultado del worker, recibo, lectura final y capturas). Primera comprobación se detuvo por orden alfabético de categorías devuelto por Woo; se corrigió comparación de pertenencia exacta sin exigir orden, se añadió prueba contra sustitución y se concilió por GET del ID 18, sin repetir POST. Las fotos sí conservan su orden. 15 comprobaciones SQL rollback; 129 unitarias finales. CI #262 pasó migraciones, tipos, lint, integración, build y E2E en 02b1c985; comprobar también el commit final con la corrección de categorías.

Límites: primera cola de UI admite únicamente un alta simple por producto habilitado; futuras ediciones no se reenvían todavía. El puente es administrativo supervisado; el navegador no accede a secretos ni procesa directamente localhost. Los atributos descriptivos del padre (por ejemplo UNITALLA), variantes completas, promociones, plugins/tema de tienda real y recuperación distribuida siguen fuera de este ensayo. No presentar la copia como clon íntegro o sincronización automática lista para producción. Próximo paso: completar estos campos y el flujo de actualización/variantes en laboratorio antes de ampliar el lote. Ninguna publicación real autorizada ni ejecutada.


### Actualizaciones verificadas y familias con tallas — 2026-10-02

Versión 0.58.0 desplegada en Preview: una revisión editorial posterior a un ensayo exitoso puede solicitar actualización del mismo ID local. El historial conserva todas las solicitudes; se bloquea una segunda solicitud activa o una revisión ya enviada. El recibo de actualización debe conservar el ID confirmado. El puente exige el directorio de evidencia previo, verifica sus huellas y comprueba que Woo local no cambió antes de escribir; reutiliza adjuntos/categorías existentes.

Resultados reales comprobados: actualización solicitada desde UI, job acc23ac1-09ce-46e3-9631-895c5f734d2d, revisión 2, SUCCEEDED en el mismo Woo local 18. Se aplicaron sólo al ensayo las correcciones «AZA»→«ASA» e «INTERNO.EL»→«INTERNO. EL». Comparación antes/después: cambian únicamente description, date_modified/date_modified_gmt y marcador de operación; fotos completas idénticas, precio 8695.00, SKU, código 10521, promociones y campos de existencias intactos. Adjuntos/categorías reutilizados; repetición cero solicitudes. UI y avatar 0.58.0 comprobados. Evidencia outputs/m9-actualizacion-local-2026-10-02.

Ensayo de familia separado: `scripts/m9/woo-test/rehearse-family.mjs` tomó la familia Wrangler 5630 del reporte conciliado y creó el borrador local 23 con hijos 24–28, tallas S/M/L/XL/XXL y códigos SICAR 10581–10585, precio 820.00 por talla, cuatro fotos. Actualización parcial incluyó sólo S y corrigió «AMARILLOEN» en el texto del padre: los otros cuatro hijos conservaron su JSON completo; repetición cero solicitudes. Evidencia outputs/m9-familia-local-2026-10-02. Usa IDs internos y SKUs sintéticos de laboratorio y categoría explícita «Laboratorio M9»; no sustituye vínculos reales ni acredita la taxonomía de producción.

131 unitarias, ocho comprobaciones SQL de actualización con rollback, tipos y lint aprobados; consultar CI del commit de entrega para integración/build/E2E. Los avisos de seguridad históricos siguen en 105 funciones y una configuración de contraseñas filtradas; las tablas nuevas permanecen privadas con RLS cerrado.

Límites: cola UI todavía sólo para productos simples habilitados; la familia variable se probó por herramienta supervisada y no se incorporó al catálogo de staging. No hay trabajador automático permanente. Atributos descriptivos del padre, variantes fuera del piloto, clasificación web completa y compatibilidad de plugins/tema siguen pendientes antes de ampliar el lote o publicar. Siguiente paso: revisar e incorporar las variantes completas al piloto y conectar su edición/envío supervisado desde la ficha. Producción y existencias siguen cerradas.


### Primera familia completa en el catálogo staging — 2026-10-03

Familia Wrangler Woo 5630: se incorporaron cuatro variantes faltantes al mismo producto 14f3af61-18f0-4adb-b1d8-29b447ae9cdb. Cinco tallas literales S/M/L/XL/XXL, códigos SICAR 10581–10585, IDs Woo 6186–6190, precio público 820.00, departamento DAMA y sección CAMISAS WRANGLER. Costos NULL; mayoreo y medio mayoreo indefinidos. La variante S original conservó UUID/SKU. El piloto queda en 40 productos y 44 variantes.

Preparación reproducible de sólo lectura: `node scripts/m9/prepare-staging-family.mjs FAMILY_REPORT_DIR RECONCILIATION_DIR 5630 NEW_OUTPUT_DIR`. Verifica huellas y cruza filas SICAR con la conciliación exacta; rechaza ambigüedad, duplicados, revisiones y atributos distintos. No copia existencias. Dos generaciones idénticas. Paquete SHA256 b27019379401691c7d808f20eec56e2006839d4262abcc9f3d422698988c8ee6.

Se reutilizó el importador privado existente, con plan y token: 4 CREATE + 1 UNCHANGED, sin errores. Ensayo transaccional rollback comprobó identidad, segunda aplicación sin cambios y preservación de fuentes web/borradores/categorías/cola/inventario. Aplicación real sólo en zsezjtswqeijboezvado: 4 creadas, 0 actualizadas; repetición 0 creadas, 0 actualizadas, 5 sin cambios. Las 40 filas previas permanecen idénticas; inventario y movimientos siguen en cero. Evidencia: outputs/m9-familia-staging-2026-10-03 (payload, manifest, preflight, antes/después, rollback, ambas cargas y verificación).

Versión 0.59.0 desplegada y comprobada en el avatar de Preview: el aviso de variantes fuera del piloto compara el snapshot histórico contra variantes activas del catálogo con el mismo padre Woo. No se altera la exportación ni se habilitan envíos por este cálculo visual. 136 pruebas unitarias, lint y tipos aprobados. CI #266 (run 37131005304, commit ce7b67313efcaf01474b486d53eb3686d5ecc1f2) terminó con éxito: formato, lint, tipos, migraciones, unitarias, integración, build y E2E. Vercel confirmó despliegue exitoso; UI mostró las cinco variantes y retiró el aviso obsoleto. Captura: outputs/m9-familia-staging-2026-10-03/tallas-staging.jpg.

Pendiente: conectar esta familia completa con la cola de fichas, correspondencias de categorías jerárquicas y recibos por variante del Woo local; por ahora sigue deshabilitada para envío desde UI. El borrador local 23 del ensayo anterior conserva UUID/SKU sintéticos y no se adoptó como destino de estas variantes. No hubo publicación Woo, modificación de producción, importación de inventario ni integración con main. Las mejoras de caja/dólares del otro chat siguen separadas; no declarar terminado todo staging hasta cerrar el flujo variable y sus verificaciones.


### Flujo nativo de familias completas y cortes de datos — 2026-10-03

Versión 0.60.0 desplegada en Preview. La cola privada admite familias variables completas con evidencia revisada independiente del snapshot original: huellas de fuente y catálogo, conjunto exacto de variantes Woo, códigos/filas SICAR íntegros y categorías verificadas. Cambios de exportación, precio o activación entre preparación y reclamación dejan SUPERSEDED; no se envía automáticamente una mezcla de cortes. Evidencia, habilitación y recibos permanecen privados, sin permisos API.

El puente local valida cada variante, conserva los atributos descriptivos del padre separados de los ejes de variación y crea categorías con jerarquía (Camisa y Dama > Camisa no se fusionan). Actualizaciones exigen evidencia previa íntegra y conservan IDs locales de padre e hijos; verifican padre/hijos antes de modificar. Cada recibo contiene el vínculo de las cinco variantes. La UI muestra los IDs de laboratorio separados de los IDs Woo reales. No hay tareas automáticas ni escrituras de producción.

Validación local inicial: 139 unitarias, lint y tipos; 16 comprobaciones SQL con rollback sobre la familia Wrangler (permisos, fuente/precio/actividad cambiados, idempotencia, hijos faltantes/duplicados, campos de stock rechazados y conservación de destinos al actualizar). Migración local 20261003150138 aplicada sólo a staging. Ensayo real desde UI y CI completados; resultados al final de esta entrada.

La tienda permanece operando: los ensayos usan cortes congelados, no representan existencias ni catálogo en tiempo real. Cada exportación nueva debe conservarse con fecha y SHA256, conciliarse con el corte anterior, separar altas/cambios/ausencias y revalidar el lote. Ausencias no autorizan bajas; cambios ambiguos se revisan. No sobrescribir textos humanos ni costos/mayoreos desconocidos; existencias siguen excluidas. Una solicitud ya reclamada representa su corte; un cambio posterior requiere otra revisión.

Pendiente después del ensayo variable: probar el ciclo incremental con una nueva exportación, incluida la regla de revisión cuando cambia sólo el precio del catálogo y no el texto editorial; actualmente el envío exige nueva revisión editorial y revisión administrativa de evidencia. Ampliar lote, coordinar mejoras del otro chat y ensayar preparación/recuperación del corte final antes de autorizar producción. No declarar cerrada toda la fase staging.


Verificación final de 0.60.0: CI #268 / run 37132484822 / commit 94d82edb880f72e925aca92d9387f97c09c40efa, éxito en todas las etapas; Preview y avatar comprobados. Ensayo nativo Wrangler: job 3d918351-7587-4b54-9da1-84a69fe1b7d9 (revisión 1) y da705acb-b33b-4086-932d-07d0537181fc (revisión 2), ambos SUCCEEDED, padre Woo local 33 y cinco hijos 34–38. Corrección editorial AMARILLOEN→AMARILLO EN sólo en staging/local. Padre cambió descripción, fechas y marcador; hijos sólo fechas/marcadores, con datos comerciales íntegros. Fotos y categorías reutilizadas; repetición cero solicitudes. Atributo Color no variable conservado y taxonomía jerárquica comprobada. UI muestra cada vínculo local. Catálogo SICAR y snapshots Woo conservan sus huellas; inventario/movimientos cero.

Evidencia reproducible: outputs/m9-familia-nativa-2026-10-03 (claims, entradas, diarios, verificaciones, recibos, comparación antes/después y capturas). Reporte humano reporte-avance.md y métricas avance.json: estimación técnica 65% frente a ~60% anterior; 40 productos/44 variantes en staging, producción 0%. No hubo nueva captura de fuentes en esta entrega. El aviso de categorías de la UI sigue siendo genérico; el servidor sí exige la correspondencia verificada antes del envío. El siguiente hito es actualización incremental con nuevos cortes, en especial precio sin edición editorial. Toda la fase staging aún no está cerrada; mejoras del otro chat no integradas.


### Comparador incremental reproducible — 2026-10-03

Herramienta offline m9-source-delta-1, `node scripts/m9/prepare-source-delta.mjs PREVIOUS_REPORT CURRENT_REPORT NEW_OUTPUT_DIR`. Amplía el flujo previo compare-source.py: comprueba huellas de filas y manifests, separa cambios de campos SICAR y de conciliación, agrupa duplicados en revisión, conserva códigos literales, nunca convierte ausencias en bajas y excluye cantidades de inventario. No genera payload de importación ni se conecta a servicios externos.

Ensayo histórico con outputs/m9-reporte-2026-09-29 y outputs/m9-reporte-actualizado-2026-10-01: 16035→16130 filas, 98 códigos nuevos, 3 ausentes, 141 cambios exclusivamente de precio público, 56 otros cambios de catálogo, 7776 cambios sólo de conciliación, 618 sólo inventario y 7441 sin cambios. Reglas y exportación Woo distintas: no tratar cambios de conciliación como cambios físicos del producto. 1502 filas compartidas tienen cambios de campos de inventario, excluidos aun si coinciden con otros cambios. Las huellas SICAR se comprobaron contra Plantilla_Productos (3).xlsx y (4).xlsx.

Dos generaciones idénticas. Comparación vigente contra sí misma: 16130 sin cambios. 144 unitarias y lint aprobados. Evidencia outputs/m9-delta-historico-2026-10-03, su repetición y outputs/m9-delta-mismo-corte-2026-10-03. Reporte humano reporte-avance.md. No se encontró una exportación SICAR posterior a (4) en Descargas; no se ha capturado un corte nuevo.

Revisión del bloqueo de precio: la cola y UI actuales usan la revisión editorial como identidad de envío. Un cambio sólo de precio no incrementa esa revisión y debe seguir bloqueado, no forzarse alterando textos. Próximo cambio: separar revisión editorial de revisión de envío, conservar destino e idempotencia y probar una actualización incremental con nuevas fuentes. Avance global se mantiene estimado en 65% hasta comprobar ese hito; aplicación Preview 0.60.0 sin cambios, piloto 40/44 intacto y producción/inventario cerrados. Las mejoras del otro chat siguen separadas.


Verificación de entrega 0.61.0: commit funcional 3320a12ac47ea8e003eb853580340005052cbd2a; CI #271 (run 37134903562, job 111237348717) completó con éxito formato, lint, tipos, migraciones, 144 unitarias, integración, build y E2E. Vercel exitoso; avatar y consulta de estado comprobados en Preview. Captura outputs/m9-precio-local-2026-10-03/staging-version.jpg. Los avisos de seguridad mantienen las mismas cantidades históricas: 34 tablas privadas con RLS cerrado sin políticas, 105 funciones autenticadas SECURITY DEFINER y una configuración de protección de contraseñas. Las nuevas funciones son privadas y sus permisos se probaron. No se cierra todavía toda la fase staging.


### Fichas guardadas y ampliación de tres familias — 2026-10-03

Staging zsezjtswqeijboezvado tiene 41 productos / 64 variantes. Se agregaron 14 variantes en familias existentes: Woo 5738 (cinto pescado café, seis tallas), 24939 (Nokota Lincoln Black Cherry, seis tallas) y 25814 (Wrangler George Strait 6950, cinco tallas). Payload de 17 filas: 14 CREATE + 3 UNCHANGED, cero UPDATE; repetición real 17 UNCHANGED. SHA256 50fcb57bb6f7410491e43c5d78fca923b291d7e7e3f5e4b850211251e4a9711e. Dos preparaciones por familia idénticas. Ensayo con rollback y guardas en aplicación real comprobó que las 50 filas previas, fuentes web, borradores, correspondencias de categorías y cuatro trabajos anteriores permanecieran íntegros. Inventario y movimientos cero; todos los costos NULL.

Sombrero 19746: fuente web complementaria y categoría verificada Sombrero (278), cuatro fotos y textos de Woo; ficha guardada desde UI revisión 1. Siguen sólo seis tallas 54–59: talla 60 sin SICAR permanece fuera y bloquea habilitación de esa familia. Las tres familias ampliadas también se guardaron por UI en revisión 1, sin editar textos originales. Total siete borradores internos. Categorías válidas; ninguno de estos cuatro productos está habilitado para envío al laboratorio. Guardar no equivale a aprobación comercial ni publicación.

Nuevo SICAR (5) conciliado contra captura autenticada Woo del 1 de octubre. Revisión pública adicional del 3 de octubre confirmó nombres/base, fotos y orden, textos normalizados por tipografía WordPress, IDs de variantes y nombres de términos obtenidos de su taxonomía (no inferir que slug 26-5 sea talla literal). La consulta pública no sustituye una exportación autenticada completa ni verifica precios individuales actuales. La revisión de 40 familias se recalculó: ocho candidatas/44 miembros; sus contadores «ya en piloto» corresponden al lote original y no al catálogo ampliado.

Pendientes separados: 8059 excluido de ampliación porque Clave1 13851 tiene costo 990 marcado unverified; no convertirlo a costo aprobado ni anular el control. 13440 excluido de nueva ampliación por alertas de existencias contra Woo histórico, sin afirmar discrepancia actual. En Nokota 24939 se detectan departamentos SICAR mezclados: códigos 11201/talla 29 y 3280/talla 27 están en DAMA; 9174/26, 8342/26.5, 10954/27.5 y 11202/28 en CABALLERO. Se preservan literalmente para revisión; no reclasificar ni habilitar publicación automáticamente. Evidencia visual nokota-departamentos.jpg.

Archivos: outputs/m9-ampliacion-tres-familias-2026-10-03 (payload, manifests, repeticiones, plan, rollback, aplicación, verificación final, revisión pública y capturas); outputs/m9-ampliacion-contenido-2026-10-03; outputs/m9-ampliacion-taxonomia-2026-10-03; outputs/m9-sombrero-contenido-2026-10-03; outputs/m9-sombrero-taxonomia-2026-10-03. No modificar retrospectivamente snapshots originales.

Preview sigue 0.61.0: esta entrega cambia datos de prueba/documentación, no código de aplicación ni esquema. Avance técnico estimado se mantiene 68% (no porcentaje de filas migradas), producción 0%. La fase staging NO está cerrada. Próximo: ensayo de fichas completas elegibles en Woo local, lector físico para 2396, revisión de pendientes, corte actualizado de ambas fuentes y ensayo de recuperación; coordinar mejoras del otro chat antes del cierre. Sin producción, existencias, nuevos trabajos Woo, merge a main ni integración del otro chat.


### Dos familias adicionales en Woo local y recuperación verificada — 2026-10-03

Ensayo nativo desde UI de cinto 5738 y camisa 25814, con evidencia exacta de SICAR (5), catálogo y fuente Woo. Sólo habilitados para m9-local-2026-10-02; no modifica permisos API ni acceso a producción. Cinto: job 86dcdc66-24f1-444a-a5f3-a397260498c2, padre local 42, seis hijos 43–48, precio 490. Camisa: job 37bf73b5-807e-4837-a1c9-86e1c183ab18, padre local 52, cinco hijos 53–57, precio 890. Ambos SUCCEEDED; tres fotos por familia, texto y categorías jerárquicas verificadas, códigos originales en metadatos. Repetición de cada worker: cero solicitudes. Permanecen borradores.

El primer intento del cinto se detuvo al verificar el padre: WordPress convierte <br /><br /> en cierre/apertura de párrafo. Versión 0.62.0 corrige sólo esa equivalencia y finales de línea en verificación y comparación de actualizaciones; no elimina texto, atributos ni otras etiquetas para forzar coincidencias. No cambia los payloads de creación ni su identidad. Recuperación explícita del ID conocido 42 mediante reconcileKnownResult: sólo GET, cero escrituras; reanuda hijos pendientes sin recrear padre/fotos/categorías. El diario conserva el fallo original y la conciliación. Las pruebas rechazan texto faltante, salto simple y etiquetas adicionales. Un cambio sólo de precio no vuelve a enviar descripción equivalente.

148 unitarias, lint de archivos cambiados y tipos aprobados. Prueba de habilitación con rollback: dos paquetes completos. Comparación antes/después: catálogo 5e684a46289c462049570690bde64701, fuentes 5072f2618649b8792b3cdd9f7b8c6ca9, borradores 6942f0fca89c23eafbecd1c4dec90a8b y categorías de5f889a2393d7308f7f0ac1f8d0a0a1 intactos. 41 productos/64 variantes, siete fichas, seis trabajos SUCCEEDED acumulados; inventario/movimientos cero. Woo local confirma cron/correos/salidas/pagos/webhooks bloqueados, cero pedidos. Evidencia outputs/m9-dos-familias-woo-local-2026-10-03.

Avance técnico estimado 70% por ensayo ampliado y recuperación real, no porcentaje del catálogo. Staging NO cerrado: faltan lector físico, corte actualizado completo, ensayo de recuperación del corte, revisión comercial y coordinación de mejoras del otro chat. Sombrero incompleto y Nokota con departamentos mezclados no habilitados. No escrituras Woo/Supabase de producción ni importación de existencias. Publicación y CI de 0.62.0 pendientes de verificación al redactar esta entrada.


Verificación final 0.62.0: commit funcional 99e62536e1ba862f8d4ecdb30f1b49c0e85a402a, CI #274 / run 37139180684 / job 111249877566 completado con éxito (formato, lint, tipos, migraciones, 148 unitarias, integración, build y E2E). Vercel Preview exitoso y avatar confirma 0.62.0. UI confirma borradores locales 42/52 y sus 11 vínculos; fotos y tallas comprobadas en laboratorio. Las 64 filas staging siguen coincidiendo literalmente con SICAR (5) en código, descripción, precio y clasificación. Evidencia en outputs/m9-dos-familias-woo-local-2026-10-03, incluida guía prueba-lector.md. Avance técnico estimado 70%; staging aún abierto y producción 0%.


## Registro vivo — recuperación y ensayo de corte (2026-10-03, 0.63.0)

Añadidas herramientas reproducibles de respaldo SQLite consistente, restauración en copia separada de solo lectura HTTP y ensayo de corte sin escrituras. Recuperados 9,976 archivos, seis padres, 23 variantes y 19 imágenes; diario de trabajos preservado y reintentos completados sin solicitudes ni duplicados. Laboratorio original permanece disponible. El respaldo incluye secretos locales y queda fuera de Git, con permisos restringidos. No constituye respaldo de producción ni de Supabase.

El ensayo con SICAR (4)→(5) y Woo autenticado del 1 de octubre se repitió con resultados idénticos: 64/64 filas staging coincidentes; tres altas nuevas manuales; 68 cambios de existencias excluidos. 36 de 41 familias tienen reservas estructurales, principalmente porque el piloto es parcial. Ninguna coincidencia se interpreta como aprobación comercial. Sombrero sin talla 60 y Nokota mixto siguen bloqueados.

Avance técnico estimado 80%, por los dos hitos adicionales; no es porcentaje del catálogo migrado. Staging NO cerrado: faltan lector físico, revisión comercial, fuentes frescas al corte, integración del otro chat y plan de respaldo/reversión real con autorización de producción. Sin escrituras en producción ni importación de existencias. Guía: [M9_CORTE_RECUPERACION.md](M9_CORTE_RECUPERACION.md). Evidencia fuera de Git en outputs/m9-corte-y-recuperacion-2026-10-03. CI y Preview 0.63.0 pendientes al redactar esta entrada.


Verificación final 0.63.0: commit funcional c937c46d615e8b6c410f9b5c816cc912717c896c; CI #277, run 37141506692, job 111256730121 completado con éxito (formato, lint, tipos, migraciones, 162 unitarias —incluyen ocho casos Python de respaldo—, integración, build y E2E). Preview Vercel exitoso y avatar confirma 0.63.0. Recuperación reiniciada y verificada nuevamente: seis padres, 23 variantes y 19 imágenes; bloqueos de administrador, POST y parámetros de cambio de método/ruta comprobados. Evidencia definitiva: restauracion-protegida.json; versión visible: version-0.63.jpg. Staging sigue abierto, avance técnico estimado 80%, producción sin cambios.


## Registro vivo - lector y lote de revision (2026-10-03)

El usuario confirma lectura de etiqueta con lector fisico y busqueda en staging. Talla 59 y precio 2190 siguen pendientes de confirmar; no se realizo venta. Esta evidencia parcial no autoriza importadores. Por indicacion expresa del usuario, las mejoras del otro chat se posponen hasta terminar esta etapa; no bloquean preparar el lote actual. Antes de produccion se probara la version definitiva.

Paquete offline de revision: cuatro familias nativas completas y ya ensayadas: 5630/5 variantes (Wrangler guinda), 5738/6 (cinto pescado cafe), 19771/1 (bolsa Cuadra), 25814/5 (Wrangler George Strait). Total 17 variantes vendibles; 37 familias del piloto excluidas y tres altas nuevas SICAR 18056-18058 en revision. Verificadas huellas, unicidad de Clave1 literal, precio1, departamento/seccion, costo NULL, totalidad de hijos y borrador recuperado. Dos ejecuciones identicas byte por byte. Evidencia y preparador: outputs/m9-lote-revision-2026-10-03, fuera del repositorio.

No contiene SQL ni payload de importacion; permisos de produccion y automaticos false. Los cuatro padres ya existen en Woo: nunca utilizar sus IDs locales en produccion ni recrearlos como nuevos. Faltan revision comercial y fuentes frescas al corte. Preguntas enviadas: talla 60 Tombstone Randa; departamentos Nokota; piedra roja West Point; eleccion/surtido de amartigon; talla/precio del resultado del lector; distincion entre cintos 18057/18058.

Aplicacion permanece 0.63.0, sin cambios funcionales ni despliegue nuevo. Sin escrituras de catalogo/Woo/existencias. Estimacion tecnica se mantiene 80% hasta cerrar nuevos hitos: organizar un lote no basta para declarar 90%. Staging sigue abierto.


Actualizacion posterior del mismo turno: el usuario responde que SI aparecio el sombrero talla 59 a $2,190 al usar el lector. Lectura, busqueda, talla y precio quedan confirmados por reporte del usuario (no por observacion directa del agente). No hubo venta ni prueba de existencias; esto no autoriza produccion. Las preguntas 1-4 y 6 siguen pendientes de los propietarios. Reproduccion final del paquete en final/ y final-repeticion/ incorpora esta confirmacion.


## Registro vivo - ensayo conjunto del lote (2026-10-03)

Completada reaplicacion de valores existentes en Woo local de cuatro familias/17 variantes vendibles: origen 5630/local33, 5738/42, 19771/18, 25814/52. Veinte PUT, cero POST; cuatro SUCCEEDED, reintentos cero solicitudes. Comparacion completa de seis padres y sus hijos antes/despues identica salvo date_modified/date_modified_gmt. Catorce fotos del lote verificadas por SHA256 contra respaldo. Textos y galerias revisados en navegador, sin aprobar propiedades fisicas.

Ensayo supervisado con diario separado, conservando revisiones/marcadores originales. Diario real de entregas comprobado contra respaldo. La comprobacion previa detuvo dos intentos antes de escribir por diferente ordenacion de los mismos IDs de categorias; el ensayo conserva el orden actual tras comprobar igualdad de conjuntos. No cambia el compilador ni el comportamiento del sistema. No hay nuevos cambios comerciales ni precio SICAR real simulado.

Evidencia: outputs/m9-lote-actualizacion-2026-10-03 (ensayar.mjs, run/before.json, after.json, plans.json, cuatro resultados, verification.json, journal-integrity.json, captura y procedimiento-del-corte.md). Procedimiento propuesto exige fuentes frescas, lectura final de IDs, comparacion antes/despues y reversion selectiva protegida contra ventas/ediciones posteriores. Respaldo y recuperacion del destino real siguen pendientes; no sustituirlos por el laboratorio.

Estimacion tecnica 85% por lector fisico confirmado y ensayo conjunto completado, no porcentaje de catalogo publicado. Staging abierto. Pendientes: aprobacion comercial, casos excluidos, fuentes frescas, respaldo/reversion real y autorizacion de produccion. Mejoras del otro chat pospuestas por usuario. Version 0.63.0 sin cambios funcionales ni nuevo despliegue de codigo. Sin escrituras Supabase/Woo produccion ni importacion de existencias.


## Registro vivo - errores y reversion selectiva local (2026-10-03)

Cinco escenarios ejecutados contra familia SINTETICA local 23/hijo24: edicion concurrente detectada antes del envio (cero escrituras), perdida de conexion antes del envio (reintento cero solicitudes), perdida de respuesta tras PUT real (conciliacion GET por ID conocido, padre escrito una vez y continuacion del hijo), reversion de precio conservando edicion posterior del nombre, y bloqueo de reversion ante cambio posterior del mismo precio. Datos simulados limpiados con guardas; seis padres/23 hijos comparados contra estado anterior iguales salvo fechas de modificacion. Diario original verificado contra respaldo; diarios de ensayo separados.

Esto prueba el flujo supervisado local; NO ofrece compare-and-swap atomico ni resuelve la ventana entre GET/PUT en produccion. Falta definir/validar concurrencia en destino real. No hay ventas ni existencias importadas.

Comparativo comercial preparado: cuatro familias/17 variantes/14 fotos locales; texto de exportacion Woo 1 de octubre frente a texto ensayado. Navegador verificado en localhost9430, solo lectura, no publicacion. Evidencia outputs/m9-errores-reversion-2026-10-03 (reporte, scripts, run/verification.json, catalogue-final.json, comparativo HTML/JSON/fotos y captura).

Version 0.63.0 sin cambios funcionales de app. Estimacion 85% se mantiene. Staging abierto; respaldo real pendiente de acceso Hostinger con verificacion del usuario, decisiones comerciales y fuentes frescas pendientes. Ninguna escritura de produccion o staging.


## Registro vivo - revision offline de reversion (2026-10-03, 0.64.0)

Nueva herramienta inspect-rollback.mjs de solo lectura: coteja snapshots antes/aplicado/actual por campos explicitamente seleccionados, verifica identidad literal y pertenencia de variantes, distingue ya restaurado/sin cambio/conflicto/candidato para revision. Si hay conflicto bloquea todo el recurso. Prohibe inventario, promociones, publicacion y metadatos como objetivos. No posee cliente de red ni mutaciones; produccion y reversion automatica siempre false.

16 pruebas especificas aprobadas. Ejecucion sobre evidencia historica real del precio sintetico informa ALREADY_RESTORED; repeticion byte-identica. No se altero Woo ni staging. Ver guia [M9_REVISION_REVERSION.md](M9_REVISION_REVERSION.md) y outputs/m9-revision-reversion-2026-10-03.

No resuelve carrera GET/PUT ni cambios intermedios que regresaron al mismo valor. Recuperacion real de Hostinger pendiente del codigo de acceso; aprobacion comercial y fuentes frescas pendientes. Avance tecnico se mantiene 85%; staging abierto. Entrega funcional 0.64.0; CI/Preview pendientes de verificar al redactar esta entrada.


Verificacion final 0.64.0: commit 3ada2b9c9c6f33fea61f38b58332540e706100ee. CI #282 / run 37150771716 / job 111284031238 completado con exito (formato, lint, tipos, migraciones, 178 unitarias, integracion, build y E2E). Preview exitoso y avatar confirma 0.64.0; captura version-0.64.jpg en outputs/m9-revision-reversion-2026-10-03. Sin escrituras Woo/Supabase; estimacion 85%, staging abierto.


## Recuperacion privada del respaldo real - 2026-10-03

Acceso Hostinger resuelto. Descargados archivos (19,769,176,434 bytes) y SQL (34,854,457 bytes) del respaldo mostrado como 2026-10-03 10:29; zona horaria no confirmada. Gzip completos, CRC y SHA256 verificados. Configuracion DB coincide con asociacion del panel. Originales privados fuera de Git. No se pulso Restaurar en Hostinger.

Recuperados exclusivamente 294,825 archivos de vaquerosm.com (23,194,613,938 bytes), releidos y cotejados por SHA256. Carpetas 0700, archivos 0600, cero enlaces; 71 entradas externas al prefijo excluidas. WordPress 6.9.9 y WooCommerce 11.0.1 leidos estaticamente. No se ejecuto PHP ni se sirvio la copia.

Docker Desktop 4.93.0 oficial preparado localmente: huella y firma verificadas. Al abrir mostro bienvenida con Skip, sin acuerdo pendiente; el agente no acepto acuerdos ni inicio sesion externa. Motor 29.8.1. SQL importado sin errores en MariaDB 11.8.9, imagen oficial fijada por digest sha256:6422478cb8e159f080fb1d8ccf65101e26fe51385787fde7d16c3b165a331f15. Nuevo contenedor sin red ni puertos; skip_networking=1, event_scheduler=OFF, local_infile=0. Credenciales locales aleatorias nuevas y volumen independiente. CHECK TABLE: 290/290 OK. Recuento historico del respaldo: 2,121 productos y 12,158 variaciones, todos los estados; no implica publicaciones actuales ni coincidencias SICAR. Contenedor detenido al terminar.

Evidencia: outputs/m9-respaldo-real-2026-10-03 (restaurar-archivos.py, recuperar-base.py, archivos-restauracion.json, aislamiento-archivos.json, base-datos-restauracion.json). Copia privada en work/m9-hostinger-restore-2026-10-03. No arrancarla con configuracion original: falta reemplazar conexiones y credenciales, probar aislamiento y verificar WordPress/catalogo/medios. La recuperacion de aplicacion aun no esta comprobada.

Avance tecnico estimado 88% por recuperar archivos y SQL reales; no porcentaje de catalogo publicado. Staging sigue abierto. Pendientes: prueba funcional aislada, decisiones comerciales, fuentes frescas y autorizacion de produccion. Panel reporto 619K/600K inodos, causa no investigada; no se borraron archivos ni se cambio plan. Aplicacion 0.64.0 sin cambios funcionales ni despliegue. Produccion intacta; inventario no importado al sistema.


## Recuperacion WordPress aislada y revision del lote - 2026-10-04

Arranque CLI real de WordPress 6.9.9 / WooCommerce 11.0.1 con PHP 8.3.35, sobre archivos recuperados de solo lectura y configuracion local nueva superpuesta. MariaDB sin red/puertos y usuario SELECT-only. Verificados bloqueo de salida TCP, HTTP WordPress, correo, pasarelas, webhooks y escritura SQL; cron desactivado. Solo WooCommerce cargado; tema y otros plugins desactivados expresamente. No equivale a validar la tienda completa.

Lectura repetida coincide en identidad, variantes, precios e imagenes de cuatro familias 5630/5738/19771/25814, 17 variantes vendibles y 14 fotos locales. Primer intento de repeticion fallo en el comparador por zip(strict=True) incompatible con Python 3.9; corregido con comprobacion explicita de longitudes y repeticion exitosa. Ninguna mutacion de catalogo. Recuento historico 2121 padres / 12158 variaciones no representa conciliacion SICAR ni catalogo publicado.

Vista estatica local http://127.0.0.1:9447/ abierta y verificada en navegador: textos escapados, imagenes copiadas sin cambios y verificadas por SHA256, sin carrito ni conexiones externas. Servidor restringido a 127.0.0.1 y lista de 15 archivos permitidos; POST 405, rutas privadas 404, CSP connect-src none. Los tres contenedores de recuperacion quedan detenidos. Credenciales, SQL y copia original privados fuera de Git; no servidos por la vista.

Evidencia reproducible: outputs/m9-recuperacion-wordpress-2026-10-04 (ensayar.py, repetir-lectura.py, verificar.php, guard.php, resultado.json, resultado-repeticion.json, crear-vista.py, servir-vista.py, vista-verificacion.json, verificacion-final.json). ensayar.py crea recursos nuevos; para repetir lectura usar repetir-lectura.py. No ejecutar la copia con wp-config original. Servidor de vista no inicia WordPress.

Avance tecnico estimado 90% (orientativo por hitos, no porcentaje de productos migrados): respaldo real recuperado y modelo Woo del lote comprobado. Staging sigue abierto. Siguiente: ensayo aislado del tema y complementos necesarios, validar recuperacion/reversion sin perder ventas posteriores, resolver decisiones comerciales, obtener fuentes frescas al corte y aprobacion especifica antes de produccion. Mejoras del otro chat siguen pospuestas. App 0.64.0 sin cambio funcional ni despliegue; cero escrituras Woo/Supabase de produccion y cero importacion de existencias.


## Arranque aislado con tema y complementos reales - 2026-10-05

Ensayo CLI del respaldo real con Blocksy / blocksy-child y lista original de 31 plugins activos; init y after_setup_theme completados sin error fatal. Identidad y pertenencia de hijos de las cuatro familias 5630/5738/19771/25814 coinciden con el ensayo Woo-only. Correos y HTTP bloqueados, pasarelas disponibles cero, cron desactivado. Contenedor sin red/puertos, archivos y raiz de solo lectura, usuario DB SELECT-only. Contenedores detenidos en finally.

Limitacion concreta: 57 menciones de escrituras SQL denegadas durante arranque. Son intentos bloqueados de plugins y no deben ocultarse ni interpretarse como compatibilidad funcional completa. Dos avisos PHP: ABSPATH definido dos veces por configuracion local, REMOTE_ADDR ausente al ejecutar Openpay por CLI. Cero fatales; no prueba renderizado, checkout, tareas programadas ni integraciones. No se ampliaron permisos para eliminar avisos. Diagnosticos crudos permanecen privados.

Evidencia fuera del repositorio: outputs/m9-tema-complementos-2026-10-05/{ensayar.py,probar.php,guard.php,resultado.json,diagnostico-resumido.json,sha256.json}. Siguiente: preparar copia desechable de DB para escrituras internas de plugins, mantener aislamiento de red/correo/pagos, y probar renderizado web local con bloqueo de recursos externos del navegador. No servir directamente el arbol privado ni exponer datos de clientes. Pendiente aceptacion comercial, fuentes frescas y reversion que preserve ventas posteriores.

Avance estimado se mantiene 90%; staging NO cerrado. Version Mi Tienda SM 0.64.0, sin cambios funcionales ni despliegue. Produccion intacta y sin importacion de existencias.


## Base desechable y render del tema - 2026-10-05

Creado esquema local m9_disposable_20261005 desde dump consistente de m9_recovery. Usuario nuevo con permisos solo sobre ese esquema. Misma MariaDB local sin red/puertos; PHP sin red, archivos originales RO, correo/pagos/HTTP/cron bloqueados. Credenciales y dump privados fuera de Git. Primer intento detenido por ruta local de configuracion inexistente; corregido y continuado sin recrear el esquema.

Tema Blocksy-child y 31 plugins arrancan sobre clon writable. Cero SQL command denied (ensayo previo 57 menciones), cero fatales; un aviso SERVER_NAME ausente por ejecucion CLI. Generado single.php de producto 5630: 180713 bytes, nombre esperado presente. HTML crudo privado, no servido: contiene recursos de terceros que requieren bloqueo/relocalizacion antes de abrir navegador. No se declara prueba visual ni checkout completo.

CHECKSUM TABLE wp_posts/wp_postmeta antes/despues coincide en origen recuperado y clon. No equivale a comparar cada tabla de la base; plugins pueden actualizar opciones/tablas internas en el clon. Cuatro familias conservan identidad e hijos. Contenedores detenidos al terminar. Produccion intacta; sin importacion de existencias al sistema.

Evidencia: outputs/m9-base-desechable-2026-10-05/ensayar.py, continuar.py, probar.php, guard.php, resultado.json, diagnostico.json. scripts requieren nombres nuevos o el estado parcial documentado; no reejecutar sin revisar. Siguiente: render web local seguro con recursos externos bloqueados y revision visual; despues ensayo de recuperacion conservando ventas posteriores, decisiones comerciales y fuentes frescas. Estimacion 90% se mantiene; staging abierto. App 0.64.0 sin despliegue ni cambio funcional.


## Lote visual, selectores, pedido posterior y cortes repetibles — 2026-10-05

Avance local en los cuatro frentes autorizados. Cuatro fichas renderizadas con template_include Woo y tema Blocksy, comprobadas en navegador: fotos/textos/precios. Vista localhost9448 sirve solo 73 archivos públicos del lote con lista permitida, CSP sin conexiones/formularios/frames remotos; scripts de publicidad/pagos retirados. Selector de consulta 17 opciones; selector JS original Woo 16 tallas (tres familias variables), IDs/precios cotejados. Bolsa simple revisada sin selector. JSON de variaciones tiene imágenes/HTML auxiliar neutralizados; no equivale a aprobar checkout, galería dinámica ni plugin swatches. Capturas y pruebas en outputs/m9-cierre-pruebas-2026-10-05. Dos fuentes EOT antiguas omitidas. Agotado mostrado es histórico, no inventario actual.

Reversión secuencial en clon desechable: producto ficticio 100→110, pedido ficticio posterior por 110; precio regresado a 100 y pedido conserva importe/cantidad. Cambio posterior a 120 bloquea decisión de revertir con esperado110. Datos ficticios limpiados; wp_posts/wp_postmeta del clon y origen sin cambios por checksum. No pago ni stock. NO prueba atomicidad GET/PUT, concurrencia de producción ni restauración total conservando pedidos. Script local no habilitado como importador real.

Comparador ejecutado dos veces byte-idéntico: histórico 15722 UNCHANGED, 384 RECONCILIATION_CHANGE_ONLY, 24 INVENTORY_ONLY_EXCLUDED, 3 NEW_MANUAL_REVIEW. Mismo corte 16133 UNCHANGED. Seis escenarios de seguridad de actualización aprobados. Fuentes guardadas, no exportaciones nuevas. Comparar-cortes.py permite repetir sobre reportes nuevos con huellas verificadas y salida nueva. Reglas/conciliación cambiadas no prueban cambios físicos.

Todos los contenedores de recuperación detenidos; solo vista estática local activa. Evidencia y procedimiento detallado: outputs/m9-cierre-pruebas-2026-10-05/reporte.md y verificacion-final.json. Estimación orientativa 90% se mantiene; staging abierto. Restan interfaz integrada completa, concurrencia/reversión real, aprobación comercial y fuentes frescas/autorización antes de producción. Mi Tienda SM 0.64.0 sin cambio funcional/despliegue. Producción intacta y cero importación de existencias al sistema. Mejoras del otro chat pospuestas por usuario.


## Conflictos simultaneos — ensayo local 2026-10-05

Dos conexiones concurrentes al clon desechable intentan actualizar precio de producto ficticio desde100 a110/120; exactamente una gana y otra afecta cero filas. Transaccion condicional SQL mantiene par _regular_price/_price consistente. Reversion preserva nombre editado posteriormente; un precio posterior bloquea reversion obsoleta. Acuse descartado se concilia por lectura sin reenviar; simulacion, no caida de red real. Woo lee140 final. Producto ficticio marcado eliminado; checksums wp_posts/wp_postmeta origen y clon iguales a iniciales. Sin pagos ni stock ni produccion.

Limite: prototipo del motor SQL, NO endpoint Woo REST ni adaptador integrado. Escrituras directas evitan hooks/cache/tablas auxiliares y no cubren promociones. Comparacion por valor no detecta ABA ni obliga a escritores normales. No declarar resuelta concurrencia productiva. Siguiente: canal de escritura controlado con identidad/version/valor y registro de operacion, integrado y probado en laboratorio; o ventana supervisada sin ediciones del catalogo para las familias del lote, pendiente de acordar. Ninguna restauracion total sobre ventas posteriores.

Evidencia outputs/m9-concurrencia-2026-10-05/reporte.md y resultado.json. Contenedores detenidos. Mi Tienda SM0.64.0 sin cambio funcional/despliegue. Estimacion90% mantenida, staging abierto; produccion intacta, existencias no importadas.


## Worker con actualizacion condicionada local — 2026-10-05, preparada0.65.0

Integrado expected snapshot de cada PUT en worker/wooClient; se envia a ruta POST local conditional-update, sin fallback a PUT normal. Guard en localhost9417 adquiere bloqueo exclusivo de opcion, relee respuesta REST completa y compara antes de delegar en Woo. Directos wc/v3 de actualizacion/batch bloqueados; metadata identidad/inventario rechazados. Caidas conservan bloqueo para inspeccion, sin vencimiento. Consultar [M9_ACTUALIZACION_CONDICIONAL_LOCAL.md](M9_ACTUALIZACION_CONDICIONAL_LOCAL.md).

Ensayo real mediante runJob: SUCCEEDED, conflicto inyectado entre preflight/envio REVIEW_REQUIRED con edicion conservada, retry cero solicitudes, dos solicitudes iguales una aceptada/otra rechazada. Negativas: PUT directo409, inventario400, codigo400, batch409, anonimo401. Familia sintetica23/hijo24 restaurada salvo fechas; diarios originales intactos. Evidencia outputs/m9-adaptador-protegido-2026-10-05. Primer ensayo fallo por enlaces REST omitidos en snapshot interno; corregido mediante response_to_data. 181 unitarias aprobadas desde raiz repo (primer lanzamiento desde workspace fallo ruta Python, no logica).

Limitaciones explicitas: laboratorio Playground con un workerPHP; no multiples procesos, no ABA/versionado global, no bloqueo WP-admin/CLI/otras versiones API/creaciones. No transaccion atomica por familia. Produccion NO habilitada. Pendiente validar coordinacion de escritores/canal final y aprobacion/fuentes frescas. Staging abierto, estimacion90% mantenida. App preparada0.65.0; version publicada0.64.0 sin despliegue nuevo, avatar nuevo pendiente de comprobar al desplegar. Sin cambios en Woo/Supabase produccion ni importacion de existencias.


## Preview 0.65.0 verificado — 2026-10-05

Commit funcional b3524cf754c6111f3f81dc1498c9b9a7f89ea8f5 publicado en codex/m9-staging-review. Vercel success y menú de usuario0.65.0 comprobado. Captura: outputs/m9-preview-0.65-2026-10-05/version-staging.png. Antes de publicar se corrigió mutex: add_option permite upsert; ahora INSERT exclusivo y liberación condicionada al token. Bloqueo ocupado423, token conservado, producto intacto. Ensayos finales v3 aprobados.

181 unitarias locales aprobadas, formato y diferencias revisados. GitHub Actions sin ejecución para este commit; PR87 borrador con mergeable=false frente a main5366bd48. No se mezclaron mejoras del otro chat ni se declara CI remota aprobada. Pendiente integrar ramas por separado y verificación completa, canal final con múltiples escritores, recuperación por familia, decisiones comerciales y fuentes frescas. Estimación90%, staging abierto. Producción intacta; cero importación de existencias.


## Preparación de integración, interrupción y cortes — 2026-10-05

Revisado main766c92e mediante merge-tree: cuatro conflictos (manifest de empleados, plan, release, package). Propuesta separada en outputs/m9-preparacion-integracion-2026-10-05/propuesta-no-aplicada, sin aplicar merge ni publicar0.66.0. Versión publicada sigue0.65.0. Preserva ambos historiales y Route Handler/cabeceras de staging, más iconos/caché de Mi Vaquero al integrar. Necesario repetir diagnóstico si cambian puntas.

SIGKILL real del trabajador local tras respuesta de Woo antes de registrar acuse: bloqueo persistente, reinicio sin solicitudes, inspección y retirada sólo del bloqueo propio con proceso muerto, conciliación por una lectura del padre conocido, reanudación sólo de variante pendiente, repetición final cero solicitudes. Familia sintética23/24 restaurada salvo fechas. No prueba multiworker, WP-admin ni transacción por familia. 34 unitarias de worker/cortes aprobadas.

Nuevo ejecutor offline recibir-corte.mjs preserva fuentes, genera dos reportes y dos deltas, comprueba igualdad y huellas. Ensayo con fuentes históricas:11 archivos idénticos,16133 sin cambios, cero escrituras de producción/existencias. No se descargaron fuentes nuevas. Ver reporte.md del paquete para instrucciones y limitaciones. Scripts del conciliador work/m9 conservan cambios no versionados preexistentes: no fueron modificados. Estimación90% mantenida, staging abierto; CI remota del commit anterior sigue pendiente y no se declara cierre.

### 2026-10-03 · 0.55.4 · Icono original de Mi Vaquero

El icono instalado usa el mismo logo completo original del inicio (`public/brand/logo-vaquerosm-blanco.png`), exportado sobre negro en 180/192/512 px con margen seguro, sin generación de otra silueta. Manifest, favicon y Apple Touch Icon apuntan a archivos nuevos; caché editorial v2. Conserva el nombre Mi Vaquero y el resto de la PWA vigente en main. Sin cambios de datos ni simulaciones nuevas. La actualización de instalaciones existentes depende del navegador/SO; en iOS puede requerir volver a agregar a Inicio.

La verificación detectó que la convención `app/manifest.ts` tenía prioridad sobre el manifiesto de clientes. Se convierte a Route Handler en la misma URL `/manifest.webmanifest`, conservando el contenido de Mi Tienda SM, para que `/mi` seleccione su manifiesto propio y el icono correcto.

Validación de entrega: compilación de producción y TypeScript correctos; lint completo y formato correctos; seis pruebas de la PWA en escritorio/móvil aprobadas, incluyendo manifiestos separados y tarjeta offline. Navegador confirma `/mi/manifest.webmanifest` y Apple Touch Icon original sin overlay de error. La versión 0.55.4 queda sincronizada con package.json. No se validó avatar S con sesión de empleado en este entorno sin credenciales ni actualización del icono en dispositivo físico instalado.

### 2026-10-03 · 0.55.5 · Restaurar letras de Mi Vaquero

El icono combina el emblema original de Vaquero SM con las letras «Mi Vaquero» del icono anterior, conservadas sin reinterpretarlas. Se corrige la entrega 0.55.4 que había reemplazado el nombre por VAQUERO SM. Exportaciones PNG 180/192/512 y máscara de 512 con margen adicional; referencias nuevas y caché editorial v3. Sin cambios de datos ni simulaciones nuevas.

Validación 0.55.5: revisión visual del icono; compilación de producción/TypeScript, lint y seis pruebas de PWA correctos. Navegador confirma el manifiesto de Mi Vaquero y nuevo Apple Touch Icon, con contenido y sin error de interfaz. La comprobación del icono en un teléfono instalado sigue pendiente; su actualización depende del SO. Avatar S no validado sin sesión de empleado en este entorno.


## Registro vivo — integración M9 y Mi Vaquero, 2026-10-05

Integrado main766c92e en staging por autorización del usuario. Cuatro conflictos resueltos preservando Route Handler tipado y cabeceras del manifest de empleados, registros históricos de ambas ramas, build webpack y versión nueva0.66.0. Incluidos iconos originales de Mi Vaquero, caché v3 y su prueba PWA. Sin cambios de base de datos, datos Woo o inventario. 181 unitarias y formato locales aprobados antes del envío; validación alojada y avatar pendientes en este registro de preparación. No declarar staging cerrado ni habilitar producción.


## Verificación Preview integrado0.66.0 — 2026-10-05

Publicado4fb17ef con segundo padre main766c92e, árbol local/remoto idéntico. Vercel success, avatar0.66.0 verificado. Búsqueda escrita2396 devuelve sombrero59/$2190; no nueva prueba física de lector. /mi carga y referencia manifiesto propio e iconos originales nuevos. 181 unitarias, formato, lint y tipos aprobados localmente. PR87 mergeable=true, permanece borrador. CI286/run37375255100 sigue queued, sin ejecución: integración/E2E completas pendientes por runner externo; no declarar aprobado ni staging cerrado. Capturas y verificacion.json en outputs/m9-integracion-0.66-2026-10-05. Sin producción, importación de existencias o merge a main.


## Verificación integrada y lote completo — 2026-10-05

CI286/run37375255100 sobre4fb17ef termina SUCCESS:181 unitarias,165 integración,128 navegador, formato/lint/tipos/build y base de prueba aprobados. Lote real local de cuatro familias/17 variantes pasa actualización condicionada, respuesta descartada, conciliación por ID y reanudación; repetir cero solicitudes. Todo restaurado salvo fechas; identidad/stock conservados. Nueva evidencia outputs/m9-cierre-integrado-2026-10-05. No es un nuevo recorrido UI→cola→puente→recibo. Snapshots históricos pueden quedar obsoletos por las fechas; revalidar, no forzar comparación.

Preparado procedimiento de escritor único/ventana supervisada, pero no verificado bloqueo de editores wp-admin/CLI/plugins ni múltiples procesos PHP. Pendientes recorrido UI fresco y validación de escritores antes de cerrar staging. Supabase local arrancó mientras CI estaba en cola y fue detenido preservando volúmenes; pruebas completas válidas son las de CI. Sin producción, stock o versión funcional nueva. Publicada0.66.0, estimación90%, staging abierto.


Revisión posterior de recibos históricos: 20 recursos, 20 con diferencias exclusivamente en date_modified/date_modified_gmt y 0 con otras diferencias. Consulta sin escrituras, sin aceptar un nuevo baseline. La UI de bolsa sigue mostrando envío2 verificado/ID18; no se editó ni se encoló otro trabajo al identificar este requisito. Pendiente mecanismo auditable para revalidar el destino y conservar recibo original. Ver revalidacion-lectura.json.


## Revalidación supervisada y recorrido de bolsa — 2026-10-05, 0.67.0

Nueva herramienta prepare-revalidation.mjs produce sólo lecturas contra Woo local. Compara TODOS los campos contra la evidencia original salvo date_modified/date_modified_gmt de primer nivel; cualquier cambio comercial/identidad bloquea. Registro con motivo, hash de evidencia anterior, tienda/producto/target y snapshots nuevos. El puente valida la evidencia anterior íntegra antes de aplicar el registro; liga su hash al diario y conserva el registro en la evidencia del nuevo recibo. Preflight y guard final siguen comparando el snapshot completo; no se ignoran fechas durante el envío. No detecta ABA ni controla escritores externos.

Recorrido real autorizado: UI staging bolsa10521, revisión3 con nombre temporal→cola→claim38ffe5a3-76dc-4c17-990a-f05b57b38c61→revalidación→Woo local18→recibo SUCCEEDED visible. UI revisión4 restaura nombre→claime9f1db4a-caf5-4746-96f3-6b021bb6f4d0→puente normal sin otra revalidación→mismo ID18 y recibo visible. Campos comerciales originales, cuatro fotos, código10521 y precio8695 conservados; cero solicitudes al repetir worker. Comprobantes anteriores sin modificaciones. Sólo escritura de ficha/cola en staging y borrador Woo local, nunca producción ni existencias. Evidencia outputs/m9-revalidacion-2026-10-05.

194 unitarias locales aprobadas, incluyendo13 nuevas de revalidación; lint dirigido aprobado. Versión preparada0.67.0; despliegue y CI de esta versión pendientes al guardar este registro. CI286 aprobó0.66.0 con181/165/128 pruebas, no sustituye la nueva validación. Staging sigue abierto por control de escritores externos y revisión final del lote; no se declara revalidación productiva.


## Entrega0.67.0 verificada — 2026-10-05

Publicadoa258dbd, árbol384ccb731ed90b8a22d60ad517bda3daabd2d5d0. Vercel success, avatar0.67.0 y ficha con revisión4/recibo verificado comprobados. CI287/run37387433446 SUCCESS:194 unitarias,165 integración,128 navegador; formato/lint/tipos/build y base de prueba aprobados. Cadena de recibos anterior→revalidación→envío3→restauración4 verificada por huellas. Recorrido UI de bolsa simple cerrado para este ensayo; no equivale a UI de todas las familias ni control global de escritores. Pendiente validación de escritores externos, alcance final y fuentes frescas antes de cierre/producción. Staging abierto, sin producción ni existencias. Evidencia outputs/m9-revalidacion-2026-10-05/estado-final.json.


## Decisiones de dueños recibidas — 2026-10-05

Registradas las seis respuestas en [M9_RESPUESTAS_DUENOS_2026-10-05.md](M9_RESPUESTAS_DUENOS_2026-10-05.md). Talla 60 de Tombstone es una opción del modelo sin mercancía recibida: no crear identidad física ni existencias. Nokota debe ser CABALLERO; corrección reportada, pendiente de exportación fresca. Aprobado el detalle de piedra roja de West Point. Amartigones por talla y color según disponibilidad, con nuevo requisito de exhibición sin compra, pendiente de implementación y prueba de bloqueo también en servidor. Prueba física del lector2396/talla59/$2190 ya cerrada por confirmación anterior. Cintos18057/18058 corresponden a40/42; falta verificar la asignación exacta por código en el archivo corregido. No se sustituye evidencia histórica ni se liberan automáticamente casos. Sólo documentación local, sin cambios de datos, producción, existencias o despliegue. Publicada0.67.0; staging sigue abierto y la estimación no cambia por estas respuestas.


## Corte SICAR 6 verificado — 2026-10-05

Archivo recibido Plantilla_Productos (6).xlsx, SHA256 171200f4b21f1a1f11bd977739d3e80a7f191b09977d2cdffcee1a6a4daab12a. Comparación offline reproducible en outputs/m9-corte-sicar6-2026-10-05:16224 filas,91 nuevas,28 precios públicos modificados,155 filas con cambios de inventario excluidas;11 archivos y delta idénticos al repetir. Confirmadas seis tallas Nokota en CABALLERO (11201/3280 corregidos),18057 talla40/$2050 y18058 talla42/$2300 (precio anterior$2050),2396 talla59/$2190 intacto. No crear talla60 de Tombstone. SICAR_ONLY de cintos no se libera automáticamente. Amartigones exhibición sin compra pendiente de implementar y verificar. Woo histórico del1 de octubre, reglas m9-readonly-5 sin incorporación automática de respuestas nuevas. Evidencia casos-verificados.json y reporte.md. Originales intactos; sin producción, staging, Woo, existencias ni despliegue. Publicada0.67.0, staging abierto.


## Prototipo de exhibición y revisión de altas — 2026-10-05

Evidencia outputs/m9-exhibicion-2026-10-05. Prototipo PHP exclusivamente local, instalado en mu-plugins del laboratorio9417, sin modificar catálogo ni el puente. Diez comprobaciones en memoria aprobadas de política de compra simple/variante, herencia mediante resolvedor de prueba, no interferencia y hooks Store API. Ruta diagnóstica autenticada, aislamiento de correos/red/pagos verificado. Vista de demostración /m9-exhibicion/ abierta y comprobada; sin tallas/fotos inventadas. NO demuestra carrito/checkout HTTP ni asignación real de política. Pendiente integrar ficha y validar sesiones completas.

91 altas SICAR6 agrupadas:90 SICAR_ONLY,1 CONFLICT por EXISTENCIA_INVALIDA (18086/BCD3782-60CAF26.5). Departamentos37 CABALLERO,36 DAMA,18 UNISEX;28 cambios de precio documentados. Sin coincidencia web no significa error; no se liberan automáticamente. Woo fuente del1 de octubre. Código y existencias originales preservados. Sólo prototipo local y reportes; sin producción, existencias, despliegue o escritura de catálogo staging. Publicada0.67.0; estimación técnica90% mantenida, staging abierto.


## Ensayo persistido de carrito — 2026-10-05

Once comprobaciones aprobadas contra Woo local real con cuatro productos sintéticos temporales. Control elegible añadido; exhibición simple y variante heredada rechazadas; carrito previo bloqueado al cambiar política. Store API ejecutada por REST interno dentro de solicitud diagnóstica autenticada:control201,exhibición/variante400 con código woocommerce_rest_product_not_purchasable. No es una sesión de navegador checkout. Se corrigió la expectativa inicial200 del control a201 según código instalado de Woo; no se relajó el rechazo. Productos62–65 eliminados; también58–61 del primer ensayo. Endpoint temporal retirado después del ensayo. Aislamiento posterior aprobado, cero pedidos. Evidencia integracion.json.

Revisión de cierre en estado-cierre.json:la integración ficha→cola→puente→recibo del modo exhibición aún no existe; control de escritores, navegador checkout, fuentes finales y alcance aprobado pendientes. No declarar100%. El90% previo era estimación sin denominador medido; no se usa como aceptación. Sin cambios de aplicación publicada0.67.0, producción o existencias.


## Integración de política de exhibición — preparada 0.68.0, 2026-10-05

Regla aprobada de Woo37102/producto200ca5b2-7e5f-44ee-9428-2bceebe282dc/Clave10105 en lib/m9-display-policy.json, compartida por aviso de ficha y compilador del trabajador. No es selector editable ni una regla por nombre. Rechaza cambios del conjunto de códigos y conserva las validaciones existentes de identidad. Añade aviso comercial y metadata _m9_display_only=yes al padre; hijos heredan en Woo. El cliente comprueba capacidad exacta del plugin local antes de escribir; no hay fallback. Guard condicionado admite únicamente activar la metadata, nunca desactivarla. Launcher instala plugin con bloqueo de compra, Store API y carrito. Sin migración de esquema ni modificación de datos staging.

199 unitarias aprobadas (cinco nuevas), lint dirigido, TypeScript y build webpack correctos. Ensayo real del trabajador en Woo local: borrador técnico66 creado y actualizado SUCCEEDED, repetición cero solicitudes, código10105/precio230 y campos de inventario conservados. Se usó imagen sintética existente y nombre explícito de prueba, no ficha comercial definitiva. Evidencia outputs/m9-exhibicion-integrada-2026-10-05/evidencia.json. No equivale a recorrido UI→cola→claim→recibo visible; quedan habilitación/revisión del producto en cola, despliegue Preview y comprobación del avatar0.68.0. Versión preparada0.68.0, publicada sigue0.67.0. Sin producción ni importación de existencias; staging abierto.


## Entrega 0.68.1 — exhibición con recorrido completo, 2026-10-05

Publicado d32fbaf58a3605acad14325f1008357666be166e, árbol6bebfec965aa54ace0b810162185ca7533109405. Preview success y avatar0.68.1 comprobados. CI290/run37407202498 SUCCESS:199 unitarias,165 integración,128 navegador, formato/lint/tipos/build. La primera CI288 detectó formato de una prueba y se corrigió.

Categorías del amartigón37102 verificadas por consulta pública:467 Amartigon,270 Caballo,419 Vaquero SM, padres0. Binding preparado mediante función auditada y producto10105 habilitado sólo para laboratorio en staging. UI guardó revisión1 y encoló24aaacd1-53ac-4fed-be13-b41a1d3a324a; claimc0c4d8b4-6206-47fa-850b-6c107aeb3cf7. Puente creó borrador local75 con ocho imágenes, código10105, precio230, metadata de exhibición yes y purchasable=false. Recibo SUCCEEDED f1c147eb02efdeed96e6cd69d3a2f6d162771e3e40df50dd383c6f9428ed0525 registrado y visible en UI. Repetición cero solicitudes, cero campos de existencias enviados, cero pedidos.

El recorrido encontró un409 al crear categoría nueva: guard antiguo bloqueaba esa colección. 0.68.1 permite sólo POST exacto de la colección categorías, manteniendo bloqueo de updates directos de productos. Se comprobó ausencia por slug, guardó diario original y evidencia y retiró sólo la marca del envío rechazado para reanudar. PUT directo al producto75 sigue409 y nombre intacto. Aislamiento de red/correo/pagos validado.

Evidencia outputs/m9-exhibicion-integrada-2026-10-05:claim-ui.json,run-ui/,asset-recovery.json,cierre-funcional.json,entrega-verificada.json,recibo-ui.png y version-0.68.1.png. Cerrado este recorrido de exhibición; staging global sigue abierto por control de escritores externos, alcance final y fuentes del corte. Sin producción, importación de existencias ni merge a main. PR87 continúa borrador.


## Catálogo visual de pruebas — preparada 0.69.0, 2026-10-05

Soporte de portadas HTTPS exclusivamente vaquerosm.com/wp-content/uploads/ en productos y ficha, conservando rutas de almacenamiento existentes; aviso persistente únicamente en staging. 207 unitarias, build y lint locales aprobados. Pendientes despliegue y asignación auditada de las 41 portadas conciliadas; no se declara visible hasta verificar Preview. Preparación offline de 16224 filas SICAR6 en outputs/m9-catalogo-completo-pruebas-2026-10-05/catalogo-preparado.json:6363 candidatas,3970 revisión manual,5891 SICAR sin vínculo web para revisión. Ninguna importada por esta preparación; inventario excluido y coste nulo. Woo fuente 1 de octubre, no se considera corte actualizado de hoy. Altas arbitrarias programa→Woo aún requieren ampliar la cola restringida. Sesión Hostinger accesible por Chrome nativo; herramienta staging disponible, sin crear copia todavía ni modificar producción.


## Corrección de portadas — 0.69.1, 2026-10-05

La asignación de URL a products.image_path fue rechazada por products_image_path_format y toda la transacción se revirtió:0 portadas almacenadas/0 auditorías de asignación. Se conservó la restricción de almacenamiento. Se implementó read_catalog_covers: consulta sólo de lectura a fuente y vínculo M9 exacto, lote máximo200, usuario activo con products.read, puerta staging, sin acceso anon/service_role. Devuelve41 portadas existentes y respeta fotos manuales; validación adicional de URL en aplicación. Migración20261006032727 aplicada sólo en zsezjtswqeijboezvado. Pruebas SQL de autorización, lote vacío y límite aprobadas; build/tipos y lint dirigidos correctos. Evidencia outputs/m9-catalogo-visual-2026-10-05/verification.json. Commit8c056476b3f9560fa64c99cbc169f1017b521c43 en PR87; Preview/CI292 y visual pendientes al registrar. No importación de catálogo, inventario ni producción.


## Verificación visual 0.69.1 y alojamiento remoto — 2026-10-05

Preview success y avatar0.69.1 comprobados. Catálogo muestra fotos de las41 identidades conciliadas mediante lectura; muestra visual2396 conserva talla59/$2190 y foto del sombrero cargada. No se alteraron image_path, códigos, precios ni existencias. CI292 todavía en ejecución. Asesor no reporta read_catalog_covers; conserva avisos globales de funciones y RLS anteriores, no modificados.

Hostinger accesible en Chrome nativo (no vía extensión). Se preparó instalación NUEVA de WordPress con dominio temporal en plan Business existente, sin clonar tienda activa. Formulario «Crea los datos de acceso» pendiente de que usuario establezca contraseña y pulse «Crea desde cero», por política de control de navegador. No creada aún, no Woo remoto operativo ni credenciales nuevas del agente. Captura hostinger-acceso-pruebas.png y consulta pendiente en chat. No sustituir con staging automático que copia conexiones/pedidos sin aislamiento previo. Catálogo completo sigue sólo preparado offline y altas arbitrarias programa→Woo todavía pendientes.


## Continuación de alojamiento de pruebas — 2026-10-05

CI292/run37409175801 finalizó SUCCESS para8c056476/0.69.1. Usuario completó creación del WordPress independiente en salmon-nightingale-251188.hostingersite.com; administrador accesible en Chrome. Se inicia instalación oficial de WooCommerce; aún sin conexión al programa ni catálogo cargado remoto. Objetivo solicitado: pruebas listas esta semana, sujeto a verificación; no es autorización de producción.


## Woo remoto instalado — 2026-10-05

WooCommerce oficial11.1.2 instalado y activado en WordPress7.1.2 del sitio nuevo salmon-nightingale-251188.hostingersite.com. MonedaMXN guardada; modo Próximamente ampliado a todo el sitio y confirmación de guardado verificada. Sin enlace privado habilitado, sin pasarelas instaladas ni conexión al programa ni productos importados. No declarar aislamiento completo: bloqueo servidor de correo/pedidos pendiente, así como configuración regional, credencial acotada del puente y ensayo de alta nueva. Captura y estado en outputs/m9-woo-remoto-2026-10-05. Tienda real sin cambios.


### 2026-10-05 — Preparación del aislamiento remoto (pendiente de instalación)

- Woo remoto independiente: `https://salmon-nightingale-251188.hostingersite.com`; WooCommerce activo, MXN y Próximamente en todo el sitio.
- Preparado `scripts/m9/woo-remote/m9-test-isolation.php`, fijado exclusivamente a ese origen. Bloquea correo WordPress, HTTP saliente, pagos, webhooks, compra/carrito, guardado de pedidos y escritura REST Woo; fuerza productos publicados a borrador. No modifica el guard local.
- 15 comprobaciones locales con PHP 8.3 y stubs de WordPress pasaron; evidencia `outputs/m9-woo-remoto-2026-10-05/guard-tests.json`. No equivale a una prueba de integración remota. ZIP listo en ese mismo directorio.
- Instalación/activación remota pendiente de confirmación en el navegador para complemento propio fuera del directorio oficial. Conexión con el programa, credencial acotada y prueba de alta con imagen pendientes. No importación de existencias ni escrituras en producción.


### 2026-10-05 — Aislamiento remoto instalado y activo

Usuario autorizó instalación y activación del complemento propio. Instalado 1.0.0 en salmon-nightingale-251188.hostingersite.com, confirmado “Plugin activado”. Panel Herramientas > Pruebas M9: 8 comprobaciones OK (origen, correo, red saliente, cero pagos, webhooks, compra, variaciones, carrito). Evidencia: outputs/m9-woo-remoto-2026-10-05/aislamiento-activo.png y estado.json. Son comprobaciones de filtros y HTTP saliente, no una compra integral. Conexión con programa continúa pendiente, API Woo de escritura bloqueada. Sin cambios en producción ni importación de existencias.


### 2026-10-05 — Puente remoto preparado, NO instalado ni conectado

Preparados scripts/m9/woo-remote/client.mjs y catalog-bridge.php; plugin local 1.1.0 incluye módulo separado. Origen exacto remoto; sólo alta de producto simple en borrador con una imagen binaria validada y recibo por UUID. Sin campos de inventario, sin actualización de productos existentes, sin acceso genérico Woo. Rol m9_test_catalog todavía NO creado remoto; exige contraseña de aplicación de usuario de ese rol y niega otras rutas REST/XML-RPC. Locks persistentes por solicitud/producto; errores requieren revisión, no reenvío automático. No modificar conector localhost.

53 pruebas Vitest aprobadas (13 nuevas y 40 de conectores existentes), lint/formato correctos. 17 comprobaciones PHP con stubs aprobadas: validación, permisos, bloqueo de otros endpoints y repetición/conflictos de recibos. No se ha probado escritura integral con Woo remoto ni adaptación de ficha/cola del programa al nuevo protocolo. Evidencia bridge-server-tests.json, ejecutor test-bridge.mjs en outputs/m9-woo-remoto-2026-10-05. ZIP m9-test-isolation-1.1.0.zip preparado. Chrome abre selector con ZIP válido pero Abrir deshabilitado; se canceló y dejó formulario Subir plugin para intervención del usuario. No se subió/instaló 1.1.0; remoto permanece 1.0.0, protecciones activas. Próximo: cargar actualización, verificarla, preparar cuenta exclusiva/contraseña de aplicación mediante intervención del usuario y probar producto de staging de extremo a extremo. App publicada 0.69.1 sin cambios; sin producción/existencias.


### 2026-10-06 — Actualización remota 1.1.0 verificada

Se resolvió bloqueo del selector copiando ZIP idéntico a /tmp/m9-test-isolation.zip. Carga y reemplazo ejecutados en Chrome únicamente en Woo remoto de pruebas; WordPress confirmó actualización con éxito. Herramientas > Pruebas M9 muestra Protección1.1.0 y ocho comprobaciones OK. Evidencia outputs/m9-woo-remoto-2026-10-05/puente-1.1.0-instalado.png. Puente instalado; falta cuenta/contraseña de aplicación exclusiva y ensayo integral desde ficha de programa. Sin credencial nueva, importación de existencias ni cambios en producción. Aplicación publicada permanece0.69.1.


### 2026-10-06 — Acceso exclusivo preparado, pendiente de usuario

En Chrome, formulario Agregar usuario del Woo remoto: nombre m9_catalogo_pruebas, perfil M9 — Sólo catálogo de pruebas, aviso por correo desmarcado y contraseña oculta. No se envió el formulario ni se creó credencial. Usuario debe indicar correo que controle y completar/guardar contraseña y crear cuenta por regla de handoff de credenciales del navegador. Después preparar contraseña de aplicación para ese usuario, guardarla de forma privada y verificar denegación de otros endpoints antes del ensayo de producto. Captura acceso-limitado-pendiente.png en outputs/m9-woo-remoto-2026-10-05. Conexión pendiente; producción intacta.


### 2026-10-06 — Usuario limitado confirmado y clave de aplicación pendiente

WordPress confirma Nuevo usuario creado. Verificados username m9_catalogo_pruebas y rol M9 — Sólo catálogo de pruebas en lista y edición. Preparado nombre de contraseña de aplicación M9 - Conector Woo de pruebas; NO pulsado Agregar contraseña de aplicación por handoff de credenciales. Plantilla privada auth.json en work/m9-woo-remote/private, directorio0700 y archivo0600, contraseña vacía; no secretos leídos. Usuario debe generar clave y guardarla localmente, fuera del chat y repositorio. Pendiente autorización efectiva de API y ensayo integral. No cambios de producción ni inventario.


### 2026-10-06 — Credencial verificada y caché pública corregida

Clave corregida aceptada por diagnóstico remoto, sin imprimir secretos. Accesos autenticados a wc/v3/orders, wc/v3/products y wp/v2/users rechazados403 m9_scope_denied. Detectado diagnóstico en caché LiteSpeed servido sin autenticación (200/x-litespeed-cache:hit); una URL de consulta nueva confirmó401 rest_forbidden, aislando caché como causa. Desactivado LiteSpeed Cache sólo en Woo de pruebas, con confirmación UI. Repetición misma URL: anónimo401, autenticado200, anónimo401; sin hit caché. Evidencia cache-auth-verification.json, remote-preflight.json y cache-desactivada.png en outputs/m9-woo-remoto-2026-10-05. remote-access-checks.json conserva hallazgo inicial fallido para trazabilidad. No reactivar caché sin exclusión de API y regresión autenticado/anónimo. Pendiente envío real de producto simple remoto y adaptación desde ficha/cola del programa. Sin producto creado, sin inventario ni producción modificados; app0.69.1.


### 2026-10-06 — Ensayo remoto verificado y alcance funcional aclarado

Usuario reafirma aceptación: alta desde Mi Tienda → producto Woo; fotos añadidas en Mi Tienda o Woo deben aparecer en ambos; migración debe traer fotos Woo a producto correspondiente de Mi Tienda. No considerar cerrado con envíos manuales o script. Vínculos por identidad verificada, nunca sólo nombre; cambios simultáneos en revisión.

Ensayo de transporte remoto con ficha histórica guardada/revisada4 de bolsa f4291151-09fc-429a-9e36-ccc214c32acb, código10521, precio8695: producto remoto14 e imagen15 creados como borrador. Primer intento quedó REVIEW_REQUIRED por comparación estricta de image_id (Woo devuelve string). Corrección plugin1.1.1 normaliza ID a entero y verifica archivo original SHA256, textos/código/precio/meta/estado. 22 comprobaciones PHP aprobadas. Instalado1.1.1 sólo en sitio remoto, confirmación UI de éxito. Reconciliación del MISMO paquete/IDs, sin recrear recursos, terminó SUCCEEDED; repetición mismo recibo/IDs. Conservado estado/error previo para auditoría. Fuente y paquete en outputs/m9-envio-remoto-2026-10-06, reproducción no reenvía automáticamente tras dispatch.

Alcance probado: un producto simple, una portada y textos, sin categorías/galería/variaciones/stock. NO es recorrido nuevo desde UI Mi Tienda → Woo remoto ni integración de cola remota ni sincronización inversa. App publicada0.69.1 aún dice laboratorio local y read_web_draft no acepta URLs del host remoto. No afirmar fotos bidireccionales o catálogo completo migrado. Pendientes: integrar outbox/recibo remoto con creación Mi Tienda (también SICAR_ONLY); admitir galerías, categorías y familias; retorno de fotos con baseline y conflicto, guardar vínculos por tienda, comprobar desde ambas interfaces. Producción intacta y cero importación de existencias.


### 2026-10-06 — Lectura remota de fotos y conciliación bidireccional

Requisito funcional explícito en [M9_SINCRONIZACION_CATALOGO_Y_FOTOS.md](M9_SINCRONIZACION_CATALOGO_Y_FOTOS.md): alta desde programa→Woo, fotos desde ambos lados y migración por identidad confirmada. Instalado conector remoto1.1.2: GET de galería por recibo propio SUCCEEDED, valida identidad y archivos originales, devuelve orden/alt/huellas; no catálogo general. Cabeceras privadas/no-store y exclusión LiteSpeed. Lectura real producto14/10521/imagen15 aprobada; secuencia misma URL anónimo401→autenticado200→anónimo401 con no-store. Sin fotos escritas en Mi Tienda.

Nuevo planificador puro de tres versiones con19 pruebas: propone dirección, preserva orden/portada, rechaza duplicados/galerías parciales/identidad distinta y detiene cambios simultáneos o eliminaciones. Revalidación de ambos lados antes de ejecutar; no resuelve aún escrituras concurrentes externas. 239 unitarias completas y32 comprobaciones PHP con stubs aprobadas; lint dirigido correcto. Primer fallo unitario fue fixture it.each mal anidado, corregido sin cambiar regla. Evidencia outputs/m9-fotos-bidireccionales-2026-10-06. Dry-run contra destino vacío SINTÉTICO, no lectura/escritura real de galería Mi Tienda. Cola remota, aplicación de fotos en ambos sentidos y alta desde UI siguen pendientes. App publicada0.69.1 sin cambio/despliegue; plugin de pruebas1.1.2. Sin producción/existencias; staging abierto.


### 2026-10-06 — Cola remota preparada y acceso Vercel recuperado

Versión local0.70.0 preparada: cola duradera y recibo visibles en ficha; alta simple elegible se encola al guardar, sólo en staging configurado. Primer alcance: producto nuevo sin vínculo Woo, una variante sin atributos, una foto, sin categorías y textos completos. No reenviar POST ante timeout: recuperar por recibo; conservar literalmente código/precio, no existencias. RPC de claim/huella/confirmación sólo service_role, validación de propietario y permisos actuales. Migración20261006142911 aplicada únicamente a zsezjtswqeijboezvado.16 pruebas SQL transaccionales con rollback aprobadas; siguen41 productos y0 trabajos reales.252 unitarias/39 archivos, TypeScript y compilación final aprobados.

Usuario completó autorización Vercel CLI. Configurados y verificados M9_REMOTE_WOO_ENABLED, M9_REMOTE_WOO_USERNAME y M9_REMOTE_WOO_PASSWORD como secretos exclusivamente Preview + rama codex/m9-staging-review. SUPABASE_SECRET_KEY ya existe en Preview. No valores secretos en repositorio/evidencias. La configuración se incorpora al próximo despliegue; todavía NO demuestra el recorrido interfaz→Woo. Pendientes publicación0.70.0, avatar y ensayo integral; después galerías bidireccionales, categorías/familias y fotos migradas. Producción intacta. No cerrar M9 ni afirmar100%.


### 2026-10-06 — Alta simple explícita (0.70.1)

0.70.0 publicado en Preview, avatar/panel remoto confirmados (commit5237d34). Ensayo UI detectó que la matriz exigía COLOR+TALLA y no podía producir el producto sin atributos requerido por el conector; formulario cancelado sin crear registros. Corrección0.70.1: opción explícita «Producto sin talla ni color» sólo al crear, un código nuevo generado por servidor y atributos vacíos; no elimina atributos de productos existentes ni acepta esta modalidad al agregar variantes. El servidor rechaza combinación de modo simple con matriz. Costos de SICAR permanecen intactos; un ensayo sintético podrá usar costo de prueba. Pendiente verificar alta real desde interfaz después del despliegue. No ampliar a familias ni declarar sincronización completa de fotos.


### 2026-10-06 — Recorrido UI→Woo remoto aprobado (0.70.1)

Commit8375be36 publicado Preview READY (vaquero-3cx1izyq9-procesa-lab.vercel.app); avatar0.70.1 comprobado. Desde formulario publicado se creó PRUEBA M9 conexión remota0610 (nombre real contiene espacio antes de0610), categoría interna Accesorios, sin atributos, costo SINTÉTICO1/público123.45, textos, una URL de foto ilustrativa y sin categorías web. Producto Mi Tienda e8cfb266-e17f-4482-9756-ac0c1e457b8d, barcode generado2000010001699, SKU1000169-1. Envío automático confirmado SUCCEEDED: trabajo1870ed16-203c-4cc6-8d2b-0228011fb116, Woo remoto18, imagen19, borrador no comprable. Recibo GET independiente validó código/precio/foto/textos; Actualizar estado de UI conservó ID18 y consulta SQL confirmó un solo trabajo. Sin importación de existencias ni escrituras en producción.

Evidencia outputs/m9-cola-remota-2026-10-06/ui-remote-receipt.json y alta-0701-recibida.png. Build, TypeScript y lint dirigido aprobados; CI294 en curso al registrar. Alcance aceptado: alta NUEVA simple desde UI con una imagen. Pendientes: familias/categorías/galerías, actualizaciones posteriores, fotos en ambos sentidos, importación completa y visualización de vínculo por tienda en panel de variante (todavía muestra Sin vínculo WooCommerce porque ese rótulo usa vínculo histórico de producción). No confundir recibo remoto18 con Woo local18 de ensayo anterior. No cerrar M9.


### 2026-10-06 — Recepción protegida de galería remota (0.71.0 preparada)

Acción explícita Traer fotos de Woo de pruebas para altas remotas SUCCEEDED propias. Verifica recibo, propietario/permiso vigente, identidad/código, galería completa, SHA de bytes, límite20 fotos/4MB por foto/16MB total, sin redirecciones ni hosts arbitrarios. Descarga sin credenciales de Woo en archivos; copia por hash a product-images con upsertfalse, valida copia previa al reintentar; relee revisión remota antes de guardar y save_web_draft exige revisión/huella local. Mantiene textos/precios y no escribe en Woo. Bloquea cambios locales respecto del alta inicial, salvo repetición exacta, y retirada de foto original; no baseline persistente incremental aún. Puede dejar archivos sin asociar ante conflicto, nunca borra archivos. No garantiza transacción distribuida con ediciones Woo posteriores a la relectura.

12 pruebas de conciliación/copia propuestas aprobadas junto a13 del procesador. Pendiente ensayo UI de copia, actualización de portada del catálogo, baseline incremental y salida de fotos Mi Tienda→Woo. Variantes/categorías siguen pendientes. No declarar conexión bidireccional ni migración completa.


### 2026-10-06 — Originales autenticados (0.71.1)

Ensayo0.71.0 bloqueó correctamente una discrepancia: URL pública Woo devuelve SHA f5f8c179… mientras original validado es a84834f6…. No se guardó la ficha. Conector1.1.3 instalado y confirmado UI: GET photos/{request}/{media} únicamente para imagen de galería propia verificada, entrega original en base64+SHA, máximo4MB y no-store. Lectura autenticada real coincide con original; anónimo401. No es ruta arbitraria a medios. Cliente valida bytes/huella; copia usa nombre hash hexadecimal admitido por RLS de Storage. No se relajan permisos.3 nuevas pruebas del cliente aprobadas,32 comprobaciones PHP y build correctos. Se cambió sólo alt de imagen19 de ensayo en Woo para probar entrada. Pendiente resultado de copia publicada. CI294 de0.70.1 completó success.


### 2026-10-06 — Copia Woo→ficha verificada en UI0.71.1

Commit a4eb5597032153477a610e1deb5dfbf98f77070a publicado READY (vaquero-fk535s8h7-procesa-lab.vercel.app), avatar0.71.1 confirmado. Botón Traer fotos copió original de imagen19 Woo18 a Storage de staging y guardó ficha e8cfb266-e17f-4482-9756-ac0c1e457b8d revisión2, conservando texto alternativo modificado en Woo. Repetición devolvió «Las fotos ya coinciden con Woo de pruebas»; SQL confirma revisión2,1 archivo, sin duplicados. image_path del producto sigueNULL: copia verificada en ficha web, todavía no portada del catálogo. Evidencia fotos-0711.png y original-photo-check.json en outputs/m9-cola-remota-2026-10-06.267 unitarias/40 archivos, build/TypeScript y lint aprobados; CI295success, CI296 en curso al registrar.

Pendientes concretos para cerrar integración antes de migración completa: 1) portada del catálogo con control de concurrencia, 2) baseline persistente y salida de fotos Mi Tienda→Woo con actualización condicionada/recuperación, 3) categorías y familias/variantes sin perder códigos, 4) aplicar galerías históricas por vínculos conciliados y últimas exportaciones. La copia actual sólo acepta primera adopción sobre galería inicial intacta o repetición exacta; una siguiente edición remota tras adopción requiere revisión, no se debe afirmar sincronización recurrente terminada. Producción y existencias intactas.


### 2026-10-06 — Portadas desde ficha guardada (0.71.2 preparada)

read_catalog_covers ahora prioriza primera foto de ficha guardada y conserva fallback histórico sólo con vínculo conciliado; excluye productos con image_path propio. Se reutiliza en Productos y Venta, con lotes de máximo200 y destinos de imagen restringidos. No escribe image_path ni sobrescribe cambios concurrentes de portada: lectura de fuente vigente. Una galería guardada vacía no recupera silenciosamente la portada histórica. Migración20261006154347 aplicada sólo staging después de pruebas con rollback: portada almacenada visible y prioridad de imagen explícita conservada. Pendiente confirmación visual de despliegue y contexto Venta (requiere caja de pruebas abierta). No abrir caja ni crear ventas para esa comprobación.


### 2026-10-06 — Portada publicada y cierre parcial comprobado

0.71.2 READY en vaquero-nz8oc395s-procesa-lab.vercel.app, commit a448d365808de47ae4698b99ce90379d06cc8bad. Catálogo filtrado PRUEBA M9 muestra foto de bolsa junto a producto/código2000010001699; avatar0.71.2 confirmado. Evidencia portadas: outputs/m9-cola-remota-2026-10-06/portada-0712.png. Lectura también conectada a Venta, sin abrir caja para comprobación visual. No se escribió image_path, no se importaron existencias, no producción. Pruebas SQL con rollback de portada guardada/prioridad de explícita y build/lint/TypeScript correctos; CI296 anterior completó success.

No cerrar integración completa: baseline persistente y escritura de fotos Mi Tienda→Woo, galerías recurrentes con recuperación, categorías/familias y migración completa siguen pendientes. Usuario pide cerrar TODA la parte; esto debe guiar la siguiente ejecución, no sustituirla por un cierre documental del piloto.


### 2026-10-06 — Historial persistente de recepción de fotos (0.71.3)

Checkpoint privado por trabajo remoto, sólo servicio con propietario y permisos vigentes comprobados. Guarda SHA/alt/orden y revisión Woo tras verificar bytes y coincidencia con revisión/galería local; serializa mediante bloqueo del trabajo y versión esperada. Repeticiones exactas no incrementan versión. El lector acepta nuevas ediciones remotas si Mi Tienda conserva la última galería común; bloquea cambios locales y retirada de cualquier imagen previa. Una interrupción entre guardado y checkpoint se recupera por igualdad verificada, sin duplicar archivos. No representa transacción distribuida con Woo. Migración20261006155407 aplicada sólo staging; pruebas SQL con rollback verificaron creación, repetición, rechazo de versión anterior/revisión local cambiada y denegación a anon/authenticated.15 pruebas unitarias del lector aprobadas, TypeScript correcto. Falta validación del Preview de esta versión.

Continúan pendientes salida recurrente de fotos Mi Tienda→Woo, familias/categorías remotas y migración de galerías históricas. No declarar cierre total ni100%.


### 2026-10-06 — Recepción recurrente comprobada en Preview0.71.3

Commit d09db1f33900a0bc6f7e9e28eae3bc3d3c1dfc74, Preview vaquero-rc8mw0yhe-procesa-lab.vercel.app READY; avatar0.71.3 confirmado. CI298 completó success,270 unitarias aprobadas, lint y build correctos. En Woo remoto se editó nuevamente el texto alternativo de imagen19 del producto18; UI recibió «Foto ilustrativa de bolsa — segunda actualización de prueba M9». Ficha revisión3 y checkpoint versión2; repetir Traer fotos devolvió coincidencia, conservó revisión3/versión2 y un único archivo Storage. Evidencia outputs/m9-cola-remota-2026-10-06/fotos-recurrentes-0713.png. No producción ni existencias.

Pendiente corregir texto de ayuda del panel remoto que todavía menciona exclusivamente fotos del alta inicial: ahora admite la última galería sincronizada. No cerrar toda la conexión: continúan pendientes envío de cambios Mi Tienda→Woo, familias/categorías y galerías de catálogo histórico.


### 2026-10-06 — Envío de galerías preparado (0.72.0)

Nuevo botón Enviar fotos a Woo de pruebas. Plan compara galería remota contra checkpoint común y verifica bytes/identidad; bloquea ediciones remotas divergentes, duplicados y retirada de imágenes. Cola privada app.web_remote_gallery_outbox reclama cada envío una vez, conserva revisión de ficha y consulta recibo tras resultados inciertos; no reintenta POST. Confirmación valida producto/código/tienda/galería y guarda checkpoint sólo si sigue vigente la ficha local. Migración20261006161256 aplicada sólo staging; prueba SQL con rollback de reclamación única, recibo incorrecto, confirmación y permisos aprobada.

Plugin1.2.0 incorpora endpoint limitado gallery-updates: verifica aislamiento, propiedad, revisión de galería y tablas InnoDB; prepara copias, bloquea filas de producto/medios, vuelve a comprobar revisión y cambia exclusivamente metadatos de portada/galería dentro de transacción. Texto alternativo modificado crea copia independiente para no alterar medios compartidos. Archivos preparados ante conflicto quedan sin asociar para revisión; no se borran.277 unitarias,34 comprobaciones PHP, lint, TypeScript y build aprobados. Pendiente comprobar actualización remota y recorrido UI; todavía no declarar sincronización completa ni migración. Familias/categorías y galerías históricas siguen pendientes.


### 2026-10-06 — Galería enviada desde Mi Tienda y copia histórica preparada

0.72.0 publicada (c767da35c04265b7dc37f6b766bd0bdf827dd11e), avatar confirmado, CI299success. Plugin1.2.0 instalado; aislamiento de correo/red/pagos/ventas comprobado. En ficha sintética e8cfb266-e17f-4482-9756-ac0c1e457b8d revisión4 se cambió alt de portada y añadió segunda foto ilustrativa. Envío7702ee4d-b771-4198-8fff-abed51ef9997 SUCCEEDED: Woo18 conserva barcode2000010001699 y recibe medios22/23. Repetir envío y traer galería devolvieron coincidencia sin duplicación. Evidencia gallery-outbound-0720.json y fotos-ambos-sentidos-0720.png.

0.73.0 prepara /productos/fotos-migracion con lector exclusivamente staging y products.update, limitado a fuentes web cuyo producto Woo coincide con app.m9_products.41 productos conciliados contienen186 referencias de fotos actuales. Acción secuencial copia bytes al almacenamiento por hash/producto, verifica archivos ya existentes, conserva orden/alt y guarda por revisión/huella. URLs ajenas a fuente conciliada/almacenamiento propio, duplicados de contenido y límites requieren revisión. No crea productos ni cambia stock/Woo. Migración20261006162434 aplicada staging;282 unitarias aprobadas después de corregir frontera cliente/servidor pasando la acción por propiedad desde la página. Build y lint correctos; pendiente ejecutar lote publicado. Familias/categorías remotas siguen pendientes.
