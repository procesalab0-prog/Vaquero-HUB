# VAQUERO HUB — Contexto Maestro del Proyecto

> Documento vivo. Última actualización: 2026-08-31 (sección 51 con
> requerimientos adicionales del cliente, y sección 52 con la
> confirmación de secuencia: primero se construye todo el sistema, la
> migración SICAR y la conexión WooCommerce se hacen al final).
> Mantenido para guiar el trabajo conjunto de Claude Code + OpenAI Codex +
> supervisión humana (ProcesaLab).

## 1. Descripción general

- **Proyecto:** Vaquero Hub
- **Cliente:** Vaqueros SM
- **Desarrollador:** ProcesaLab
- **Ubicación actual del negocio:** La Piedad, Michoacán, México.

Vaquero Hub será un sistema propio de gestión para Vaqueros SM que sustituirá
progresivamente las funciones de SICAR que actualmente utiliza el negocio.

No se busca copiar absolutamente todas las funciones existentes de SICAR. Se
busca reemplazar correctamente las funciones que Vaqueros SM realmente
utiliza, documentarlas y posteriormente mejorarlas.

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

El sistema debe construirse pensando en crecimiento y operación real de
retail.

## 2. Situación actual

Vaqueros SM vende: botas, botines, zapatos, tenis, pantalones, camisas,
chamarras, trajes, bolsas, vestidos, texanas, sombreros, gorras, cinturones,
artículos para caballo, carteras y otros productos relacionados.

Actualmente utilizan:

- **SICAR** para POS, inventario, códigos y operación física.
- **WooCommerce** para la tienda online.

La tienda WooCommerce ya contiene productos relacionados con SICAR.

**Dato MUY IMPORTANTE:** los productos de WooCommerce utilizan los mismos
códigos que SICAR. Esto deberá aprovecharse como pieza central de la
migración.

## 3. Problema principal

SICAR funciona actualmente, pero Vaqueros SM tiene problemas principalmente
con la captura y administración de mercancía.

Ejemplo: una bota puede existir en talla 25, 25.5, 26, 26.5, 27, 27.5, 28,
etc. Actualmente la captura puede resultar lenta y repetitiva.

Vaquero Hub deberá permitir crear:

- **PRODUCTO PADRE** — ejemplo: *Bota Cuadra Modelo X*
- **VARIANTES** — ejemplo: Negro/25, Negro/25.5, Negro/26, Negro/26.5, etc.

Cada variante puede tener: código de barras, SKU/código, existencia, costo,
precio, ubicación, información WooCommerce.

El objetivo es reducir drásticamente la captura repetitiva.

## 4. Volumen actual

Existe un Excel exportable desde SICAR. Un archivo observado anteriormente
contenía aproximadamente **15,000 filas**.

No asumir que 15,000 filas equivalen a 15,000 productos únicos. Muchas
pueden representar variantes de un mismo producto.

Antes de migrar deberá realizarse: limpieza, normalización, detección de
duplicados, agrupación de variantes, validación de códigos, detección de
códigos vacíos, espacios accidentales, ceros iniciales, inconsistencias.

## 5. Regla crítica sobre códigos

**NO cambiar códigos existentes.** Los códigos utilizados actualmente por
SICAR deberán conservarse.

Además, WooCommerce y SICAR utilizan los mismos códigos. Por lo tanto:

```
Código SICAR ↕ Código Vaquero Hub ↕ Código WooCommerce
```

deben representar la misma variante. **Nunca realizar matching de productos
únicamente por nombre.** Debe existir una relación explícita, por ejemplo:

- `internal_variant_id`
- `legacy_barcode`
- `legacy_sicar_code`
- `woocommerce_product_id`
- `woocommerce_variation_id`
- `woocommerce_sku` / código

El código heredado será fundamental para realizar el matching inicial.

## 6. Migración SICAR

La migración **NO** deberá hacerse apagando SICAR inmediatamente. Proceso
esperado:

```
SICAR + WooCommerce actuales
  → Exportación SICAR
  → Auditoría y limpieza
  → Importación Vaquero Hub
  → Matching WooCommerce
  → Validación
  → Operación paralela
  → Reconciliación
  → Migración definitiva
  → Retiro progresivo de SICAR
```

Durante las pruebas SICAR continuará funcionando.

## 7. Prueba paralela

Antes de sustituir SICAR, Vaquero Hub deberá probarse en una tienda real.
Durante la prueba, una venta real puede registrarse tanto en SICAR como en
Vaquero Hub únicamente con fines de comparación. **NO significa cobrar dos
veces.**

Al final del turno se deberán comparar: ventas, productos, cantidades,
inventario, efectivo, tarjetas, transferencias, devoluciones, cancelaciones,
cortes.

El objetivo es demostrar que ambos sistemas producen resultados
equivalentes.

## 8. WooCommerce

WooCommerce deberá integrarse directamente con Vaquero Hub. La página actual
puede continuar funcionando. Vaquero Hub deberá comunicarse con WooCommerce
mediante API y webhooks.

El objetivo final es que Vaquero Hub sea la fuente principal de verdad para
inventario y operación. WooCommerce será un canal de venta.

```
TIENDA FÍSICA → VAQUERO HUB → INVENTARIO CENTRAL ↔ WOOCOMMERCE
```

## 9. Alta automática en WooCommerce

Cuando se cree un producto nuevo en Vaquero Hub deberá existir una opción
como: `[✓] Publicar también en tienda online`.

> Mientras la integración WooCommerce no esté construida (Fase 6, ver
> sección 52), este control debe permanecer oculto o deshabilitado en la
> UI — no dejar una función a medias (un checkbox que no hace nada
> confunde más de lo que ayuda).

El sistema podrá: crear producto en Vaquero Hub → crear variantes → generar/
asignar códigos → crear inventario → crear producto en WooCommerce → crear
variaciones → asignar SKU/código → asignar precios → asignar stock →
guardar IDs devueltos por WooCommerce.

Inicialmente es preferible permitir **crear como borrador en WooCommerce**
en lugar de publicar automáticamente, para poder revisar fotografías,
descripción, SEO, presentación y contenido comercial antes de publicar.
Posteriormente se puede permitir publicación automática.

## 10. Sincronización de inventario

Una venta en cualquier canal debe terminar reflejándose en el inventario
central.

```
Stock: Bota X talla 27 = 3
Se vende una en POS → Vaquero Hub: 3 → 2 → WooCommerce: 3 → 2

Venta online:
WooCommerce → Webhook → Vaquero Hub → Movimiento de inventario → Stock actualizado
```

Los eventos externos deberán ser **IDEMPOTENTES**. Un webhook repetido NO
puede descontar inventario dos veces.

## 11. Inventario

**NO** implementar inventario simplemente como `stock = stock - 1`. Toda
modificación deberá generar un movimiento auditable, por ejemplo en
`inventory_movements`:

```
id, variant_id, location_id, movement_type, quantity,
previous_stock, new_stock, reference_type, reference_id,
user_id, timestamp, metadata
```

Tipos posibles: `INITIAL_IMPORT`, `SALE`, `RETURN`, `PURCHASE`,
`TRANSFER_OUT`, `TRANSFER_IN`, `ADJUSTMENT`, `CANCELLATION`.

Nunca borrar movimientos históricos para corregir inventario. Utilizar
movimientos compensatorios/reversiones.

## 12. Inventario por ubicación

El inventario deberá diseñarse por ubicación desde V1. Actualmente existe
una sucursal; sin embargo se espera una segunda sucursal en los próximos
meses y una tercera aproximadamente dentro de un año.

Por lo tanto **NO** utilizar simplemente `products.stock`. Diseñar:
`locations`, `inventory_by_location`, `inventory_movements`.

Esto permitirá posteriormente: Sucursal 1, Sucursal 2, Sucursal 3, Bodega,
En tránsito.

## 13. Transferencias entre sucursales

Preparar arquitectura para transferencias. Estados posibles: `REQUESTED`,
`APPROVED`, `PREPARED`, `IN_TRANSIT`, `RECEIVED`, `CANCELLED`.

Una mercancía en tránsito **NO** deberá aparecer simultáneamente como
disponible en origen y destino.

> Ver también sección 51.1 (Traspasos de sucursales) — requerimiento
> confirmado directamente por el cliente.

## 14. Punto de venta

Vaquero Hub deberá incluir POS. Funciones esperadas: escaneo de código,
búsqueda manual, carrito, cantidades, descuentos autorizados, promociones
futuras, efectivo, tarjeta, transferencia, pagos externos, impresión de
ticket, devolución, cancelación, apartados, apertura de caja, cierre de
caja, cortes, movimientos de caja.

> Ver también sección 51.5 (Descuentos en cantidad o porcentaje), 51.7
> (Cotizaciones), 51.8 (Enviar tickets por teléfono/correo), 51.9 (Ticket de
> regalo), 51.10 (Métodos de pago mixtos con desglose por venta), 51.14
> (Cambios).

## 15. iPad como POS

El cliente puede operar principalmente desde iPads. Por ello Vaquero Hub
deberá diseñarse touch-first y funcionar correctamente en Safari/iPadOS.
Preferentemente como Web App / PWA instalable en pantalla de inicio.

```
VAQUERO HUB → Login empleado → Abrir caja → POS
```

No diseñar una interfaz desktop y simplemente hacerla responsive. Diseñar
específicamente para interacción táctil, considerando: botones grandes,
carrito visible, búsqueda rápida, teclado numérico, pocos pasos para
cobrar, buena operación horizontal y vertical, estados claros, prevención
de doble toque/doble cobro.

## 16. Hardware POS

Hardware potencial: iPad, soporte para iPad, lector de códigos Bluetooth,
impresora térmica compatible, cajón de dinero, impresora de etiquetas,
conexión estable, respaldo 4G/5G, UPS/no-break cuando aplique.

Para checkout se prefiere lector físico sobre cámara. La cámara del iPad
puede utilizarse para inventario, consulta, recepción, conteos.

El lector Bluetooth deberá poder enviar códigos al sistema como entrada
tipo teclado cuando el hardware lo permita.

## 17. Compatibilidad con códigos actuales

Durante el piloto, el **mismo código físico** debe poder funcionar tanto en
SICAR como en Vaquero Hub. **NO** imprimir doble código para mantener ambos
sistemas.

## 18. Productos nuevos

Para productos nuevos Vaquero Hub podrá: generar código, generar SKU, crear
variantes, generar etiquetas, imprimir etiquetas, registrar inventario,
opcionalmente crear producto WooCommerce.

Diseñar una experiencia especialmente rápida para mercancía con tallas.
Ejemplo: crear producto *Bota X*, seleccionar ☑ 25 ☑ 25.5 ☑ 26 ☑ 26.5 ☑ 27
☑ 27.5 ☑ 28 y generar variantes automáticamente.

> Ver también sección 51.18 (Carga masiva de productos, selección múltiple)
> y 51.19 (Impresión de códigos de barra personalizados y masivos).

## 19. Compras y proveedores

Vaquero Hub deberá contemplar: `SUPPLIERS`, `PURCHASES`, `PURCHASE_ITEMS`,
`RECEIVING`.

```
Crear compra → Proveedor → Productos/cantidades → Recibir mercancía
  → Detectar diferencias → Crear movimientos de inventario
  → Generar/imprimir etiquetas
```

No incrementar stock hasta registrar correctamente la recepción.

## 20. Apartados

Vaqueros SM utiliza funciones que deberán documentarse antes de
implementar. Si utilizan apartados, contemplar: `layaways`,
`layaway_items`, `payments`, `balance_remaining`, `status`.

Estados conceptuales: `OPEN`, `PARTIALLY_PAID`, `PAID`, `CANCELLED`,
`EXPIRED`.

No asumir reglas de negocio. Documentarlas con el cliente.

> Ver también sección 51.16 (Clientes: crédito y apartados).

## 21. Devoluciones y cancelaciones

Toda devolución/cancelación deberá: conservar venta original, generar
referencia, generar movimiento inverso cuando corresponda, conservar
usuario, conservar fecha, conservar motivo, mantener auditoría.

Nunca eliminar una venta histórica para simular una cancelación.

> Ver también sección 51.14 (Cambios) — flujo distinto de una devolución
> simple: implica salida de una variante y entrada de otra en la misma
> transacción.

## 22. Caja

Diseñar: `cash_registers`, `cash_sessions`, `cash_movements`, `sales`,
`payments`.

Una sesión de caja deberá tener: `opening_amount`, `expected_amount`,
`actual_amount`, `difference`, `opened_by`, `closed_by`, `opened_at`,
`closed_at`.

## 23. Usuarios y permisos

No todos los empleados deberán poder hacer todo. Roles iniciales posibles:
`ADMIN`, `MANAGER`, `CASHIER`, `WAREHOUSE`.

Permisos específicos deberán poder controlar: descuentos, cancelaciones,
devoluciones, ajustes de inventario, cambios de precio, reportes, compras,
transferencias, usuarios.

Implementar correctamente RLS en Supabase. **NO** desactivar RLS para
resolver problemas de desarrollo.

> Este es uno de los dos módulos que el cliente priorizó pagar primero
> (junto con clientes/administración) — ver nota en la sección 51.

## 24. Auditoría

Acciones sensibles deberán registrarse, por ejemplo: cambio de precio,
ajuste de inventario, devolución, cancelación, descuento, cambio de
permisos, cierre de caja, transferencia, recepción.

Guardar: usuario, acción, entidad, ID entidad, valor anterior, valor
nuevo, fecha, metadata.

> Ver también sección 51.6 (Modificaciones de precios o artículos) — debe
> quedar registrada en esta bitácora de auditoría.

## 25. Arquitectura tecnológica preferida

- **Frontend:** Next.js / React
- **Hosting:** Vercel
- **Backend / DB:** Supabase
- **Database:** PostgreSQL
- **Auth:** Supabase Auth
- **Storage:** Supabase Storage cuando sea necesario
- **Repositorio:** GitHub
- **Integraciones:** WooCommerce REST API + Webhooks
- **Desarrollo:** Claude Code + OpenAI Codex + supervisión humana.

## 26. Supabase

Para producción utilizar como mínimo Supabase Pro. Actualmente el proyecto
es pequeño en relación con la capacidad esperada: aproximadamente 15k
registros/filas de inventario provenientes de SICAR, una sucursal
inicialmente, pocos empleados, WooCommerce, crecimiento futuro.

No existe un límite conceptual de "número de sucursales". Diseñar
correctamente y escalar compute posteriormente si aumenta la concurrencia.

**IMPORTANTE:** clientes almacenados en una tabla CRM **NO** son
necesariamente usuarios Auth. Sólo cuentan como usuarios Auth si realmente
inician sesión mediante Supabase Auth.

> **Decisión pendiente antes de aprovisionar (ver sección 52):** confirmar
> plan de Supabase (mínimo Pro para producción) y si se usará un proyecto
> Supabase separado por entorno o branching de un solo proyecto — para no
> tener que migrar de plan/proyecto después de haber cargado datos reales.

## 27. Entornos

**OBLIGATORIO** separar: `DEVELOPMENT`, `STAGING`, `PRODUCTION`.

Los agentes de IA **NO** deberán modificar directamente producción. Cambios
de esquema: siempre mediante migrations.

Como todavía no hay datos reales de SICAR (la migración se hace al final,
ver sección 52), el entorno de `DEVELOPMENT`/`STAGING` se poblará con
productos y ventas de prueba creados manualmente, no con el Excel real.
Esto simplifica el desarrollo inicial, pero obliga a limpiar/aislar esos
datos de prueba antes de correr la migración real (ver sección 52).

## 28. Seguridad

Nunca: `service_role` en frontend, WooCommerce secret en frontend, secretos
en Git, claves en código, acceso público accidental a tablas, desactivar
RLS para "hacer que funcione".

Utilizar variables de entorno. Validar permisos también del lado servidor.

## 29. Concurrencia

Especial cuidado en: última pieza disponible, dos cajas vendiendo mismo
producto, WooCommerce + POS vendiendo simultáneamente, devoluciones,
transferencias, recepción, ajustes, apartados.

Operaciones críticas deberán ser transaccionales/atómicas.

Ejemplo crítico: stock = 1. Caja A intenta vender. Caja B intenta vender al
mismo tiempo. Sólo una operación puede consumir correctamente esa última
unidad si no se permite inventario negativo.

## 30. WooCommerce Webhooks

Todos los webhooks deberán: 1) verificar autenticidad, 2) registrar evento,
3) detectar duplicado, 4) procesar, 5) marcar resultado, 6) permitir
reintentos seguros.

Guardar identificadores externos cuando existan. Nunca asumir que un
webhook llegará exactamente una vez.

## 31. Modo contingencia / offline

Vaqueros SM opera 7 días por semana. El POS no debería quedar completamente
inutilizable ante una caída breve de internet.

No implementar offline complejo sin diseñarlo correctamente. Primero
diseñar estrategia.

Posible arquitectura futura:

```
PWA → cola local → operaciones pendientes → reconexión → sincronización
```

Especial cuidado con: IDs, ventas duplicadas, inventario, pagos,
timestamps, conflictos. No implementar offline improvisado.

## 32. WooCommerce como canal, no como base central

Objetivo futuro: Vaquero Hub = fuente principal operacional; WooCommerce =
canal online.

No permitir que múltiples sistemas modifiquen inventario sin reglas claras.
Definir ownership de cada campo. Ejemplo:

- **Vaquero Hub:** stock, códigos, variantes, precio operativo cuando se
  acuerde.
- **WooCommerce:** contenido comercial, SEO, fotografías/descripciones si
  así lo decide el negocio.

Esto deberá documentarse.

## 33. CFDI

Si Vaqueros SM requiere facturación: **NO** construir infraestructura
fiscal propia. Integrar un PAC/API autorizado. El proveedor exacto se
definirá posteriormente. Mantener CFDI desacoplado del núcleo del POS. Una
falla temporal del proveedor fiscal no debería corromper una venta ya
realizada.

## 34. Pagos

No construir procesamiento de tarjetas desde cero. Utilizar
proveedor/terminal externo.

Vaquero Hub deberá registrar: método, referencia, monto, estado; y
posteriormente permitir conciliación si existe integración.

> Ver también sección 51.10 (Métodos de pago mixtos con desglose por
> venta) — implica que una venta puede tener **múltiples líneas de pago**,
> no un único método.

## 35. Clientes y lealtad

Puede agregarse posteriormente. Posible módulo: `customers`,
`loyalty_accounts`, `loyalty_transactions`.

Funciones futuras: QR, puntos, historial, recompensas, promociones,
niveles, expiración, Wallet, WooCommerce.

**NO** forma necesariamente parte del núcleo V1.

> **Actualización 2026-08-31:** el cliente confirmó que sí quiere este
> módulo activo desde etapas tempranas (junto con roles/administración, es
> de lo primero que se va a pagar/aprovisionar en la base de datos). Ver
> sección 51.11 (Tarjeta de lealtad escaneable), 51.12 (Descuentos por
> cumpleaños) y 51.16 (Clientes: crédito y apartados). Esto reclasifica
> parte de este módulo hacia V1 — pendiente de confirmar alcance exacto
> con el cliente (ver sección 51, notas finales).

## 36. Estrategia de desarrollo

No intentar construir todo simultáneamente. Orden recomendado:

1. **Fase 1** — Arquitectura, auth, DB, sucursales, usuarios/roles.
2. **Fase 2** — Productos, variantes, códigos: alta manual y carga masiva
   **propia** de Vaquero Hub (sección 51.18). **Sin tocar todavía** el
   Excel real exportado de SICAR.
3. **Fase 3** — Inventario y movimientos, transferencias entre sucursales.
4. **Fase 4** — POS, ventas, caja, cambios y devoluciones.
5. **Fase 5** — Apartados, compras/proveedores, reportes, cotizaciones,
   crédito a clientes, lealtad y el resto de la sección 51 cuyas reglas de
   negocio ya estén confirmadas con el cliente.
6. **Fase 6** — Migración completa de datos reales de SICAR (corte con
   tienda cerrada).
7. **Fase 7** — WooCommerce (emparejamiento por código, alta automática de
   productos, sincronización de inventario, webhooks).
8. **Fase 8** — Pruebas.
9. **Fase 9** — Piloto paralelo.
10. **Fase 10** — Migración operacional.

> **Confirmado con el cliente (2026-08-31):** una vez lista la base de
> datos, se construyen las Fases 1 a 5 completas — es decir, todo el
> sistema **excepto** WooCommerce y la migración de SICAR — y se valida
> que funcionen bien antes de iniciar las Fases 6 y 7.

> **Corrección de orden (2026-08-31):** las Fases 6 y 7 se invirtieron
> respecto a la versión original de este documento. WooCommerce no puede
> encenderse antes del corte de SICAR: hasta que el catálogo y las
> existencias reales no estén cargados, Vaquero Hub no tiene inventario
> válido que publicar y enviaría stock incorrecto a la tienda en línea.
> El emparejamiento por código sí puede prepararse antes, pero en modo
> sólo lectura. Ver sección 52 y `PLAN_CODEX.md` sección 7.

## 37. Cronograma conceptual

Objetivo aproximado: 8–12 semanas para llegar a un piloto sólido. No
prometer apagado completo de SICAR exactamente en 12 semanas.

Prioridad: **CORRECTITUD > VELOCIDAD**.

## 38. Estrategia Claude + Codex

**Actualizado 2026-08-31 — los roles se invirtieron respecto a la versión
original de este documento:**

Codex será principalmente: **IMPLEMENTADOR**.
Claude Code será principalmente: **ARQUITECTO / REVISOR**.

```
Claude define esquema y criterios → Codex implementa (PR)
  → Claude revisa (concurrencia, RLS, dinero, idempotencia, historial)
  → tests → correcciones → revisión humana → merge
```

No permitir que ambos agentes modifiquen simultáneamente las mismas partes
sin coordinación. El plan de ejecución detallado para Codex (milestones,
decisiones técnicas cerradas, criterios de aceptación y reglas
innegociables) vive en [`PLAN_CODEX.md`](PLAN_CODEX.md).

Lo que Claude revisa en cada PR sigue siendo la lista de la sección 40:
race conditions, inconsistencias de inventario, duplicados, errores
monetarios, RLS, WooCommerce, pérdida de historial, migración,
concurrencia, offline, caja y permisos.

## 39. Instrucciones para Claude Code

Antes de implementar:

1. Leer este documento completo.
2. Proponer arquitectura.
3. Proponer modelo de datos.
4. Identificar riesgos.
5. Proponer milestones.
6. Identificar dudas de negocio.
7. Identificar funciones que NO deberían estar en V1.

No comenzar construyendo toda la aplicación. Trabajar mediante cambios
pequeños y revisables. Cada cambio importante deberá incluir: qué se
modificó, por qué, riesgos, tests, migraciones, impacto.

## 40. Instrucciones para Codex

Actuar como revisor independiente. No asumir que la implementación de
Claude es correcta. Buscar específicamente: race conditions,
inconsistencias de inventario, duplicados, errores monetarios, problemas
de RLS, problemas WooCommerce, pérdida de historial, problemas de
migración, problemas de concurrencia, problemas offline, errores de caja,
permisos incorrectos.

Para cada módulo crítico preguntar: *"¿Cómo podría romperse esto en una
tienda real?"*

## 41. Reglas obligatorias para ambos agentes

1. Nunca modificar/regenerar códigos heredados de SICAR.
2. Nunca modificar inventario sin movimiento auditable.
3. Operaciones financieras e inventario deben ser atómicas.
4. Eventos WooCommerce deben ser idempotentes.
5. Nunca modificar producción directamente.
6. Schema mediante migrations.
7. Nunca borrar historial para corregir contabilidad/inventario.
8. Código crítico requiere tests.
9. Nunca debilitar RLS para resolver un bug.
10. Nunca exponer service_role al cliente.
11. Separar dev/staging/prod.
12. Explicar cambios arquitectónicos.
13. No agregar dependencias innecesarias.
14. No sincronizar productos por nombre.
15. No asumir reglas de negocio no confirmadas.

## 42. Casos mínimos que deben probarse

**Inventario:** stock normal, stock = 1, stock = 0, venta concurrente,
devolución, cancelación, ajuste, compra, transferencia, producto sin
código, código duplicado.

**POS:** efectivo, tarjeta, transferencia, pago mixto si se habilita,
descuento autorizado, devolución, cancelación, ticket, doble toque en
botón cobrar.

**WooCommerce:** venta online, webhook duplicado, webhook atrasado,
webhook inválido, producto inexistente, variación inexistente, stock
simultáneo POS/Web, error API, timeout, reintento.

**Migración:** código duplicado, código vacío, ceros iniciales, producto
sólo SICAR, producto sólo WooCommerce, producto en ambos, diferente stock,
diferente precio, diferentes nombres pero mismo código.

> Ver también sección 51 (nota final) para casos de prueba adicionales
> derivados de los nuevos requerimientos (cambios, pagos mixtos con
> desglose, cotizaciones, envío de tickets, etc.).

## 43. Observabilidad

Producción deberá tener: logs, errores, auditoría, backups, monitoreo
básico, capacidad de rastrear una operación.

Ante una diferencia de inventario deberá poder responderse: ¿Quién? ¿Qué
hizo? ¿Cuándo? ¿Desde dónde? ¿Qué documento/venta lo originó? ¿Cuánto
había antes? ¿Cuánto quedó después?

## 44. Experiencia del usuario

Vaquero Hub debe ser más fácil de usar que SICAR para los procesos
cotidianos. Especial prioridad: alta de mercancía, variantes, códigos,
venta, consulta de stock, recepción, etiquetas.

No sacrificar simplicidad por agregar funciones.

## 45. Identidad del sistema

**Nombre:** VAQUERO HUB — sistema interno desarrollado para Vaqueros SM.

Puede utilizarse visualmente: *VAQUERO HUB — Powered by ProcesaLab*.

Posibles módulos: Vaquero Hub POS, Vaquero Hub Inventario, Vaquero Hub Web,
Vaquero Hub Clientes, Vaquero Hub Compras, Vaquero Hub Sucursales, Vaquero
Hub Analytics, Vaquero Hub Admin.

## 46. Modelo comercial

Propuesta actual de ProcesaLab: **Desarrollo inicial: $120,000 MXN**.

Forma conceptual de pagos:

1. $30,000 — inicio, análisis y arquitectura.
2. $30,000 — catálogo, inventario, variantes y códigos.
3. $25,000 — POS funcional.
4. $20,000 — integraciones y preparación para piloto.
5. $15,000 — implementación/piloto.

**Total:** $120,000 MXN

**Mensualidad posterior:** $2,400 MXN / mes. Comienza cuando el sistema
entra formalmente en operación. Puede incluir: licencia, mantenimiento,
corrección de errores, monitoreo básico, soporte, actualizaciones
necesarias, ajustes menores. **NO** incluye desarrollo ilimitado de
módulos nuevos.

## 47. Infraestructura

Servicios externos deberán mantenerse separados del precio de
desarrollo/mantenimiento cuando corresponda. Ejemplos: Supabase, Vercel,
PAC/CFDI, APIs externas, mensajería, correo, dominio/subdominio.

Idealmente las cuentas productivas deberán ser propiedad del cliente y
ProcesaLab tendrá acceso administrativo/técnico.

## 48. Sucursales adicionales

La arquitectura deberá soportarlas desde el principio. Comercialmente se ha
considerado como referencia:

- Implementación adicional por sucursal: $10,000–$15,000 MXN
- Mensualidad adicional: $500–$800 MXN

Estos precios aún pueden ajustarse comercialmente.

## 49. Principio central del proyecto

Vaquero Hub **NO** debe ser simplemente "otro SICAR". Debe conservar las
funciones que Vaqueros SM necesita actualmente, pero resolver mejor sus
principales problemas y crear una plataforma que pueda crecer.

```
SICAR actual + WooCommerce + procesos manuales → VAQUERO HUB
```

Una sola plataforma operacional para: TIENDA, INVENTARIO, WEB, SUCURSALES,
CLIENTES, DATOS.

## 50. Primera tarea para los agentes

**NO** escribir inmediatamente toda la aplicación. Primero entregar:

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

**Objetivo:** construir un sistema retail confiable, auditable y escalable
que pueda operar diariamente en Vaqueros SM, sustituir progresivamente
SICAR y centralizar la operación física y digital sin poner en riesgo la
continuidad del negocio.

---

## 51. Requerimientos adicionales del cliente (agregado 2026-08-31)

El cliente entregó una lista adicional de funciones que espera ver en
Vaquero Hub. Se integran aquí, mapeadas contra la estructura anterior, con
notas de implicación en el modelo de datos. Ninguna de estas reglas de
negocio está confirmada a detalle todavía — quedan pendientes de validar
con el cliente antes de implementar (ver notas finales de esta sección).

Contexto de esta entrega: el cliente indicó que **está por pagar/aprovisionar
la base de datos** específicamente para dejar listos (a) roles y permisos
(sección 23) y (b) la parte de clientes y administración. Eso sugiere que
`locations`, `users`/`roles` (RLS), y `customers` deberían quedar entre las
primeras tablas del esquema real, junto con lo ya previsto en Fase 1 del
plan de desarrollo (sección 36).

### 51.1 Traspasos de sucursales

Ya cubierto conceptualmente en la sección 13 (Transferencias entre
sucursales). Se confirma como requerimiento explícito del cliente, no sólo
preparación arquitectónica a futuro — debe entrar en alcance de
implementación real, no solo de diseño.

### 51.2 Reportes de ventas

Nuevo módulo de reportes. Requiere pensar en vistas/consultas sobre
`sales`, `payments`, `sale_items` por rango de fecha, sucursal, cajero,
categoría, producto. Definir con el cliente qué reportes usa hoy en SICAR
para no perder ninguno relevante (ver sección 3: documentar antes de
reemplazar).

### 51.3 Reportes de inventario

Reportes sobre `inventory_by_location` e `inventory_movements`: existencias
actuales, quiebres de stock, productos sin movimiento, valorización de
inventario (costo vs. precio), diferencias detectadas en recepciones/
conteos.

### 51.4 Reportes de descuentos

Reportes sobre descuentos aplicados (ver 51.5): por cajero, por producto,
por sucursal, por periodo — para control interno y detección de abuso de
autorización de descuentos.

### 51.5 Descuentos en cantidad o porcentaje

El descuento autorizado (ya mencionado en la sección 14) debe soportar dos
modalidades: **monto fijo** o **porcentaje**, a nivel de línea de venta o
de ticket completo. Debe quedar registrado quién autorizó (sección 24,
auditoría) y alimentar el reporte de 51.4.

### 51.6 Modificaciones de precios o artículos

Edición de precio/datos de artículo desde el sistema, con permiso
controlado por rol (sección 23) y registro obligatorio en auditoría
(sección 24): valor anterior, valor nuevo, usuario, fecha. Debe respetar
la regla de la sección 5 — nunca se modifica el código heredado, sólo
atributos como precio, descripción, etc.

### 51.7 Cotizaciones

**Módulo nuevo**, no mencionado en el documento original. Una cotización es
un documento no fiscal/no definitivo (no mueve inventario ni caja) que
lista productos y precios para un cliente, con vigencia, y que
posteriormente puede convertirse en una venta real. Requiere tabla propia
(`quotes`, `quote_items`) con estado (`DRAFT`, `SENT`, `CONVERTED`,
`EXPIRED`) y relación opcional a `customers`.

### 51.8 Enviar tickets a teléfonos o correos

Envío de comprobante digital de venta (ticket) por SMS/WhatsApp y/o correo
electrónico. Implica: capturar teléfono/correo del cliente en el momento
de la venta (opcional, no bloqueante), generar el ticket en un formato
enviable (PDF/imagen o enlace), e integrar un proveedor externo de envío
(no construir infraestructura de mensajería propia — mismo principio que
CFDI en la sección 33: desacoplar del núcleo del POS, para que una falla
del proveedor de envío no bloquee ni corrompa una venta).

### 51.9 Ticket de regalo

Variante de impresión de ticket que oculta precios (útil para regalos).
Es una vista/formato alternativo del mismo comprobante de venta, no una
entidad de datos distinta.

### 51.10 Métodos de pago mixtos con desglose por venta

Requerimiento explícito y crítico: una venta debe poder pagarse con
**múltiples métodos simultáneos** (ejemplo: 30% efectivo + 70% tarjeta).
Esto confirma que `payments` debe modelarse como **una o más líneas de
pago por venta** (relación 1:N entre `sales` y `payments`), cada una con su
propio método, monto y referencia — no un campo único de "método de pago"
en la venta. Ya estaba previsto como caso de prueba en la sección 42
("pago mixto si se habilita"); ahora se confirma como funcionalidad
requerida desde V1, no opcional.

### 51.11 Escanear y tener la tarjeta de lealtad

Relacionado con la sección 35 (Clientes y lealtad). Implica que cada
cliente tenga un identificador escaneable (código de barras o QR, físico
o digital) ligado a su `customer_id`/`loyalty_account`, para identificarlo
rápidamente en el POS sin captura manual.

### 51.12 Ofrecer descuentos a cumpleañeros

Requiere capturar fecha de nacimiento en `customers` y una regla de
descuento (por definir con el cliente: automático vs. requiere
autorización, monto/porcentaje, vigencia dentro del mes o sólo el día).
Pendiente de confirmar regla de negocio exacta (ver sección 15 de las
reglas obligatorias: no asumir reglas de negocio no confirmadas).

### 51.13 Ventas

Ya es núcleo del sistema (sección 14). Sin cambios adicionales.

### 51.14 Cambios

Distinto de una devolución simple (sección 21): un cambio implica dar de
baja una variante (talla/color incorrecto, por ejemplo) y dar de alta otra
en la misma transacción, potencialmente con diferencia de precio a favor o
en contra del cliente. Debe generar los movimientos de inventario
correspondientes (salida + entrada) y quedar trazado como una operación
única, no como dos operaciones independientes sin relación entre sí.

### 51.15 Devoluciones

Ya cubierto en la sección 21. Sin cambios adicionales.

### 51.16 Clientes (crédito, apartados)

Dos funciones distintas bajo el mismo punto:

- **Apartados (layaways):** ya previsto conceptualmente en la sección 20.
- **Crédito a clientes:** requerimiento nuevo — implica una cuenta por
  cobrar por cliente (saldo, límite de crédito, historial de abonos),
  distinta de un apartado. Requiere su propio modelo conceptual (por
  ejemplo `customer_credit_accounts`, `credit_transactions`) y reglas de
  negocio a validar con el cliente (¿quién autoriza crédito?, ¿hay
  límite?, ¿interese o recargos?, ¿cómo se cobra el saldo?).

### 51.17 Conectar la página web

Reafirma la sección 8 (integración WooCommerce) como prioridad confirmada
por el cliente, no sólo visión a futuro.

### 51.18 Carga masiva de productos, selección múltiple

Extiende la sección 18 (alta rápida de variantes por talla): además de
generar variantes por selección de tallas al crear un producto, el cliente
pide poder **importar/cargar productos en lote** (por ejemplo desde Excel/
CSV) y poder **seleccionar varios productos/variantes a la vez** en el
listado para aplicar una acción en conjunto (cambio de precio, publicación
en WooCommerce, impresión de etiquetas, etc. — ver 51.19). Debe reutilizar
la misma lógica de importación/limpieza descrita en la sección 4 y 6 para
la migración de SICAR, ya que es esencialmente el mismo problema
(deduplicar, validar códigos, agrupar variantes) aplicado de forma
recurrente y no sólo en la migración inicial.

### 51.19 Impresión de códigos de barra personalizados y masivos

Extiende la sección 18/16 (generación e impresión de etiquetas):

- **Personalizados:** poder definir el formato/diseño de la etiqueta
  (qué datos incluye: nombre corto, precio, talla, código, logo).
  - **Masivos:** poder imprimir etiquetas para muchas variantes/productos a
  la vez (por ejemplo, todo el resultado de una recepción de compra, o
  toda una selección múltiple del catálogo — ver 51.18), no sólo una
  etiqueta a la vez.

### Notas finales de la sección 51

- Igual que en el documento original (sección 39, punto 6 y sección 41,
  regla 15): **no se asumen reglas de negocio no confirmadas.** Antes de
  implementar cotizaciones, crédito a clientes, descuentos por cumpleaños,
  y el desglose de pagos mixtos, se debe documentar con el cliente el
  detalle exacto de cada regla (ver preguntas abiertas más abajo).
- Esta lista **no reemplaza** la prioridad ya establecida en la sección 36
  (Fase 1 → Fase 10). Se integra dentro de esas fases, no como un carril
  paralelo. En particular:
  - Roles/permisos (23) y Clientes/administración → Fase 1 (ya en
    progreso según el cliente, quien está por pagar la base de datos para
    esta parte).
  - Traspasos (51.1), pagos mixtos (51.10), cambios (51.14) → Fase 3/4
    (inventario y POS).
  - Reportes (51.2–51.4), cotizaciones (51.7), envío de ticket (51.8),
    ticket de regalo (51.9), lealtad/cumpleaños (51.11–51.12), crédito
    (51.16) → Fase 5 en adelante, salvo que el cliente decida adelantar
    alguno.
  - Carga masiva (51.18) e impresión masiva de códigos (51.19) → Fase 2
    (se apoyan directamente en el trabajo de importación SICAR).
- **Preguntas abiertas para el cliente** (agregar a la sección 50, punto
  13 — información pendiente de solicitar):
  1. Cotizaciones: ¿tienen vigencia?, ¿requieren aprobación?, ¿pueden
     convertirse parcialmente en venta?
  2. Envío de tickets: ¿qué proveedor de SMS/WhatsApp/correo prefieren (si
     alguno ya usan)? ¿es obligatorio para todas las ventas o sólo cuando
     el cliente lo pide?
  3. Ticket de regalo: ¿oculta sólo precios unitarios o también
     descuentos/totales?
  4. Pagos mixtos: ¿cuántos métodos simultáneos como máximo permiten hoy en
     SICAR?
  5. Tarjeta de lealtad: ¿ya existe una tarjeta física con código/QR
     impreso hoy, o se crearía desde cero en Vaquero Hub?
  6. Descuento de cumpleaños: ¿automático o requiere autorización de
     cajero/gerente?, ¿monto o porcentaje fijo?, ¿vigencia?
  7. Crédito a clientes: ¿ya lo operan hoy en SICAR o es una función nueva
     que quieren estrenar en Vaquero Hub? ¿quién autoriza el límite de
     crédito?
  8. Cambios: ¿permiten cambio por producto de distinto precio? ¿cómo
     manejan la diferencia (efectivo, nota de crédito)?
  9. Carga masiva: ¿el formato de origen sigue siendo Excel/CSV exportado
     de SICAR, o necesitan una plantilla propia de Vaquero Hub?
  10. Etiquetas personalizadas: ¿qué impresora(s) de etiquetas usan hoy
      (marca/modelo), para validar compatibilidad?

> Igual que el resto del documento: **no implementar hasta revisar y
> aprobar el alcance de estas nuevas funciones**, en particular las que
> dependen de reglas de negocio aún no confirmadas.

---

## 52. Confirmación de secuencia de implementación (2026-08-31)

El cliente confirmó explícitamente: en cuanto esté lista la base de datos,
**no se inicia la migración de SICAR ni la conexión con WooCommerce.**
Esa parte se hace **hasta que el resto del sistema funcione bien.**

### 52.1 Qué significa esto en términos concretos

- Se construyen las **Fases 1 a 5** completas (sección 36): arquitectura/
  auth/roles/sucursales → productos/variantes/códigos con alta manual y
  carga masiva propia → inventario y movimientos/transferencias → POS,
  ventas, caja, cambios y devoluciones → apartados, compras, reportes,
  cotizaciones, crédito y lealtad.
- **Fase 6 (WooCommerce)** y **Fase 7 (migración real de SICAR)** quedan
  explícitamente en espera hasta que el cliente confirme que las Fases 1–5
  funcionan bien en el día a día.
- Esto **no contradice** la regla original de la sección 39/41 de no
  construir toda la aplicación de un solo golpe: "construir todo lo que no
  es SICAR/WooCommerce" se sigue haciendo por fases pequeñas y revisables,
  una fase a la vez, sólo que ahora sin pausas de negocio entre la Fase 1
  y la Fase 5 — la pausa se mueve a antes de la Fase 6/7.

### 52.2 Algo que no cuadraba y ya se corrigió

La sección 36 original mezclaba "importación SICAR" dentro de la Fase 2
(productos/variantes/códigos), lo cual contradecía esta nueva instrucción.
Se separó: la Fase 2 ahora es sólo alta manual y carga masiva **propia**
de productos (útil de forma permanente, no sólo para la migración — ver
sección 51.18); la carga del Excel real de SICAR sigue siendo la Fase 7,
tal como ya estaba previsto por separado en la sección 6.

Ambas funciones (carga masiva propia y migración SICAR) comparten
componentes técnicos (parseo, limpieza, detección de duplicados/códigos
vacíos — sección 4), pero son iniciativas distintas con momentos
distintos: una es una función normal del sistema desde V1, la otra es un
evento único que se hace cuando el resto ya está probado.

### 52.3 Riesgo detectado: reglas de negocio pendientes vs. "hacer todo ya"

Varias funciones de la sección 51 todavía no tienen su regla de negocio
confirmada (ver las 10 preguntas abiertas al final de esa sección):
cotizaciones, crédito a clientes, descuento de cumpleaños, envío de
tickets por SMS/correo, detalle de ticket de regalo. Construirlas sin
confirmar esas reglas es el mismo riesgo que la sección 41, regla 15, ya
advertía ("no asumir reglas de negocio no confirmadas").

Criterio recomendado para no frenar el avance general por esto:

- **Construir ya** (reglas ya claras, sin preguntas pendientes): roles y
  permisos, sucursales, productos/variantes/códigos, carga masiva propia,
  inventario y movimientos, transferencias, POS, ventas, caja, cambios,
  devoluciones, compras/proveedores, reportes de ventas/inventario/
  descuentos, auditoría, tarjeta de lealtad escaneable (identificación del
  cliente, sin la regla de descuento todavía).
- **Construir con valores por defecto explícitos, marcados como
  "sujeto a confirmación"**: apartados (usar los estados ya propuestos en
  la sección 20 como default razonable), cotizaciones (vigencia y
  conversión a venta con reglas simples iniciales).
- **Dejar en espera hasta tener respuesta del cliente**: crédito a
  clientes (falta definir límite/autorización/recargos), descuento por
  cumpleaños (automático vs. autorizado), envío de tickets por SMS/correo
  (depende de elegir proveedor externo — sección 51.8).

### 52.4 Datos de prueba vs. datos reales de SICAR

Como la migración real se hace al final, el desarrollo y las pruebas de
las Fases 1–5 usarán productos/ventas creados manualmente (de prueba), no
el Excel real de SICAR. Antes de ejecutar la Fase 7 (migración real) hay
que:

1. Vaciar o aislar los datos de prueba de `products`/`variants`/
   `inventory_movements`/`sales` en el ambiente donde se vaya a importar
   la información real, para que no choquen con códigos reales
   (sección 5: nunca cambiar/regenerar códigos heredados).
2. Confirmar que ningún código de prueba coincide por casualidad con un
   código real de SICAR o WooCommerce.

### 52.5 Tres contactos distintos con SICAR (no confundirlos)

Sólo el tercero es "la migración" que se pospone:

1. **Exportación de muestra para análisis** — leer un Excel para diseñar
   correctamente el catálogo (cómo codifica SICAR tallas, colores,
   producto padre). Sin riesgo, no toca nada. **Conviene conseguirla
   cuanto antes**, porque el modelo de datos de la Fase 2 depende de
   ella.
2. **Importación de una foto (snapshot) en staging** — para el piloto
   paralelo de la sección 7. No toca producción.
3. **Corte definitivo** — tienda cerrada, exportación final, importación a
   producción, apertura al día siguiente ya con Vaquero Hub. Ésta es la
   que va al final (Fase 6).

El runbook completo del corte, con validaciones y plan de rollback, está
en `PLAN_CODEX.md` sección 7.3. Punto clave: durante todo el proceso
SICAR sólo se lee, nunca se escribe, por lo que el rollback siempre es
"abrir mañana con SICAR como si nada".

### 52.6 Antes de aprovisionar la base de datos

Dos decisiones conviene cerrarlas antes de pagar/crear el proyecto de
Supabase (evita tener que migrar de plan o de proyecto después con datos
ya cargados):

1. **Plan de Supabase:** mínimo Pro para producción (sección 26).
2. **Estrategia de entornos:** proyecto separado por entorno vs. branching
   de un solo proyecto Supabase para `DEVELOPMENT`/`STAGING`/`PRODUCTION`
   (sección 27).
