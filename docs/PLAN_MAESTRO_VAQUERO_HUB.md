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

Entrega digital de tickets:

- Al terminar una venta, el empleado podrá imprimir el ticket, abrir su vista real, usar el menú nativo **Compartir** o enviarlo por WhatsApp.
- WhatsApp abrirá una conversación con texto preparado y un enlace seguro al ticket; esta opción no dependerá de contratar un proveedor de SMS.
- El envío automático por SMS o correo será opcional y quedará desacoplado mediante un proveedor externo por definir.
- El ticket digital usará un identificador opaco y no enumerable. Nunca expondrá listados, datos de otros clientes, credenciales ni permitirá modificar la venta.
- El ticket de regalo tendrá su propia vista compartible y seguirá ocultando los precios definidos por la política del negocio.
- Una falla de WhatsApp, del menú Compartir, de SMS o de correo nunca deberá cancelar, duplicar ni revertir una venta ya cobrada.
- El envío transaccional del comprobante y el consentimiento para promociones se tratarán como decisiones distintas. Compartir un ticket no habilita marketing.
- Los intentos de entrega deberán dejar auditoría mínima de canal, estado, actor y fecha, sin copiar teléfonos, correos ni el contenido completo del ticket a los logs.

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

Vaqueros SM utiliza funciones que deberán documentarse antes de implementar.

Si utilizan apartados, contemplar:

layaways
layaway_items
payments
balance_remaining
status

Estados conceptuales:

OPEN
PARTIALLY_PAID
PAID
CANCELLED
EXPIRED

No asumir reglas de negocio. Documentarlas con el cliente.

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

Posible módulo:

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
- Producción conserva 18 códigos generados durante el desarrollo; no se borran
  ni se reinterpretan sin la exportación de SICAR. La compuerta para operación
  real sigue abierta hasta demostrar que los códigos heredados no usan `20`–`29`.
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
- La interfaz mantiene un recorrido táctil de tres pasos y cancela claramente
  ante errores. La siguiente entrega de M2 es M2.5: selección en lote y
  plantillas de etiquetas desde la computadora de trastienda.
- La base técnica se actualizó a Next.js 16.2.11 y el árbol de dependencias de
  producción quedó sin vulnerabilidades conocidas en la auditoría del gestor
  de paquetes al momento de la entrega.
