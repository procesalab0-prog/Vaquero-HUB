import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CircleDollarSign,
  PackagePlus,
  PackageCheck,
  ShoppingCart,
  Store,
  Tags,
} from "lucide-react";
import { DashboardGreeting } from "./dashboard-greeting";

export const metadata: Metadata = { title: "Inicio" };

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

function currentDateLabel() {
  const label = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Mexico_City" }).format(new Date());
  return label.charAt(0).toLocaleUpperCase("es-MX") + label.slice(1);
}

export default function DashboardPage() {
  return (
    <section className="module-page dashboard-page">
      <div className="section-heading">
        <DashboardGreeting dateLabel={currentDateLabel()} />
        <Link className="primary-button" href="/pos"><ShoppingCart aria-hidden="true" />Nueva venta</Link>
      </div>

      <div className="metric-grid">
        <article className="metric-card metric-sales"><span className="metric-icon"><CircleDollarSign aria-hidden="true" /></span><span>Venta de hoy</span><strong>{money.format(16240)}</strong><small>8 tickets · promedio {money.format(2030)}</small></article>
        <article className="metric-card metric-cash"><span className="metric-icon"><Store aria-hidden="true" /></span><span>Caja esperada</span><strong>{money.format(18740)}</strong><small>Incluye fondo de {money.format(2500)}</small></article>
        <article className="metric-card metric-units"><span className="metric-icon"><PackageCheck aria-hidden="true" /></span><span>Unidades vendidas</span><strong>14</strong><small>3 tickets de regalo</small></article>
        <article className="metric-card metric-alert"><span className="metric-icon"><AlertTriangle aria-hidden="true" /></span><span>Inventario crítico</span><strong>2</strong><small>1 agotado · 1 última pieza</small></article>
      </div>

      <div className="dashboard-columns">
        <section className="content-card">
          <div className="card-heading"><div><p className="eyebrow">Accesos rápidos</p><h2>Operación diaria</h2></div></div>
          <div className="quick-actions">
            <Link href="/pos"><ShoppingCart aria-hidden="true" /><span><strong>Iniciar venta</strong><small>Escanear o buscar productos</small></span><ArrowRight aria-hidden="true" /></Link>
            <Link href="/productos"><PackagePlus aria-hidden="true" /><span><strong>Nuevo producto</strong><small>Crear variantes y códigos</small></span><ArrowRight aria-hidden="true" /></Link>
            <Link href="/etiquetas"><Tags aria-hidden="true" /><span><strong>Imprimir etiquetas</strong><small>Códigos heredados o nuevos</small></span><ArrowRight aria-hidden="true" /></Link>
            <Link href="/caja"><CircleDollarSign aria-hidden="true" /><span><strong>Revisar caja</strong><small>Movimientos y corte</small></span><ArrowRight aria-hidden="true" /></Link>
          </div>
        </section>

        <section className="content-card">
          <div className="card-heading"><div><p className="eyebrow">Atención</p><h2>Pendientes</h2></div><Link href="/inventario">Ver inventario</Link></div>
          <div className="alert-list">
            <article><span className="alert-icon warning"><AlertTriangle aria-hidden="true" /></span><div><strong>Última pieza</strong><p>Bota Cuadra piel de venado · Café · 26</p></div><code>750104020268</code></article>
            <article><span className="alert-icon error"><AlertTriangle aria-hidden="true" /></span><div><strong>Producto agotado</strong><p>Camisa western manga larga · Azul · M</p></div><code>195696170455</code></article>
            <article><span className="alert-icon neutral"><Store aria-hidden="true" /></span><div><strong>Preparado para crecer</strong><p>Agrega otra tienda desde Ajustes → Sucursales.</p></div></article>
          </div>
        </section>
      </div>

      <section className="content-card recent-sales">
        <div className="card-heading"><div><p className="eyebrow">Actividad</p><h2>Ventas recientes</h2></div><Link href="/tickets">Ver todos los tickets</Link></div>
        <div className="compact-table">
          <div className="compact-row compact-header"><span>Folio</span><span>Hora</span><span>Artículos</span><span>Pago</span><span>Total</span></div>
          <div className="compact-row"><code>V-000842</code><span>14:32</span><span>2</span><span>Tarjeta</span><strong>{money.format(5780)}</strong></div>
          <div className="compact-row"><code>V-000841</code><span>13:05</span><span>1</span><span>Efectivo</span><strong>{money.format(2890)}</strong></div>
          <div className="compact-row"><code>V-000840</code><span>11:48</span><span>3</span><span>Transferencia</span><strong>{money.format(4360)}</strong></div>
        </div>
      </section>
    </section>
  );
}
