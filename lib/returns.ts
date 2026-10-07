import {parseMeasureQuantity,quantityUnit,type MeasureUnit} from './measure-units';
export type ReturnableSaleItem = {
  measureUnit?: MeasureUnit;
  sale_item_id: string;
  variant_id: string | null;
  product_name: string;
  variant_description: string;
  sku: string | null;
  quantity: number;
  remaining_quantity: number;
  paid_line_cents: number;
  already_returned_cents: number;
};

export type OriginalPayment = {
  method_code: "CASH" | "CARD" | "TRANSFER" | "USD";
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
  credit_outstanding_cents: number;
  payments: OriginalPayment[];
  items: ReturnableSaleItem[];
};

export type ExchangeVariant = {
  measureUnit?: MeasureUnit;
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
      creditSettlement?: {
        debtReductionCents: number;
        paidRefundCents: number;
      };
    }
  | { ok: false; message: string };

export type ReturnAuthorizationResult =
  | { ok: true; authorizationToken: string; expiresAt: string }
  | { ok: false; message: string };

export type CancelCreditSaleResult =
  | {
      ok: true;
      saleFolio: string;
      returnFolio: string;
      debtReductionCents: number;
      paidRefundCents: number;
    }
  | { ok: false; message: string };

export function databaseErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error ?? "UNKNOWN_ERROR");
}

export function unitExchangeValue(item: ReturnableSaleItem) {
  return selectedReturnValue(item,Math.min(1,Number(item.remaining_quantity)));
}

export function selectedReturnValue(
  item: ReturnableSaleItem,
  quantity: number,
) {
  const sold = Math.round(Number(item.quantity)*1000);
  const remaining = Math.round(Number(item.remaining_quantity)*1000);
  const requested=Math.round(quantity*1000);
  const paid = Number(item.paid_line_cents);
  const alreadyReturned = Number(item.already_returned_cents);
  if(parseMeasureQuantity(String(quantity),quantityUnit(item))===null||requested>remaining||!Number.isSafeInteger(sold)||sold<=0||!Number.isSafeInteger(paid)) return 0;
  return requested === remaining
    ? paid - alreadyReturned
    : Number(BigInt(paid)*BigInt(requested)/BigInt(sold));
}
