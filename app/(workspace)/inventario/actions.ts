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
  if (message.includes("SEPARATION_OF_DUTIES"))
    return "inventario-separacion-funciones";
  if (message.includes("INSUFFICIENT_STOCK"))
    return "inventario-sin-existencia";
  if (
    message.includes("INVALID_TRANSFER") ||
    message.includes("INVALID_COUNT") ||
    message.includes("COUNT_EMPTY") ||
    message.includes("VARIANT_NOT_FOUND")
  )
    return "inventario-operacion-invalida";
  return "inventario-error";
}

function redirectToInventory(status: string, locationId = ""): never {
  revalidatePath(inventoryPath);
  const params = new URLSearchParams({ status });
  if (locationId) params.set("ubicacion", locationId);
  redirect(`${inventoryPath}?${params.toString()}`);
}

function jsonItems(formData: FormData, field = "items") {
  const raw = textField(formData, field);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 500)
      return null;
    const items = parsed.map((item) => {
      const candidate = item as { variant_id?: unknown; qty?: unknown };
      return {
        variant_id: String(candidate.variant_id ?? ""),
        qty: Number(candidate.qty),
      };
    });
    return items.every(
      (item) =>
        item.variant_id &&
        Number.isFinite(item.qty) &&
        item.qty >= 0 &&
        item.qty <= 999999999.999,
    )
      ? items
      : null;
  } catch {
    return null;
  }
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

  redirectToInventory(status, locationId);
}

export async function createInventoryCount(formData: FormData) {
  const locationId = textField(formData, "location_id");
  let status = "conteo-creado";
  try {
    const { supabase } = await requirePermission("inventory.count");
    const { error } = await supabase.rpc("create_inventory_count", {
      p_location_id: locationId,
      p_scope: { type: "SELECTED" },
    });
    if (error) throw error;
  } catch (error) {
    status = errorStatus(error);
    console.error("[inventario/createInventoryCount] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }
  redirectToInventory(status, locationId);
}

export async function recordInventoryCountItem(formData: FormData) {
  const locationId = textField(formData, "location_id");
  let status = "conteo-capturado";
  try {
    const { supabase } = await requirePermission("inventory.count");
    const countId = textField(formData, "count_id");
    const variantId = textField(formData, "variant_id");
    const countedQuantity = numberField(formData, "counted_quantity");
    if (
      !countId ||
      !variantId ||
      countedQuantity === null ||
      countedQuantity < 0
    )
      throw new Error("INVALID_COUNT_QUANTITY");
    const { error } = await supabase.rpc("record_inventory_count_item", {
      p_count_id: countId,
      p_variant_id: variantId,
      p_counted_qty: countedQuantity,
    });
    if (error) throw error;
  } catch (error) {
    status = errorStatus(error);
    console.error("[inventario/recordInventoryCountItem] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }
  redirectToInventory(status, locationId);
}

export async function closeInventoryCount(formData: FormData) {
  const locationId = textField(formData, "location_id");
  let status = "conteo-cerrado";
  try {
    const { supabase } = await requirePermission("inventory.count");
    const { data, error } = await supabase.rpc("close_inventory_count", {
      p_count_id: textField(formData, "count_id"),
    });
    if (error) throw error;
    if (Number((data as { warnings?: number } | null)?.warnings ?? 0) > 0)
      status = "conteo-cerrado-con-avisos";
  } catch (error) {
    status = errorStatus(error);
  }
  redirectToInventory(status, locationId);
}

export async function cancelInventoryCount(formData: FormData) {
  const locationId = textField(formData, "location_id");
  let status = "conteo-cancelado";
  try {
    const { supabase } = await requirePermission("inventory.count");
    const { error } = await supabase.rpc("cancel_inventory_count", {
      p_count_id: textField(formData, "count_id"),
    });
    if (error) throw error;
  } catch (error) {
    status = errorStatus(error);
  }
  redirectToInventory(status, locationId);
}

export async function createInventoryTransfer(formData: FormData) {
  const fromLocationId = textField(formData, "from_location_id");
  let status = "traspaso-creado";
  try {
    const { supabase } = await requirePermission("transfers.create");
    const items = jsonItems(formData);
    if (!items || items.some((item) => item.qty <= 0))
      throw new Error("INVALID_TRANSFER_ITEMS");
    const { error } = await supabase.rpc("create_transfer", {
      p_from_location_id: fromLocationId,
      p_to_location_id: textField(formData, "to_location_id"),
      p_items: items,
      p_note: textField(formData, "note") || null,
    });
    if (error) throw error;
  } catch (error) {
    status = errorStatus(error);
  }
  redirectToInventory(status, fromLocationId);
}

async function transitionTransfer(
  formData: FormData,
  permission: string,
  rpc: string,
  successStatus: string,
  includeItems = false,
) {
  const locationId = textField(formData, "location_id");
  let status = successStatus;
  try {
    const { supabase } = await requirePermission(permission);
    const args: Record<string, unknown> = {
      p_transfer_id: textField(formData, "transfer_id"),
    };
    if (includeItems) {
      const items = jsonItems(formData);
      if (!items) throw new Error("INVALID_TRANSFER_ITEMS");
      args.p_items = items;
    }
    const { error } = await supabase.rpc(rpc, args);
    if (error) throw error;
  } catch (error) {
    status = errorStatus(error);
    console.error(`[inventario/${rpc}] failed`, {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }
  redirectToInventory(status, locationId);
}

export async function approveInventoryTransfer(formData: FormData) {
  return transitionTransfer(
    formData,
    "transfers.approve",
    "approve_transfer",
    "traspaso-aprobado",
  );
}

export async function prepareInventoryTransfer(formData: FormData) {
  return transitionTransfer(
    formData,
    "transfers.create",
    "prepare_transfer",
    "traspaso-preparado",
    true,
  );
}

export async function dispatchInventoryTransfer(formData: FormData) {
  return transitionTransfer(
    formData,
    "transfers.create",
    "dispatch_transfer",
    "traspaso-en-transito",
  );
}

export async function receiveInventoryTransfer(formData: FormData) {
  return transitionTransfer(
    formData,
    "transfers.receive",
    "receive_transfer",
    "traspaso-recibido",
    true,
  );
}

export async function cancelInventoryTransfer(formData: FormData) {
  return transitionTransfer(
    formData,
    "transfers.create",
    "cancel_transfer",
    "traspaso-cancelado",
  );
}
