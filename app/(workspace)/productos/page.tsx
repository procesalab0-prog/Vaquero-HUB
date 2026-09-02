import type { Metadata } from "next";
import { mockVariants } from "@/lib/mock-data";
import { requirePermission } from "@/lib/auth/authorization";
import { initialCatalogImportState } from "@/lib/catalog-import-shared";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  addCatalogVariants,
  commitCatalogImport,
  createCatalogProduct,
  lookupCatalogBarcode,
  previewCatalogImport,
  registerVariantBarcode,
  updateCatalogProduct,
  updateCatalogVariant,
  updateCatalogVariantPrice,
} from "./actions";
import { ProductsWorkspace } from "./products-workspace";

export const metadata: Metadata = { title: "Productos" };

type CatalogRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  category_name: string;
  brand_name: string;
  legacy_sicar_code: string | null;
  primary_barcode: string | null;
  sku: string;
  price_cents: number;
  cost_cents: number | null;
  attributes: Record<string, string> | null;
  is_active: boolean;
};

type Category = {
  id: string;
  name: string;
  default_size_scale_code: string | null;
};
type AttributeValue = {
  id: string;
  type_code: string;
  scale_code: string | null;
  value: string;
  display_order: number;
};
type ProductRow = {
  id: string;
  category_id: string;
  description: string | null;
  is_active: boolean;
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    return (
      <ProductsWorkspace
        initialVariants={mockVariants}
        categories={[]}
        attributeValues={[]}
        preview
      />
    );
  }

  const { supabase, roleId } = await requirePermission("products.read");
  const [
    catalogResult,
    categoriesResult,
    valuesResult,
    productsResult,
    permissionsResult,
  ] = await Promise.all([
    supabase.rpc("search_catalog", { p_query: "", p_limit: 200 }),
    supabase
      .from("categories")
      .select("id, name, default_size_scale_code")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("attribute_values")
      .select("id, type_code, scale_code, value, display_order")
      .order("display_order"),
    supabase.from("products").select("id, category_id, description, is_active"),
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", roleId)
      .in("permission_code", [
        "products.create",
        "products.update",
        "products.price_update",
        "reports.inventory",
        "purchases.manage",
      ]),
  ]);

  if (
    catalogResult.error ||
    categoriesResult.error ||
    valuesResult.error ||
    productsResult.error
  ) {
    console.error("[productos] catalog unavailable", {
      catalog: catalogResult.error?.message,
      categories: categoriesResult.error?.message,
      values: valuesResult.error?.message,
      products: productsResult.error?.message,
    });
    return (
      <ProductsWorkspace
        initialVariants={mockVariants}
        categories={[]}
        attributeValues={[]}
        preview
        status="catalogo-pendiente"
      />
    );
  }

  const products = new Map(
    ((productsResult.data ?? []) as ProductRow[]).map((product) => [
      product.id,
      product,
    ]),
  );
  const permissions = new Set(
    (permissionsResult.data ?? []).map((permission) =>
      String(permission.permission_code),
    ),
  );
  const canUpdate = permissions.has("products.update");
  const canCreate = permissions.has("products.create");
  const canSeeCost =
    permissions.has("reports.inventory") || permissions.has("purchases.manage");
  const variants = ((catalogResult.data ?? []) as CatalogRow[]).map((row) => ({
    ...(() => {
      const product = products.get(row.product_id);
      return {
        categoryId: product?.category_id,
        description: product?.description ?? "",
        productActive: product?.is_active ?? true,
      };
    })(),
    id: row.variant_id,
    productId: row.product_id,
    productName: row.product_name,
    brand: row.brand_name,
    legacyCode: row.primary_barcode ?? row.legacy_sicar_code ?? "Sin código",
    sku: row.sku,
    color: row.attributes?.COLOR ?? "Sin color",
    size: row.attributes?.TALLA ?? "Única",
    price: row.price_cents / 100,
    cost: row.cost_cents === null ? undefined : row.cost_cents / 100,
    isActive: row.is_active,
    stock: 0,
  }));

  return (
    <ProductsWorkspace
      initialVariants={variants}
      categories={(categoriesResult.data ?? []) as Category[]}
      attributeValues={(valuesResult.data ?? []) as AttributeValue[]}
      status={params.status}
      createAction={canCreate ? createCatalogProduct : undefined}
      addVariantsAction={canCreate ? addCatalogVariants : undefined}
      registerBarcodeAction={canUpdate ? registerVariantBarcode : undefined}
      lookupBarcodeAction={lookupCatalogBarcode}
      updateProductAction={canUpdate ? updateCatalogProduct : undefined}
      updateVariantAction={
        canUpdate && canSeeCost ? updateCatalogVariant : undefined
      }
      updatePriceAction={
        permissions.has("products.price_update")
          ? updateCatalogVariantPrice
          : undefined
      }
      previewImportAction={canCreate ? previewCatalogImport : undefined}
      commitImportAction={canCreate ? commitCatalogImport : undefined}
      initialImportState={canCreate ? initialCatalogImportState : undefined}
    />
  );
}
