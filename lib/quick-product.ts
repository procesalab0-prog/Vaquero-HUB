import type { CartLine, ProductVariant } from "./domain";

export type QuickProduct = { name: string; unit_price_cents: number; unit_cost_cents?: number };
export type PosItemInput = { variant_id: string; quantity: number; gift_receipt: boolean; quick?: QuickProduct };

/** The UUID identifies a cart line, NOT a catalog variant, SKU or barcode. */
export function quickProductVariant(id: string, quick: QuickProduct): ProductVariant {
  return { id, productName: quick.name, brand: "", legacyCode: "", color: "", size: "",
    price: quick.unit_price_cents / 100, stock: 999, isActive: true, quick };
}

export function posItemInput(line: CartLine): PosItemInput {
  return { variant_id: line.variant.id, quantity: line.quantity, gift_receipt: line.giftReceipt,
    ...(line.variant.quick ? { quick: line.variant.quick } : {}) };
}

export function posItemVariant(item: PosItemInput, variants: Map<string, ProductVariant>): ProductVariant | undefined {
  return item.quick ? quickProductVariant(item.variant_id, item.quick) : variants.get(item.variant_id);
}

export function parseQuickProduct(name: string, price: string, quantity: string, cost?: string): { quick: QuickProduct; quantity: number } | null {
  const toCents = (value: string) => {
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value.trim())) return null;
    const cents = Math.round(Number(value) * 100);
    return cents <= 100000000 ? cents : null;
  };
  const unitPrice = toCents(price);
  const qty = /^\d{1,3}$/.test(quantity) ? Number(quantity) : 0;
  const unitCost = cost?.trim() ? toCents(cost) : undefined;
  if (!name.trim() || name.trim().length > 160 || unitPrice === null || unitPrice <= 0 || qty < 1 || qty > 999 || unitCost === null) return null;
  return { quick: { name: name.trim(), unit_price_cents: unitPrice, ...(unitCost === undefined ? {} : { unit_cost_cents: unitCost }) }, quantity: qty };
}
