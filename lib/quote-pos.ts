export type QuotePosPricing = {
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  customer_name: string | null;
  items: Array<{ variant_id: string; unit_price_cents: number; discount_cents: number; line_total_cents: number }>;
};
