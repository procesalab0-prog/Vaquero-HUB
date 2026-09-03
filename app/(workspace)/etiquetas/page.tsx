import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/authorization";
import type { LabelTemplate, ProductVariant } from "@/lib/domain";
import { mockVariants } from "@/lib/mock-data";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { saveLabelTemplate } from "./actions";
import { LabelsWorkspace } from "./labels-workspace";

export const metadata: Metadata = { title: "Etiquetas y códigos" };

const previewTemplate: LabelTemplate = {
  id: "preview-50x30",
  name: "Vaquero 50 × 30 mm",
  widthMm: 50,
  heightMm: 30,
  layout: "BALANCED",
  showLogo: true,
  showProductName: true,
  showBrand: false,
  showSize: true,
  showColor: true,
  showPrice: true,
  showSku: false,
  showBarcode: true,
  showCode: true,
  isDefault: true,
  isActive: true,
};

type CatalogRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  brand_name: string;
  primary_barcode: string | null;
  legacy_sicar_code: string | null;
  sku: string;
  price_cents: number;
  attributes: Record<string, string> | null;
  is_active: boolean;
};

type TemplateRow = {
  id: string;
  name: string;
  width_mm: number | string;
  height_mm: number | string;
  layout: LabelTemplate["layout"];
  show_logo: boolean;
  show_product_name: boolean;
  show_brand: boolean;
  show_size: boolean;
  show_color: boolean;
  show_price: boolean;
  show_sku: boolean;
  show_barcode: boolean;
  show_code: boolean;
  is_default: boolean;
  is_active: boolean;
};

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; desde?: string }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    return (
      <LabelsWorkspace
        variants={mockVariants}
        templates={[previewTemplate]}
        preview
        fromProducts={params.desde === "productos"}
      />
    );
  }

  const { supabase, roleId } = await requirePermission("products.read");
  const [catalogResult, productsResult, templatesResult, permissionsResult] =
    await Promise.all([
      supabase.rpc("search_catalog", { p_query: "", p_limit: 200 }),
      supabase.from("products").select("id, is_active"),
      supabase
        .from("label_templates")
        .select("*")
        .eq("is_active", true)
        .order("is_default", { ascending: false })
        .order("name"),
      supabase
        .from("role_permissions")
        .select("permission_code")
        .eq("role_id", roleId)
        .eq("permission_code", "products.update"),
    ]);

  if (catalogResult.error || productsResult.error || templatesResult.error) {
    console.error("[etiquetas] data unavailable", {
      catalog: catalogResult.error?.message,
      products: productsResult.error?.message,
      templates: templatesResult.error?.message,
    });
    return (
      <LabelsWorkspace
        variants={mockVariants}
        templates={[previewTemplate]}
        preview
        status="etiquetas-pendientes"
      />
    );
  }

  const activeProducts = new Set(
    (productsResult.data ?? [])
      .filter((product) => product.is_active)
      .map((product) => product.id),
  );
  const variants: ProductVariant[] = (
    (catalogResult.data ?? []) as CatalogRow[]
  )
    .filter((row) => row.is_active && activeProducts.has(row.product_id))
    .map((row) => ({
      id: row.variant_id,
      productId: row.product_id,
      productName: row.product_name,
      brand: row.brand_name,
      legacyCode: row.primary_barcode ?? row.legacy_sicar_code ?? "Sin código",
      sku: row.sku,
      color: row.attributes?.COLOR ?? "Sin color",
      size: row.attributes?.TALLA ?? "Única",
      price: row.price_cents / 100,
      isActive: row.is_active,
      stock: 0,
    }));
  const templates: LabelTemplate[] = (
    (templatesResult.data ?? []) as TemplateRow[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    widthMm: Number(row.width_mm),
    heightMm: Number(row.height_mm),
    layout: row.layout,
    showLogo: row.show_logo,
    showProductName: row.show_product_name,
    showBrand: row.show_brand,
    showSize: row.show_size,
    showColor: row.show_color,
    showPrice: row.show_price,
    showSku: row.show_sku,
    showBarcode: row.show_barcode,
    showCode: row.show_code,
    isDefault: row.is_default,
    isActive: row.is_active,
  }));

  return (
    <LabelsWorkspace
      variants={variants}
      templates={templates.length ? templates : [previewTemplate]}
      canManageTemplates={(permissionsResult.data ?? []).length > 0}
      saveTemplateAction={saveLabelTemplate}
      status={params.status}
      fromProducts={params.desde === "productos"}
    />
  );
}
