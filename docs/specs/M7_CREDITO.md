# M7 — Crédito a clientes

> Reglas confirmadas por Vaqueros SM el 9 de septiembre de 2026.
> Esta especificación cubre ventas a crédito y cobro de saldos. Apartados
> viven en `M7_APARTADOS.md`; puntos y lealtad se harán en una etapa posterior
> y no bloquean la entrega de apartados y crédito.

## 1. Regla principal

Vaqueros SM ya vende a crédito. El crédito no se ofrece automáticamente por
crear una cuenta: sólo se habilita a los clientes autorizados por personal
encargado y siempre con un límite definido por un administrador o gerente.

Una venta a crédito es una venta real: entrega mercancía y mueve inventario en
ese momento. La parte no pagada genera una cuenta por cobrar; no debe registrarse
como efectivo, tarjeta o transferencia recibida hasta que exista un abono real.

## 2. Autorización y límites

- Sólo los clientes expresamente autorizados pueden usar crédito.
- Un administrador o gerente puede autorizar al cliente y establecer o cambiar
  su límite.
- El cliente nunca puede modificar su autorización, límite, saldo, vencimiento
  ni bloqueo desde su cuenta.
- Un cliente vencido queda bloqueado para **nuevas ventas a crédito**, pero puede
  seguir comprando con pago completo y puede abonar a su deuda.
- Puede haber excepciones, pero deben ser autorizadas por un usuario
  administrador con el permiso correspondiente. Cada excepción conserva autor,
  motivo, fecha, saldo vencido y operación autorizada.
- Desbloquear permanentemente o cambiar el límite requiere una acción separada
  y auditable; una excepción no deberá borrar ni ocultar el atraso.

## 3. Plazo y vencimiento

- No hay un plazo fijo obligatorio. La fecha de vencimiento se define en cada
  venta a crédito por un usuario con permiso.
- La interfaz puede proponer como valor inicial un mes después de la venta,
  porque ése es el plazo habitual, pero permitirá cambiarlo antes de confirmar.
- No se calculan intereses, recargos ni penalizaciones automáticas porque el
  negocio no los maneja actualmente.
- El cliente necesita ver saldo, movimientos, fechas de vencimiento y estado de
  cuenta.
- Los recordatorios se preparan para WhatsApp siete días antes de vencer, sin
  convertir una falla de entrega del mensaje en cambio de saldo o estado.

## 4. Ventas y abonos

- Se permiten ventas parcialmente pagadas: una parte puede cobrarse con uno o
  varios métodos y el resto quedar a crédito.
- Se permiten abonos parciales y pagos mixtos posteriores.
- Cada abono conserva importe, método, referencia, sucursal, caja, empleado y
  fecha. Los movimientos son inmutables; una corrección usa un documento
  compensatorio.
- El crédito funciona en todas las sucursales. El saldo y el límite pertenecen
  al cliente dentro de toda la empresa, aunque cada venta y abono conserva su
  sucursal de origen.
- Un abono recibido en otra sucursal reduce el mismo saldo global y mueve sólo
  la caja donde realmente se recibió.
- Cada abono genera comprobante y el estado de cuenta debe conciliar la deuda
  original, abonos, ajustes y saldo actual.

## 5. Seguridad e integridad obligatorias

- Autorizar crédito, cambiar límites, conceder excepciones y registrar abonos
  son permisos distintos y se validan en el servidor.
- Dos ventas simultáneas no pueden superar juntas el crédito disponible. La
  comprobación y el consumo del límite deben usar un candado transaccional, no
  dos lecturas independientes desde la interfaz.
- Repetir una venta o abono por un reintento de red no puede duplicar deuda,
  inventario ni dinero; las operaciones requieren idempotencia.
- El saldo no se edita directamente. Se obtiene de cargos y abonos auditables.
- Caja registra únicamente el dinero realmente recibido. El componente a
  crédito nunca infla el efectivo esperado del corte.
- Los empleados sólo consultan clientes y movimientos según sus permisos y
  sucursales. El cliente autenticado sólo puede consultar su propia información.
- Ninguna excepción elimina el registro del vencimiento que la originó.

## 6. Ergonomía mínima

- El POS muestra claramente crédito disponible, saldo actual, importe nuevo y
  saldo resultante antes de confirmar.
- Si el crédito está bloqueado, explica la causa y permite pedir autorización a
  un administrador sin perder el carrito.
- Registrar un abono requiere pocos pasos, acepta pagos mixtos y presenta saldo
  anterior, abono y saldo nuevo.
- El estado de cuenta se filtra por periodo y distingue cargos, abonos,
  devoluciones, cancelaciones y ajustes.
- Los controles y comprobantes funcionan con scroll en teléfono, iPad y
  computadora.

## 7. Decisiones todavía pendientes

1. ¿Cómo afectan las devoluciones y cancelaciones al saldo? Debe definirse si
   primero reducen deuda pendiente y qué ocurre cuando el cliente ya pagó parte
   o toda la compra.
2. ¿Existen saldos de crédito actuales en SICAR que deban migrarse? Si existen,
   se necesita exportar cliente, saldo, vencimiento y movimientos o al menos un
   saldo inicial conciliado.

Hasta responder la primera, M7 no debe inventar una conversión de devolución a
efectivo ni permitir que una cancelación borre deuda sin documento compensatorio.

## 8. Criterios de aceptación

- Un cliente sin autorización no puede comprar a crédito.
- Administrador o gerente puede asignar un límite; otro rol no puede hacerlo sin
  el permiso explícito.
- Dos compras concurrentes nunca exceden juntas el límite disponible.
- La parte pagada mueve caja y la parte a crédito genera deuda por el importe
  exacto, sin duplicar la venta ni el inventario.
- Un abono parcial o mixto reduce exactamente el saldo y concilia con la caja
  donde se recibió.
- Un atraso bloquea solamente nuevas operaciones de crédito. Una excepción de
  administrador es explícita, limitada y auditable.
- No se generan intereses o recargos automáticos.
- El estado de cuenta cuadra desde el saldo inicial hasta el saldo actual.
