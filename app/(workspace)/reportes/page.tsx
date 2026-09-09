import type { Metadata } from "next";

import { resolveActiveLocation } from "@/lib/auth/active-location";
import { requirePermission } from "@/lib/auth/authorization";
import {
  isReportGrouping,
  reportDateRange,
  reportDefaultDates,
  type ReportGrouping,
  validReportDate,
} from "@/lib/reports";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  ReportsWorkspace,
  type InventoryReport,
  type SalesReport,
} from "./reports-workspace";

export const metadata: Metadata = { title: "Reportes" };

type Location = { id: string; name: string; code: string };
const previewLocation = { id: "preview", name: "La Piedad", code: "LAP" };

function previewSales(): SalesReport {
  const soldAt = new Date().toISOString();
  return {
    scope: "SALES",
    summary: {
      sale_count: 2,
      item_count: 3,
      gross_cents: 757000,
      discount_cents: 20000,
      net_cents: 737000,
      payment_total_cents: 737000,
      cancelled_count: 0,
    },
    periods: [
      {
        period_key: soldAt.slice(0, 10),
        sale_count: 2,
        item_count: 3,
        net_cents: 737000,
      },
    ],
    products: [
      {
        product_name: "Bota vaquera de piel",
        sku: "BOT-260-MIE",
        variant_description: "Miel · 26",
        quantity: 2,
        net_cents: 558000,
      },
      {
        product_name: "Cinturón piteado",
        sku: "CIN-034-CAF",
        variant_description: "Café · 34",
        quantity: 1,
        net_cents: 179000,
      },
    ],
    payments: [
      { code: "CASH", name: "Efectivo", amount_cents: 300000 },
      { code: "CARD", name: "Tarjeta", amount_cents: 437000 },
    ],
    details: [
      {
        sale_id: "preview-1",
        folio: "LAP-V-000142",
        sold_at: soldAt,
        cashier_name: "Salomon",
        product_name: "Bota vaquera de piel",
        sku: "BOT-260-MIE",
        variant_description: "Miel · 26",
        quantity: 2,
        discount_cents: 20000,
        net_cents: 558000,
      },
      {
        sale_id: "preview-2",
        folio: "LAP-V-000141",
        sold_at: soldAt,
        cashier_name: "Salomon",
        product_name: "Cinturón piteado",
        sku: "CIN-034-CAF",
        variant_description: "Café · 34",
        quantity: 1,
        discount_cents: 0,
        net_cents: 179000,
      },
    ],
    truncated: false,
  };
}

function previewInventory(): InventoryReport {
  return {
    summary: {
      variant_count: 2,
      qty: 8,
      reserved_qty: 1,
      available_qty: 7,
      out_count: 0,
      low_count: 1,
      cost_value_cents: 860000,
      retail_value_cents: 1295000,
    },
    categories: [
      {
        category_name: "Botas",
        variant_count: 2,
        qty: 8,
        available_qty: 7,
        cost_value_cents: 860000,
      },
    ],
    items: [
      {
        variant_id: "preview-1",
        product_name: "Bota vaquera de piel",
        category_name: "Botas",
        brand_name: "Cuadra",
        sku: "BOT-260-MIE",
        variant_description: "Miel · 26",
        qty: 6,
        reserved_qty: 1,
        available_qty: 5,
        cost_cents: 110000,
        price_cents: 279000,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      {
        variant_id: "preview-2",
        product_name: "Bota rodeo",
        category_name: "Botas",
        brand_name: "El General",
        sku: "BOT-270-NEG",
        variant_description: "Negro · 27",
        qty: 2,
        reserved_qty: 0,
        available_qty: 2,
        cost_cents: 100000,
        price_cents: 179500,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
    ],
    truncated: false,
  };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    ubicacion?: string;
    desde?: string;
    hasta?: string;
    agrupacion?: string;
    busqueda?: string;
  }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "inventario" ? "inventario" : "ventas";
  const defaults = reportDefaultDates();
  const groupingParam = params.agrupacion ?? "";
  const grouping: ReportGrouping = isReportGrouping(groupingParam)
    ? groupingParam
    : "day";
  const filters = {
    from: validReportDate(params.desde, defaults.from),
    to: validReportDate(params.hasta, defaults.to),
    grouping,
    query: (params.busqueda ?? "").trim().slice(0, 100),
  } as const;

  if (!isSupabaseConfigured()) {
    return (
      <ReportsWorkspace
        tab={tab}
        locations={[previewLocation]}
        activeLocationId={previewLocation.id}
        filters={filters}
        sales={tab === "ventas" ? previewSales() : undefined}
        inventory={tab === "inventario" ? previewInventory() : undefined}
      />
    );
  }

  const permission =
    tab === "inventario" ? "reports.inventory" : "reports.sales";
  const { supabase, profile } = await requirePermission(permission);
  const locations = (profile?.user_locations ?? []).flatMap((entry) =>
    Array.isArray(entry.locations)
      ? entry.locations
      : entry.locations
        ? [entry.locations]
        : [],
  ) as Location[];
  const activeLocation = await resolveActiveLocation(
    locations,
    params.ubicacion,
  );

  if (!activeLocation) {
    return (
      <ReportsWorkspace
        tab={tab}
        locations={locations}
        activeLocationId=""
        filters={filters}
        status="No tienes una sucursal asignada para consultar."
      />
    );
  }

  if (tab === "inventario") {
    const result = await supabase.rpc("get_inventory_report", {
      p_location_id: activeLocation.id,
      p_query: filters.query,
    });
    return (
      <ReportsWorkspace
        tab={tab}
        locations={locations}
        activeLocationId={activeLocation.id}
        filters={filters}
        inventory={result.data as InventoryReport | null}
        status={result.error?.message}
      />
    );
  }

  const range = reportDateRange(filters.from, filters.to);
  const result = await supabase.rpc("get_sales_report", {
    p_location_id: activeLocation.id,
    p_from: range.from,
    p_to: range.to,
    p_grouping: filters.grouping,
    p_query: filters.query,
  });
  return (
    <ReportsWorkspace
      tab={tab}
      locations={locations}
      activeLocationId={activeLocation.id}
      filters={filters}
      sales={result.data as SalesReport | null}
      status={result.error?.message}
    />
  );
}
