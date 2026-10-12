import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import {
  reportDateRange,
  reportDefaultDates,
  validReportDate,
} from "@/lib/reports";
import { isSupabaseConfigured } from "@/lib/supabase/config";
type CostReport = {
  entries: Array<{
    id: number;
    occurred_at: string;
    product_name: string;
    sku: string;
    quantity: number;
    reference_type: string;
    unit_cost_cents: number | null;
    value_cents: number | null;
  }>;
  changes: Array<{
    id: string;
    created_at: string;
    entity_id: string;
    location_id: string | null;
    previous_cost_cents: string;
    new_cost_cents: string;
  }>;
  limited: boolean;
};
const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
export default async function CostReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    ubicacion?: string;
    desde?: string;
    hasta?: string;
    agrupacion?: string;
  }>;
}) {
  const params = await searchParams;
  const defaults = reportDefaultDates();
  const from = validReportDate(params.desde, defaults.from);
  const to = validReportDate(params.hasta, defaults.to);
  const grouping =
    params.agrupacion === "year"
      ? "year"
      : params.agrupacion === "month"
        ? "month"
        : "day";
  let report: CostReport = { entries: [], changes: [], limited: false };
  let error = "";
  let locationId = "";
  let locationName = "Demostración";
  if (isSupabaseConfigured()) {
    const { supabase, profile } = await requirePermission("reports.inventory");
    const locations = (profile?.user_locations ?? []).flatMap((e) =>
      Array.isArray(e.locations)
        ? e.locations
        : e.locations
          ? [e.locations]
          : [],
    );
    const location = await resolveActiveLocation(locations, params.ubicacion);
    locationId = location?.id ?? "";
    locationName = location?.name ?? "Sin sucursal";
    if (locationId) {
      const range = reportDateRange(from, to);
      const result = await supabase.rpc("report_operational_costs", {
        p_location_id: locationId,
        p_from: range.from,
        p_to: range.to,
      });
      if (result.error)
        error =
          "No fue posible consultar costos. Revisa permisos y un periodo de máximo un año.";
      else report = result.data as CostReport;
    }
  }
  const purchase = report.entries.filter(
    (e) => e.reference_type !== "MANUAL_STOCK_ENTRY",
  );
  const manual = report.entries.filter(
    (e) => e.reference_type === "MANUAL_STOCK_ENTRY",
  );
  const sum = (entries: CostReport["entries"]) =>
    entries.reduce((n, e) => n + Number(e.value_cents ?? 0), 0);
  const periods = new Map<
    string,
    { purchase: number; manual: number; unknown: number }
  >();
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const entry of report.entries) {
    const date = dateFormatter.format(new Date(entry.occurred_at));
    const key =
      grouping === "year"
        ? date.slice(0, 4)
        : grouping === "month"
          ? date.slice(0, 7)
          : date;
    const value = periods.get(key) ?? { purchase: 0, manual: 0, unknown: 0 };
    if (entry.value_cents === null) value.unknown++;
    else if (entry.reference_type === "MANUAL_STOCK_ENTRY")
      value.manual += Number(entry.value_cents);
    else value.purchase += Number(entry.value_cents);
    periods.set(key, value);
  }
  return (
    <section className="module-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{locationName}</p>
          <h1>Costos y entradas</h1>
          <p>
            Recepciones valorizadas, entradas manuales y cambios de costo. No
            representa pagos al proveedor ni utilidad.
          </p>
        </div>
        <Link
          className="secondary-button"
          href={`/reportes?ubicacion=${locationId}`}
        >
          Volver a reportes
        </Link>
      </div>
      <form className="toolbar-card report-filters">
        <input type="hidden" name="ubicacion" value={locationId} />
        <label>
          Desde
          <input type="date" name="desde" defaultValue={from} />
        </label>
        <label>
          Hasta
          <input type="date" name="hasta" defaultValue={to} />
        </label>
        <button type="submit" className="primary-button">
          Consultar
        </button>
        <label>
          Agrupar
          <select name="agrupacion" defaultValue={grouping}>
            <option value="day">Día</option>
            <option value="month">Mes</option>
            <option value="year">Año</option>
          </select>
        </label>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {!isSupabaseConfigured() ? (
        <p>Demostración sin registros reales.</p>
      ) : null}
      {report.limited ? (
        <p role="alert">
          Hay más de 500 registros. Reduce el periodo; los totales mostrados son
          parciales.
        </p>
      ) : null}
      <div className="dashboard-metrics">
        <article className="metric-card">
          <span>Recepciones valorizadas</span>
          <strong>{money.format(sum(purchase) / 100)}</strong>
        </article>
        <article className="metric-card">
          <span>Entradas manuales valorizadas</span>
          <strong>{money.format(sum(manual) / 100)}</strong>
        </article>
      </div>
      <p>
        Sin costo histórico no se inventa un valor:{" "}
        {report.entries.filter((e) => e.value_cents === null).length} entrada(s)
        sin valorización documentada.
      </p>
      <h2>Resumen por periodo</h2>
      <ul>
        {Array.from(periods)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => (
            <li key={key}>
              {key} · Recepciones {money.format(value.purchase / 100)} ·
              Entradas manuales {money.format(value.manual / 100)} · Sin costo:{" "}
              {value.unknown}
            </li>
          ))}
      </ul>
      <div className="content-card cost-report-table">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Cantidad</th>
              <th>Costo unitario</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {report.entries.map((e) => (
              <tr key={e.id}>
                <td>
                  {new Date(e.occurred_at).toLocaleDateString("es-MX", {
                    timeZone: "America/Mexico_City",
                  })}
                </td>
                <td>
                  {e.product_name}
                  <small>{e.sku}</small>
                </td>
                <td>
                  {e.reference_type === "MANUAL_STOCK_ENTRY"
                    ? "Entrada manual"
                    : "Recepción"}
                </td>
                <td>{e.quantity}</td>
                <td>
                  {e.unit_cost_cents === null
                    ? "No documentado"
                    : money.format(Number(e.unit_cost_cents) / 100)}
                </td>
                <td>
                  {e.value_cents === null
                    ? "No documentado"
                    : money.format(Number(e.value_cents) / 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Cambios de costo</h2>
      <p>
        El costo de variante es global. Los cambios sin sucursal se identifican
        como globales.
      </p>
      <ul>
        {report.changes.map((c) => (
          <li key={c.id}>
            {new Date(c.created_at).toLocaleString("es-MX")} · {c.entity_id} ·{" "}
            {c.location_id ? "Sucursal" : "Global"}:{" "}
            {money.format(Number(c.previous_cost_cents) / 100)} →{" "}
            {money.format(Number(c.new_cost_cents) / 100)}
          </li>
        ))}
      </ul>
    </section>
  );
}
