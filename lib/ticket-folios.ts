export function giftFolioFromSale(folio: string, itemNumber = 1) {
  return `R-${folio.replace(/^V-/, "")}-${itemNumber}`;
}

export function saleFolioFromReceiptCode(value: string) {
  const normalized = value.trim().toLocaleUpperCase("es-MX");
  const giftMatch = normalized.match(/^R-(.+)-(\d+)$/);
  if (!giftMatch) return normalized;

  const embeddedSaleFolio = giftMatch[1];
  if (embeddedSaleFolio.startsWith("V-") || embeddedSaleFolio.includes("-V-")) {
    return embeddedSaleFolio;
  }

  return `V-${embeddedSaleFolio}`;
}
