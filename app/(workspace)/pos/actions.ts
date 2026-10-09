"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import { posScanError, type PosScanResult } from "@/lib/pos-scan";
import type { ProductVariant } from "@/lib/domain";

export async function resolvePosScan(input: { code: string; cashSessionId: string }): Promise<PosScanResult> {
  try {
    const code = typeof input.code === "string" ? input.code.trim() : "";
    if (!code || code.length > 100) return { ok: false, message: "Revisa el código escaneado." };
    const { supabase } = await requirePermission("pos.sell");
    const { data, error } = await supabase.rpc("resolve_pos_scan", { p_cash_session_id: input.cashSessionId, p_code: code });
    if (error || !data) {
      const message = error?.message ?? "";
      return { ok: false, message: posScanError(message) };
    }
    return { ok: true, variant: data as ProductVariant };
  } catch { return { ok: false, message: "No fue posible consultar el código. Revisa tu sesión e inténtalo nuevamente." }; }
}

export type SalePaymentInput = {
  method_code: "CASH" | "CARD" | "TRANSFER" | "CREDIT" | "LOYALTY" | "USD";
  amount_cents: number;
  tendered_cents?: number;
  reference?: string;
  card_kind?: "CREDIT" | "DEBIT";
};

export type SaleActionInput = {
  usd?: import("@/components/usd-checkout").UsdTenderInput;
  idempotencyKey: string;
  cashSessionId: string;
  items: import("@/lib/quick-product").PosItemInput[];
  payments: SalePaymentInput[];
  customerId?: string | null;
  quoteId?: string | null;
  discount?: {
    percent: number;
    authorizationToken: string;
  } | null;
  creditDueDate?: string | null;
  creditOverrideAuthorizationToken?: string | null;
  creditOverrideReason?: string | null;
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

export type CreateLayawayResult =
  | { ok: true; layawayId: string; folio: string; totalCents: number }
  | { ok: false; code: string; message: string };

export type LoyaltyRedemptionResult =
  | {
      ok: true;
      token: string;
      points: number;
      valueCents: number;
      availablePoints: number;
      expiresAt: string;
    }
  | { ok: false; code: string; message: string };

export type PosDraftItemInput = import("@/lib/quick-product").PosItemInput;

export type PosDraftPayload = {
  id: string;
  status: "CURRENT" | "HELD";
  label: string | null;
  items: PosDraftItemInput[];
  discount_percent: number;
  quote_id?: string | null;
  quote_pricing?: import("@/lib/quote-pos").QuotePosPricing | null;
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

function databaseErrorText(error: unknown) {
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

function saleError(error: unknown): SaleActionResult {
  const raw = databaseErrorText(error);
  const definitions: Array<[string, string]> = [
    ['USD_CHECKOUT_NOT_ENABLED','El cobro en dólares todavía no está habilitado.'],
    ['FX_QUOTE_EXPIRED','La tasa venció. Actualízala antes de cobrar.'],
    ['FX_QUOTE_ALREADY_USED','Esta tasa ya se usó en otro ticket. Actualízala.'],
    ['INSUFFICIENT_CASH','No hay suficientes pesos en el cajón para entregar el cambio.'],
    ["INVALID_QUICK_ITEM", "Revisa nombre, cantidad entera y precio del producto rápido."],
    ["QUICK_COST_FORBIDDEN", "Sólo administración o gerencia puede registrar el costo del producto rápido."],
    ["INVALID_MEASURE_QUANTITY", "Revisa la cantidad y la unidad del producto. No se redondean cantidades de piezas."],
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
      "LOYALTY_CODE_REQUIRED",
      "Vuelve a validar el código de puntos antes de cobrar.",
    ],
    [
      "LOYALTY_CODE_INVALID",
      "El código de puntos ya no es válido. Genera uno nuevo.",
    ],
    [
      "LOYALTY_CODE_EXPIRED",
      "El código de puntos venció. Genera uno nuevo.",
    ],
    [
      "LOYALTY_POINTS_CHANGED",
      "El saldo de puntos cambió. Vuelve a validar el canje.",
    ],
    [
      "LOYALTY_PAYMENT_MISMATCH",
      "El valor del canje cambió. Vuelve a validar el código.",
    ],
    [
      "DISCOUNT_AUTHORIZATION_INVALID",
      "La autorización del descuento venció. Solicítala otra vez.",
    ],
    [
      "IDEMPOTENCY_CONFLICT",
      "La solicitud de venta cambió. Vuelve a intentar el cobro.",
    ],
    ["QUOTE_EXPIRED", "La cotización venció. Crea una nueva antes de cobrar."],
    [
      "QUOTE_NOT_CONVERTIBLE",
      "Esta cotización ya fue cobrada o ya no está disponible.",
    ],
    [
      "QUOTE_PRICE_OR_PRODUCT_CHANGED",
      "Cambió el precio o la disponibilidad de un artículo. Crea una cotización actualizada.",
    ],
    ["QUOTE_LOCATION_MISMATCH", "La cotización pertenece a otra sucursal."],
    ["CREDIT_NOT_AUTHORIZED", "Este cliente no tiene crédito autorizado."],
    [
      "CREDIT_LIMIT_EXCEEDED",
      "El importe supera el crédito disponible del cliente.",
    ],
    [
      "CREDIT_OVERDUE",
      "El cliente tiene un saldo vencido y no puede usar más crédito.",
    ],
    [
      "CREDIT_OVERDUE_OVERRIDE_REQUIRED",
      "La autorización administrativa venció o ya fue utilizada. Solicítala nuevamente.",
    ],
    [
      "CREDIT_OVERRIDE_NOT_REQUIRED",
      "El cliente ya no tiene saldo vencido. Actualiza sus datos y vuelve a cobrar.",
    ],
    [
      "INVALID_CREDIT_SALE",
      "Selecciona un cliente y una fecha de vencimiento válida.",
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

export async function verifyPosLoyaltyCode(input: {
  customerId: string;
  code: string;
  maxValueCents: number;
}): Promise<LoyaltyRedemptionResult> {
  try {
    const { supabase } = await requirePermission("loyalty.redeem");
    if (
      !input.customerId ||
      !/^\d{6}$/.test(input.code) ||
      !Number.isSafeInteger(input.maxValueCents) ||
      input.maxValueCents <= 0
    ) {
      return {
        ok: false,
        code: "INVALID_CODE",
        message: "Captura los seis dígitos del código del cliente.",
      };
    }
    const { data, error } = await supabase.rpc(
      "verify_loyalty_redemption_code",
      {
        p_customer_id: input.customerId,
        p_code: input.code,
        p_max_value_cents: input.maxValueCents,
      },
    );
    if (error) throw error;
    const result = data as {
      ok?: boolean;
      code?: string;
      token?: string;
      points?: number;
      value_cents?: number;
      available_points?: number;
      expires_at?: string;
      attempts_remaining?: number;
    } | null;
    if (!result?.ok || !result.token) {
      const messages: Record<string, string> = {
        NOT_ACTIVE: "El programa de puntos todavía no está activo.",
        NOT_FOUND: "El cliente no tiene un código activo.",
        EXPIRED: "El código venció. Pide al cliente que genere uno nuevo.",
        LOCKED:
          "El código quedó bloqueado por intentos fallidos. Genera uno nuevo.",
        POINTS_CHANGED:
          "El saldo de puntos cambió. Pide al cliente que genere otro código.",
        VALUE_EXCEEDS_SALE:
          "El valor de los puntos supera el total de esta venta.",
        INVALID_CODE:
          result?.attempts_remaining === undefined
            ? "El código no es válido."
            : `Código incorrecto. Quedan ${result.attempts_remaining} intentos.`,
      };
      return {
        ok: false,
        code: result?.code ?? "INVALID_CODE",
        message:
          messages[result?.code ?? "INVALID_CODE"] ??
          "No fue posible validar el código de puntos.",
      };
    }
    return {
      ok: true,
      token: result.token,
      points: Number(result.points ?? 0),
      valueCents: Number(result.value_cents ?? 0),
      availablePoints: Number(result.available_points ?? 0),
      expiresAt: result.expires_at ?? "",
    };
  } catch (error) {
    console.error("[pos/verifyLoyaltyCode] failed", {
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return {
      ok: false,
      code: "LOYALTY_UNAVAILABLE",
      message: "No fue posible validar los puntos. Intenta nuevamente.",
    };
  }
}

function draftError(error: unknown): PosDraftActionResult {
  const raw = databaseErrorText(error);
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

export async function createLayawayFromCart(input: {
  idempotencyKey: string;
  cashSessionId: string;
  customerId: string;
  dueDate: string;
  items: Array<{ variant_id: string; quantity: number }>;
  notes?: string;
}): Promise<CreateLayawayResult> {
  try {
    if (
      !input.idempotencyKey ||
      !input.cashSessionId ||
      !input.customerId ||
      !input.dueDate ||
      input.items.length < 1 ||
      input.items.length > 100
    ) {
      return {
        ok: false,
        code: "INVALID_LAYAWAY",
        message: "Selecciona cliente, fecha y al menos un artículo.",
      };
    }
    const { supabase } = await requirePermission("layaways.manage");
    const { data, error } = await supabase.rpc("create_layaway", {
      p_idempotency_key: input.idempotencyKey,
      p_cash_session_id: input.cashSessionId,
      p_customer_id: input.customerId,
      p_due_date: input.dueDate,
      p_items: input.items,
      p_notes: input.notes?.trim() || null,
    });
    if (error) throw error;
    const result = data as { id: string; folio: string; total_cents: number };
    revalidatePath("/pos");
    revalidatePath("/inventario");
    revalidatePath("/apartados");
    return {
      ok: true,
      layawayId: result.id,
      folio: result.folio,
      totalCents: Number(result.total_cents),
    };
  } catch (error) {
    const raw = databaseErrorText(error);
    const definitions: Array<[string, string]> = [
      ["INSUFFICIENT_STOCK", "La existencia cambió. Revisa el carrito antes de apartar."],
      ["SESSION_FORBIDDEN", "Abre tu caja antes de crear el apartado."],
      ["CUSTOMER_NOT_FOUND", "El cliente ya no está disponible."],
      ["VARIANT_NOT_SELLABLE", "Uno de los artículos ya no está disponible."],
      ["IDEMPOTENCY_CONFLICT", "El apartado cambió. Cierra esta ventana y vuelve a intentarlo."],
    ];
    const match = definitions.find(([code]) => raw.includes(code)) ?? [
      "LAYAWAY_FAILED",
      "No fue posible crear el apartado. No se reservó mercancía.",
    ] as const;
    return { ok: false, code: match[0], message: match[1] };
  }
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
    const draft = data as PosDraftPayload;
    if (draft?.id) {
      const { data: session, error: sessionError } = await supabase.rpc("get_my_cash_session");
      if (sessionError) throw sessionError;
      const sessionId = (session as { id?: string } | null)?.id;
      if (sessionId) {
        const { data: drafts, error: draftsError } = await supabase.rpc("list_my_pos_drafts", { p_cash_session_id: sessionId });
        if (draftsError) throw draftsError;
        return { ok: true, draft: (drafts as PosDraftPayload[]).find(item => item.id === draft.id) ?? draft };
      }
    }
    return { ok: true, draft };
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

export async function authorizeOverdueCredit(input: {
  employeeCode: string;
  pin: string;
}): Promise<
  | { ok: true; authorizationToken: string; expiresAt: string }
  | { ok: false; message: string }
> {
  try {
    const { supabase } = await requirePermission("credit.sell");
    const { data, error } = await supabase.rpc("verify_supervisor_pin", {
      p_employee_code: input.employeeCode.trim(),
      p_pin: input.pin,
      p_permission: "credit.override",
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
            ? "Sólo un administrador autorizado puede permitir esta venta."
            : "Código o PIN de administrador incorrecto.";
      return { ok: false, message };
    }
    return {
      ok: true,
      authorizationToken: result.authorization_token,
      expiresAt: result.expires_at ?? "",
    };
  } catch {
    return {
      ok: false,
      message: "No fue posible validar la excepción administrativa.",
    };
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
    if (input.quoteId && discounts.length > 0) {
      return {
        ok: false,
        code: "QUOTE_DISCOUNT_NOT_ALLOWED",
        message:
          "La cotización conserva su total. Crea otra si necesitas aplicar un descuento.",
      };
    }
    const hasCredit = input.payments.some(
      (payment) => payment.method_code === "CREDIT",
    );
    if (input.quoteId && hasCredit) {
      return {
        ok: false,
        code: "QUOTE_CREDIT_NOT_AVAILABLE",
        message:
          "Por ahora crea la venta a crédito desde el carrito, no desde una cotización.",
      };
    }
    if ((!input.usd && input.payments.some(p=>p.method_code==='USD')) || (input.usd && (input.quoteId || hasCredit || input.payments.some(p=>p.method_code==='LOYALTY') || !Number.isSafeInteger(input.usd.receivedUsdCents) || input.usd.receivedUsdCents<=0 || input.payments.filter(p=>p.method_code==='USD').length!==1))) {
      return {ok:false,code:'INVALID_USD_PAYMENT',message:'Dólares no se combina por ahora con cotización, crédito o puntos. Revisa el importe recibido.'};
    }
    const { data, error } = input.usd
      ? await supabase.rpc('create_usd_sale', {p_idempotency_key:input.idempotencyKey,p_cash_session_id:input.cashSessionId,p_items:input.items,p_quote_id:input.usd.quoteId,p_received_usd_cents:input.usd.receivedUsdCents,p_applied_mxn_cents:input.payments.find(p=>p.method_code==='USD')!.amount_cents,p_other_payments:input.payments.filter(p=>p.method_code!=='USD'),p_customer_id:input.customerId??null,p_discounts:discounts,p_notes:null})
      : input.quoteId
      ? await supabase.rpc("convert_quote_to_sale", {
          p_quote_id: input.quoteId,
          p_idempotency_key: input.idempotencyKey,
          p_cash_session_id: input.cashSessionId,
          p_payments: input.payments,
        })
      : hasCredit && input.creditOverrideAuthorizationToken
        ? await supabase.rpc("create_overdue_credit_sale", {
            p_idempotency_key: input.idempotencyKey,
            p_cash_session_id: input.cashSessionId,
            p_items: input.items,
            p_payments: input.payments,
            p_customer_id: input.customerId ?? null,
            p_due_date: input.creditDueDate ?? null,
            p_overdue_authorization_token:
              input.creditOverrideAuthorizationToken,
            p_override_reason: input.creditOverrideReason ?? null,
            p_discounts: discounts,
            p_notes: null,
          })
        : hasCredit
          ? await supabase.rpc("create_credit_sale", {
              p_idempotency_key: input.idempotencyKey,
              p_cash_session_id: input.cashSessionId,
              p_items: input.items,
              p_payments: input.payments,
              p_customer_id: input.customerId ?? null,
              p_due_date: input.creditDueDate ?? null,
              p_discounts: discounts,
              p_notes: null,
            })
          : await supabase.rpc("create_sale", {
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
    revalidatePath("/cotizaciones");
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

export async function getPosCustomerCredit(customerId: string) {
  try {
    const { supabase } = await requirePermission("pos.sell");
    const { data, error } = await supabase.rpc("get_customer_credit_summary", {
      p_customer_id: customerId,
    });
    if (error) throw error;
    return {
      ok: true as const,
      summary: data as {
        is_authorized: boolean;
        limit_cents: number;
        balance_cents: number;
        available_cents: number;
        oldest_due_date: string | null;
        has_overdue: boolean;
      },
    };
  } catch {
    return {
      ok: false as const,
      message: "No fue posible consultar el crédito del cliente.",
    };
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
        "CREDIT_CANCELLATION_REQUIRES_RETURN",
        "La venta tiene crédito o abonos. Registra la operación como devolución para reducir primero la deuda y reembolsar sólo lo pagado.",
      ],
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
