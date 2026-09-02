export type ProductVariant = {
  id: string;
  /** Identificadores del catálogo real; se omiten en datos de demostración antiguos. */
  productId?: string;
  categoryId?: string;
  productName: string;
  brand: string;
  legacyCode: string;
  color: string;
  size: string;
  price: number;
  stock: number;
  /**
   * Una variante dada de baja sigue existiendo y sigue apareciendo en la
   * búsqueda: su identidad es inmutable y su historial no se borra. Por eso el
   * estado tiene que viajar hasta la interfaz — si se pierde aquí, lo inactivo
   * se ve idéntico a lo vendible.
   */
  isActive?: boolean;
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
