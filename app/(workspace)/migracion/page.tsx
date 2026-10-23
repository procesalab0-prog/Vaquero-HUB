import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import styles from "./migration.module.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Migración SICAR · Catálogo, clientes e inventario",
};
const pesos = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    n / 100,
  );
const fecha = (s: string) =>
  new Date(s).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
type Account = {
  key: string;
  ref: string;
  name: string;
  used_cents: number;
  previously_registered: boolean;
  holds: string[];
  documents: Array<{
    key: string;
    folio: string;
    total_cents: number;
    balance_cents: number;
  }>;
};
type Census = {
  source_at: string;
  observed_until: string;
  source_older_than_24h: boolean;
  summary: {
    accounts: number;
    additional_accounts: number;
    documents: number;
    observed_balance_cents: number;
  };
  rows: Account[];
  total: number;
  page: number;
  pages: number;
  catalog_loaded_codes: number;
  legacy_registered: number;
  legacy_operating_balance_cents: number;
  pilot_codes: number;
  pilot_pending_fields: number;
  operating_windows: number;
};
export default async function MigrationCenter({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("customers.manage");
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 100),
    filter = ["all", "additional", "debt", "review"].includes(
      params.filter ?? "",
    )
      ? params.filter!
      : "all";
  const page = /^[1-9][0-9]{0,5}$/.test(params.page ?? "")
    ? Number(params.page)
    : 1;
  const { data, error } = await supabase.rpc("m9_general_migration_read", {
    p_input: { q, filter, page },
  });
  if (error) throw Error("No se pudo consultar la preparación de migración.");
  const view = data as Census;
  const pageLink = (n: number) =>
    "/migracion?" +
    new URLSearchParams({ q, filter, page: String(n) }).toString();
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Ambiente de pruebas</p>
        <h1>Migración de SICAR a Mi Tienda</h1>
        <p>
          Catálogo, cuentas, saldos y mercancía. Aquí puedes ver lo preparado y
          lo que todavía necesita comprobación.
        </p>
        <Link className="button primary" href="/migracion/avance">
          Ver avance, bloqueos y siguientes lotes
        </Link>
      </header>
      <section className={styles.notice} aria-label="Alcance del corte">
        <h2>Corte conservado, pendiente de renovar para operar</h2>
        <p>
          El padrón se observó del {fecha(view.source_at)} al{" "}
          {fecha(view.observed_until)}.{" "}
          {view.source_older_than_24h
            ? "Ya superó las 24 horas."
            : "La captura fue durante un intervalo, no un cierre simultáneo."}{" "}
          SICAR sigue en uso y estas cifras no se presentan como saldos
          actuales.
        </p>
        <p>
          Consultar aquí no registra cobros, ventas, entregas ni inventario. No
          incluye clientes eliminados ni todo el historial pagado.
        </p>
      </section>
      <section className={styles.panel}>
        <h2>Detalle de créditos conciliado por separado</h2>
        <p>
          Consulta la revisión documental posterior: abonos activos y
          cancelados, productos y diferencias. Conserva sus propias fechas y no
          cambia este padrón histórico.
        </p>
        <Link className="button primary" href="/migracion/creditos">
          Revisar créditos, abonos y productos
        </Link>
        <Link className="button secondary" href="/migracion/entregas">
          Revisar entregas por documento
        </Link>
      </section>
      <section className={styles.panel}>
        <h2>Ensayo de la venta web y su reversión</h2>
        <p>
          Prueba sintética de reserva, venta nativa, pago no efectivo y ticket.
          Revierte sus efectos y conserva sólo el recibo del ensayo.
        </p>
        <Link className="button secondary" href="/productos/ensayo-woo/venta">
          Probar venta Woo sin efectos operativos
        </Link>
      </section>
      <div className={styles.cards}>
        <section>
          <strong>{view.catalog_loaded_codes.toLocaleString("es-MX")}</strong>
          <h2>Códigos SICAR cargados</h2>
          <p>
            Conservan su identidad y código de barras. La revisión de venta se
            valida por separado.
          </p>
          <Link
            className="button secondary"
            href="/inventario?ubicacion=467765fe-d18e-43bb-be68-326adbf05ce1"
          >
            Consultar catálogo completo
          </Link>
          <Link href="/productos/migracion-pendientes">
            Ver códigos pendientes
          </Link>
        </section>
        <section>
          <strong>{view.summary.accounts}</strong>
          <h2>Cuentas de origen observadas</h2>
          <p>
            {view.legacy_registered} del primer paquete registrado y{" "}
            {view.summary.additional_accounts} adicionales para revisión. No son
            altas de socios ni de portal.
          </p>
          <a href="#cuentas" className="button primary">
            Revisar cuentas y documentos
          </a>
        </section>
        <section>
          <strong>{view.summary.documents}</strong>
          <h2>Documentos con saldo observado</h2>
          <p>
            {pesos(view.summary.observed_balance_cents)} en el padrón histórico.
            El detalle posterior se consulta por separado. Apertura del primer
            paquete en staging: {pesos(view.legacy_operating_balance_cents)}.
          </p>
          <Link
            className="button secondary"
            href="/clientes/heredados-sicar/saldos"
          >
            Ver apertura y ensayo de abonos
          </Link>
          <p>
            {view.operating_windows} ventanas de cobro vigentes. El archivo
            histórico no habilita cobros.
          </p>
        </section>
        <section>
          <strong>{view.pilot_codes}</strong>
          <h2>Códigos del inventario piloto</h2>
          <p>
            {view.pilot_pending_fields} cantidades por capturar: físico
            presente, vendido guardado y separado. Pendiente no significa cero.
          </p>
          <Link
            className="button secondary"
            href="/clientes/heredados-sicar#piloto"
          >
            Abrir hoja del inventario piloto
          </Link>
          <Link href="/clientes/migracion-sicar/conciliacion">
            Consultar saldos y entregas pendientes
          </Link>
        </section>
      </div>
      <section id="cuentas" className={styles.panel}>
        <h2>Padrón visible completo y cola de documentos</h2>
        <p>
          Busca por nombre, referencia SICAR o folio. Un nombre repetido
          conserva su cuenta independiente. Este padrón conserva lo observado en
          su fecha; el detalle y los abonos posteriores se consultan en la
          revisión de créditos. La entrega sigue sin acreditar.
        </p>
        <form className={styles.filters}>
          <label>
            Buscar
            <input
              name="q"
              maxLength={100}
              defaultValue={q}
              placeholder="Nombre, referencia o folio"
            />
          </label>
          <label>
            Mostrar
            <select name="filter" defaultValue={filter}>
              <option value="all">Todas las cuentas</option>
              <option value="additional">Adicionales al primer paquete</option>
              <option value="debt">Con documentos pendientes</option>
              <option value="review">Con nombre repetido</option>
            </select>
          </label>
          <button className="button primary">Buscar cuentas</button>
          <Link href="/migracion#cuentas" className="button secondary">
            Limpiar
          </Link>
        </form>
        <p role="status">
          {view.total} cuentas encontradas · Página {view.page} de {view.pages}
        </p>
        <div className={styles.accounts}>
          {view.rows.map((a) => (
            <details key={a.key}>
              <summary>
                <span>{a.name}</span>
                <span>
                  {pesos(a.used_cents)} observado · {a.documents.length}{" "}
                  documento(s)
                </span>
              </summary>
              <p>
                {a.previously_registered
                  ? "Identidad conservada en el primer paquete; consulta su apertura por separado."
                  : "Cuenta adicional del padrón histórico. No se abrió este saldo para cobrar."}
              </p>
              {a.holds.length > 0 && (
                <p className={styles.notice}>
                  Hay otra cuenta con el mismo nombre. Se mantienen separadas
                  por su referencia SICAR.
                </p>
              )}
              <p>
                Referencia SICAR: <code>{a.ref}</code>
              </p>
              {a.documents.length ? (
                <ul>
                  {a.documents.map((d) => (
                    <li key={d.key}>
                      <strong>Folio {d.folio}</strong> · Pendiente observado{" "}
                      {pesos(d.balance_cents)} de {pesos(d.total_cents)}.{" "}
                      <span>
                        Ver detalle y abonos en la revisión posterior; entrega
                        sin acreditar.
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  Sin documentos no pagados en esta consulta histórica. Esto no
                  acredita entrega ni ausencia de historial.
                </p>
              )}
              <div className={styles.links}>
                {a.previously_registered && (
                  <Link
                    className="button secondary"
                    href={`/clientes/migracion-sicar?key=${a.key}`}
                  >
                    Ver documentos del primer paquete
                  </Link>
                )}
                <a
                  className="button secondary"
                  href={`https://app.sicarx.com/clients/detail/${a.ref}?tab=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Consultar cuenta en SICAR
                </a>
              </div>
            </details>
          ))}
        </div>
        <nav className={styles.pagination} aria-label="Páginas del padrón">
          {view.page > 1 && (
            <Link
              className="button secondary"
              href={pageLink(view.page - 1) + "#cuentas"}
            >
              Anterior
            </Link>
          )}
          {view.page < view.pages && (
            <Link
              className="button secondary"
              href={pageLink(view.page + 1) + "#cuentas"}
            >
              Siguiente
            </Link>
          )}
        </nav>
      </section>
      <section className={styles.panel}>
        <h2>Para el siguiente corte</h2>
        <ol>
          <li>
            Revisar las diferencias de la conciliación documental posterior,
            manteniendo la cuenta y el folio literal.
          </li>
          <li>
            Capturar físico y mercancía comprometida del piloto; una deuda no
            demuestra que falte entregar mercancía.
          </li>
          <li>
            Renovar SICAR y Woo próximos al arranque, conciliar diferencias y
            probar el lote aprobado en staging.
          </li>
        </ol>
        <p>
          Las cuentas adicionales y los productos con dudas no se liberan
          automáticamente. Las operaciones confirmadas podrán avanzar por etapas
          cuando se cierre su conciliación.
        </p>
      </section>
    </div>
  );
}
