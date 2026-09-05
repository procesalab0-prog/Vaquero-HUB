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
  | {
      ok: true;
      saleId: string;
      folio: string;
      soldAt: string;
      totalCents: number;
      receipt: Record<string, unknown> | null;
    }
  | { ok: false; code: string; message: string };

export type CancelSaleActionResult =
  { ok: true; folio: string } | { ok: false; code: string; message: string };

export type PosDraftItemInput = {
  variant_id: string;
  quantity: number;
  gift_receipt: boolean;
};

export type PosDraftPayload = {
  id: string;
  status: "CURRENT" | "HELD";
  label: string | null;
  items: PosDraftItemInput[];
  discount_percent: number;
  held_at: string | null;
  updated_at: string;
  customer: {
    id: string;
    member_number: string;
    full_name: string;
    phone_e164: string;
    email: string | null;
  } | null;
};

type PosDraftActionResult =
  | { ok: true; draftId?: string; draft?: PosDraftPayload }
  | { ok: false; message: string };

function saleError(error: unknown): SaleActionResult {
  const raw = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const definitions: Array<[string, string]> = [
    [
      "INSUFFICIENT_STOCK",
      "La existencia cambió. Revisa el carrito antes de cobrar.",
    ],
    ["SESSION_FORBIDDEN", "Abre tu caja antes de registrar una venta."],
    [
      "VARIANT_NOT_SELLABLE",
      "Uno de los artículos ya no está disponible para venta.",
    ],
    [
      "PAYMENT_TOTAL_MISMATCH",
      "Los pagos no coinciden con el total de la venta.",
    ],
    [
      "PAYMENT_REFERENCE_REQUIRED",
      "Captura la referencia del pago electrónico.",
    ],
    [
      "DISCOUNT_AUTHORIZATION_INVALID",
      "La autorización del descuento venció. Solicítala otra vez.",
    ],
    [
      "IDEMPOTENCY_CONFLICT",
      "La solicitud de venta cambió. Vuelve a intentar el cobro.",
    ],
  ];
  const match = definitions.find(([code]) => raw.includes(code));
  return {
    ok: false,
    code: match?.[0] ?? "SALE_FAILED",
    message:
      match?.[1] ??
      "No fue posible registrar la venta. No se realizó ningún cargo ni movimiento.",
  };
}

function draftError(error: unknown): PosDraftActionResult {
  const raw = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const message = raw.includes("CURRENT_DRAFT_NOT_EMPTY")
    ? "Guarda o vacía la venta actual antes de recuperar otra."
    : raw.includes("DRAFT_ITEMS_UNAVAILABLE")
      ? "Ese ticket contiene artículos que ya no están disponibles para venta."
      : raw.includes("DRAFT_NOT_FOUND")
        ? "Ese ticket en espera ya no está disponible."
        : raw.includes("SESSION_FORBIDDEN")
          ? "La caja cambió o ya fue cerrada."
          : "No fue posible guardar el carrito. Intenta nuevamente.";
  return { ok: false, message };
}

export async function savePosCurrentDraft(input: {
  cashSessionId: string;
  items: PosDraftItemInput[];
  customerId?: string | null;
  discountPercent?: number;
}): Promise<PosDraftActionResult> {
  try {
    const { supabase } = await requirePermission("pos.sell");
    const { data, error } = await supabase.rpc("save_pos_current_draft", {
      p_cash_session_id: input.cashSessionId,
      p_items: input.items,
      p_customer_id: input.customerId ?? null,
      p_discount_percent: input.discountPercent ?? 0,
    });
    if (error) throw error;
    return { ok: true, draftId: (data as string | null) ?? undefined };
  } catch (error) {
    return draftError(error);
  }
}

export async function holdPosDraft(input: {
  cashSessionId: string;
  items: PosDraftItemInput[];
  customerId?: string | null;
  discountPercent?: number;
  label?: string;
}): Promise<PosDraftActionResult> {
  try {
    const { supabase } = await requirePermission("pos.sell");
    const { data, error } = await supabase.rpc("hold_pos_draft", {
      p_cash_session_id: input.cashSessionId,
      p_items: input.items,
      p_customer_id: input.customerId ?? null,
      p_discount_percent: input.discountPercent ?? 0,
      p_label: input.label?.trim() || null,
    });
    if (error) throw error;
    revalidatePath("/pos");
    return { ok: true, draftId: data as string };
  } catch (error) {
    return draftError(error);
  }
}

export async function resumePosDraft(
  draftId: string,
): Promise<PosDraftActionResult> {
  try {
    const { supabase } = await requirePermission("pos.sell");
    const { data, error } = await supabase.rpc("resume_pos_draft", {
      p_draft_id: draftId,
    });
    if (error) throw error;
    revalidatePath("/pos");
    return { ok: true, draft: data as PosDraftPayload };
  } catch (error) {
    return draftError(error);
  }
}

export async function discardPosDraft(
  draftId: string,
): Promise<PosDraftActionResult> {
  try {
    const { supabase } = await requirePermission("pos.sell");
    const { error } = await supabase.rpc("discard_pos_draft", {
      p_draft_id: draftId,
    });
    if (error) throw error;
    revalidatePath("/pos");
    return { ok: true };
  } catch (error) {
    return draftError(error);
  }
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

export async function createPosSale(
  input: SaleActionInput,
): Promise<SaleActionResult> {
  try {
    const { supabase } = await requirePermission("pos.sell");
    if (
      !input.idempotencyKey ||
      !input.cashSessionId ||
      input.items.length < 1 ||
      input.items.length > 100 ||
      input.payments.length < 1 ||
      input.payments.some(
        (payment) =>
          !Number.isSafeInteger(payment.amount_cents) ||
          payment.amount_cents <= 0,
      )
    ) {
      return {
        ok: false,
        code: "INVALID_SALE",
        message: "Revisa artículos y formas de pago.",
      };
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
    const receiptResult = await supabase.rpc("get_sale_receipt", {
      p_sale_id: sale.id,
    });
    revalidatePath("/pos");
    revalidatePath("/caja");
    revalidatePath("/inventario");
    return {
      ok: true,
      saleId: sale.id,
      folio: sale.folio,
      soldAt: sale.sold_at,
      totalCents: Number(sale.total_cents),
      receipt: receiptResult.error
        ? null
        : (receiptResult.data as Record<string, unknown>),
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
    return {
      ok: false as const,
      message: "No fue posible registrar la impresión. Intenta nuevamente.",
    };
  }
}

export async function cancelPosSale(
  saleId: string,
  reason: string,
): Promise<CancelSaleActionResult> {
  try {
    const { supabase } = await requirePermission("sales.cancel");
    if (!saleId || reason.trim().length < 3 || reason.trim().length > 500) {
      return {
        ok: false,
        code: "INVALID_REASON",
        message: "Escribe un motivo de entre 3 y 500 caracteres.",
      };
    }
    const { data, error } = await supabase.rpc("cancel_sale", {
      p_sale_id: saleId,
      p_reason: reason.trim(),
    });
    if (error) throw error;
    const result = data as { folio?: string } | null;
    revalidatePath("/pos");
    revalidatePath("/caja");
    revalidatePath("/inventario");
    revalidatePath("/tickets");
    return { ok: true, folio: result?.folio ?? "" };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const definitions: Array<[string, string]> = [
      [
        "SALE_SESSION_CLOSED",
        "La caja original ya cerró. Esta operación debe registrarse como devolución.",
      ],
      [
        "SALE_NOT_CANCELLABLE",
        "La venta ya fue cancelada o no admite cancelación.",
      ],
      [
        "SALE_NOT_FOUND",
        "No encontramos esa venta en una sucursal autorizada.",
      ],
      ["NOT_AUTHORIZED", "Tu cuenta no tiene permiso para cancelar ventas."],
    ];
    const match = definitions.find(([code]) => raw.includes(code));
    console.error("[pos/cancelSale] failed", {
      code: match?.[0] ?? "CANCELLATION_FAILED",
    });
    return {
      ok: false,
      code: match?.[0] ?? "CANCELLATION_FAILED",
      message:
        match?.[1] ??
        "No fue posible cancelar la venta. No se modificó inventario ni caja.",
    };
  }
}
