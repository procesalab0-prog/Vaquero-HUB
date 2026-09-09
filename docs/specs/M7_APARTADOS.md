# M7 — Apartados

> Reglas confirmadas por Vaqueros SM el 9 de septiembre de 2026.
> Esta especificación cubre apartados. Crédito y lealtad permanecen fuera
> hasta que el negocio conteste sus reglas propias.

## 1. Regla principal

Un apartado reserva mercancía vendible para un cliente. Desde que se confirma,
la cantidad reservada deja de estar disponible para una venta normal. Abonar
reduce el saldo, pero no convierte el apartado en venta hasta liquidarlo y
entregarlo. Cancelarlo libera exactamente la mercancía que siga reservada.

Ninguna pantalla podrá fingir que un apartado existe: reserva, abono, cambio,
cancelación y entrega deberán ejecutarse en el servidor, dentro de operaciones
atómicas y auditables.

## 2. Reglas confirmadas

### Plazo y vencimiento

- No existe un plazo fijo global. Un usuario interno con el permiso adecuado
  captura los días o la fecha de vencimiento de cada apartado.
- Llegar a la fecha no cierra, cancela ni bloquea automáticamente al cliente o
  al apartado. La decisión de cancelarlo siempre la toma personal autorizado.
- La interfaz muestra en amarillo los apartados próximos a vencer y en rojo
  los vencidos. Mientras no se cancelen, continúan abiertos y conservan la
  mercancía reservada.
- Los recordatorios operativos se preparan para WhatsApp siete días antes del
  vencimiento, conforme a las decisiones registradas en
  `docs/PREGUNTAS_CLIENTE.md`.

### Enganche y abonos

- No hay enganche mínimo ni monto mínimo por abono.
- El cliente puede abonar cuando pueda y realizar tantos abonos como necesite.
- Cada abono conserva fecha, importe, método de pago, sucursal, caja y empleado.
  Los pagos son inmutables; una corrección se registra con un movimiento
  compensatorio, nunca editando el historial.
- Cada abono genera un comprobante físico o digital y actualiza el saldo en la
  misma transacción.

### Cancelación y penalización

- La cancelación es manual y requiere el permiso correspondiente; no depende
  de un PIN separado.
- Si Vaqueros SM cancela un apartado vencido, los importes abonados se retienen
  como penalización y no se devuelven por omisión.
- Cancelar no borra abonos ni el documento. Registra quién canceló, cuándo,
  motivo, saldo, penalización y mercancía liberada.
- Debe existir la posibilidad futura de autorizar otra forma de devolución,
  pero no se habilitará una excepción sin definir método, permiso y auditoría.
  El sistema no convertirá automáticamente pagos electrónicos en efectivo.

### Productos, precios y descuentos

- Un usuario con permiso específico puede modificar el precio de un artículo
  ya apartado y aplicar descuentos.
- Cada modificación conserva el valor anterior, el nuevo, el motivo y el autor.
  No se reescriben silenciosamente los abonos o precios históricos.
- Se pueden sustituir productos mientras el apartado siga abierto. La operación
  libera la variante anterior, reserva la nueva y recalcula el saldo de forma
  atómica para que una falla no deje el inventario a medias.

### Entrega y sucursales

- El apartado puede localizarse mediante su ticket físico, ticket digital o el
  nombre del cliente. Una coincidencia por nombre deberá mostrar elementos para
  distinguir personas sin exponer datos innecesarios.
- Se permitirá entregar en otra sucursal como una opción controlada. El sistema
  deberá resolver el traslado físico mediante el flujo auditable de traspasos;
  nunca moverá existencias entre sucursales sólo en la interfaz.
- Sólo un empleado autenticado y con el permiso concreto puede crear, modificar,
  abonar, cancelar, sustituir productos o entregar un apartado. Ser cliente
  registrado no concede permisos internos.

## 3. Estados

- `OPEN`: creado y con saldo pendiente.
- `PARTIALLY_PAID`: tiene abonos y conserva saldo.
- `PAID`: está liquidado, pendiente de la entrega o conversión final.
- `COMPLETED`: mercancía entregada y venta generada por el flujo normal.
- `CANCELLED`: cancelado manualmente, con mercancía liberada y resultado
  financiero documentado.

Vencido y próximo a vencer son condiciones calculadas usando la fecha, no
estados terminales. No se usará una transición automática a `EXPIRED`, porque
el negocio confirmó que el apartado continúa abierto hasta que alguien con
permiso decida cancelarlo.

## 4. Seguridad e integridad obligatorias

- Reservar nunca puede dejar `available_qty` negativo ni vender mercancía ya
  reservada.
- Dos cajas intentando reservar la última pieza en paralelo producen una sola
  reserva exitosa.
- Cancelar dos veces no libera inventario dos veces ni duplica penalizaciones.
- Un abono repetido por reintento de red debe ser idempotente.
- Cambiar productos o entregar en otra sucursal usa candados consistentes con
  M3 y no rompe la suma global del inventario.
- Los permisos se comprueban en PostgreSQL o en el servidor, no mediante botones
  ocultos. Todas las operaciones relevantes dejan auditoría.
- Los movimientos de caja y la venta final deben conciliar contra todos los
  abonos, ajustes y penalizaciones del apartado.

## 5. Ergonomía mínima

- Crear el apartado desde el carrito actual, sin volver a capturar productos ni
  cliente.
- Registrar un abono en pocos toques, mostrando saldo anterior, abono y saldo
  nuevo antes de confirmar.
- Mostrar claramente folio, cliente, sucursal de origen, sucursal de entrega,
  fecha y estado por color.
- Permitir búsqueda por folio, escaneo del ticket, nombre o número de socio.
- Mantener formularios y confirmaciones utilizables con scroll en teléfono,
  iPad y computadora.

## 6. Decisiones todavía pendientes

Estas preguntas no invalidan lo confirmado, pero deben resolverse antes de
cerrar M7:

1. Sin enganche mínimo, ¿se permite confirmar un apartado con **$0 abonados** o
   debe existir al menos un pago positivo?
2. ¿Cuántos días antes del vencimiento comienza el color amarillo?
3. Si se baja el precio por debajo de lo ya abonado, ¿el excedente se devuelve,
   queda como saldo a favor o se impide el cambio?
4. Al sustituir por un producto de distinto precio, ¿la diferencia sólo ajusta
   el saldo o puede requerir devolución inmediata?
5. ¿Qué excepciones permiten devolver abonos, por qué métodos y con qué permiso?
6. Para entregar en otra sucursal, ¿quién solicita y quién autoriza el traspaso,
   y se permite recoger antes de que la mercancía sea recibida físicamente?
7. ¿Cuántos apartados abiertos existen en SICAR y deben migrarse?

La retención de abonos como penalización debe aparecer claramente en la política
y en el comprobante aceptado por el cliente antes de recibir dinero.

## 7. Criterios de aceptación

- Apartar una pieza la retira de disponibilidad sin registrar todavía una venta.
- Abonar reduce exactamente el saldo y cuadra con caja.
- Vencer sólo cambia los avisos visuales; no cancela ni libera mercancía.
- Cancelar con permiso libera la reserva una sola vez y conserva los abonos como
  penalización, salvo una excepción posteriormente autorizada.
- Sustituir artículos mantiene inventario y saldo consistentes aun con dos
  usuarios operando al mismo tiempo.
- Liquidar y entregar genera una venta normal sin volver a cobrar los abonos.
- Ningún usuario sin permiso puede ejecutar operaciones sensibles llamando
  directamente al backend.
