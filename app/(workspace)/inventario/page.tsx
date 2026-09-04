import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth/authorization";
import type {
  InventoryCount,
  InventoryItem,
  InventoryMovement,
  InventoryTransfer,
} from "@/lib/domain";
import { mockVariants } from "@/lib/mock-data";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  applyInventoryAdjustment,
  approveInventoryTransfer,
  cancelInventoryCount,
  cancelInventoryTransfer,
  closeInventoryCount,
  createInventoryCount,
  createInventoryTransfer,
  dispatchInventoryTransfer,
  prepareInventoryTransfer,
  receiveInventoryTransfer,
  recordInventoryCountItem,
} from "./actions";
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

type CountRow = {
  id: string;
  folio: number;
  status: InventoryCount["status"];
  created_at: string;
  closed_at: string | null;
  inventory_count_items: Array<{
    variant_id: string;
    counted_qty: number | string;
    system_qty: number | string | null;
    difference: number | string | null;
    had_movement_after_count: boolean;
  }>;
};

type TransferRow = {
  transfer_id: string;
  folio: number;
  from_location_id: string;
  from_location_name: string;
  to_location_id: string;
  to_location_name: string;
  status: InventoryTransfer["status"];
  note: string | null;
  requested_at: string;
  variant_id: string;
  product_name: string;
  sku: string;
  qty_requested: number | string;
  qty_sent: number | string | null;
  qty_received: number | string | null;
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
        counts={[]}
        transfers={[]}
        locations={[{ id: "preview", name: "La Piedad", code: "LP" }]}
        transferLocations={[{ id: "preview", name: "La Piedad", code: "LP" }]}
        activeLocationId="preview"
        status={params.status}
        preview
      />
    );
  }

  const { supabase, userId, roleId } =
    await requirePermission("inventory.read");
  const [locationsResult, permissionsResult] = await Promise.all([
    supabase
      .from("user_locations")
      .select("locations(id, name, code, type, is_active)")
      .eq("user_id", userId),
    supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role_id", roleId)
      .in("permission_code", [
        "inventory.adjust",
        "inventory.count",
        "transfers.create",
        "transfers.approve",
        "transfers.receive",
      ]),
  ]);
  if (locationsResult.error || permissionsResult.error)
    throw locationsResult.error ?? permissionsResult.error;

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
        counts={[]}
        transfers={[]}
        locations={[]}
        transferLocations={[]}
        activeLocationId=""
        status="inventario-sin-sucursal"
      />
    );
  }

  const permissionSet = new Set(
    (permissionsResult.data ?? []).map((row) => row.permission_code),
  );
  const [inventory, movementsData, countsData, transfersData, destinations] =
    await Promise.all([
      supabase.rpc("get_inventory_snapshot", {
        p_location_id: activeLocation.id,
        p_query: "",
        p_limit: 500,
      }),
      supabase.rpc("list_inventory_movements", {
        p_location_id: activeLocation.id,
        p_limit: 100,
      }),
      supabase
        .from("inventory_counts")
        .select(
          "id, folio, status, created_at, closed_at, inventory_count_items(variant_id, counted_qty, system_qty, difference, had_movement_after_count)",
        )
        .eq("location_id", activeLocation.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.rpc("list_inventory_transfers", {
        p_location_id: activeLocation.id,
        p_limit: 30,
      }),
      permissionSet.has("transfers.create") ||
      permissionSet.has("transfers.receive")
        ? supabase.rpc("list_transfer_locations")
        : Promise.resolve({ data: [] as Location[], error: null }),
    ]);

  const errors = [
    inventory,
    movementsData,
    countsData,
    transfersData,
    destinations,
  ]
    .map((result) => result.error)
    .filter(Boolean);
  if (errors.length) {
    console.error(
      "[inventario] data unavailable",
      errors.map((error) => error?.message),
    );
    return (
      <InventoryWorkspace
        items={[]}
        movements={[]}
        counts={[]}
        transfers={[]}
        locations={locations}
        transferLocations={[]}
        activeLocationId={activeLocation.id}
        status="inventario-no-disponible"
      />
    );
  }

  const items: InventoryItem[] = ((inventory.data ?? []) as InventoryRow[]).map(
    (row) => ({
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
    }),
  );
  const movements: InventoryMovement[] = (
    (movementsData.data ?? []) as MovementRow[]
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
  const counts: InventoryCount[] = ((countsData.data ?? []) as CountRow[]).map(
    (row) => ({
      id: row.id,
      folio: row.folio,
      status: row.status,
      createdAt: row.created_at,
      closedAt: row.closed_at,
      items: row.inventory_count_items.map((item) => ({
        variantId: item.variant_id,
        countedQuantity: Number(item.counted_qty),
        systemQuantity:
          item.system_qty === null ? null : Number(item.system_qty),
        difference: item.difference === null ? null : Number(item.difference),
        hadMovementAfterCount: item.had_movement_after_count,
      })),
    }),
  );
  const transferLocations = (destinations.data ?? []) as Location[];
  const transfersById = new Map<string, InventoryTransfer>();
  for (const row of (transfersData.data ?? []) as TransferRow[]) {
    const transfer = transfersById.get(row.transfer_id) ?? {
      id: row.transfer_id,
      folio: row.folio,
      fromLocationId: row.from_location_id,
      fromLocationName: row.from_location_name,
      toLocationId: row.to_location_id,
      toLocationName: row.to_location_name,
      status: row.status,
      note: row.note,
      requestedAt: row.requested_at,
      items: [],
    };
    transfer.items.push({
      variantId: row.variant_id,
      productName: row.product_name,
      sku: row.sku,
      requestedQuantity: Number(row.qty_requested),
      sentQuantity: row.qty_sent === null ? null : Number(row.qty_sent),
      receivedQuantity:
        row.qty_received === null ? null : Number(row.qty_received),
    });
    transfersById.set(row.transfer_id, transfer);
  }
  const transfers = Array.from(transfersById.values());

  return (
    <InventoryWorkspace
      items={items}
      movements={movements}
      counts={counts}
      transfers={transfers}
      locations={locations}
      transferLocations={transferLocations}
      activeLocationId={activeLocation.id}
      canAdjust={permissionSet.has("inventory.adjust")}
      canCount={permissionSet.has("inventory.count")}
      canCreateTransfer={permissionSet.has("transfers.create")}
      canApproveTransfer={permissionSet.has("transfers.approve")}
      canReceiveTransfer={permissionSet.has("transfers.receive")}
      adjustmentAction={applyInventoryAdjustment}
      createCountAction={createInventoryCount}
      recordCountAction={recordInventoryCountItem}
      closeCountAction={closeInventoryCount}
      cancelCountAction={cancelInventoryCount}
      createTransferAction={createInventoryTransfer}
      approveTransferAction={approveInventoryTransfer}
      prepareTransferAction={prepareInventoryTransfer}
      dispatchTransferAction={dispatchInventoryTransfer}
      receiveTransferAction={receiveInventoryTransfer}
      cancelTransferAction={cancelInventoryTransfer}
      status={params.status}
    />
  );
}
