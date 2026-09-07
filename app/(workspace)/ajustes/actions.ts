"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";

export async function saveReturnPolicy(input: {
  locationId: string;
  windowDays: number;
}): Promise<{ ok: true; windowDays: number } | { ok: false; message: string }> {
  try {
    if (
      !Number.isSafeInteger(input.windowDays) ||
      input.windowDays < 0 ||
      input.windowDays > 365
    ) {
      return { ok: false, message: "El plazo debe estar entre 0 y 365 días." };
    }
    const { supabase } = await requirePermission("returns.policy_manage");
    const { data, error } = await supabase.rpc("update_return_policy", {
      p_location_id: input.locationId,
      p_window_days: input.windowDays,
    });
    if (error) throw error;
    revalidatePath("/ajustes");
    revalidatePath("/tickets");
    return {
      ok: true,
      windowDays: Number((data as { window_days: number }).window_days),
    };
  } catch {
    return {
      ok: false,
      message:
        "No fue posible guardar la política. Se requiere permiso de gerente.",
    };
  }
}

export async function saveMySupervisorPin(
  pin: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    if (!/^\d{4,8}$/.test(pin)) {
      return { ok: false, message: "El PIN debe tener de 4 a 8 números." };
    }
    const { supabase } = await requirePermission("returns.create");
    const { error } = await supabase.rpc("update_my_profile", {
      p_full_name: null,
      p_new_pin: pin,
    });
    if (error) throw error;
    return { ok: true };
  } catch {
    return { ok: false, message: "No fue posible guardar tu PIN." };
  }
}
