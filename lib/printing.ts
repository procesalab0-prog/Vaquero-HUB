// Hardware real de la tienda, no una elección de diseño.
//
// Tickets: BIXOLON térmica de 80 mm, ya instalada en la computadora del
// mostrador. Etiquetas: la impresora que SICAR entregó con el sistema
// actual. Las dos imprimen por el controlador del sistema operativo, que es
// lo que `window.print()` usa; no hacen falta ni ePOS-Print ni WebPRNT.
//
// `size: <ancho> auto` es lo que evita que cada ticket saque una hoja
// completa de papel: en rollo continuo la altura la define el contenido. Sin
// esa línea el controlador usa su tamaño por omisión y alimenta de más en
// cada venta.
export const RECEIPT_WIDTH_MM = 80;

export const receiptPageStyle = `@page { size: ${RECEIPT_WIDTH_MM}mm auto; margin: 0; }
@media print {
  body { width: ${RECEIPT_WIDTH_MM}mm; }
  .print-receipt { width: ${RECEIPT_WIDTH_MM}mm; }
}`;
