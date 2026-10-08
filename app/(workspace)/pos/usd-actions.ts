"use server";
import { requirePermission } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchBanxicoFix } from "@/lib/banxico-server";
import type { UsdExchangeQuote } from "@/lib/usd-exchange";

export async function prepareUsdExchange(
  cashSessionId: string,
): Promise<
  | {
      ok: true;
      quote: UsdExchangeQuote;
      source: "BANXICO" | "LAST_VALID_REFERENCE";
    }
  | { ok: false; message: string }
> {
  try {
    const { supabase } = await requirePermission("pos.sell");
    // Verify ownership before fetching external data or using a privileged client.
    const { data: session, error: sessionError } = await supabase.rpc(
      "get_my_cash_session",
    );
    if (sessionError || !session || session.id !== cashSessionId)
      return {
        ok: false,
        message: "Abre tu propia caja antes de consultar el tipo de cambio.",
      };
    const available = await supabase.rpc("usd_checkout_available");
    if (available.error || available.data !== true) return { ok: false, message: "El cobro en dólares todavía no está habilitado." };
    const token = process.env.BANXICO_SIE_TOKEN;
    let fresh = false;
    if (token && process.env.SUPABASE_SECRET_KEY) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const part = (name: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === name)?.value;
      const fix = await fetchBanxicoFix(
        token,
        `${part("year")}-${part("month")}-${part("day")}`,
      );
      if (fix) {
        const result = await createAdminClient().rpc("record_banxico_fix", {
          p_date: fix.date,
          p_rate_million: fix.rateMillion,
        });
        fresh = !result.error;
      }
    }
    const { data, error } = await supabase.rpc("get_usd_exchange_quote", {
      p_cash_session_id: cashSessionId,
    });
    if (error || !data)
      return {
        ok: false,
        message:
          "No hay una referencia FIX válida. El cobro en dólares permanece bloqueado hasta configurar Banxico.",
      };
    return {
      ok: true,
      quote: data as UsdExchangeQuote,
      source: fresh ? "BANXICO" : "LAST_VALID_REFERENCE",
    };
  } catch {
    return {
      ok: false,
      message:
        "No fue posible consultar el tipo de cambio. Revisa tu sesión y configuración.",
    };
  }
}
