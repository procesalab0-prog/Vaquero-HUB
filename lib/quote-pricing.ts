import { measureLineCents, parseMeasureQuantity, PIECE_UNIT, type MeasureUnit } from "./measure-units";
export type QuotePriceInput = { variant_id: string; quantity: number; unit_price_cents?: number; discount_cents?: number };

/** Money stays in integer cents; blank overrides retain the catalog snapshot. */
export function quoteLinePricing(id: string, quantity: number, catalogPrice: number, price = "", discount = "", unit: MeasureUnit = PIECE_UNIT): QuotePriceInput {
  const cents = (value: string) => {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error("INVALID_QUOTE_PRICING");
    const result = Math.round(Number(value.replace(",", ".")) * 100);
    if (!Number.isSafeInteger(result) || result > 999999999999) throw new Error("INVALID_QUOTE_PRICING");
    return result;
  };
  if (parseMeasureQuantity(String(quantity),unit) === null || quantity > 999 || !Number.isSafeInteger(catalogPrice) || catalogPrice < 0) throw new Error("INVALID_QUOTE_PRICING");
  const unitPrice = price.trim() ? cents(price) : catalogPrice;
  const discountCents = discount.trim() ? cents(discount) : 0;
  const gross=measureLineCents(unitPrice,quantity,unit);
  if (gross === null || discountCents > gross) throw new Error("INVALID_QUOTE_PRICING");
  return { variant_id: id, quantity, ...(price.trim() ? { unit_price_cents: unitPrice } : {}), ...(discount.trim() ? { discount_cents: discountCents } : {}) };
}
