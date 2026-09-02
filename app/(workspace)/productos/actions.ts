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
  if (message.includes("BARCODE_ALREADY_ASSIGNED")) return "codigo-ya-asignado";
  if (message.includes("BARCODE_SOURCE_NOT_ALLOWED"))
    return "codigo-origen-invalido";
  if (
    message.includes("INVALID_EAN13") ||
    message.includes("INVALID_CODE128") ||
    message.includes("INVALID_BARCODE") ||
    message.includes("BARCODE_SYMBOLOGY_NOT_ALLOWED") ||
    message.includes("BARCODE_METADATA_MISMATCH")
  )
    return "codigo-invalido";
  if (message.includes("VARIANT_NOT_FOUND")) return "variante-no-encontrada";
  if (message.includes("CATALOG_DUPLICATE_VALUE")) return "producto-duplicado";
  // El control de combinación repetida es una restricción diferida: salta al
  // cerrar la transacción, ya fuera del `exception` de `create_catalog_product`,
  // así que llega con su nombre propio y no traducido a CATALOG_DUPLICATE_VALUE.
  if (message.includes("DUPLICATE_VARIANT_ATTRIBUTES"))
    return "producto-combinacion-repetida";
  if (message.includes("NOT_AUTHORIZED")) return "producto-sin-permiso";
  if (message.includes("IDENTITY_FIELDS_NOT_ALLOWED"))
    return "producto-cliente-desactualizado";
  if (message.includes("PRODUCT_NOT_FOUND")) return "producto-no-encontrado";
  if (message.includes("INVALID_VARIANT")) return "producto-datos-invalidos";
  return "producto-error";
}

function variantsFromForm(formData: FormData) {
  const priceCents = cents(textField(formData, "price"));
  const costCents = cents(textField(formData, "cost"));
  const combinations = Array.from(
    new Set(formData.getAll("variant_combo").map(String).filter(Boolean)),
  );

  if (
    priceCents === null ||
    costCents === null ||
    combinations.length === 0 ||
    combinations.length > 200
  ) {
    throw new Error("INVALID_VARIANT_FORM");
  }

  return combinations.map((combination) => {
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
}

export async function createCatalogProduct(formData: FormData) {
  let status = "producto-error";

  try {
    const { supabase } = await requirePermission("products.create");
    const productName = textField(formData, "product_name");
    const categoryId = textField(formData, "category_id");
    const brandName = textField(formData, "brand_name");
    const variants = variantsFromForm(formData);

    if (!productName || !categoryId) {
      status = "producto-datos-invalidos";
    } else {
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

export async function addCatalogVariants(formData: FormData) {
  let status = "variantes-error";

  try {
    const { supabase } = await requirePermission("products.create");
    const productId = textField(formData, "product_id");
    const variants = variantsFromForm(formData);

    if (!productId) {
      status = "producto-datos-invalidos";
    } else {
      const { error } = await supabase.rpc("add_variants_to_product", {
        p_product_id: productId,
        p_variants: variants,
      });
      if (error) throw error;
      status = "variantes-agregadas";
    }
  } catch (error) {
    status = catalogErrorStatus(error);
    console.error("[productos/addCatalogVariants] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }

  revalidatePath(productsPath);
  redirect(`${productsPath}?status=${status}`);
}

export async function registerVariantBarcode(formData: FormData) {
  let status = "codigo-error";

  try {
    const { supabase } = await requirePermission("products.update");
    const variantId = textField(formData, "variant_id");
    const code = textField(formData, "code");
    const symbology = textField(formData, "symbology").toUpperCase();
    const source = textField(formData, "source").toUpperCase();

    if (
      !variantId ||
      !code ||
      !["EAN13", "CODE128"].includes(symbology) ||
      !["MANUAL", "SUPPLIER"].includes(source)
    ) {
      status = "codigo-invalido";
    } else {
      const { error } = await supabase.rpc("register_variant_barcode", {
        p_variant_id: variantId,
        p_code: code,
        p_symbology: symbology,
        p_source: source,
      });
      if (error) throw error;
      status = "codigo-registrado";
    }
  } catch (error) {
    status = catalogErrorStatus(error);
    console.error("[productos/registerVariantBarcode] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }

  revalidatePath(productsPath);
  redirect(`${productsPath}?status=${status}`);
}
