import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  PackageSearch,
  Search,
  ShoppingBag,
  Tags,
} from "lucide-react";
import { LocationPreferenceSelect } from "@/components/location-preference-select";

import type { ReportGrouping } from "@/lib/reports";

type Location = { id: string; name: string; code: string };
type Filters = {
  from: string;
  to: string;
  grouping: ReportGrouping;
  query: string;
  categoryId?: string;
  department?: string;
};

export type SalesReport = {
  scope: "SALES" | "PRODUCT_LINES";
  summary: {
    unit_quantities?: Array<{code:string;name:string;quantity:number}>;
    sale_count: number;
    item_count: number;
    gross_cents: number;
    discount_cents: number;
    net_cents: number;
    payment_total_cents: number | null;
    cancelled_count: number;
  };
  periods: Array<{
    unit_quantities?: Array<{code:string;name:string;quantity:number}>;
    period_key: string;
    sale_count: number;
    item_count: number;
    net_cents: number;
  }>;
  products: Array<{
    unit_code?: string;
    product_name: string;
    sku: string;
    variant_description: string;
    category_name?: string | null;
    department_name?: string | null;
    quantity: number;
    net_cents: number;
  }>;
  payments: Array<{ code: string; name: string; amount_cents: number }>;
  details: Array<{
    measureUnit?: import('@/lib/measure-units').MeasureUnit;
    sale_id: string;
    folio: string;
    sold_at: string;
    cashier_name: string;
    category_name?: string | null;
    department_name?: string | null;
    product_name: string;
    sku: string;
    variant_description: string;
    quantity: number;
    discount_cents: number;
    net_cents: number;
  }>;
  truncated: boolean;
};

export type InventoryReport = {
  summary: {
    unit_quantities?: Array<{code:string;name:string;qty:number;available_qty:number;reserved_qty:number}>;
    variant_count: number;
    qty: number;
    reserved_qty: number;
    available_qty: number;
    out_count: number;
    low_count: number;
    cost_value_cents: number;
    retail_value_cents: number;
  };
  categories: Array<{
    category_name: string;
    department_name?: string | null;
    variant_count: number;
    qty: number;
    available_qty: number;
    cost_value_cents: number;
  }>;
  items: Array<{
    measureUnit?: import('@/lib/measure-units').MeasureUnit;
    variant_id: string;
    product_name: string;
    category_name: string;
    brand_name: string;
    sku: string;
    variant_description: string;
    qty: number;
    reserved_qty: number;
    available_qty: number;
    cost_cents: number;
    price_cents: number;
    is_active: boolean;
    updated_at: string;
  }>;
  truncated: boolean;
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const quantity = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 });
const dateTime = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Mexico_City",
});

function cents(value: number) {
  return money.format(Number(value ?? 0) / 100);
}

function tabHref(tab: "ventas" | "inventario", locationId: string, filters: Filters) {
  const query = new URLSearchParams({ tab });
  if (locationId) query.set("ubicacion", locationId);
  query.set("desde", filters.from); query.set("hasta", filters.to); query.set("agrupacion", filters.grouping);
  if (filters.query) query.set("busqueda", filters.query);
  if (filters.categoryId) query.set("categoria", filters.categoryId);
  if (filters.department) query.set("departamento", filters.department);
  return `/reportes?${query.toString()}`;
}

export function ReportsWorkspace({
  tab,
  locations,
  activeLocationId,
  filters,
  sales,
  inventory,
  status,
  classifications = { categories: [], departments: [] },
  preview = false,
}: {
  tab: "ventas" | "inventario";
  locations: Location[];
  activeLocationId: string;
  filters: Filters;
  sales?: SalesReport | null;
  inventory?: InventoryReport | null;
  status?: string;
  classifications?: { categories: Array<{ id: string; name: string }>; departments: string[] };
  preview?: boolean;
}) {
  return (
    <section className="module-page reports-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Información para decidir</p>
          <h1>Reportes reales</h1>
          <p className="heading-copy">
            Consulta ventas por periodo, producto o variante y revisa la
            existencia valorizada de cada sucursal.
          </p>
        </div>
      </div>

      <nav className="report-tabs" aria-label="Tipo de reporte">
        <Link href={`/reportes/costos?${new URLSearchParams({ubicacion:activeLocationId,desde:filters.from,hasta:filters.to})}`}>Costos y entradas</Link>
        <Link
          className={tab === "ventas" ? "active" : ""}
          href={tabHref("ventas", activeLocationId, filters)}
        >
          <BarChart3 aria-hidden="true" /> Ventas
        </Link>
        <Link
          className={tab === "inventario" ? "active" : ""}
          href={tabHref("inventario", activeLocationId, filters)}
        >
          <Boxes aria-hidden="true" /> Inventario
        </Link>
      </nav>

      <form key={`${tab}:${activeLocationId}:${JSON.stringify(filters)}`} className="toolbar-card report-filters" method="get">
        <input type="hidden" name="tab" value={tab} />
        <div className="toolbar-select">
          <span>Sucursal</span>
          <LocationPreferenceSelect
            locations={locations}
            defaultValue={activeLocationId}
          />
        </div>
        {tab === "ventas" ? (
          <>
            <label className="toolbar-select">
              <span>Desde</span>
              <input type="date" name="desde" defaultValue={filters.from} />
            </label>
            <label className="toolbar-select">
              <span>Hasta</span>
              <input type="date" name="hasta" defaultValue={filters.to} />
            </label>
            <label className="toolbar-select">
              <span>Dividir por</span>
              <select name="agrupacion" defaultValue={filters.grouping}>
                <option value="day">Día</option>
                <option value="week">Semana</option>
                <option value="month">Mes</option>
                <option value="year">Año</option>
              </select>
            </label>
          </>
        ) : null}
        <label className="toolbar-select"><span>Categoría</span><select aria-label="Categoría" name="categoria" defaultValue={filters.categoryId ?? ""}>
          <option value="">Todas las categorías</option>{classifications.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <label className="toolbar-select"><span>Departamento</span><select aria-label="Departamento" name="departamento" defaultValue={filters.department ?? ""}>
          <option value="">Todos los departamentos</option>{classifications.departments.map(department => <option key={department} value={department}>{department}</option>)}
        </select></label>
        <label className="module-search report-search">
          <Search aria-hidden="true" />
          <input
            name="busqueda"
            defaultValue={filters.query}
            maxLength={100}
            placeholder="Producto, SKU, talla o color"
            aria-label="Buscar producto o variante"
          />
        </label>
        <button className="primary-button" type="submit">
          Consultar
        </button>
      </form>
      <p className="notice">Categoría y departamento son la clasificación actual del catálogo. El departamento se asigna en Productos; no se deduce de la categoría ni del código.</p>
      {preview ? <p className="notice">Datos de demostración. Los filtros no ejecutan consultas reales sin conexión a Supabase.</p> : null}

      {status ? (
        <div className="status-banner error">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>No fue posible cargar este reporte</strong>
            <p>{status}</p>
          </div>
        </div>
      ) : null}
      {!status && tab === "ventas" && sales ? (
        <SalesResults report={sales} query={filters.query} />
      ) : null}
      {!status && tab === "inventario" && inventory ? (
        <InventoryResults report={inventory} />
      ) : null}
    </section>
  );
}

function SalesResults({
  report,
  query,
}: {
  report: SalesReport;
  query: string;
}) {
  const summary = report.summary;
  const paymentMatches = summary.payment_total_cents === summary.net_cents;
  return (
    <>
      {report.scope === "PRODUCT_LINES" ? (
        <div className="status-banner">
          <PackageSearch aria-hidden="true" />
          <div>
            <strong>{query ? `Resultado sólo para “${query}”` : "Resultado de la clasificación seleccionada"}</strong>
            <p>
              Los importes corresponden a los renglones coincidentes, aunque el
              ticket tenga otros productos.
            </p>
          </div>
        </div>
      ) : null}
      <div className="report-summary-grid">
        <article>
          <ShoppingBag aria-hidden="true" />
          <span>Ventas</span>
          <strong>{quantity.format(summary.sale_count)}</strong>
          <small>{summary.unit_quantities?.map(unit=>`${quantity.format(unit.quantity)} ${unit.name}`).join(' · ')??`${quantity.format(summary.item_count)} piezas`}</small>
        </article>
        <article>
          <CircleDollarSign aria-hidden="true" />
          <span>Venta neta</span>
          <strong>{cents(summary.net_cents)}</strong>
          <small>Bruto {cents(summary.gross_cents)}</small>
        </article>
        <article>
          <Tags aria-hidden="true" />
          <span>Descuentos</span>
          <strong>{cents(summary.discount_cents)}</strong>
          <small>{summary.cancelled_count} canceladas</small>
        </article>
        <article>
          <CalendarDays aria-hidden="true" />
          <span>Control de cobros</span>
          <strong>
            {query ? "Por producto" : paymentMatches ? "Cuadra" : "Revisar"}
          </strong>
          <small>
            {query
              ? "No reparte pagos mixtos"
              : cents(summary.payment_total_cents ?? 0)}
          </small>
        </article>
      </div>

      <div className="report-grid">
        <section className="content-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Evolución</p>
              <h2>Ventas por periodo</h2>
            </div>
          </div>
          <div className="report-list">
            {report.periods.map((period) => (
              <div key={period.period_key}>
                <span>
                  <strong>{period.period_key}</strong>
                  <small>
                    {period.sale_count} ventas ·{" "}
                    {period.unit_quantities?.map(unit=>`${quantity.format(unit.quantity)} ${unit.name}`).join(' · ')??`${quantity.format(period.item_count)} piezas`}
                  </small>
                </span>
                <b>{cents(period.net_cents)}</b>
              </div>
            ))}
            {!report.periods.length ? (
              <p className="empty-copy">No hubo ventas con estos filtros.</p>
            ) : null}
          </div>
        </section>
        <section className="content-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Productos</p>
              <h2>Productos y variantes</h2>
            </div>
          </div>
          <div className="report-list">
            {report.products.slice(0, 12).map((product) => (
              <div key={`${product.sku}-${product.variant_description}`}>
                <span>
                  <strong>{product.product_name}</strong>
                  <small>
                    {product.variant_description} · {product.sku} ·{" "}
                    {quantity.format(product.quantity)} {product.unit_code??'pzas.'}
                  </small>
                </span>
                <b>{cents(product.net_cents)}</b>
              </div>
            ))}
            {!report.products.length ? (
              <p className="empty-copy">No hay productos que mostrar.</p>
            ) : null}
          </div>
        </section>
      </div>

      {!query && report.payments.length ? (
        <section className="content-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Conciliación</p>
              <h2>Cobrado por método</h2>
            </div>
          </div>
          <div className="payment-report-row">
            {report.payments.map((payment) => (
              <article key={payment.code}>
                <span>{payment.name}</span>
                <strong>{cents(payment.amount_cents)}</strong>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="content-card report-table-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Día y hora</p>
            <h2>Detalle vendido</h2>
          </div>
          <small>Máximo 300 renglones</small>
        </div>
        <div className="report-table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Ticket</th>
                <th>Producto</th>
                <th>Variante</th>
                <th>Cajero</th>
                <th>Cant.</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {report.details.map((line) => (
                <tr key={`${line.sale_id}-${line.sku}`}>
                  <td>{dateTime.format(new Date(line.sold_at))}</td>
                  <td>
                    <code>{line.folio}</code>
                  </td>
                  <td>
                    <strong>{line.product_name}</strong>
                    <small>{line.sku}</small>
                    <small>{line.category_name ?? "Sin categoría"} · {line.department_name ?? "Sin departamento"}</small>
                  </td>
                  <td>{line.variant_description || "Única"}</td>
                  <td>{line.cashier_name}</td>
                  <td>{quantity.format(line.quantity)} {line.measureUnit?.name}</td>
                  <td>{cents(line.net_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.truncated ? (
          <p className="table-note">
            Hay más resultados. Reduce el periodo o busca un producto para ver
            el detalle completo.
          </p>
        ) : null}
      </section>
    </>
  );
}

function InventoryResults({ report }: { report: InventoryReport }) {
  const summary = report.summary;
  return (
    <>
      <div className="report-summary-grid">
        <article>
          <Boxes aria-hidden="true" />
          <span>Existencia</span>
          <strong>{summary.unit_quantities?.map(unit=>`${quantity.format(unit.qty)} ${unit.name}`).join(' · ')??quantity.format(summary.qty)}</strong>
          <small>{summary.variant_count} variantes</small>
        </article>
        <article>
          <ShoppingBag aria-hidden="true" />
          <span>Disponible</span>
          <strong>{summary.unit_quantities?.map(unit=>`${quantity.format(unit.available_qty)} ${unit.name}`).join(' · ')??quantity.format(summary.available_qty)}</strong>
          <small>{summary.unit_quantities?.map(unit=>`${quantity.format(unit.reserved_qty)} ${unit.name}`).join(' · ')??quantity.format(summary.reserved_qty)} reservadas</small>
        </article>
        <article>
          <AlertTriangle aria-hidden="true" />
          <span>Por atender</span>
          <strong>{summary.low_count + summary.out_count}</strong>
          <small>
            {summary.out_count} agotadas · {summary.low_count} bajas
          </small>
        </article>
        <article>
          <CircleDollarSign aria-hidden="true" />
          <span>Valor a costo</span>
          <strong>{cents(summary.cost_value_cents)}</strong>
          <small>Menudeo {cents(summary.retail_value_cents)}</small>
        </article>
      </div>
      <section className="content-card report-table-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Existencia actual</p>
            <h2>Producto por variante</h2>
          </div>
          <small>Máximo 500 variantes</small>
        </div>
        <div className="report-table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Departamento</th>
                <th>Variante</th>
                <th>Existencia</th>
                <th>Disponible</th>
                <th>Costo</th>
                <th>Menudeo</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item) => (
                <tr
                  className={
                    item.available_qty <= 0
                      ? "stock-out"
                      : item.available_qty <= 2
                        ? "stock-low"
                        : ""
                  }
                  key={item.variant_id}
                >
                  <td>
                    <strong>{item.product_name}</strong>
                    <small>
                      {item.brand_name} · {item.sku}
                    </small>
                  </td>
                  <td>{item.category_name}</td>
                  <td>{item.variant_description}</td>
                  <td>{quantity.format(item.qty)} {item.measureUnit?.name}</td>
                  <td>{quantity.format(item.available_qty)} {item.measureUnit?.name}</td>
                  <td>{cents(item.cost_cents)}</td>
                  <td>{cents(item.price_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!report.items.length ? (
          <p className="empty-copy">
            No encontramos inventario con esos filtros.
          </p>
        ) : null}
        {report.truncated ? (
          <p className="table-note">
            Hay más variantes. Busca por producto, SKU, talla o color.
          </p>
        ) : null}
      </section>
    </>
  );
}
