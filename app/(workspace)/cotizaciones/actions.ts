"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";

export type QuoteActionResult =
  | { ok: true; id?: string; folio?: string; href?: string }
  | { ok: false; message: string };

function quoteError(error: unknown): QuoteActionResult {
  const raw = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const definitions: Array<[string, string]> = [
    ["QUOTE_DATE_IN_PAST", "La vigencia no puede terminar en una fecha pasada."],
    ["CURRENT_DRAFT_NOT_EMPTY", "Guarda o vacía la venta actual antes de cobrar esta cotización."],
    ["QUOTE_EXPIRED", "Esta cotización ya venció."],
    ["QUOTE_LOCATION_MISMATCH", "Abre una caja de la misma sucursal que emitió la cotización."],
    ["QUOTE_NOT_CONVERTIBLE", "Esta cotización ya no se puede cobrar."],
    ["SESSION_FORBIDDEN", "Abre tu caja antes de enviar la cotización a Venta."],
    ["INVALID_QUOTE_ITEMS", "Agrega al menos un artículo válido."],
  ];
  const match = definitions.find(([code]) => raw.includes(code));
  return {
    ok: false,
    message: match?.[1] ?? "No fue posible guardar la cotización. Revisa los datos e intenta nuevamente.",
  };
}

export async function createQuote(input: {
  locationId: string;
  customerId?: string | null;
  items: Array<{ variant_id: string; quantity: number }>;
  validUntil?: string | null;
  notes?: string;
}): Promise<QuoteActionResult> {
  try {
    if (!input.locationId || input.items.length < 1 || input.items.length > 100) {
      return { ok: false, message: "Agrega al menos un artículo válido." };
    }
    const { supabase } = await requirePermission("quotes.manage");
    const { data, error } = await supabase.rpc("create_quote", {
      p_location_id: input.locationId,
      p_items: input.items,
      p_customer_id: input.customerId ?? null,
      p_valid_until: input.validUntil || null,
      p_notes: input.notes?.trim() || null,
    });
    if (error) throw error;
    const quote = data as { id: string; folio: string };
    revalidatePath("/cotizaciones");
    return { ok: true, id: quote.id, folio: quote.folio };
  } catch (error) {
    return quoteError(error);
  }
}

export async function markQuoteSent(quoteId: string): Promise<QuoteActionResult> {
  try {
    const { supabase } = await requirePermission("quotes.manage");
    const { data, error } = await supabase.rpc("send_quote", { p_quote_id: quoteId });
    if (error) throw error;
    const quote = data as { id: string; folio: string };
    revalidatePath("/cotizaciones");
    return { ok: true, id: quote.id, folio: quote.folio };
  } catch (error) {
    return quoteError(error);
  }
}

export async function loadQuoteForSale(quoteId: string): Promise<QuoteActionResult> {
  try {
    const { supabase } = await requirePermission("quotes.manage");
    const { data: session, error: sessionError } = await supabase.rpc("get_my_cash_session");
    if (sessionError) throw sessionError;
    const cashSession = session as { id?: string } | null;
    if (!cashSession?.id) return { ok: false, message: "Abre tu caja antes de cobrar la cotización." };
    const { error } = await supabase.rpc("load_quote_into_pos", {
      p_quote_id: quoteId,
      p_cash_session_id: cashSession.id,
    });
    if (error) throw error;
    revalidatePath("/pos");
    return { ok: true, href: "/pos" };
  } catch (error) {
    return quoteError(error);
  }
}
