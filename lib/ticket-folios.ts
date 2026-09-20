export function giftFolioFromSale(folio: string, itemNumber = 1) {
  return `R-${folio.replace(/^V-/, "")}-${itemNumber}`;
}

function normalizeScannerPunctuation(value: string) {
  return value
    .trim()
    .toLocaleUpperCase("es-MX")
    .replace(/['’‘`´]/g, "-");
}

export function saleFolioFromReceiptCode(value: string) {
  // Algunos lectores USB configurados con otra distribución de teclado
  // envían el carácter físico del guion como apóstrofe. La corrección vive
  // sólo en el contexto de folios para no modificar códigos de producto.
  const normalized = normalizeScannerPunctuation(value);
  const giftMatch = normalized.match(/^R-(.+)-(\d+)$/);
  if (!giftMatch) return normalized;

  const embeddedSaleFolio = giftMatch[1];
  if (embeddedSaleFolio.startsWith("V-") || embeddedSaleFolio.includes("-V-")) {
    return embeddedSaleFolio;
  }

  return `V-${embeddedSaleFolio}`;
}

export function isTicketReceiptCode(value: string) {
  const normalized = saleFolioFromReceiptCode(value);
  return /^(?:[A-Z0-9]+-)*V-[A-Z0-9-]+$/.test(normalized);
}
