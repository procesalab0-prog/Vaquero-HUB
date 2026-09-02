"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";

const productsPath = "/productos";

function textField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function cents(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100)
    : null;
}

function catalogErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("CATALOG_DUPLICATE_VALUE")) return "producto-duplicado";
  if (message.includes("NOT_AUTHORIZED")) return "producto-sin-permiso";
  return "producto-error";
}

export async function createCatalogProduct(formData: FormData) {
  let status = "producto-error";

  try {
    const { supabase } = await requirePermission("products.create");
    const productName = textField(formData, "product_name");
    const categoryId = textField(formData, "category_id");
    const brandName = textField(formData, "brand_name");
    const colorId = textField(formData, "color_id");
    const codeBase = textField(formData, "code_base").toUpperCase();
    const priceCents = cents(textField(formData, "price"));
    const costCents = cents(textField(formData, "cost"));
    const sizeIds = formData.getAll("size_id").map(String).filter(Boolean);
    const isSicar = formData.get("is_sicar") === "on";

    if (
      !productName ||
      !categoryId ||
      !colorId ||
      !codeBase ||
      priceCents === null ||
      costCents === null ||
      sizeIds.length === 0
    ) {
      status = "producto-datos-invalidos";
    } else {
      const variants = sizeIds.map((sizeId, index) => {
        const code =
          sizeIds.length === 1
            ? codeBase
            : `${codeBase}-${String(index + 1).padStart(2, "0")}`;
        return {
          sku: code,
          cost_cents: costCents,
          price_cents: priceCents,
          legacy_sicar_code: isSicar ? code : null,
          barcode: code,
          barcode_symbology: "CODE128",
          barcode_source: isSicar ? "SICAR" : "MANUAL",
          attributes: { COLOR: colorId, TALLA: sizeId },
        };
      });

      const { error } = await supabase.rpc("create_catalog_product", {
        p_name: productName,
        p_category_id: categoryId,
        p_variants: variants,
        p_brand_name: brandName || null,
      });
      if (error) throw error;
      status = "producto-creado";
    }
  } catch (error) {
    status = catalogErrorStatus(error);
    console.error("[productos/createCatalogProduct] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }

  revalidatePath(productsPath);
  redirect(`${productsPath}?status=${status}`);
}
