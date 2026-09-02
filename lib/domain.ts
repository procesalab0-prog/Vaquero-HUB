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
