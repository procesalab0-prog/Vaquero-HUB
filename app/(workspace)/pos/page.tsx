import type { Metadata } from "next";
import { PosWorkspace } from "./pos-workspace";
import { prepareUsdExchange } from "./usd-actions";
import { mockVariants } from "@/lib/mock-data";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { productImageUrl, readCatalogCoverUrls } from "@/lib/product-images";
import type { ProductVariant } from "@/lib/domain";
import {
  authorizeOverdueCredit,
  authorizeSaleDiscount,
  cancelPosSale,
  createLayawayFromCart,
  createPosSale,
  discardPosDraft,
  getPosCustomerCredit,
  holdPosDraft,
  requestSalePrint,
  resolvePosScan,
  resumePosDraft,
  savePosCurrentDraft,
  verifyPosLoyaltyCode,
  type PosDraftPayload,
} from "./actions";

export const metadata: Metadata = { title: "Punto de venta" };

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
type InventoryRow = { variant_id: string; available_qty: number };

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ ubicacion?: string }>;
}) {
  if (!isSupabaseConfigured())
    return <PosWorkspace variants={mockVariants} preview canAccessTransfers />;
  const { supabase, profile, roleId } = await requirePermission("pos.sell");
  const transferPermissions = await supabase
    .from("role_permissions")
    .select("permission_code")
    .eq("role_id", roleId)
    .in("permission_code", [
      "inventory.read",
      "transfers.create",
      "transfers.approve",
      "transfers.receive",
    ]);
  const transferCodes = new Set(
    (transferPermissions.data ?? []).map((row) => row.permission_code),
  );
  const canAccessTransfers =
    !transferPermissions.error &&
    transferCodes.has("inventory.read") &&
    ["transfers.create", "transfers.approve", "transfers.receive"].some(
      (code) => transferCodes.has(code),
    );
  const params = await searchParams;
  const locations = (profile?.user_locations ?? []).flatMap((entry) =>
    Array.isArray(entry.locations)
      ? entry.locations
      : entry.locations
        ? [entry.locations]
        : [],
  );
  const activeLocation = await resolveActiveLocation(
    locations,
    params.ubicacion,
  );
  const { data: session } = await supabase.rpc("get_my_cash_session");
  const cashSession = session as {
    id?: string;
    location_id?: string;
    register_name?: string;
  } | null;
  if (!cashSession?.id || !cashSession.location_id) {
    return (
      <PosWorkspace
        variants={[]}
        cashSession={null}
        canAccessTransfers={canAccessTransfers}
      />
    );
  }
  if (activeLocation?.id && activeLocation.id !== cashSession.location_id) {
    return (
      <PosWorkspace
        variants={[]}
        cashSession={null}
        canAccessTransfers={canAccessTransfers}
        status="La caja abierta pertenece a otra sucursal. Cierra el turno o vuelve a esa sucursal."
      />
    );
  }
  const [catalogResult, inventoryResult, draftsResult, productsResult] =
    await Promise.all([
      supabase.rpc("search_catalog", { p_query: "", p_limit: 500 }),
      supabase.rpc("get_inventory_snapshot", {
        p_location_id: cashSession.location_id,
        p_query: "",
        p_limit: 500,
      }),
      supabase.rpc("list_my_pos_drafts", {
        p_cash_session_id: cashSession.id,
      }),
      supabase.from("products").select("id,image_path"),
    ]);
  if (
    catalogResult.error ||
    inventoryResult.error ||
    draftsResult.error ||
    productsResult.error
  ) {
    console.error("[pos] data unavailable", {
      catalog: catalogResult.error?.message,
      inventory: inventoryResult.error?.message,
      drafts: draftsResult.error?.message,
      products: productsResult.error?.message,
    });
    return (
      <PosWorkspace
        variants={[]}
        cashSession={
          cashSession as {
            id: string;
            location_id: string;
            register_name: string;
          }
        }
        status="pos-no-disponible"
        canAccessTransfers={canAccessTransfers}
      />
    );
  }
  const stocks = new Map(
    ((inventoryResult.data ?? []) as InventoryRow[]).map((row) => [
      row.variant_id,
      Number(row.available_qty),
    ]),
  );
  const images = new Map(
    (productsResult.data ?? []).map((product) => [
      product.id,
      productImageUrl(supabase, product.image_path),
    ]),
  );
  const covers = await readCatalogCoverUrls(
    supabase,
    ((catalogResult.data ?? []) as CatalogRow[]).map((row) => row.product_id),
  );
  for (const [id, url] of covers) if (!images.get(id)) images.set(id, url);
  const initialVariants = ((catalogResult.data ?? []) as CatalogRow[])
    .filter((row) => row.is_active)
    .map((row) => ({
      id: row.variant_id,
      productName: row.product_name,
      brand: row.brand_name ?? "",
      legacyCode: row.primary_barcode ?? row.legacy_sicar_code ?? row.sku,
      sku: row.sku,
      color: row.attributes?.COLOR ?? "Sin color",
      size: row.attributes?.TALLA ?? "Única",
      price: Number(row.price_cents) / 100,
      isActive: row.is_active,
      stock: stocks.get(row.variant_id) ?? 0,
      image: images.get(row.product_id),
    }));
  const requestedIds = [
    ...new Set([
      ...initialVariants.map((variant) => variant.id),
      ...((draftsResult.data ?? []) as PosDraftPayload[]).flatMap((draft) =>
        draft.items
          .filter((item) => !item.quick)
          .map((item) => item.variant_id),
      ),
    ]),
  ];
  const expanded = await supabase.rpc("get_pos_variants", {
    p_cash_session_id: cashSession.id,
    p_variant_ids: requestedIds,
  });
  if (expanded.error)
    return (
      <PosWorkspace
        variants={[]}
        cashSession={
          cashSession as {
            id: string;
            location_id: string;
            register_name: string;
          }
        }
        status="No fue posible recuperar el catálogo y tus tickets en espera. Recarga antes de vender."
      />
    );
  const variants = (
    (expanded.data ?? []) as Array<ProductVariant & { productId: string }>
  ).map((variant) => ({ ...variant, image: images.get(variant.productId) }));
  return (
    <PosWorkspace
      variants={variants}
      usdEnabled={(await supabase.rpc("usd_checkout_available")).data === true}
      prepareUsdAction={prepareUsdExchange}
      canAccessTransfers={canAccessTransfers}
      initialDrafts={(draftsResult.data ?? []) as PosDraftPayload[]}
      canCaptureQuickCost={["ADMIN", "MANAGER"].includes(
        (Array.isArray(profile?.roles) ? profile.roles[0] : profile?.roles)
          ?.code ?? "",
      )}
      cashSession={
        cashSession as {
          id: string;
          location_id: string;
          register_name: string;
        }
      }
      createSaleAction={createPosSale}
      resolveScanAction={resolvePosScan}
      verifyLoyaltyCodeAction={verifyPosLoyaltyCode}
      getCustomerCreditAction={getPosCustomerCredit}
      authorizeDiscountAction={authorizeSaleDiscount}
      authorizeCreditOverrideAction={authorizeOverdueCredit}
      printAction={requestSalePrint}
      cancelSaleAction={cancelPosSale}
      createLayawayAction={createLayawayFromCart}
      saveDraftAction={savePosCurrentDraft}
      holdDraftAction={holdPosDraft}
      resumeDraftAction={resumePosDraft}
      discardDraftAction={discardPosDraft}
    />
  );
}
