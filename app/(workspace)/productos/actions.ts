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
  // El control de combinación repetida es una restricción diferida: salta al
  // cerrar la transacción, ya fuera del `exception` de `create_catalog_product`,
  // así que llega con su nombre propio y no traducido a CATALOG_DUPLICATE_VALUE.
  if (message.includes("DUPLICATE_VARIANT_ATTRIBUTES"))
    return "producto-combinacion-repetida";
  if (message.includes("NOT_AUTHORIZED")) return "producto-sin-permiso";
  if (message.includes("IDENTITY_FIELDS_NOT_ALLOWED"))
    return "producto-cliente-desactualizado";
  return "producto-error";
}

export async function createCatalogProduct(formData: FormData) {
  let status = "producto-error";

  try {
    const { supabase } = await requirePermission("products.create");
    const productName = textField(formData, "product_name");
    const categoryId = textField(formData, "category_id");
    const brandName = textField(formData, "brand_name");
    const priceCents = cents(textField(formData, "price"));
    const costCents = cents(textField(formData, "cost"));
    const combinations = Array.from(
      new Set(formData.getAll("variant_combo").map(String).filter(Boolean)),
    );

    if (
      !productName ||
      !categoryId ||
      priceCents === null ||
      costCents === null ||
      combinations.length === 0 ||
      combinations.length > 200
    ) {
      status = "producto-datos-invalidos";
    } else {
      const variants = combinations.map((combination) => {
        const [colorId, sizeId, ...unexpected] = combination.split(":");
        if (!colorId || !sizeId || unexpected.length) {
          throw new Error("INVALID_VARIANT_COMBINATION");
        }
        return {
          cost_cents: costCents,
          price_cents: priceCents,
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
