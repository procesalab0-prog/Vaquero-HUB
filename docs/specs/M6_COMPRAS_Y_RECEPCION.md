# M6 — Compras, proveedores y recepción

## Objetivo

Registrar qué se pidió, qué llegó realmente y quién lo recibió, sin inventar
existencias ni perder diferencias. El recorrido debe funcionar de corrido en
teléfono, iPad y computadora.

## Invariantes

1. Crear o cancelar una orden no modifica inventario.
2. Sólo una recepción confirmada crea movimientos `PURCHASE`.
3. La suma recibida por renglón nunca supera la cantidad pedida.
4. Orden, renglones, recepción y movimientos se confirman en una sola
   transacción. Si una línea falla, no entra ninguna.
5. Las recepciones son idempotentes y el historial no se edita ni se borra.
6. Dos recepciones simultáneas bloquean la misma orden antes de comprobar
   pendientes; sólo puede entrar mercancía todavía pedida.
7. RLS y las funciones validan permiso y sucursal. Un cajero no ve compras.
8. El costo se guarda en el documento de compra. No actualiza el costo vigente
   de la variante hasta decidir entre promedio ponderado y último costo.
9. Dar de alta un producto desde una orden exige simultáneamente permisos de
   compras y catálogo; reutiliza el generador protegido de SKU/código y nunca
   recibe campos de SICAR o WooCommerce.
10. Las fotos son opcionales, públicas por tratarse de contenido comercial y
    se validan por tipo y tamaño. Subir un archivo no concede permiso para
    cambiar otro producto ni expone una llave privilegiada.

## Flujo humano

- Compras crea proveedor y orden; Almacén o Compras recibe.
- La recepción muestra una tabla continua con Pedido, Ya llegó y Recibo hoy.
- “Recibir todo pendiente” llena todas las líneas y permite corregir excepciones.
- Confirmar actualiza inventario una sola vez y deja visible la diferencia.
- Desde el historial se mandan a Etiquetas las cantidades exactas recibidas.
- Si el producto no existe, Compras abre el alta rápida sin perder la orden:
  una captura de datos, foto opcional y matriz continua de tallas y colores.
- Después de confirmar una recepción, Etiquetas se abre con cada cantidad
  recibida ya seleccionada. El empleado revisa y confirma la impresión para no
  desperdiciar rollo.

## Aceptación

- [x] Una orden de 10 piezas deja la existencia en cero.
- [x] Recibir 4 deja la orden parcial, 6 pendientes y existencia 4.
- [x] Completar el resto deja la orden recibida y existencia 10.
- [x] Dos recepciones concurrentes no pueden exceder lo pedido.
- [x] Cada entrada tiene usuario, sucursal, costo documental y movimiento.
- [x] Historial inmutable y cajero sin lectura ni escritura.
- [x] Etiquetas reciben la cantidad real de cada variante.
- [x] Un producto faltante se crea y vuelve a la orden con todas sus variantes.
- [x] La foto opcional se guarda con permisos y aparece en Productos y Venta.
- [x] Confirmar recepción prepara automáticamente el lote exacto de etiquetas.

La impresión y el escaneo físicos siguen siendo una compuerta externa: ninguna
prueba automatizada sustituye la impresora, el lector y la PWA reales.
