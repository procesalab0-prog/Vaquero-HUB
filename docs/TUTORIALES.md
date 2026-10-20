# Tutoriales en video de Mi Tienda SM

Lista acordada con Emmanuel el 20 de octubre de 2026. **Pendiente de empezar**:
Emmanuel quiere grabarlos con productos verdaderos, así que se graban cuando el
catálogo real esté cargado (ver «Cuándo empezar»).

## Formato

- Videos con **capítulos**, para brincar directo a la tarea que se busca.
- Se quedan en la web al entregar el sistema: una página de Ayuda con todos y
  un acceso desde cada sección a su video y capítulo.
- Cada video indica la versión de Mi Tienda SM con la que se grabó, para saber
  cuándo hay que rehacerlo.

## Los videos

### Para el equipo (7)

1. **Primeros pasos**
   - Entrar y cambiar de sucursal.
   - Inicio y la campana de avisos.
   - Moverse en computadora, iPad y teléfono.

2. **Vender, cobrar y devoluciones** (largo, 8–10 min)
   - Agregar productos con lector, cámara o catálogo.
   - Cliente: asignar o dar de alta.
   - Descuento y regalo.
   - Producto rápido.
   - Cobrar: efectivo, tarjeta y pagos combinados.
   - Ticket de regalo y reimpresión.
   - Devoluciones y cambios.

3. **Cotizaciones**
   - Crear, entregar al cliente y convertir en venta.
   - Antes de grabar, confirmar cómo quedaron las cotizaciones personalizadas
     (nombre libre, precios propios, vigencia). Si no están listas, grabar la
     cotización normal y agregar esa parte después.

4. **Caja**
   - Abrir caja.
   - Entradas y salidas de efectivo.
   - Corte ciego.
   - Corte de sucursal.

5. **Apartados y crédito**
   - Apartar, abonar y entregar.
   - Crédito y estado de cuenta.
   - Cancelaciones.

6. **Productos e inventario** (largo, 8–10 min)
   - Alta y edición de productos: fotos, tallas, categorías.
   - Etiquetas.
   - Entradas de mercancía.
   - Conteos.
   - Traspasos.
   - Compras.

7. **Gerencia**
   - Reportes.
   - Usuarios, permisos y PIN.
   - Ajustes e impresora.
   - Sucursales.

### Para clientes, aparte (1)

8. **Mi Vaquero**: puntos, canje y tarjeta de socio. Se publica donde lo vean
   los clientes, no en la Ayuda del sistema.

Fuera de la lista: la sección de dudas de migración, que es temporal.

## Cuándo empezar

- Con productos verdaderos: depende de la migración M9 (hoy el catálogo real
  sólo está parcialmente en staging; ver
  [`M9_PROPUESTA_AGILIZAR_MIGRACION.md`](M9_PROPUESTA_AGILIZAR_MIGRACION.md)).
- Después de comprobar en la tienda lo que aún falta (iPad, Safari, impresora),
  para no grabar algo que vaya a cambiar.

## Cómo se graban

- Productos verdaderos, pero **sin datos reales de clientes ni ventas reales**:
  clientes, tickets y montos de demostración. Grabar en staging o en una
  sucursal de prueba, nunca generando ventas o movimientos falsos en
  producción.
- Claude Code puede grabar las pantallas del sistema (computadora, iPad,
  teléfono) con texto en pantalla. No puede grabar el lector físico, la
  impresora, la terminal ni la cámara reales: esas tomas las graba el equipo en
  la tienda o se simulan en pantalla. Tampoco pone voz; si se quiere narración,
  se graba aparte.
- Primer paso cuando se retome: escribir el guion de cada video, paso por paso,
  sobre la versión vigente, para que Emmanuel lo apruebe antes de grabar.
