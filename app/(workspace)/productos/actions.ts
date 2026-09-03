"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { parseCatalogImportFile } from "@/lib/catalog-import";
import {
  type CatalogImportIssue,
  type CatalogImportRow,
  type CatalogImportState,
} from "@/lib/catalog-import-shared";
import type { ProductVariant } from "@/lib/domain";
import type { BatchActionResult } from "@/lib/domain";

const productsPath = "/productos";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validVariantIds(ids: string[]) {
  return (
    ids.length > 0 &&
    ids.length <= 500 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => uuidPattern.test(id))
  );
}

export async function bulkUpdateVariantStatus(
  variantIds: string[],
  isActive: boolean,
): Promise<BatchActionResult> {
  try {
    if (!validVariantIds(variantIds) || typeof isActive !== "boolean") {
      return { ok: false, message: "La selección no es válida." };
    }
    const { supabase } = await requirePermission("products.update");
    const { data, error } = await supabase.rpc("bulk_update_variant_status", {
      p_variant_ids: variantIds,
      p_is_active: isActive,
    });
    if (error) throw error;
    const changedCount = Number(
      (data as { changed_count?: number } | null)?.changed_count ?? 0,
    );
    revalidatePath(productsPath);
    revalidatePath("/etiquetas");
    return {
      ok: true,
      changedCount,
      message: changedCount
        ? `${changedCount} variantes quedaron ${isActive ? "activas" : "dadas de baja"}.`
        : "Las variantes ya tenían ese estado.",
    };
  } catch (error) {
    console.error("[productos/bulkUpdateVariantStatus] failed", {
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return {
      ok: false,
      message:
        error instanceof Error && error.message.includes("NOT_AUTHORIZED")
          ? "Tu rol no tiene permiso para cambiar el estado del catálogo."
          : "No se cambió ninguna variante. Actualiza la página e inténtalo de nuevo.",
    };
  }
}

export async function bulkUpdateVariantPrices(
  changes: Array<{
    variantId: string;
    expectedPriceCents: number;
    newPriceCents: number;
  }>,
): Promise<BatchActionResult> {
  try {
    const ids = changes.map((change) => change.variantId);
    if (
      !validVariantIds(ids) ||
      changes.some(
        ({ expectedPriceCents, newPriceCents }) =>
          !Number.isSafeInteger(expectedPriceCents) ||
          !Number.isSafeInteger(newPriceCents) ||
          expectedPriceCents < 0 ||
          newPriceCents < 0 ||
          expectedPriceCents === newPriceCents,
      )
    ) {
      return { ok: false, message: "La vista previa de precios no es válida." };
    }
    const { supabase } = await requirePermission("products.price_update");
    const { data, error } = await supabase.rpc("bulk_update_variant_prices", {
      p_changes: changes.map((change) => ({
        variant_id: change.variantId,
        expected_price_cents: change.expectedPriceCents,
        new_price_cents: change.newPriceCents,
      })),
    });
    if (error) throw error;
    const changedCount = Number(
      (data as { changed_count?: number } | null)?.changed_count ?? 0,
    );
    revalidatePath(productsPath);
    revalidatePath("/etiquetas");
    return {
      ok: true,
      changedCount,
      message: `${changedCount} precios se actualizaron y quedaron en la bitácora.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    console.error("[productos/bulkUpdateVariantPrices] failed", { message });
    if (message.includes("STALE_PRICE_BATCH")) {
      return {
        ok: false,
        stale: true,
        message:
          "Un precio cambió después de la vista previa. No se modificó ninguno; actualiza la página y revisa de nuevo.",
      };
    }
    return {
      ok: false,
      message: message.includes("NOT_AUTHORIZED")
        ? "Tu rol no tiene permiso para cambiar precios."
        : "No se modificó ningún precio. Revisa la selección e inténtalo de nuevo.",
    };
  }
}

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
  if (message.includes("RESERVED_INTERNAL_PREFIX"))
    return "codigo-prefijo-reservado";
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
  if (message.includes("INVALID_CATEGORY"))
    return "producto-categoria-invalida";
  if (message.includes("INVALID_PRICE")) return "producto-precio-invalido";
  if (message.includes("INVALID_PRODUCT")) return "producto-datos-invalidos";
  if (message.includes("INVALID_VARIANT")) return "producto-datos-invalidos";
  return "producto-error";
}

function importFileMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("ARCHIVO_VACIO")) return "El archivo está vacío.";
  if (message.includes("ARCHIVO_DEMASIADO_GRANDE"))
    return "El archivo supera 1 MB. Divídelo en bloques de hasta 1,000 filas.";
  if (message.includes("FORMATO_NO_ADMITIDO"))
    return "Usa la plantilla CSV o XLSX de Mi Tienda SM.";
  if (message.includes("ARCHIVO_SIN_DATOS"))
    return "La plantilla no contiene productos para revisar.";
  if (message.includes("DEMASIADAS_FILAS"))
    return "Importa como máximo 1,000 variantes por archivo.";
  if (message.includes("CSV_COMILLAS_SIN_CERRAR"))
    return "El CSV tiene una celda entre comillas sin cerrar.";
  if (message.includes("XLSX_SIN_HOJA"))
    return "El XLSX no contiene una hoja legible.";
  if (message.includes("XLSX_"))
    return "El XLSX está dañado o se expande demasiado. Descarga una plantilla nueva.";
  if (message.includes("NOT_AUTHORIZED"))
    return "Tu rol no tiene permiso para importar productos.";
  return "No fue posible leer la plantilla. Descárgala de nuevo y revisa su formato.";
}

export async function previewCatalogImport(
  _previous: CatalogImportState,
  formData: FormData,
): Promise<CatalogImportState> {
  try {
    const { supabase } = await requirePermission("products.create");
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("ARCHIVO_VACIO");
    const parsed = await parseCatalogImportFile(file);
    if (parsed.rows.length === 0) {
      return {
        phase: "preview",
        message: "Corrige la estructura de la plantilla antes de continuar.",
        totalRows: 0,
        validRows: 0,
        errorCount: parsed.issues.length,
        errors: parsed.issues,
      };
    }
    const { data, error } = await supabase.rpc("validate_catalog_import", {
      p_rows: parsed.rows,
    });
    if (error) throw error;
    const report = data as {
      total_rows: number;
      valid_rows: number;
      error_count: number;
      errors: CatalogImportIssue[];
    };
    const allErrors = [...parsed.issues, ...(report.errors ?? [])];
    const errors = allErrors.slice(0, 200);
    return {
      phase: "preview",
      message: allErrors.length
        ? "No se guardó nada. Corrige las filas marcadas y vuelve a revisar."
        : "La corrida en seco terminó sin errores. Revisa el resumen antes de importar.",
      totalRows: report.total_rows,
      validRows: allErrors.length ? 0 : report.valid_rows,
      errorCount: allErrors.length,
      errors,
      payload: JSON.stringify(parsed.rows),
    };
  } catch (error) {
    console.error("[productos/previewCatalogImport] failed", {
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return { phase: "error", message: importFileMessage(error) };
  }
}

export async function commitCatalogImport(
  _previous: CatalogImportState,
  formData: FormData,
): Promise<CatalogImportState> {
  try {
    const { supabase } = await requirePermission("products.create");
    const payload = textField(formData, "payload");
    if (!payload || payload.length > 1_500_000)
      throw new Error("INVALID_IMPORT_PAYLOAD");
    const rows = JSON.parse(payload) as CatalogImportRow[];
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000)
      throw new Error("INVALID_IMPORT_PAYLOAD");
    const { data, error } = await supabase.rpc("commit_catalog_import", {
      p_rows: rows,
    });
    if (error) throw error;
    const result = data as { product_count: number; variant_count: number };
    revalidatePath(productsPath);
    return {
      phase: "committed",
      message:
        "Importación terminada. Todas las filas se guardaron correctamente.",
      productCount: result.product_count,
      variantCount: result.variant_count,
    };
  } catch (error) {
    console.error("[productos/commitCatalogImport] failed", {
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return {
      phase: "error",
      message:
        error instanceof Error &&
        error.message.includes("IMPORT_VALIDATION_FAILED")
          ? "El catálogo cambió después de la revisión. Vuelve a cargar el archivo para validarlo de nuevo."
          : "No se guardó ninguna fila. Revisa permisos y vuelve a ejecutar la corrida en seco.",
    };
  }
}

export async function updateCatalogProduct(formData: FormData) {
  let status = "producto-error";
  try {
    const { supabase } = await requirePermission("products.update");
    const productId = textField(formData, "product_id");
    const name = textField(formData, "product_name");
    const categoryId = textField(formData, "category_id");
    if (!productId || !name || !categoryId) {
      status = "producto-datos-invalidos";
    } else {
      const { error } = await supabase.rpc("update_catalog_product", {
        p_product_id: productId,
        p_name: name,
        p_category_id: categoryId,
        p_brand_name: textField(formData, "brand_name") || null,
        p_description: textField(formData, "description") || null,
        p_is_active: formData.get("is_active") === "on",
      });
      if (error) throw error;
      status = "producto-actualizado";
    }
  } catch (error) {
    status = catalogErrorStatus(error);
    console.error("[productos/updateCatalogProduct] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }
  revalidatePath(productsPath);
  redirect(`${productsPath}?status=${status}`);
}

export async function updateCatalogVariant(formData: FormData) {
  let status = "producto-error";
  try {
    const { supabase } = await requirePermission("products.update");
    const variantId = textField(formData, "variant_id");
    const costCents = cents(textField(formData, "cost"));
    if (!variantId || costCents === null) {
      status = "producto-datos-invalidos";
    } else {
      const { error } = await supabase.rpc("update_catalog_variant", {
        p_variant_id: variantId,
        p_cost_cents: costCents,
        p_is_active: formData.get("is_active") === "on",
      });
      if (error) throw error;
      status = "variante-actualizada";
    }
  } catch (error) {
    status = catalogErrorStatus(error);
    console.error("[productos/updateCatalogVariant] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }
  revalidatePath(productsPath);
  redirect(`${productsPath}?status=${status}`);
}

export async function updateCatalogVariantPrice(formData: FormData) {
  let status = "producto-error";
  try {
    const { supabase } = await requirePermission("products.price_update");
    const variantId = textField(formData, "variant_id");
    const priceCents = cents(textField(formData, "price"));
    if (!variantId || priceCents === null) {
      status = "producto-precio-invalido";
    } else {
      const { error } = await supabase.rpc("update_catalog_variant_price", {
        p_variant_id: variantId,
        p_price_cents: priceCents,
      });
      if (error) throw error;
      status = "precio-actualizado";
    }
  } catch (error) {
    status = catalogErrorStatus(error);
    console.error("[productos/updateCatalogVariantPrice] failed", {
      status,
      message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
  }
  revalidatePath(productsPath);
  redirect(`${productsPath}?status=${status}`);
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

export async function lookupCatalogBarcode(
  rawCode: string,
): Promise<ProductVariant | null> {
  const code = rawCode.trim();
  if (!code || code.length > 80) return null;

  const { supabase } = await requirePermission("products.read");
  const { data, error } = await supabase.rpc("search_catalog", {
    p_query: code,
    p_limit: 5,
  });
  if (error) {
    console.error("[productos/lookupCatalogBarcode] failed", {
      message: error.message,
    });
    return null;
  }

  const row = (
    data as Array<{
      variant_id: string;
      product_id: string;
      product_name: string;
      category_name: string;
      brand_name: string;
      legacy_sicar_code: string | null;
      primary_barcode: string | null;
      price_cents: number;
      attributes: Record<string, string> | null;
    }> | null
  )?.[0];
  if (!row) return null;

  return {
    id: row.variant_id,
    productId: row.product_id,
    productName: row.product_name,
    brand: row.brand_name,
    legacyCode: row.primary_barcode ?? row.legacy_sicar_code ?? code,
    color: row.attributes?.COLOR ?? "Sin color",
    size: row.attributes?.TALLA ?? "Única",
    price: row.price_cents / 100,
    stock: 0,
  };
}
