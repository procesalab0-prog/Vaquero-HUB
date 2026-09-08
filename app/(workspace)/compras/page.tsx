import type { Metadata } from "next";

import { getWorkspaceSession } from "@/lib/auth/workspace-session";
import { mockVariants } from "@/lib/mock-data";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  cancelPurchaseOrder,
  createPurchaseProduct,
  createPurchaseOrder,
  receivePurchaseOrder,
  saveSupplier,
} from "./actions";
import {
  PurchasesWorkspace,
  type PurchaseOrderView,
  type ReceiptView,
  type SupplierView,
  type VariantView,
} from "./purchases-workspace";
import type {
  PurchaseAttributeValue,
  PurchaseCategory,
} from "./quick-product-form";

export const metadata: Metadata = { title: "Compras" };

const previewCategories: PurchaseCategory[] = [
  { id: "preview-botas", name: "Botas", default_size_scale_code: "CALZADO_MX" },
];
const previewAttributeValues: PurchaseAttributeValue[] = [
  ...["25", "25.5", "26", "26.5", "27", "27.5", "28"].map((value, index) => ({
    id: `preview-size-${index}`,
    type_code: "TALLA",
    scale_code: "CALZADO_MX",
    value,
    display_order: index,
  })),
  ...["Negro", "Café", "Miel"].map((value, index) => ({
    id: `preview-color-${index}`,
    type_code: "COLOR",
    scale_code: null,
    value,
    display_order: index,
  })),
];

type Location = { id: string; name: string; code: string };

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ubicacion?: string }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    const variants: VariantView[] = mockVariants.slice(0, 8).map((variant) => ({
      id: variant.id,
      name: variant.productName,
      sku: variant.sku ?? variant.legacyCode,
      attributes: `${variant.color} · ${variant.size}`,
      costCents: Math.round(variant.price * 55),
    }));
    return (
      <PurchasesWorkspace
        saveSupplierAction={saveSupplier}
        createPurchaseOrderAction={createPurchaseOrder}
        receivePurchaseOrderAction={receivePurchaseOrder}
        cancelPurchaseOrderAction={cancelPurchaseOrder}
        createPurchaseProductAction={createPurchaseProduct}
        suppliers={[
          {
            id: "demo-provider",
            code: "LEON",
            name: "Proveedor León",
            contactName: "",
            phone: "",
            email: "",
            taxId: "",
            notes: "",
            isActive: true,
          },
        ]}
        orders={[]}
        receipts={[]}
        variants={variants}
        locations={[{ id: "preview", name: "La Piedad", code: "LP" }]}
        activeLocationId="preview"
        canManage
        canReceive
        canCreateProducts
        categories={previewCategories}
        attributeValues={previewAttributeValues}
        initialTab={params.tab}
        preview
      />
    );
  }

  const session = await getWorkspaceSession();
  if (!session?.userId || !session.profile?.is_active)
    throw new Error("NOT_AUTHORIZED");
  const { supabase, userId, profile } = session;
  const [
    locationsResult,
    permissionsResult,
    suppliersResult,
    categoriesResult,
    attributeValuesResult,
  ] = await Promise.all([
    supabase
      .from("user_locations")
      .select("locations(id,name,code,type,is_active)")
      .eq("user_id", userId),
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", profile.role_id)
      .in("permission_code", [
        "purchases.manage",
        "purchases.receive",
        "products.create",
      ]),
    supabase
      .from("suppliers")
      .select("id,code,name,contact_name,phone,email,tax_id,notes,is_active")
      .order("name"),
    supabase
      .from("categories")
      .select("id,name,default_size_scale_code")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("attribute_values")
      .select("id,type_code,scale_code,value,display_order")
      .order("display_order"),
  ]);
  if (
    locationsResult.error ||
    suppliersResult.error ||
    categoriesResult.error ||
    attributeValuesResult.error
  )
    throw (
      locationsResult.error ??
      suppliersResult.error ??
      categoriesResult.error ??
      attributeValuesResult.error
    );
  const permissionSet = new Set(
    (permissionsResult.data ?? []).map((row) => row.permission_code),
  );
  if (!permissionSet.size) throw new Error("NOT_AUTHORIZED");
  const locations = (
    (locationsResult.data ?? []) as unknown as Array<{
      locations: (Location & { type: string; is_active: boolean }) | null;
    }>
  )
    .map((row) => row.locations)
    .filter(
      (location): location is Location & { type: string; is_active: boolean } =>
        Boolean(location?.is_active && location.type !== "TRANSIT"),
    )
    .map(({ id, name, code }) => ({ id, name, code }));
  const activeLocation =
    locations.find((location) => location.id === params.ubicacion) ??
    locations[0];
  if (!activeLocation)
    return (
      <PurchasesWorkspace
        saveSupplierAction={saveSupplier}
        createPurchaseOrderAction={createPurchaseOrder}
        receivePurchaseOrderAction={receivePurchaseOrder}
        cancelPurchaseOrderAction={cancelPurchaseOrder}
        createPurchaseProductAction={createPurchaseProduct}
        suppliers={[]}
        orders={[]}
        receipts={[]}
        variants={[]}
        locations={[]}
        activeLocationId=""
        canManage={permissionSet.has("purchases.manage")}
        canReceive={permissionSet.has("purchases.receive")}
        canCreateProducts={permissionSet.has("products.create")}
        categories={(categoriesResult.data ?? []) as PurchaseCategory[]}
        attributeValues={
          (attributeValuesResult.data ?? []) as PurchaseAttributeValue[]
        }
        initialTab={params.tab}
      />
    );

  const [ordersResult, receiptsResult, variantsResult] = await Promise.all([
    supabase.rpc("list_purchase_orders", {
      p_location_id: activeLocation.id,
      p_limit: 100,
    }),
    supabase.rpc("list_purchase_receipts", {
      p_location_id: activeLocation.id,
      p_limit: 50,
    }),
    supabase.rpc("get_inventory_snapshot", {
      p_location_id: activeLocation.id,
      p_query: "",
      p_limit: 500,
    }),
  ]);
  const error =
    ordersResult.error ?? receiptsResult.error ?? variantsResult.error;
  if (error) throw error;

  const suppliers: SupplierView[] = (suppliersResult.data ?? []).map(
    (supplier) => ({
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      contactName: supplier.contact_name ?? "",
      phone: supplier.phone ?? "",
      email: supplier.email ?? "",
      taxId: supplier.tax_id ?? "",
      notes: supplier.notes ?? "",
      isActive: supplier.is_active,
    }),
  );
  const orders = (ordersResult.data ?? []).map(
    (order: Record<string, unknown>) => ({
      id: order.order_id,
      folio: Number(order.folio),
      status: order.status,
      supplierId: order.supplier_id,
      supplierName: order.supplier_name,
      expectedAt: order.expected_at,
      notes: order.notes,
      createdAt: order.created_at,
      orderedQty: Number(order.ordered_qty),
      receivedQty: Number(order.received_qty),
      totalCents: Number(order.total_cents),
      items: (order.items ?? []) as PurchaseOrderView["items"],
    }),
  ) as PurchaseOrderView[];
  const receipts = (receiptsResult.data ?? []).map(
    (receipt: Record<string, unknown>) => ({
      id: receipt.receipt_id,
      folio: Number(receipt.folio),
      orderId: receipt.order_id,
      orderFolio: Number(receipt.order_folio),
      supplierName: receipt.supplier_name,
      receivedByName: receipt.received_by_name,
      createdAt: receipt.created_at,
      items: (receipt.items ?? []) as ReceiptView["items"],
    }),
  ) as ReceiptView[];
  const variants: VariantView[] = (variantsResult.data ?? []).map(
    (variant: Record<string, unknown>) => ({
      id: String(variant.variant_id),
      name: String(variant.product_name),
      sku: String(variant.sku),
      attributes: Object.values(
        (variant.attributes ?? {}) as Record<string, string>,
      ).join(" · "),
      costCents: 0,
    }),
  );

  return (
    <PurchasesWorkspace
      saveSupplierAction={saveSupplier}
      createPurchaseOrderAction={createPurchaseOrder}
      receivePurchaseOrderAction={receivePurchaseOrder}
      cancelPurchaseOrderAction={cancelPurchaseOrder}
      createPurchaseProductAction={createPurchaseProduct}
      suppliers={suppliers}
      orders={orders}
      receipts={receipts}
      variants={variants}
      locations={locations}
      activeLocationId={activeLocation.id}
      canManage={permissionSet.has("purchases.manage")}
      canReceive={permissionSet.has("purchases.receive")}
      canCreateProducts={permissionSet.has("products.create")}
      categories={(categoriesResult.data ?? []) as PurchaseCategory[]}
      attributeValues={
        (attributeValuesResult.data ?? []) as PurchaseAttributeValue[]
      }
      initialTab={params.tab}
    />
  );
}
