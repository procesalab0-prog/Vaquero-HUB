"use server";
import { requirePermission } from "@/lib/auth/authorization";
import {
  mapInventoryCatalog,
  type InventoryCatalogQuery,
  type InventoryCatalogTransport,
} from "@/lib/inventory-catalog";

export async function lookupInventoryCatalog(input: InventoryCatalogQuery) {
  try {
    if (
      !input.locationId ||
      input.query.length > 120 ||
      !["all", "available", "last", "out"].includes(input.filter) ||
      !Number.isSafeInteger(input.page) ||
      input.page < 1 ||
      input.page > 1000000 ||
      typeof input.exact !== "boolean" ||
      (input.exact && !input.query.trim())
    )
      return { ok: false as const, message: "Revisa el código o la búsqueda." };
    const { supabase } = await requirePermission("inventory.read");
    const { data, error } = await supabase.rpc("get_inventory_catalog", {
      p_location_id: input.locationId,
      p_query: input.query,
      p_filter: input.filter,
      p_page: input.page,
      p_page_size: 50,
      p_exact: input.exact,
    });
    if (error) throw error;
    return {
      ok: true as const,
      data: mapInventoryCatalog(data as InventoryCatalogTransport),
    };
  } catch {
    return {
      ok: false as const,
      message:
        "No fue posible consultar el inventario. Intenta de nuevo; no se modificó ninguna existencia.",
    };
  }
}
