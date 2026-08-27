export type ProductVariant = {
  id: string;
  productName: string;
  brand: string;
  legacyCode: string;
  color: string;
  size: string;
  price: number;
  stock: number;
};

export type CartLine = {
  variant: ProductVariant;
  quantity: number;
  giftReceipt: boolean;
};

export type PaymentMethod = "cash" | "card" | "transfer";

export type GiftReceiptStatus =
  | "valid"
  | "partially_used"
  | "used"
  | "expired"
  | "cancelled";
