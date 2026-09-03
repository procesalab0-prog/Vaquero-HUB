"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";

const inventoryPath = "/inventario";

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function numberField(formData: FormData, name: string) {
  const value = Number(textField(formData, name));
  return Number.isFinite(value) ? value : null;
}

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("STALE_INVENTORY")) return "inventario-desactualizado";
  if (message.includes("INSUFFICIENT_STOCK")) return "inventario-reservado";
  if (
    message.includes("NOT_AUTHORIZED") ||
    message.includes("PERMISSION_DENIED") ||
    message.includes("LOCATION_FORBIDDEN")
  ) {
    return "inventario-sin-permiso";
  }
  if (message.includes("INVALID_ADJUSTMENT"))
    return "inventario-datos-invalidos";
  return "inventario-error";
}

export async function applyInventoryAdjustment(formData: FormData) {
  const locationId = textField(formData, "location_id");
  let status = "inventario-error";

  try {
    const { supabase } = await requirePermission("inventory.adjust");
    const variantId = textField(formData, "variant_id");
    const expectedQuantity = numberField(formData, "expected_quantity");
    const countedQuantity = numberField(formData, "counted_quantity");
    const reason = textField(formData, "reason");
    const note = textField(formData, "note");

    if (
      !variantId ||
      !locationId ||
      expectedQuantity === null ||
      expectedQuantity < 0 ||
      countedQuantity === null ||
      countedQuantity < 0 ||
      !reason
    ) {
      status = "inventario-datos-invalidos";
    } else {
      const { data, error } = await supabase.rpc("apply_inventory_adjustment", {
        p_variant_id: variantId,
        p_location_id: locationId,
        p_expected_qty: expectedQuantity,
        p_counted_qty: countedQuantity,
        p_reason: reason,
        p_note: note || null,
      });
      if (error) throw error;
      status =
        (data as { status?: string } | null)?.status === "NO_CHANGE"
          ? "inventario-sin-cambios"
          : "inventario-ajustado";
    }
  } catch (error) {
    status = errorStatus(error);
    console.error("[inventario/applyInventoryAdjustment] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }

  revalidatePath(inventoryPath);
  const params = new URLSearchParams({ status });
  if (locationId) params.set("ubicacion", locationId);
  redirect(`${inventoryPath}?${params.toString()}`);
}
