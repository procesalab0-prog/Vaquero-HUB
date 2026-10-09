# Mejoras operativas de octubre — candidata 0.63.0

Rama: `codex/mejoras-operativas-octubre`. Base: main 0.62.0.
No publicada ni aplicada a producción. M9 y Mi Vaquero quedan fuera de esta entrega.

## Los 15 puntos

1. Corte por sucursal: gerencia consolida todos los turnos cerrados aún no incluidos en un corte. Cada cajero conserva su cierre ciego; se guardan caja, usuario, contado, esperado, diferencia y motivo. No se confirma mientras haya turnos abiertos. El primer corte incluye turnos históricos sin corte previo; revisar antes de confirmar. USD, cuando esté habilitado, sigue separado de MXN.
2. Venta en teléfono: catálogo y carrito visibles, cobro compacto y ajuste de espacio en vivo. Un mínimo de espacio protege productos y Cobrar. En pantallas muy bajas se permite desplazamiento vertical.
3. Métodos de pago después de Cobrar. Crédito y débito diferenciados, con posibilidad de combinar ambos; la suma debe coincidir exactamente. Pagos históricos sin subtipo siguen sin subtipo.
4. Ticket de regalo después de vender: si no hubo selección previa de regalo, se genera con todos los renglones, sin importes. No modifica la venta ni sus marcas históricas.
5. Alta de cliente en Venta, sin perder carrito: permiso existente de clientes, teléfono, aviso de privacidad y consentimiento. No crea sesión del cliente ni concede crédito.
6. `/clientes/cuentas`: pestañas de crédito y apartados, saldo y acceso al detalle. Crédito conserva su alcance global; apartados muestra la sucursal activa.
7. Crear y seleccionar categoría desde alta de producto, sin borrar lo capturado. Nombre único y autorización del servidor. Las nuevas categorías no inventan una escala de tallas.
8. Seleccionar variantes visibles por marca o todas las visibles para agregar unidades. La acción dice explícitamente que es entrada, no conteo. Movimiento auditado, transaccional, idempotente y con protección contra existencias desactualizadas.
9. Preparar etiquetas desde las variantes capturadas del conteo. Se propone una etiqueta por variante y la cantidad es editable en Etiquetas; nunca se manda a imprimir automáticamente todo un conteo.
10. Contención del desplazamiento del menú de Productos, sin mover la pantalla de fondo al llegar al límite.
11. Crear, capturar, cerrar o cancelar un conteo conserva el contexto de Conteos en la URL, incluyendo recarga.
12. Cantidad editable en la fila de Inventario, con motivo y guardado allí mismo. Cambiar existencias requiere permiso y rechaza una base desactualizada; no sobrescribe silenciosamente cambios de otra persona.
13. Avisos reales de traspasos, compras/entradas, ajustes/conteos y entradas/retiros de caja. Filtrados por permisos y sucursal; cada usuario acusa recepción. Consulta periódica con la aplicación visible, no push en segundo plano. Sonido sólo si está habilitado y el navegador permite audio. Avisos históricos llegan silenciosamente. Enlace al movimiento desde la campana.
14. Producto rápido con formulario más grande y controles legibles. Conserva sus reglas: no crea código ni mueve inventario.
15. `/reportes/costos`: recepciones y entradas manuales valorizadas, agrupación día/mes/año y cambios históricos de costo. Sólo gerencia autorizada. Valorización no equivale a gasto pagado ni utilidad; entradas manuales no simulan compras. Sin costo histórico se informa falta de valorización. Periodo máximo de 366 días, aviso de totales parciales cuando hay más de 500 registros.

## Arquitectura y pruebas

- Una migración nueva `20261009200155_operational_october.sql`; ninguna migración desplegada se reescribió.
- Tablas nuevas cerradas con RLS y sin escritura directa para usuarios. RPC con comprobación de rol, permiso y sucursal. Documentos de entradas y cortes inmutables.
- Las operaciones nuevas de interfaz cruzan `/api/operaciones`, con origen validado, sin importar acciones de servidor en componentes cliente.
- 125 migraciones y regresiones financieras aplicadas sobre base local vacía `qa_operational_oct09_e`.
- `verify-october-native.mjs`: entradas idempotentes/concurrentes, subtipo tarjeta, regalo posventa, corte con dos cajas y faltante, rechazo por rol, avisos/acuse, valorización e inmutabilidad.
- 138 pruebas unitarias y 39 pruebas de navegador, incluidas ventanas móviles, sin encimamientos ni errores ocultos. TypeScript, ESLint de archivos cambiados y compilación de producción correctos.
- Navegador: Chrome a 390/768/1440 px y ventanas a teléfono compacto/iPad/computadora. Vista de demostración; el transporte de alta de cliente está simulado. SQL usa identidades JWT de prueba y esquemas Auth/Storage simulados: NO es una prueba de Auth/PostgREST real.

## Antes de publicar

1. Revisar la candidata y la migración junto con el trabajo paralelo de M9 antes de fusionar.
2. En staging con cuentas reales: alta de cliente, categorías, entradas y conteos, crédito/apartados, dos usuarios/sucursales y rechazo a usuarios no autorizados.
3. Corte de sucursal con dos cajas: cada cajero cierra a ciegas y gerencia consolida; comprobar caja abierta, reintento y faltante.
4. Tarjeta crédito + débito y devoluciones del pago combinado; son registros de terminal, no cargos bancarios automáticos.
5. Generar un traspaso desde otro usuario y verificar campana, destino y sonido en el dispositivo de tienda. La prueba física de audibilidad no se puede inferir de una llamada a AudioContext.
6. Revisión Safari/iPhone/iPad reales. Las pruebas físicas previas de etiquetas, escáner y tickets ya fueron realizadas por Emmanuel; esta entrega no cambia su tipografía ni sus medidas.

## Comandos de QA

Con una base **local vacía** nueva cuyo nombre empiece `qa_`:

```sh
QA_DATABASE_URL=postgresql://postgres:postgres@localhost:58322/qa_nueva node scripts/verify-operational-native.mjs
QA_DATABASE_URL=postgresql://postgres:postgres@localhost:58322/qa_nueva node scripts/verify-october-native.mjs
node node_modules/vitest/vitest.mjs run tests/unit
node node_modules/@playwright/test/cli.js test --config=playwright.october.config.ts
```

El navegador de QA usa un servidor de esta rama en el puerto 3137; no el 3107 del chat anterior. No reiniciar ni limpiar bases compartidas.
