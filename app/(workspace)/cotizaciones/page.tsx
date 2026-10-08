import type { Metadata } from "next";

import { resolveActiveLocation } from "@/lib/auth/active-location";
import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { mockVariants } from "@/lib/mock-data";
import { PIECE_UNIT, type MeasureUnit } from "@/lib/measure-units";
import { QuotesWorkspace, type QuotePayload, type QuoteVariant } from "./quotes-workspace";
import { authorizeQuoteValidity, createQuote, loadQuoteForSale, markQuoteSent } from "./actions";

export const metadata: Metadata = { title: "Cotizaciones" };

type CatalogRow = {
  variant_id: string;
  product_id: string;
  product_name: string;
  brand_name: string | null;
  sku: string;
  price_cents: number;
  attributes: Record<string, string> | null;
  is_active: boolean;
};

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{
    ubicacion?: string;
    estado?: string;
    busqueda?: string;
  }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    const variants = mockVariants.map(variant => ({ id: variant.id, name: variant.productName, brand: variant.brand, sku: variant.sku ?? variant.legacyCode, description: [variant.color, variant.size].filter(Boolean).join(" · "), priceCents: Math.round(variant.price * 100) }));
    return <QuotesWorkspace locationId="preview" variants={variants} quotes={[]} preview canPersonalize />;
  }
  const { supabase, profile } = await requirePermission("quotes.manage");
  const locations = (profile?.user_locations ?? []).flatMap((entry) => (Array.isArray(entry.locations) ? entry.locations : entry.locations ? [entry.locations] : []));
  const activeLocation = await resolveActiveLocation(locations, params.ubicacion);
  if (!activeLocation) {
    return <QuotesWorkspace locationId="" variants={[]} quotes={[]} status="No tienes una sucursal asignada." />;
  }
  const allowedStatus = ["DRAFT", "SENT", "CONVERTED", "EXPIRED"].includes(params.estado ?? "") ? params.estado! : null;
  const [quotesResult, catalogResult,productsResult,unitsResult] = await Promise.all([
    supabase.rpc("list_quotes", {
      p_location_id: activeLocation.id,
      p_status: allowedStatus,
      p_query: (params.busqueda ?? "").trim().slice(0, 100),
      p_limit: 100,
    }),
    supabase.rpc("search_catalog", { p_query: "", p_limit: 500 }),
    supabase.from("products").select("id,measure_unit_code"),
    supabase.rpc("list_measure_units"),
  ]);
  const productUnits=new Map((productsResult.data??[]).map(row=>[row.id,row.measure_unit_code]));
  const units=new Map(((unitsResult.data??[]) as MeasureUnit[]).map(unit=>[unit.code,unit]));
  const variants: QuoteVariant[] = ((catalogResult.data ?? []) as CatalogRow[])
    .filter((row) => row.is_active)
    .map((row) => ({
      id: row.variant_id,
      name: row.product_name,
      brand: row.brand_name ?? "",
      sku: row.sku,
      description: [row.attributes?.COLOR, row.attributes?.TALLA].filter(Boolean).join(" · ") || "Única",
      priceCents: Number(row.price_cents),
      measureUnit: units.get(productUnits.get(row.product_id)??'PIECE')??PIECE_UNIT,
    }));
  const role = Array.isArray(profile?.roles) ? profile.roles[0] : profile?.roles;
  return <QuotesWorkspace locationId={activeLocation.id} locationName={activeLocation.name} locationAddress={activeLocation.address} locationPhone={activeLocation.phone} variants={productsResult.error||unitsResult.error?[]:variants} quotes={(quotesResult.data ?? []) as QuotePayload[]} status={quotesResult.error?.message ?? catalogResult.error?.message ?? productsResult.error?.message ?? unitsResult.error?.message} canPersonalize={role?.code === "ADMIN"} validityAction={authorizeQuoteValidity} createAction={createQuote} sendAction={markQuoteSent} loadAction={loadQuoteForSale} />;
}
