"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import { databaseErrorText } from "@/lib/returns";
import type {
  CreateExchangeResult,
  ExchangeSearchResult,
  ExchangeVariant,
  PrepareExchangeResult,
  ReturnAuthorizationResult,
  ReturnableSale,
} from "@/lib/returns";
import type { Ticket } from "./tickets-real-workspace";

type CashSession = { id?: string; location_id?: string } | null;
type ExchangeVariantRow = {
  variant_id: string;
  product_name: string;
  brand_name: string | null;
  sku: string;
  price_cents: number;
  attributes: Record<string, string> | null;
  available_qty: number;
};

export async function findTicketByCode(input: {
  locationId: string;
  code: string;
}): Promise<{ ok: true; ticket: Ticket } | { ok: false; message: string }> {
  try {
    const code = input.code.trim().toLocaleUpperCase("es-MX").slice(0, 100);
    if (!code)
      return { ok: false, message: "Escanea o escribe un folio válido." };
    const { supabase } = await requirePermission("returns.create");
    const { data, error } = await supabase.rpc("get_sale_ticket_by_folio", {
      p_location_id: input.locationId,
      p_folio: code,
    });
    if (error) throw error;
    const ticket = data as Ticket | null;
    return ticket
      ? { ok: true, ticket }
      : { ok: false, message: "No encontramos ese ticket en esta sucursal." };
  } catch {
    return { ok: false, message: "No fue posible consultar el ticket." };
  }
}

function exchangeMessage(error: unknown) {
  const raw = databaseErrorText(error);
  const messages: Array<[string, string]> = [
    ["RETURN_EXCEEDS_SOLD", "Ese artículo ya fue cambiado o devuelto."],
    [
      "CREDIT_RETURN_REQUIRES_DEBT_SETTLEMENT",
      "Esta venta tiene saldo a crédito. La devolución debe aplicarse primero a la deuda; esa operación se habilitará en el siguiente avance de M7.",
    ],
    ["INSUFFICIENT_STOCK", "La existencia cambió. Elige otro artículo."],
    [
      "INSUFFICIENT_CASH",
      "No hay suficiente efectivo en esta caja para devolverlo. Usa el método original disponible o solicita un ingreso autorizado.",
    ],
    [
      "EXCHANGE_PRICE_DIFFERENCE_UNSUPPORTED",
      "Por ahora el cambio debe ser por el mismo importe.",
    ],
    ["SALE_NOT_RETURNABLE", "La venta ya no admite cambios."],
    [
      "RETURN_WINDOW_EXPIRED",
      "El plazo configurado para cambios y devoluciones ya terminó.",
    ],
    [
      "RETURN_AUTHORIZATION_REQUIRED",
      "Solicita de nuevo la autorización del gerente.",
    ],
    [
      "REFUND_REFERENCE_REQUIRED",
      "Captura la referencia de devolución de tarjeta o transferencia.",
    ],
    [
      "REFUND_EXCEEDS_ORIGINAL_PAYMENT",
      "La devolución supera lo que queda pagado en el ticket.",
    ],
    [
      "RETURN_PAYMENT_TOTAL_MISMATCH",
      "Los pagos no coinciden con la diferencia del cambio.",
    ],
    ["INVALID_PAYMENT", "Revisa el importe y la referencia del cobro."],
    ["SALE_NOT_FOUND", "No encontramos ese ticket en tu sucursal."],
    [
      "SESSION_FORBIDDEN",
      "Abre una caja en la misma sucursal antes de registrar el cambio.",
    ],
    ["VARIANT_NOT_SELLABLE", "El artículo nuevo ya no está disponible."],
    [
      "IDEMPOTENCY_CONFLICT",
      "La selección cambió. Cierra y vuelve a abrir el cambio.",
    ],
    ["NOT_AUTHORIZED", "No tienes permiso para registrar cambios."],
  ];
  return (
    messages.find(([code]) => raw.includes(code))?.[1] ??
    "No fue posible registrar el cambio. El inventario no se modificó."
  );
}

export async function prepareEqualExchange(
  saleId: string,
): Promise<PrepareExchangeResult> {
  try {
    const { supabase } = await requirePermission("returns.create");
    const [saleResult, sessionResult] = await Promise.all([
      supabase.rpc("get_returnable_sale", { p_sale_id: saleId }),
      supabase.rpc("get_my_cash_session"),
    ]);
    if (saleResult.error) throw saleResult.error;
    if (sessionResult.error) throw sessionResult.error;
    const sale = saleResult.data as ReturnableSale;
    const session = sessionResult.data as CashSession;
    if (!session?.id || !session.location_id) {
      return {
        ok: false,
        message: "Abre una caja antes de registrar un cambio.",
      };
    }
    if (session.location_id !== sale.location_id) {
      return {
        ok: false,
        message:
          "La caja abierta debe pertenecer a la misma sucursal del ticket.",
      };
    }
    return { ok: true, sale, cashSessionId: session.id };
  } catch (error) {
    return { ok: false, message: exchangeMessage(error) };
  }
}

export async function searchEqualExchangeVariants(input: {
  query: string;
  priceCents: number;
  excludeVariantId: string;
}): Promise<ExchangeSearchResult> {
  try {
    if (!Number.isSafeInteger(input.priceCents) || input.priceCents < 0) {
      return { ok: false, message: "El importe del artículo no es válido." };
    }
    const { supabase } = await requirePermission("returns.create");
    const query = input.query.trim().slice(0, 120);
    const { data, error } = await supabase.rpc("search_exchange_variants", {
      p_exclude_variant_id: input.excludeVariantId,
      p_query: query,
      p_limit: 50,
    });
    if (error) throw error;
    const variants = ((data ?? []) as ExchangeVariantRow[]).map(
      (row): ExchangeVariant => ({
        id: row.variant_id,
        productName: row.product_name,
        brand: row.brand_name ?? "",
        sku: row.sku,
        color: row.attributes?.COLOR ?? "Sin color",
        size: row.attributes?.TALLA ?? "Única",
        priceCents: Number(row.price_cents),
        stock: Number(row.available_qty),
      }),
    );
    return { ok: true, variants };
  } catch (error) {
    return { ok: false, message: exchangeMessage(error) };
  }
}

export async function authorizeReturn(input: {
  employeeCode: string;
  pin: string;
}): Promise<ReturnAuthorizationResult> {
  try {
    const { supabase } = await requirePermission("returns.create");
    const { data, error } = await supabase.rpc("verify_supervisor_pin", {
      p_employee_code: input.employeeCode.trim(),
      p_pin: input.pin,
      p_permission: "returns.authorize",
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
          ? "El PIN quedó bloqueado 15 minutos por intentos fallidos."
          : result?.status === "INSUFFICIENT_PERMISSION"
            ? "Ese empleado no es gerente o no puede autorizar en esta sucursal."
            : "Código o PIN de gerente incorrecto.";
      return { ok: false, message };
    }
    return {
      ok: true,
      authorizationToken: result.authorization_token,
      expiresAt: result.expires_at ?? "",
    };
  } catch {
    return { ok: false, message: "No fue posible validar al gerente." };
  }
}

export async function createReturnExchange(input: {
  idempotencyKey: string;
  cashSessionId: string;
  originalSaleId: string;
  saleItemId: string;
  quantity: number;
  condition: "RESELLABLE" | "DAMAGED";
  outputVariantId?: string | null;
  chargePayments: Array<{
    method_code: "CASH" | "CARD" | "TRANSFER";
    amount_cents: number;
    reference?: string;
  }>;
  refundReferences: Array<{ method_code: string; reference: string }>;
  authorizationToken: string;
  reason: string;
}): Promise<CreateExchangeResult> {
  try {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
      return { ok: false, message: "Selecciona una cantidad válida." };
    }
    if (input.reason.trim().length < 3 || input.reason.trim().length > 500) {
      return {
        ok: false,
        message: "Escribe un motivo de al menos 3 caracteres.",
      };
    }
    const { supabase } = await requirePermission("returns.create");
    const { data, error } = await supabase.rpc("create_return_exchange", {
      p_idempotency_key: input.idempotencyKey,
      p_cash_session_id: input.cashSessionId,
      p_original_sale_id: input.originalSaleId,
      p_items_in: [
        {
          sale_item_id: input.saleItemId,
          quantity: input.quantity,
          condition: input.condition,
        },
      ],
      p_items_out: input.outputVariantId
        ? [{ variant_id: input.outputVariantId, quantity: 1 }]
        : [],
      p_charge_payments: input.chargePayments,
      p_refund_references: input.refundReferences,
      p_authorization_token: input.authorizationToken,
      p_reason: input.reason.trim(),
    });
    if (error) throw error;
    const result = data as {
      id: string;
      folio: string;
      type: "RETURN" | "EXCHANGE";
      difference_cents: number;
      payments?: Array<{
        direction: "REFUND" | "CHARGE";
        method_code: string;
        amount_cents: number;
        reference: string | null;
      }>;
      credit_settlement?: {
        debt_reduction_cents: number;
        paid_refund_cents: number;
      };
    };
    revalidatePath("/tickets");
    revalidatePath("/inventario");
    revalidatePath("/pos");
    revalidatePath("/caja");
    return {
      ok: true,
      id: result.id,
      folio: result.folio,
      type: result.type,
      differenceCents: Number(result.difference_cents),
      payments: result.payments ?? [],
      creditSettlement: result.credit_settlement
        ? {
            debtReductionCents: Number(
              result.credit_settlement.debt_reduction_cents,
            ),
            paidRefundCents: Number(
              result.credit_settlement.paid_refund_cents,
            ),
          }
        : undefined,
    };
  } catch (error) {
    console.error("[tickets/createReturnExchange] failed", {
      message: databaseErrorText(error),
    });
    return { ok: false, message: exchangeMessage(error) };
  }
}
