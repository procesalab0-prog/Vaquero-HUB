"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import type {
  CreateExchangeResult,
  ExchangeSearchResult,
  ExchangeVariant,
  PrepareExchangeResult,
  ReturnableSale,
} from "@/lib/returns";

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

function exchangeMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const messages: Array<[string, string]> = [
    ["RETURN_EXCEEDS_SOLD", "Ese artículo ya fue cambiado o devuelto."],
    ["INSUFFICIENT_STOCK", "La existencia cambió. Elige otro artículo."],
    [
      "EXCHANGE_PRICE_DIFFERENCE_UNSUPPORTED",
      "Por ahora el cambio debe ser por el mismo importe.",
    ],
    ["SALE_NOT_RETURNABLE", "La venta ya no admite cambios."],
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
    const { data, error } = await supabase.rpc(
      "search_equal_exchange_variants",
      {
        p_price_cents: input.priceCents,
        p_exclude_variant_id: input.excludeVariantId,
        p_query: query,
        p_limit: 50,
      },
    );
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

export async function createEqualExchange(input: {
  idempotencyKey: string;
  cashSessionId: string;
  originalSaleId: string;
  saleItemId: string;
  outputVariantId: string;
  reason: string;
}): Promise<CreateExchangeResult> {
  try {
    if (input.reason.trim().length < 3 || input.reason.trim().length > 500) {
      return {
        ok: false,
        message: "Escribe un motivo de al menos 3 caracteres.",
      };
    }
    const { supabase } = await requirePermission("returns.create");
    const { data, error } = await supabase.rpc("create_equal_exchange", {
      p_idempotency_key: input.idempotencyKey,
      p_cash_session_id: input.cashSessionId,
      p_original_sale_id: input.originalSaleId,
      p_items_in: [{ sale_item_id: input.saleItemId, quantity: 1 }],
      p_items_out: [{ variant_id: input.outputVariantId, quantity: 1 }],
      p_reason: input.reason.trim(),
    });
    if (error) throw error;
    const result = data as { id: string; folio: string };
    revalidatePath("/tickets");
    revalidatePath("/inventario");
    revalidatePath("/pos");
    return { ok: true, id: result.id, folio: result.folio };
  } catch (error) {
    return { ok: false, message: exchangeMessage(error) };
  }
}
