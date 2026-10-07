import type { ProductVariant } from "./domain";

export type PosScanResult = { ok: true; variant: ProductVariant } | { ok: false; message: string };

export function posScanError(message: string): string {
  if (message.includes("SCAN_NOT_FOUND")) return "No encontramos este código en el catálogo.";
  if (message.includes("SCAN_AMBIGUOUS")) return "El código es ambiguo. Selecciona el producto correcto.";
  if (message.includes("SCAN_NOT_AVAILABLE")) return "No hay existencia disponible para este producto en tu sucursal.";
  return "No fue posible consultar el código. Revisa tu caja y tu sesión.";
}
