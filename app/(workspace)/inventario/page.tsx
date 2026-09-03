import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/authorization";
import type { InventoryItem, InventoryMovement } from "@/lib/domain";
import { mockVariants } from "@/lib/mock-data";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { applyInventoryAdjustment } from "./actions";
import { InventoryWorkspace } from "./inventory-workspace";

export const metadata: Metadata = { title: "Inventario" };

type InventoryRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  brand_name: string;
  sku: string;
  primary_barcode: string | null;
  attributes: Record<string, string> | null;
  qty: number | string;
  reserved_qty: number | string;
  available_qty: number | string;
  is_active: boolean;
  updated_at: string;
};

type MovementRow = {
  id: number;
  occurred_at: string;
  variant_id: string;
  product_name: string;
  sku: string;
  movement_type: string;
  quantity: number | string;
  previous_qty: number | string;
  new_qty: number | string;
  reference_type: string;
  reference_id: string;
  user_name: string;
  metadata: Record<string, unknown> | null;
};

type Location = { id: string; name: string; code: string };

function previewItems(): InventoryItem[] {
  return mockVariants.map((item) => ({
    variantId: item.id,
    productId: item.productId ?? item.id,
    productName: item.productName,
    brand: item.brand,
    sku: item.sku ?? item.legacyCode,
    code: item.legacyCode,
    attributes: { COLOR: item.color, TALLA: item.size },
    quantity: item.stock,
    reservedQuantity: 0,
    availableQuantity: item.stock,
    isActive: item.isActive !== false,
    updatedAt: new Date().toISOString(),
  }));
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ubicacion?: string }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    return (
      <InventoryWorkspace
        items={previewItems()}
        movements={[]}
        locations={[{ id: "preview", name: "La Piedad", code: "LP" }]}
        activeLocationId="preview"
        status={params.status}
        preview
      />
    );
  }

  const { supabase, userId, roleId } =
    await requirePermission("inventory.read");
  const [locationsResult, adjustmentPermission] = await Promise.all([
    supabase
      .from("user_locations")
      .select("locations(id, name, code, type, is_active)")
      .eq("user_id", userId),
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", roleId)
      .eq("permission_code", "inventory.adjust")
      .maybeSingle(),
  ]);

  if (locationsResult.error) throw locationsResult.error;
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
  if (!activeLocation) {
    return (
      <InventoryWorkspace
        items={[]}
        movements={[]}
        locations={[]}
        activeLocationId=""
        status="inventario-sin-sucursal"
      />
    );
  }

  const [inventoryResult, movementsResult] = await Promise.all([
    supabase.rpc("get_inventory_snapshot", {
      p_location_id: activeLocation.id,
      p_query: "",
      p_limit: 500,
    }),
    supabase.rpc("list_inventory_movements", {
      p_location_id: activeLocation.id,
      p_limit: 100,
    }),
  ]);

  if (inventoryResult.error || movementsResult.error) {
    console.error("[inventario] data unavailable", {
      inventory: inventoryResult.error?.message,
      movements: movementsResult.error?.message,
    });
    return (
      <InventoryWorkspace
        items={[]}
        movements={[]}
        locations={locations}
        activeLocationId={activeLocation.id}
        status="inventario-no-disponible"
      />
    );
  }

  const items: InventoryItem[] = (
    (inventoryResult.data ?? []) as InventoryRow[]
  ).map((row) => ({
    variantId: row.variant_id,
    productId: row.product_id,
    productName: row.product_name,
    brand: row.brand_name,
    sku: row.sku,
    code: row.primary_barcode ?? row.sku,
    attributes: row.attributes ?? {},
    quantity: Number(row.qty),
    reservedQuantity: Number(row.reserved_qty),
    availableQuantity: Number(row.available_qty),
    isActive: row.is_active,
    updatedAt: row.updated_at,
  }));
  const movements: InventoryMovement[] = (
    (movementsResult.data ?? []) as MovementRow[]
  ).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    variantId: row.variant_id,
    productName: row.product_name,
    sku: row.sku,
    type: row.movement_type,
    quantity: Number(row.quantity),
    previousQuantity: Number(row.previous_qty),
    newQuantity: Number(row.new_qty),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    userName: row.user_name,
    metadata: row.metadata ?? {},
  }));

  return (
    <InventoryWorkspace
      items={items}
      movements={movements}
      locations={locations}
      activeLocationId={activeLocation.id}
      canAdjust={Boolean(adjustmentPermission.data)}
      adjustmentAction={applyInventoryAdjustment}
      status={params.status}
    />
  );
}
