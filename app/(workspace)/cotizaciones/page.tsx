import type { Metadata } from "next";

import { resolveActiveLocation } from "@/lib/auth/active-location";
import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { QuotesWorkspace, type QuotePayload, type QuoteVariant } from "./quotes-workspace";
import { createQuote, loadQuoteForSale, markQuoteSent } from "./actions";

export const metadata: Metadata = { title: "Cotizaciones" };

type CatalogRow = {
  variant_id: string;
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
  searchParams: Promise<{ ubicacion?: string; estado?: string; busqueda?: string }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    return <QuotesWorkspace locationId="preview" variants={[]} quotes={[]} preview />;
  }
  const { supabase, profile } = await requirePermission("quotes.manage");
  const locations = (profile?.user_locations ?? []).flatMap((entry) =>
    Array.isArray(entry.locations) ? entry.locations : entry.locations ? [entry.locations] : [],
  );
  const activeLocation = await resolveActiveLocation(locations, params.ubicacion);
  if (!activeLocation) {
    return <QuotesWorkspace locationId="" variants={[]} quotes={[]} status="No tienes una sucursal asignada." />;
  }
  const allowedStatus = ["DRAFT", "SENT", "CONVERTED", "EXPIRED"].includes(params.estado ?? "")
    ? params.estado!
    : null;
  const [quotesResult, catalogResult] = await Promise.all([
    supabase.rpc("list_quotes", {
      p_location_id: activeLocation.id,
      p_status: allowedStatus,
      p_query: (params.busqueda ?? "").trim().slice(0, 100),
      p_limit: 100,
    }),
    supabase.rpc("search_catalog", { p_query: "", p_limit: 500 }),
  ]);
  const variants: QuoteVariant[] = ((catalogResult.data ?? []) as CatalogRow[])
    .filter((row) => row.is_active)
    .map((row) => ({
      id: row.variant_id,
      name: row.product_name,
      brand: row.brand_name ?? "",
      sku: row.sku,
      description: [row.attributes?.COLOR, row.attributes?.TALLA].filter(Boolean).join(" · ") || "Única",
      priceCents: Number(row.price_cents),
    }));
  return (
    <QuotesWorkspace
      locationId={activeLocation.id}
      variants={variants}
      quotes={(quotesResult.data ?? []) as QuotePayload[]}
      status={quotesResult.error?.message ?? catalogResult.error?.message}
      createAction={createQuote}
      sendAction={markQuoteSent}
      loadAction={loadQuoteForSale}
    />
  );
}
