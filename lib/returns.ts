export type ReturnableSaleItem = {
  sale_item_id: string;
  variant_id: string;
  product_name: string;
  variant_description: string;
  sku: string;
  quantity: number;
  remaining_quantity: number;
  paid_line_cents: number;
  already_returned_cents: number;
};

export type OriginalPayment = {
  method_code: "CASH" | "CARD" | "TRANSFER";
  method_name: string;
  amount_cents: number;
  requires_reference: boolean;
};

export type ReturnableSale = {
  id: string;
  folio: string;
  status: "COMPLETED" | "CANCELLED";
  sold_at: string;
  total_cents: number;
  location_id: string;
  customer_id: string | null;
  window_days: number;
  return_deadline: string;
  within_window: boolean;
  payments: OriginalPayment[];
  items: ReturnableSaleItem[];
};

export type ExchangeVariant = {
  id: string;
  productName: string;
  brand: string;
  sku: string;
  color: string;
  size: string;
  priceCents: number;
  stock: number;
};

export type PrepareExchangeResult =
  | { ok: true; sale: ReturnableSale; cashSessionId: string }
  | { ok: false; message: string };

export type ExchangeSearchResult =
  { ok: true; variants: ExchangeVariant[] } | { ok: false; message: string };

export type CreateExchangeResult =
  | {
      ok: true;
      id: string;
      folio: string;
      type?: "RETURN" | "EXCHANGE";
      differenceCents?: number;
      payments?: Array<{
        direction: "REFUND" | "CHARGE";
        method_code: string;
        amount_cents: number;
        reference: string | null;
      }>;
    }
  | { ok: false; message: string };

export type ReturnAuthorizationResult =
  | { ok: true; authorizationToken: string; expiresAt: string }
  | { ok: false; message: string };

export function unitExchangeValue(item: ReturnableSaleItem) {
  const sold = Number(item.quantity);
  const remaining = Number(item.remaining_quantity);
  const paid = Number(item.paid_line_cents);
  const alreadyReturned = Number(item.already_returned_cents);
  return remaining === 1 ? paid - alreadyReturned : Math.floor(paid / sold);
}

export function selectedReturnValue(
  item: ReturnableSaleItem,
  quantity: number,
) {
  const sold = Number(item.quantity);
  const remaining = Number(item.remaining_quantity);
  const paid = Number(item.paid_line_cents);
  const alreadyReturned = Number(item.already_returned_cents);
  return quantity === remaining
    ? paid - alreadyReturned
    : Math.floor((paid * quantity) / sold);
}
