import Link from "next/link";
import { requirePermission } from "@/lib/auth/authorization";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { isSupabaseConfigured } from "@/lib/supabase/config";
const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
type Credit = {
  customer_id: string;
  full_name: string;
  member_number: string;
  is_authorized: boolean;
  balance_cents: number;
  available_cents: number;
  has_overdue: boolean;
};
type Layaway = {
  customer_id: string;
  full_name: string;
  member_number: string;
  active_count: number;
  paid_cents: number;
  balance_cents: number;
  due_date: string;
};
export default async function CustomerAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; q?: string; ubicacion?: string }>;
}) {
  const params = await searchParams;
  const type = params.tipo === "apartados" ? "apartados" : "credito";
  const query = (params.q ?? "").trim().slice(0, 100);
  let credits: Credit[] = [];
  let layaways: Layaway[] = [];
  let error = "";
  let locationId = "";
  if (isSupabaseConfigured()) {
    const { supabase, profile } = await requirePermission("customers.manage");
    const locations = (profile?.user_locations ?? []).flatMap((e) =>
      Array.isArray(e.locations)
        ? e.locations
        : e.locations
          ? [e.locations]
          : [],
    );
    const location = await resolveActiveLocation(locations, params.ubicacion);
    locationId = location?.id ?? "";
    if (type === "credito") {
      const result = await supabase.rpc("list_customer_credit_accounts", {
        p_query: query,
        p_limit: 200,
      });
      if (result.error) error = "Sin permiso para consultar crédito.";
      else
        credits = (result.data ?? []).filter(
          (c: Credit) => c.is_authorized || Number(c.balance_cents) > 0,
        );
    } else if (locationId) {
      const result = await supabase.rpc("list_customer_layaway_accounts", {
        p_location_id: locationId,
        p_query: query,
      });
      if (result.error)
        error = "No fue posible consultar los apartados de esta sucursal.";
      else layaways = result.data ?? [];
    }
  }
  const href = (tipo: string) =>
    `/clientes/cuentas?${new URLSearchParams({ tipo, ubicacion: locationId, q: query })}`;
  return (
    <section className="module-page customers-page">
      <div className="section-heading">
        <div>
          <h1>Cuentas de clientes</h1>
          <p>
            Crédito y apartados son cuentas separadas; una persona puede tener
            ambas. Crédito es global; apartados corresponde a la sucursal
            seleccionada.
          </p>
        </div>
        <Link
          className="secondary-button"
          href={`/clientes?ubicacion=${locationId}`}
        >
          Todos los clientes
        </Link>
      </div>
      <nav className="report-tabs" aria-label="Tipo de cuenta">
        <Link
          className={type === "credito" ? "active" : ""}
          href={href("credito")}
        >
          Crédito
        </Link>
        <Link
          className={type === "apartados" ? "active" : ""}
          href={href("apartados")}
        >
          Apartados
        </Link>
      </nav>
      <form className="toolbar-card">
        <input type="hidden" name="tipo" value={type} />
        <input type="hidden" name="ubicacion" value={locationId} />
        <label>
          Nombre o socio
          <input name="q" defaultValue={query} />
        </label>
        <button type="submit" className="secondary-button">
          Buscar
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {credits.length >= 200 || layaways.length > 200 ? (
        <p>
          Lista limitada. Busca por nombre o socio para encontrar una cuenta
          específica.
        </p>
      ) : null}
      {type === "credito"
        ? credits.map((c) => (
            <article
              className="content-card account-summary-card"
              key={c.customer_id}
            >
              <h2>{c.full_name}</h2>
              <p>
                Socio {c.member_number} · Deuda:{" "}
                {money.format(Number(c.balance_cents) / 100)} · Disponible:{" "}
                {money.format(Number(c.available_cents) / 100)}{" "}
                {c.has_overdue ? "· Crédito vencido" : ""}
              </p>
              <Link
                href={`/clientes?${new URLSearchParams({ credit: c.customer_id, q: c.full_name, ubicacion: locationId })}`}
              >
                Estado de cuenta y abonos
              </Link>
            </article>
          ))
        : layaways.map((c) => (
            <article
              className="content-card account-summary-card"
              key={c.customer_id}
            >
              <h2>{c.full_name}</h2>
              <p>
                Socio {c.member_number} · {c.active_count} apartado(s) ·
                Abonado: {money.format(Number(c.paid_cents) / 100)} · Pendiente:{" "}
                {money.format(Number(c.balance_cents) / 100)}
              </p>
              <Link
                href={`/apartados?${new URLSearchParams({ busqueda: c.full_name, ubicacion: locationId })}`}
              >
                Ver apartados
              </Link>
            </article>
          ))}
      {!error &&
      (type === "credito" ? credits.length : layaways.length) === 0 ? (
        <p>
          No hay cuentas coincidentes
          {!isSupabaseConfigured() ? " en esta demostración" : ""}.
        </p>
      ) : null}
    </section>
  );
}
