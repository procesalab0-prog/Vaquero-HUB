import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CircleDollarSign, PackagePlus, PackageCheck, ShoppingCart, Store, Tags } from "lucide-react";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { getWorkspaceSession } from "@/lib/auth/workspace-session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { InventoryReport, SalesReport } from "../reportes/reports-workspace";
import { DashboardGreeting } from "./dashboard-greeting";

export const metadata: Metadata = { title: "Inicio" };

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
type RecentTicket = { id: string; folio: string; status: "COMPLETED" | "CANCELLED"; sold_at: string; total_cents: number; items: Array<{ quantity: number }>; payments: Array<{ method_name: string }> };
type CashSessionSummary = { location_id: string; register_name: string };

function currentDateLabel() {
  const label = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Mexico_City" }).format(new Date());
  return label.charAt(0).toLocaleUpperCase("es-MX") + label.slice(1);
}

function todayRange() {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Mexico_City" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const from = new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00-06:00`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ ubicacion?: string }> }) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();
  const session = configured ? await getWorkspaceSession() : null;
  const profile = session?.profile;
  const locations = (profile?.user_locations ?? []).flatMap((entry) => Array.isArray(entry.locations) ? entry.locations : entry.locations ? [entry.locations] : []).filter((item) => item.is_active && item.type !== "TRANSIT");
  const location = configured ? await resolveActiveLocation(locations, params.ubicacion) : null;
  const link = (path: string) => location ? `${path}?ubicacion=${encodeURIComponent(location.id)}` : path;
  let sales: SalesReport | null = null;
  let inventory: InventoryReport | null = null;
  let recent: RecentTicket[] = [];
  let cashSession: CashSessionSummary | null = null;
  let canReportSales = false;
  let canViewCash = false;
  const errors: string[] = [];

  if (location && session?.supabase && profile?.is_active) {
    const { supabase } = session;
    const permissionsResult = await supabase.from("role_permissions").select("permission_code").eq("role_id", profile.role_id).in("permission_code", ["reports.sales", "reports.inventory", "pos.sell", "cash.open"]);
    if (permissionsResult.error) {
      errors.push("No fue posible comprobar los permisos del resumen.");
    } else {
      const permissions = new Set((permissionsResult.data ?? []).map((item) => item.permission_code));
      canReportSales = permissions.has("reports.sales");
      canViewCash = permissions.has("cash.open");
      const range = todayRange();
      const [salesResult, inventoryResult, ticketsResult, cashResult] = await Promise.all([
        canReportSales ? supabase.rpc("get_sales_report", { p_location_id: location.id, p_from: range.from, p_to: range.to, p_grouping: "day", p_query: "" }) : null,
        permissions.has("reports.inventory") ? supabase.rpc("get_inventory_report", { p_location_id: location.id, p_query: "" }) : null,
        permissions.has("pos.sell") ? supabase.rpc("list_sale_tickets", { p_location_id: location.id, p_query: "", p_from: null, p_to: null, p_limit: 5 }) : null,
          canViewCash ? supabase.rpc("get_my_cash_session") : null,
      ]);
      if (salesResult?.error) errors.push("No fue posible cargar las ventas de hoy.");
      else sales = (salesResult?.data as SalesReport | null) ?? null;
      if (inventoryResult?.error) errors.push("No fue posible cargar el inventario.");
      else inventory = (inventoryResult?.data as InventoryReport | null) ?? null;
      if (ticketsResult?.error) errors.push("No fue posible cargar los tickets recientes.");
      else recent = (ticketsResult?.data as RecentTicket[] | null) ?? [];
      if (cashResult?.error) { errors.push("No fue posible cargar el estado de caja."); canViewCash = false; }
      else cashSession = (cashResult?.data as CashSessionSummary | null) ?? null;
    }
  }

  const salesSummary = sales?.summary;
  const inventorySummary = inventory?.summary;
  const cashLocation = locations.find((item) => item.id === cashSession?.location_id);

  return <section className="module-page dashboard-page">
    <div className="section-heading"><DashboardGreeting dateLabel={currentDateLabel()} /><Link className="primary-button" href={link("/pos")}><ShoppingCart aria-hidden="true" />Nueva venta</Link></div>
    {!configured ? <div className="notice-banner">Vista de demostración: las cifras reales aparecerán al conectar la tienda.</div> : null}
    {configured && !location ? <div className="inline-error" role="alert">Selecciona una sucursal para consultar sus datos.</div> : null}
    {errors.length ? <div className="inline-error" role="alert">{errors.join(" ")}</div> : null}
    <div className="metric-grid">
      <article className="metric-card metric-sales"><span className="metric-icon"><CircleDollarSign aria-hidden="true" /></span><span>Venta de hoy{location ? ` · ${location.name}` : ""}</span><strong>{salesSummary ? money.format(Number(salesSummary.net_cents) / 100) : "—"}</strong><small>{salesSummary ? `${salesSummary.sale_count} tickets · promedio ${money.format(salesSummary.sale_count ? Number(salesSummary.net_cents) / salesSummary.sale_count / 100 : 0)}` : "Disponible para gerencia en Reportes"}</small></article>
      <article className="metric-card metric-cash"><span className="metric-icon"><Store aria-hidden="true" /></span><span>Mi caja</span><strong>{canViewCash ? cashSession ? "Abierta" : "Sin turno abierto" : "—"}</strong><small>{cashSession ? `${cashSession.register_name} · ${cashLocation?.name ?? "otra sucursal"}` : canViewCash ? "El efectivo esperado se revela sólo después del conteo" : "Consulta Caja para ver el estado de tu turno"}</small></article>
      <article className="metric-card metric-units"><span className="metric-icon"><PackageCheck aria-hidden="true" /></span><span>Unidades vendidas hoy</span><strong>{salesSummary ? Number(salesSummary.item_count) : "—"}</strong><small>{salesSummary ? "Ventas completadas de esta sucursal" : "Disponible para gerencia en Reportes"}</small></article>
      <article className="metric-card metric-alert"><span className="metric-icon"><AlertTriangle aria-hidden="true" /></span><span>Inventario crítico</span><strong>{inventorySummary ? Number(inventorySummary.out_count) + Number(inventorySummary.low_count) : "—"}</strong><small>{inventorySummary ? `${inventorySummary.out_count} agotadas · ${inventorySummary.low_count} con hasta 2 disponibles` : "Disponible para gerencia en Reportes"}</small></article>
    </div>
    <div className="dashboard-columns">
      <section className="content-card"><div className="card-heading"><div><p className="eyebrow">Accesos rápidos</p><h2>Operación diaria</h2></div></div><div className="quick-actions">
        <Link href={link("/pos")}><ShoppingCart aria-hidden="true" /><span><strong>Iniciar venta</strong><small>Escanear o buscar productos</small></span><ArrowRight aria-hidden="true" /></Link>
        <Link href={link("/productos")}><PackagePlus aria-hidden="true" /><span><strong>Nuevo producto</strong><small>Crear variantes y códigos</small></span><ArrowRight aria-hidden="true" /></Link>
        <Link href={link("/etiquetas")}><Tags aria-hidden="true" /><span><strong>Imprimir etiquetas</strong><small>Códigos heredados o nuevos</small></span><ArrowRight aria-hidden="true" /></Link>
        <Link href={link("/caja")}><CircleDollarSign aria-hidden="true" /><span><strong>Revisar caja</strong><small>Movimientos y corte</small></span><ArrowRight aria-hidden="true" /></Link>
      </div></section>
      <section className="content-card"><div className="card-heading"><div><p className="eyebrow">Atención</p><h2>Inventario de {location?.name ?? "la sucursal"}</h2></div><Link href={link("/inventario")}>Ver inventario</Link></div><div className="alert-list">
        {inventorySummary ? <><article><span className="alert-icon error"><AlertTriangle aria-hidden="true" /></span><div><strong>Agotadas: {inventorySummary.out_count}</strong><p>Variantes sin disponibilidad en esta sucursal.</p></div></article><article><span className="alert-icon warning"><AlertTriangle aria-hidden="true" /></span><div><strong>Existencia baja: {inventorySummary.low_count}</strong><p>Variantes con una o dos piezas disponibles.</p></div></article></> : <p className="empty-copy">Consulta Inventario para revisar las existencias de esta sucursal.</p>}
      </div></section>
    </div>
    <section className="content-card recent-sales"><div className="card-heading"><div><p className="eyebrow">Actividad</p><h2>{canReportSales ? "Ventas recientes" : "Mis ventas recientes"}</h2></div><Link href={link("/tickets")}>Ver todos los tickets</Link></div>
      {recent.length ? <div className="compact-table"><div className="compact-row compact-header"><span>Folio</span><span>Hora</span><span>Artículos</span><span>Pago</span><span>Total</span></div>{recent.map((ticket) => <div className="compact-row" key={ticket.id}>
        <Link href={`${link("/tickets")}${location ? "&" : "?"}venta=${encodeURIComponent(ticket.id)}`}>{ticket.folio}</Link><span>{new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" }).format(new Date(ticket.sold_at))}</span><span>{ticket.items.reduce((sum, item) => sum + Number(item.quantity), 0)}</span><span>{ticket.status === "CANCELLED" ? "Cancelada" : ticket.payments.map((payment) => payment.method_name).join(" + ") || "—"}</span><strong>{money.format(Number(ticket.total_cents) / 100)}</strong>
      </div>)}</div> : <p className="empty-copy">No hay tickets visibles en esta sucursal.</p>}
    </section>
  </section>;
}
