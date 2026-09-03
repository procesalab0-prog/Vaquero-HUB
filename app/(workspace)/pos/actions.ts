"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";

export type SalePaymentInput = {
  method_code: "CASH" | "CARD" | "TRANSFER";
  amount_cents: number;
  tendered_cents?: number;
  reference?: string;
};

export type SaleActionInput = {
  idempotencyKey: string;
  cashSessionId: string;
  items: Array<{ variant_id: string; quantity: number; gift_receipt: boolean }>;
  payments: SalePaymentInput[];
  customerId?: string | null;
  discount?: {
    percent: number;
    authorizationToken: string;
  } | null;
};

export type SaleActionResult =
  | { ok: true; saleId: string; folio: string; soldAt: string; totalCents: number; receipt: Record<string, unknown> | null }
  | { ok: false; code: string; message: string };

function saleError(error: unknown): SaleActionResult {
  const raw = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const definitions: Array<[string, string]> = [
    ["INSUFFICIENT_STOCK", "La existencia cambió. Revisa el carrito antes de cobrar."],
    ["SESSION_FORBIDDEN", "Abre tu caja antes de registrar una venta."],
    ["VARIANT_NOT_SELLABLE", "Uno de los artículos ya no está disponible para venta."],
    ["PAYMENT_TOTAL_MISMATCH", "Los pagos no coinciden con el total de la venta."],
    ["PAYMENT_REFERENCE_REQUIRED", "Captura la referencia del pago electrónico."],
    ["DISCOUNT_AUTHORIZATION_INVALID", "La autorización del descuento venció. Solicítala otra vez."],
    ["IDEMPOTENCY_CONFLICT", "La solicitud de venta cambió. Vuelve a intentar el cobro."],
  ];
  const match = definitions.find(([code]) => raw.includes(code));
  return {
    ok: false,
    code: match?.[0] ?? "SALE_FAILED",
    message: match?.[1] ?? "No fue posible registrar la venta. No se realizó ningún cargo ni movimiento.",
  };
}

export async function authorizeSaleDiscount(input: {
  employeeCode: string;
  pin: string;
}): Promise<
  | { ok: true; authorizationToken: string; expiresAt: string }
  | { ok: false; message: string }
> {
  try {
    const { supabase } = await requirePermission("pos.sell");
    const { data, error } = await supabase.rpc("verify_supervisor_pin", {
      p_employee_code: input.employeeCode.trim(),
      p_pin: input.pin,
      p_permission: "sales.discount",
    });
    if (error) throw error;
    const result = data as {
      status?: string;
      authorization_token?: string;
      expires_at?: string;
    } | null;
    if (result?.status !== "AUTHORIZED" || !result.authorization_token) {
      const message =
        result?.status === "PIN_LOCKED"
          ? "El PIN está bloqueado temporalmente por intentos fallidos."
          : result?.status === "INSUFFICIENT_PERMISSION"
            ? "Ese empleado no puede autorizar descuentos en esta sucursal."
            : "Código o PIN de supervisor incorrecto.";
      return { ok: false, message };
    }
    return {
      ok: true,
      authorizationToken: result.authorization_token,
      expiresAt: result.expires_at ?? "",
    };
  } catch {
    return { ok: false, message: "No fue posible validar la autorización." };
  }
}

export async function createPosSale(input: SaleActionInput): Promise<SaleActionResult> {
  try {
    const { supabase } = await requirePermission("pos.sell");
    if (
      !input.idempotencyKey ||
      !input.cashSessionId ||
      input.items.length < 1 ||
      input.items.length > 100 ||
      input.payments.length < 1 ||
      input.payments.some((payment) => !Number.isSafeInteger(payment.amount_cents) || payment.amount_cents <= 0)
    ) {
      return { ok: false, code: "INVALID_SALE", message: "Revisa artículos y formas de pago." };
    }

    const discounts = input.discount
      ? [
          {
            scope: "TICKET",
            type: "PERCENT",
            value: input.discount.percent,
            authorization_token: input.discount.authorizationToken,
            reason: "Descuento autorizado en punto de venta",
          },
        ]
      : [];
    const { data, error } = await supabase.rpc("create_sale", {
      p_idempotency_key: input.idempotencyKey,
      p_cash_session_id: input.cashSessionId,
      p_items: input.items,
      p_payments: input.payments,
      p_customer_id: input.customerId ?? null,
      p_discounts: discounts,
      p_notes: null,
    });
    if (error) throw error;
    const sale = data as {
      id: string;
      folio: string;
      sold_at: string;
      total_cents: number;
    };
    const receiptResult = await supabase.rpc("get_sale_receipt", { p_sale_id: sale.id });
    revalidatePath("/pos");
    revalidatePath("/caja");
    revalidatePath("/inventario");
    return {
      ok: true,
      saleId: sale.id,
      folio: sale.folio,
      soldAt: sale.sold_at,
      totalCents: Number(sale.total_cents),
      receipt: receiptResult.error ? null : (receiptResult.data as Record<string, unknown>),
    };
  } catch (error) {
    console.error("[pos/createSale] failed", {
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return saleError(error);
  }
}

export async function requestSalePrint(saleId: string, mode: "sale" | "gift") {
  try {
    const { supabase } = await requirePermission("pos.sell");
    const { error } = await supabase.rpc("request_sale_print", {
      p_sale_id: saleId,
      p_document_type: mode === "gift" ? "GIFT_RECEIPT" : "SALE_RECEIPT",
    });
    if (error) throw error;
    return { ok: true as const };
  } catch {
    return { ok: false as const, message: "No fue posible registrar la impresión. Intenta nuevamente." };
  }
}
