// Hardware real de la tienda, no una elección de diseño.
//
// Tickets: **BIXOLON SRP-330II**, térmica de 80 mm, conectada a la
// computadora del mostrador. Etiquetas: **SICAR EVA58**, rollo de 58 mm,
// interfaz USB y RS232. Las dos imprimen por el controlador del sistema
// operativo, que es lo que `window.print()` usa; no hacen falta ni
// ePOS-Print ni WebPRNT, y ninguna de las dos es de red.
//
// Corrección de una revisión anterior: se había puesto
// `@page { size: 80mm auto }` para que el ticket no alimentara una hoja
// completa. **Esa declaración es inválida.** La gramática de `size` en CSS
// Paged Media admite `<length>{1,2}`, `auto` sola, o un nombre de papel; no
// admite mezclar una medida con `auto`. El navegador descarta la regla
// entera, así que no hacía nada.
//
// El tamaño de rollo continuo se configura **en el controlador de la
// BIXOLON**, no desde CSS. Aquí sólo se quitan los márgenes y se fija el
// ancho del contenido, que es lo que sí corresponde a la hoja de estilos.
export const RECEIPT_WIDTH_MM = 80;

// El rollo de la EVA58 es de 58 mm: una etiqueta más ancha sale cortada. La
// restricción de la base admite hasta 120 mm a propósito, para no amarrar el
// sistema a la impresora de hoy; el aviso vive en la pantalla de etiquetas.
export const LABEL_MAX_WIDTH_MM = 58;

export const receiptPageStyle = `@page { margin: 0; }
@media print {
  body { width: ${RECEIPT_WIDTH_MM}mm; }
  .print-receipt { width: ${RECEIPT_WIDTH_MM}mm; }
}`;
