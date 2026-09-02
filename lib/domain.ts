export type ProductVariant = {
  id: string;
  /** Identificadores del catálogo real; se omiten en datos de demostración antiguos. */
  productId?: string;
  categoryId?: string;
  description?: string;
  productActive?: boolean;
  productName: string;
  brand: string;
  legacyCode: string;
  sku?: string;
  color: string;
  size: string;
  price: number;
  cost?: number;
  /**
   * Una variante dada de baja sigue existiendo y sigue apareciendo en la
   * búsqueda: su identidad es inmutable y su historial no se borra. Por eso el
   * estado tiene que viajar hasta la interfaz — si se pierde aquí, lo inactivo
   * se ve idéntico a lo vendible.
   */
  isActive?: boolean;
  stock: number;
  /** Ruta de la fotografía aprobada por el dueño. Si falta, la UI muestra un fallback neutro. */
  image?: string;
};

export type CartLine = {
  variant: ProductVariant;
  quantity: number;
  giftReceipt: boolean;
};

export type PaymentMethod = "cash" | "card" | "transfer";

export type GiftReceiptStatus =
  "valid" | "partially_used" | "used" | "expired" | "cancelled";

export type LabelLayout = "BALANCED" | "PRODUCT_FOCUS" | "PRICE_FOCUS";

export type LabelTemplate = {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  layout: LabelLayout;
  showLogo: boolean;
  showProductName: boolean;
  showBrand: boolean;
  showSize: boolean;
  showColor: boolean;
  showPrice: boolean;
  showSku: boolean;
  showBarcode: boolean;
  showCode: boolean;
  isDefault: boolean;
  isActive: boolean;
};

export type BatchActionResult = {
  ok: boolean;
  message: string;
  changedCount?: number;
  stale?: boolean;
};
