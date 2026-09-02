"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";

const labelsPath = "/etiquetas";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function saveLabelTemplate(formData: FormData) {
  let status = "plantilla-error";
  try {
    const { supabase } = await requirePermission("products.update");
    const id = text(formData, "id");
    const widthMm = Number(text(formData, "width_mm"));
    const heightMm = Number(text(formData, "height_mm"));
    const layout = text(formData, "layout");
    const name = text(formData, "name");
    if (
      !name ||
      !Number.isFinite(widthMm) ||
      !Number.isFinite(heightMm) ||
      !["BALANCED", "PRODUCT_FOCUS", "PRICE_FOCUS"].includes(layout)
    ) {
      status = "plantilla-invalida";
    } else {
      const { error } = await supabase.rpc("save_label_template", {
        p_id: id || null,
        p_name: name,
        p_width_mm: widthMm,
        p_height_mm: heightMm,
        p_layout: layout,
        p_show_logo: formData.get("show_logo") === "on",
        p_show_product_name: formData.get("show_product_name") === "on",
        p_show_brand: formData.get("show_brand") === "on",
        p_show_size: formData.get("show_size") === "on",
        p_show_color: formData.get("show_color") === "on",
        p_show_price: formData.get("show_price") === "on",
        p_show_sku: formData.get("show_sku") === "on",
        p_show_barcode: formData.get("show_barcode") === "on",
        p_show_code: formData.get("show_code") === "on",
        p_is_default: formData.get("is_default") === "on",
        p_is_active: formData.get("is_active") === "on",
      });
      if (error) throw error;
      status = "plantilla-guardada";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("[etiquetas/saveLabelTemplate] failed", { message });
    if (message.includes("NOT_AUTHORIZED")) status = "plantilla-sin-permiso";
    else if (message.includes("LABEL_TEMPLATE_DUPLICATE"))
      status = "plantilla-duplicada";
    else if (message.includes("INVALID_LABEL_TEMPLATE"))
      status = "plantilla-invalida";
  }
  revalidatePath(labelsPath);
  redirect(`${labelsPath}?status=${status}`);
}
