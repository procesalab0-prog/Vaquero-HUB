/**
 * La etiqueta física conserva Clave 1 de SICAR cuando existe. El código
 * principal propio queda como respaldo para productos nacidos en Mi Tienda SM.
 */
export function printableLabelCode(input: {
  legacySicarCode?: string | null;
  primaryBarcode?: string | null;
}) {
  return (
    input.legacySicarCode?.trim() ||
    input.primaryBarcode?.trim() ||
    "Sin código"
  );
}
