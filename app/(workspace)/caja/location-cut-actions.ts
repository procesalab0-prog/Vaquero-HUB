"use server";
import { requirePermission } from "@/lib/auth/authorization";
import type { LocationCutData } from "@/components/location-cash-cut";
async function requestCut(
  locationId: string,
  id: string | null,
  sessionIds: string[] | null,
): Promise<
  { ok: true; data: LocationCutData } | { ok: false; message: string }
> {
  try {
    const { supabase } = await requirePermission("cash.close");
    const { data, error } = await supabase.rpc("location_cash_cut", {
      p_location_id: locationId,
      p_id: id,
      p_session_ids: sessionIds,
    });
    if (error)
      return {
        ok: false,
        message: error.message.includes("OPEN_SESSIONS")
          ? "Cierra todos los turnos antes de confirmar."
          : error.message.includes("CHANGED")
            ? "Cambió la lista de turnos. Prepara y revisa de nuevo el corte."
            : "No fue posible preparar o guardar el corte. Revisa sucursal, permisos y turnos.",
      };
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      message: "Tu sesión venció o no tienes acceso al corte de sucursal.",
    };
  }
}
export async function loadLocationCut(locationId: string) {
  return requestCut(locationId, null, null);
}
export async function confirmLocationCut(
  locationId: string,
  id: string,
  sessionIds: string[],
) {
  return requestCut(locationId, id, sessionIds);
}
