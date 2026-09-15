import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, PackageCheck, Search } from "lucide-react";

import { resolveActiveLocation } from "@/lib/auth/active-location";
import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Apartados" };

type LayawayRow = {
  id: string;
  folio: string;
  status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "COMPLETED" | "CANCELLED";
  due_date: string;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  customer_name: string;
  member_number: string;
  item_count: number;
  unit_count: number;
  created_at: string;
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });
const activeStatuses = new Set<LayawayRow["status"]>([
  "OPEN",
  "PARTIALLY_PAID",
  "PAID",
]);

const statusLabels: Record<LayawayRow["status"], string> = {
  OPEN: "Abierto",
  PARTIALLY_PAID: "Con abonos",
  PAID: "Liquidado",
  COMPLETED: "Entregado",
  CANCELLED: "Cancelado",
};

export default async function LayawaysPage({
  searchParams,
}: {
  searchParams: Promise<{ ubicacion?: string; busqueda?: string; estado?: string }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    return <LayawayPageContent rows={[]} locationId="preview" preview />;
  }
  const { supabase, profile } = await requirePermission("layaways.manage");
  const locations = (profile?.user_locations ?? []).flatMap((entry) =>
    Array.isArray(entry.locations)
      ? entry.locations
      : entry.locations
        ? [entry.locations]
        : [],
  );
  const location = await resolveActiveLocation(locations, params.ubicacion);
  if (!location) {
    return <LayawayPageContent rows={[]} locationId="" status="No tienes una sucursal disponible." />;
  }
  const allowedStatus = ["OPEN", "PARTIALLY_PAID", "PAID", "COMPLETED", "CANCELLED"].includes(
    params.estado ?? "",
  )
    ? params.estado!
    : null;
  const result = await supabase.rpc("list_layaways", {
    p_location_id: location.id,
    p_query: (params.busqueda ?? "").trim().slice(0, 100),
    p_status: allowedStatus,
    p_limit: 100,
  });
  return (
    <LayawayPageContent
      rows={(result.data ?? []) as LayawayRow[]}
      locationId={location.id}
      query={params.busqueda ?? ""}
      selectedStatus={allowedStatus ?? ""}
      status={result.error?.message}
    />
  );
}

function LayawayPageContent({
  rows,
  locationId,
  query = "",
  selectedStatus = "",
  status,
  preview = false,
}: {
  rows: LayawayRow[];
  locationId: string;
  query?: string;
  selectedStatus?: string;
  status?: string;
  preview?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + 7);
  const warning = warningDate.toISOString().slice(0, 10);
  return (
    <section className="module-page layaways-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Mercancía comprometida</p>
          <h1>Apartados</h1>
          <p className="heading-copy">
            Consulta reservas reales por folio, cliente o número de socio.
          </p>
        </div>
        <Link className="primary-button" href={`/pos?ubicacion=${locationId}`}>
          <PackageCheck aria-hidden="true" /> Nuevo desde Venta
        </Link>
      </div>
      <form className="layaway-filters" method="get">
        <input type="hidden" name="ubicacion" value={locationId} />
        <label>
          <Search aria-hidden="true" />
          <input
            name="busqueda"
            defaultValue={query}
            placeholder="Folio, cliente o número de socio"
            maxLength={100}
          />
        </label>
        <select name="estado" defaultValue={selectedStatus} aria-label="Estado del apartado">
          <option value="">Todos los estados</option>
          <option value="OPEN">Abiertos</option>
          <option value="PARTIALLY_PAID">Con abonos</option>
          <option value="PAID">Liquidados</option>
          <option value="COMPLETED">Entregados</option>
          <option value="CANCELLED">Cancelados</option>
        </select>
        <button className="secondary-button" type="submit">Buscar</button>
      </form>
      {status ? <p className="inline-error operation-feedback" role="alert">No fue posible consultar apartados.</p> : null}
      {preview ? <p className="notice-banner">Vista previa: conecta Supabase para crear reservas reales.</p> : null}
      <div className="layaway-list">
        {rows.length === 0 ? (
          <div className="empty-state">
            <CalendarClock aria-hidden="true" />
            <strong>No hay apartados con esos filtros</strong>
            <p>Créalo desde el carrito de Venta para reservar la mercancía.</p>
          </div>
        ) : (
          rows.map((row) => {
            const active = activeStatuses.has(row.status);
            const timing = !active
              ? "closed"
              : row.due_date < today
                ? "overdue"
                : row.due_date <= warning
                  ? "warning"
                  : "current";
            return (
              <article className={`layaway-card ${timing}`} key={row.id}>
                <header>
                  <div><code>{row.folio}</code><strong>{row.customer_name}</strong></div>
                  <span>{statusLabels[row.status]}</span>
                </header>
                <div className="layaway-card-grid">
                  <span><small>Vence</small><strong>{date.format(new Date(`${row.due_date}T12:00:00`))}</strong></span>
                  <span><small>Mercancía</small><strong>{Number(row.unit_count)} pzas · {Number(row.item_count)} variantes</strong></span>
                  <span><small>Pagado</small><strong>{money.format(Number(row.paid_cents) / 100)}</strong></span>
                  <span><small>Saldo</small><strong>{money.format(Number(row.balance_cents) / 100)}</strong></span>
                </div>
                <footer>Socio {row.member_number} · Total {money.format(Number(row.total_cents) / 100)}</footer>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
