import type { ProductVariant } from "./domain";

export type PosScanResult = { ok: true; variant: ProductVariant } | { ok: false; message: string };

export function posScanError(message: string): string {
  if (message.includes("M9_VARIANT_PENDING_REVIEW") || message.includes("M9_VARIANT_REVIEW_CHANGED")) return "Este producto está pendiente de revisión de migración y no se puede vender todavía.";
  if (message.includes("M9_REVIEW_EXPIRED")) return "La revisión de migración venció. Hay que renovarla antes de vender en pruebas.";
  if (message.includes("SCAN_NOT_FOUND")) return "No encontramos este código en el catálogo.";
  if (message.includes("SCAN_AMBIGUOUS")) return "El código es ambiguo. Selecciona el producto correcto.";
  if (message.includes("SCAN_NOT_AVAILABLE")) return "No hay existencia disponible para este producto en tu sucursal.";
  return "No fue posible consultar el código. Revisa tu caja y tu sesión.";
}
