import type { Metadata } from "next";
import { mockVariants } from "@/lib/mock-data";
import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createCatalogProduct } from "./actions";
import { ProductsWorkspace } from "./products-workspace";

export const metadata: Metadata = { title: "Productos" };

type CatalogRow = {
  variant_id: string;
  product_name: string;
  brand_name: string;
  legacy_sicar_code: string | null;
  primary_barcode: string | null;
  price_cents: number;
  attributes: Record<string, string> | null;
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

  const { supabase } = await requirePermission("products.read");
  const [catalogResult, categoriesResult, valuesResult] = await Promise.all([
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
  ]);

  if (catalogResult.error || categoriesResult.error || valuesResult.error) {
    console.error("[productos] catalog unavailable", {
      catalog: catalogResult.error?.message,
      categories: categoriesResult.error?.message,
      values: valuesResult.error?.message,
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

  const variants = ((catalogResult.data ?? []) as CatalogRow[]).map((row) => ({
    id: row.variant_id,
    productName: row.product_name,
    brand: row.brand_name,
    legacyCode: row.legacy_sicar_code ?? row.primary_barcode ?? "Sin código",
    color: row.attributes?.COLOR ?? "Sin color",
    size: row.attributes?.TALLA ?? "Única",
    price: row.price_cents / 100,
    stock: 0,
  }));

  return (
    <ProductsWorkspace
      initialVariants={variants}
      categories={(categoriesResult.data ?? []) as Category[]}
      attributeValues={(valuesResult.data ?? []) as AttributeValue[]}
      status={params.status}
      createAction={createCatalogProduct}
    />
  );
}
