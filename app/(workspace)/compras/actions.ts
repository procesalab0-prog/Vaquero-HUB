"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";

type ActionResult = {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function failure(error: unknown, fallback: string): ActionResult {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("NOT_AUTHORIZED"))
    return {
      ok: false,
      message: "No tienes permiso para realizar esta acción.",
    };
  if (message.includes("LOCATION_FORBIDDEN"))
    return { ok: false, message: "No tienes acceso a esa sucursal." };
  if (message.includes("DUPLICATE_PURCHASE_VARIANT"))
    return {
      ok: false,
      message: "Cada variante debe aparecer una sola vez en la orden.",
    };
  if (message.includes("RECEIPT_EXCEEDS_ORDER"))
    return {
      ok: false,
      message: "La recepción supera la cantidad pendiente de la orden.",
    };
  if (message.includes("PURCHASE_NOT_RECEIVABLE"))
    return { ok: false, message: "Esta orden ya no admite recepciones." };
  if (message.includes("PURCHASE_NOT_CANCELLABLE"))
    return {
      ok: false,
      message: "Sólo se puede cancelar una orden que aún no tenga recepciones.",
    };
  if (message.includes("INVALID_"))
    return { ok: false, message: "Revisa los datos capturados." };
  console.error("[compras] action failed", { message });
  return { ok: false, message: fallback };
}

export async function saveSupplier(input: {
  id?: string;
  code: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  notes?: string;
  isActive?: boolean;
}): Promise<ActionResult> {
  try {
    const { supabase } = await requirePermission("purchases.manage");
    const code = clean(input.code).toUpperCase();
    const name = clean(input.name);
    if (!code || !name)
      return { ok: false, message: "Código y nombre son obligatorios." };
    const { data, error } = await supabase.rpc("upsert_supplier", {
      p_id: input.id || null,
      p_code: code,
      p_name: name,
      p_contact_name: clean(input.contactName) || null,
      p_phone: clean(input.phone) || null,
      p_email: clean(input.email) || null,
      p_tax_id: clean(input.taxId) || null,
      p_notes: clean(input.notes) || null,
      p_is_active: input.isActive !== false,
    });
    if (error) throw error;
    revalidatePath("/compras");
    return {
      ok: true,
      message: input.id ? "Proveedor actualizado." : "Proveedor agregado.",
      data: { id: data },
    };
  } catch (error) {
    return failure(error, "No fue posible guardar el proveedor.");
  }
}

export async function createPurchaseOrder(input: {
  supplierId: string;
  locationId: string;
  expectedAt?: string;
  notes?: string;
  items: Array<{ variantId: string; qty: number; unitCostCents: number }>;
}): Promise<ActionResult> {
  try {
    const { supabase } = await requirePermission("purchases.manage");
    if (
      !input.supplierId ||
      !input.locationId ||
      !input.items.length ||
      input.items.some(
        (item) =>
          !item.variantId ||
          !Number.isSafeInteger(item.qty) ||
          item.qty < 1 ||
          !Number.isSafeInteger(item.unitCostCents) ||
          item.unitCostCents < 0,
      )
    ) {
      return {
        ok: false,
        message: "Agrega al menos un producto con cantidad y costo válidos.",
      };
    }
    const { data, error } = await supabase.rpc("create_purchase_order", {
      p_supplier_id: input.supplierId,
      p_location_id: input.locationId,
      p_expected_at: input.expectedAt || null,
      p_notes: clean(input.notes) || null,
      p_items: input.items.map((item) => ({
        variant_id: item.variantId,
        qty: item.qty,
        unit_cost_cents: item.unitCostCents,
      })),
    });
    if (error) throw error;
    revalidatePath("/compras");
    return {
      ok: true,
      message: `Orden #${(data as { folio?: number } | null)?.folio ?? ""} creada sin modificar inventario.`,
      data: (data ?? {}) as Record<string, unknown>,
    };
  } catch (error) {
    return failure(error, "No fue posible crear la orden.");
  }
}

export async function receivePurchaseOrder(input: {
  orderId: string;
  notes?: string;
  idempotencyKey: string;
  items: Array<{ purchaseItemId: string; qty: number }>;
}): Promise<ActionResult> {
  try {
    const { supabase } = await requirePermission("purchases.receive");
    const items = input.items.filter((item) => item.qty > 0);
    if (
      !input.orderId ||
      !input.idempotencyKey ||
      !items.length ||
      items.some(
        (item) => !item.purchaseItemId || !Number.isSafeInteger(item.qty),
      )
    ) {
      return { ok: false, message: "Captura al menos una cantidad recibida." };
    }
    const { data, error } = await supabase.rpc("receive_purchase_order", {
      p_order_id: input.orderId,
      p_idempotency_key: input.idempotencyKey,
      p_notes: clean(input.notes) || null,
      p_items: items.map((item) => ({
        purchase_item_id: item.purchaseItemId,
        qty: item.qty,
      })),
    });
    if (error) throw error;
    revalidatePath("/compras");
    revalidatePath("/inventario");
    revalidatePath("/etiquetas");
    return {
      ok: true,
      message: `Recepción #${(data as { folio?: number } | null)?.folio ?? ""} guardada. El inventario ya fue actualizado.`,
      data: (data ?? {}) as Record<string, unknown>,
    };
  } catch (error) {
    return failure(
      error,
      "No fue posible registrar la recepción; el inventario no se modificó.",
    );
  }
}

export async function cancelPurchaseOrder(input: {
  orderId: string;
  reason: string;
}): Promise<ActionResult> {
  try {
    const { supabase } = await requirePermission("purchases.manage");
    if (!clean(input.reason))
      return { ok: false, message: "Escribe el motivo de cancelación." };
    const { error } = await supabase.rpc("cancel_purchase_order", {
      p_order_id: input.orderId,
      p_reason: clean(input.reason),
    });
    if (error) throw error;
    revalidatePath("/compras");
    return { ok: true, message: "Orden cancelada; el inventario no cambió." };
  } catch (error) {
    return failure(error, "No fue posible cancelar la orden.");
  }
}
