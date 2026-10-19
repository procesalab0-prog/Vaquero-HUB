import type { InventoryItem } from "./domain";
import {
  quantityUnit,
  summarizeMeasureQuantities,
  type MeasureUnit,
} from "./measure-units";
import { summarizeInventory } from "./inventory-summary";

export type InventoryFilter = "all" | "available" | "last" | "out";
export type InventoryCatalogQuery = {
  locationId: string;
  query: string;
  filter: InventoryFilter;
  page: number;
  exact: boolean;
};
export type InventoryCatalogSummary = {
  variantCount: number;
  outCount: number;
  lowCount: number;
  units: Array<{
    unit: MeasureUnit;
    quantity: number;
    reservedQuantity: number;
    availableQuantity: number;
  }>;
};
export type InventoryCatalog = {
  items: InventoryItem[];
  query: string;
  filter: InventoryFilter;
  exact: boolean;
  page: number;
  pageSize: number;
  totalCount: number;
  summary: InventoryCatalogSummary;
};
export type InventoryCatalogLookup = (
  input: InventoryCatalogQuery,
) => Promise<
  { ok: true; data: InventoryCatalog } | { ok: false; message: string }
>;
export type InventoryCatalogRow = {
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
  measure_unit: MeasureUnit;
};
export type InventoryCatalogTransport = {
  items: InventoryCatalogRow[];
  query: string;
  filter: InventoryFilter;
  exact: boolean;
  page: number;
  page_size: number;
  total_count: number;
  summary: {
    variant_count: number;
    out_count: number;
    low_count: number;
    units: Array<{
      unit: MeasureUnit;
      quantity: number | string;
      reserved_quantity: number | string;
      available_quantity: number | string;
    }>;
  };
};
export function mapInventoryCatalog(
  raw: InventoryCatalogTransport,
): InventoryCatalog {
  return {
    query: raw.query,
    filter: raw.filter,
    exact: raw.exact,
    page: Number(raw.page),
    pageSize: Number(raw.page_size),
    totalCount: Number(raw.total_count),
    items: raw.items.map((row) => ({
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
      measureUnit: row.measure_unit,
    })),
    summary: {
      variantCount: Number(raw.summary.variant_count),
      outCount: Number(raw.summary.out_count),
      lowCount: Number(raw.summary.low_count),
      units: raw.summary.units.map((u) => ({
        unit: u.unit,
        quantity: Number(u.quantity),
        reservedQuantity: Number(u.reserved_quantity),
        availableQuantity: Number(u.available_quantity),
      })),
    },
  };
}

export function previewInventoryCatalog(
  items: InventoryItem[],
  input: Omit<InventoryCatalogQuery, "locationId">,
): InventoryCatalog {
  const term = input.query.trim().toLocaleLowerCase("es-MX");
  const matches = items.filter(
    (item) =>
      (!term ||
        (input.exact
          ? item.code === input.query.trim() || item.sku === input.query.trim()
          : [
              item.productName,
              item.brand,
              item.code,
              item.sku,
              ...Object.values(item.attributes),
            ]
              .join(" ")
              .toLocaleLowerCase("es-MX")
              .includes(term))) &&
      (input.filter === "all" ||
        (input.filter === "available" && item.availableQuantity > 0) ||
        (input.filter === "last" &&
          item.availableQuantity > 0 &&
          item.availableQuantity <= 1) ||
        (input.filter === "out" && item.availableQuantity <= 0)),
  );
  const page = Math.min(
    input.page,
    Math.max(1, Math.ceil(matches.length / 50)),
  );
  return {
    ...input,
    page,
    pageSize: 50,
    totalCount: matches.length,
    items: matches.slice((page - 1) * 50, page * 50),
    summary: {
      variantCount: items.length,
      ...summarizeInventory(items),
      units: summarizeMeasureQuantities(items).map((u) => ({
        ...u,
        quantity: u.availableQuantity + u.reservedQuantity,
        unit: quantityUnit({ measureUnit: u.unit }),
      })),
    },
  };
}
