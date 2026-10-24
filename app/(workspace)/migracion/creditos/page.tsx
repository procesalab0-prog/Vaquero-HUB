import Link from "next/link";
import {
  deliveryReturnHref,
  deliveryReturnParams,
} from "@/lib/m9-delivery-capture";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import styles from "../migration.module.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Créditos SICAR · Revisión documental" };
const pesos = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    n / 100,
  );
const fecha = (s: string) =>
  new Date(s).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
const reasons: Record<string, string> = {
  HISTORICAL_CUSTOMER_NAME_DIFFERS:
    "El nombre guardado en el documento difiere del nombre actual de la cuenta. Conservamos ambas referencias.",
  NEW_DOCUMENT_SINCE_BASELINE:
    "Este documento apareció después del corte anterior.",
  AMOUNT_CHANGED_SINCE_BASELINE:
    "El saldo o importe cambió desde el corte anterior. No sustituye la apertura del sistema.",
  SOURCE_ID_CHANGED:
    "El identificador del documento cambió; requiere revisión.",
  LINE_SUM_DIFFERS_FROM_TOTAL:
    "El total de las líneas requiere revisión frente al documento.",
  LEGACY_GENERIC_DEBT_LINE:
    "Línea genérica de deuda histórica; no identifica una pieza de inventario.",
  AMBIGUOUS_BARCODE: "El código tiene más de una variante candidata.",
  BARCODE_NOT_IN_STAGING:
    "El código no tiene variante en el catálogo de pruebas.",
  SOURCE_LINE_PRICE_REVIEW:
    "El importe histórico de esta línea necesita revisión.",
};
type CreditLine = {
  index: number;
  barcode: string;
  quantity: string;
  description: string;
  variant_id: string | null;
  holds: string[];
};
type SourcePayment = {
  key: string;
  ref: string;
  occurred_label: string;
  amount_cents: number;
  cancelled: boolean;
};
type SourceDocument = {
  key: string;
  folio: string;
  source_id: string;
  source_at: string;
  historical_name: string;
  total_cents: number;
  balance_cents: number;
  paid_cents: number;
  due_date: string | null;
  holds: string[];
  linked_history_complete: boolean;
  payments: SourcePayment[];
  lines: CreditLine[];
};
type SourceAccount = {
  key: string;
  ref: string;
  name: string;
  source_at: string;
  balance_cents: number;
  documents: SourceDocument[];
};
type CreditView = {
  ready: boolean;
  source_from: string;
  source_until: string;
  source_older_than_24h: boolean;
  page: number;
  pages: number;
  total: number;
  rows: SourceAccount[];
  summary: {
    accounts: number;
    documents: number;
    open_documents: number;
    paid_documents: number;
    observed_balance_cents: number;
    historical_payments: number;
    cancelled_payments: number;
    cancelled_cents: number;
    active_paid_cents: number;
    credit_lines: number;
    mapped_lines: number;
    unmapped_lines: number;
    review_documents: number;
  };
};
export default async function CreditDetailReview({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    filter?: string;
    page?: string;
    document?: string;
    delivery_return?: string;
    delivery_q?: string;
    delivery_filter?: string;
    delivery_page?: string;
    delivery_document?: string;
    delivery_review_filter?: string;
  }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("customers.manage");
  const params = await searchParams;
  const returnParams = deliveryReturnParams(params),
    returnHref = deliveryReturnHref(params);
  const returnLink = returnHref ? (
    <Link className="button secondary" href={returnHref}>
      Volver a la misma tanda de entregas
    </Link>
  ) : null;
  const focusedDocument = /^[a-f0-9]{64}$/.test(params.document ?? "")
    ? params.document
    : null;
  const q = (params.q ?? "").slice(0, 100),
    filter = ["all", "review", "unmapped", "paid"].includes(params.filter ?? "")
      ? params.filter!
      : "all",
    page = /^[1-9][0-9]{0,5}$/.test(params.page ?? "")
      ? Number(params.page)
      : 1;
  const { data, error } = await supabase.rpc("m9_credit_detail_read", {
    p_input: { q, filter, page },
  });
  if (error)
    throw Error("No se pudo consultar la revisión documental de créditos.");
  const view = data as CreditView;
  if (!view.ready)
    return (
      <div className={styles.page}>
        <h1>Revisión de créditos SICAR</h1>
        <p>
          El archivo documental todavía no está disponible. No se habilitaron
          cobros.
        </p>
        <Link className="button secondary" href="/migracion">
          Volver a migración
        </Link>
        {returnLink}
      </div>
    );
  const pageLink = (n: number) =>
    "/migracion/creditos?" +
    new URLSearchParams({
      q,
      filter,
      page: String(n),
      ...returnParams,
    }).toString() +
    "#documentos";
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Revisión en pruebas</p>
        <h1>Créditos y apartados de SICAR</h1>
        <p>
          Detalle leído y conciliado por cuenta, folio y código de barras. Los
          abonos de origen son antecedentes; aquí no se cobran de nuevo.
        </p>
        <Link className="button secondary" href="/migracion">
          Volver al centro de migración
        </Link>
        {returnLink}
      </header>
      <section className={styles.notice} aria-label="Alcance de la revisión">
        <h2>Saldo observado, sin apertura para cobrar</h2>
        <p>
          Lectura del {fecha(view.source_from)} al {fecha(view.source_until)}.{" "}
          {view.source_older_than_24h ? "Ya superó las 24 horas. " : ""}
          Corresponde a las cuentas con saldo del padrón anterior y a un
          documento adicional encontrado en ellas. No renueva todo el padrón ni
          es un cierre simultáneo.
        </p>
        <p>
          El corte anterior se conserva por separado. Esta revisión no habilita
          cobros, entregas ni inventario; el primer paquete operativo mantiene
          sus propios controles.
        </p>
      </section>
      <div className={styles.cards}>
        <section>
          <strong>{view.summary.accounts}</strong>
          <h2>Cuentas conciliadas</h2>
          <p>
            {view.summary.documents} documentos con detalle:{" "}
            {view.summary.open_documents} abiertos y{" "}
            {view.summary.paid_documents} pagado(s).
          </p>
        </section>
        <section>
          <strong>{pesos(view.summary.observed_balance_cents)}</strong>
          <h2>Saldo observado en SICAR</h2>
          <p>
            Es evidencia histórica. No se agregó como deuda nueva en Mi Tienda.
          </p>
        </section>
        <section>
          <strong>{view.summary.historical_payments}</strong>
          <h2>Abonos históricos revisados</h2>
          <p>
            {pesos(view.summary.active_paid_cents)} activos conciliados.{" "}
            {view.summary.cancelled_payments} cancelados por{" "}
            {pesos(view.summary.cancelled_cents)}, excluidos del importe activo.
          </p>
        </section>
        <section>
          <strong>
            {view.summary.mapped_lines} / {view.summary.credit_lines}
          </strong>
          <h2>Líneas vinculadas por código</h2>
          <p>
            {view.summary.unmapped_lines} sin vínculo físico confirmado. Todas
            las entregas siguen sin acreditar; no se generaron reservas ni
            descuentos de stock.
          </p>
        </section>
      </div>
      <section id="documentos" className={styles.panel}>
        <h2>Buscar y revisar documentos</h2>
        <p>
          Los filtros muestran cuentas que contienen al menos un documento o
          producto pendiente del tipo seleccionado.
        </p>
        <form className={styles.filters}>
          {Object.entries(returnParams ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <label>
            Buscar
            <input
              name="q"
              maxLength={100}
              defaultValue={q}
              placeholder="Cliente, folio o código de barras"
            />
          </label>
          <label>
            Mostrar
            <select name="filter" defaultValue={filter}>
              <option value="all">Todas las cuentas revisadas</option>
              <option value="review">Con diferencias por revisar</option>
              <option value="unmapped">Con productos sin vínculo</option>
              <option value="paid">Con documentos pagados</option>
            </select>
          </label>
          <button className="button primary">Buscar documentos</button>
          <Link
            className="button secondary"
            href={
              "/migracion/creditos" +
              (returnParams
                ? "?" + new URLSearchParams(returnParams).toString()
                : "") +
              "#documentos"
            }
          >
            Limpiar
          </Link>
        </form>
        <p role="status">
          {view.total} cuentas encontradas · Página {view.page} de {view.pages}
        </p>
        <div className={styles.accounts}>
          {view.rows.map((a) => (
            <details
              key={a.key}
              open={a.documents.some((d) => d.key === focusedDocument)}
            >
              <summary>
                <span>{a.name}</span>
                <span>
                  {pesos(a.balance_cents)} observado · {a.documents.length}{" "}
                  documento(s)
                </span>
              </summary>
              <p>
                Referencia SICAR: <code>{a.ref}</code>. La cuenta conserva su
                identidad aunque coincida el nombre con otra.
              </p>
              {a.documents.map((d) => (
                <details
                  key={d.key}
                  id={`documento-${d.key}`}
                  open={d.key === focusedDocument}
                >
                  <summary>
                    <span>
                      Folio {d.folio} ·{" "}
                      {d.balance_cents === 0
                        ? "Pagado en SICAR"
                        : "Con saldo en SICAR"}
                    </span>
                    <span>
                      {pesos(d.balance_cents)} pendiente de{" "}
                      {pesos(d.total_cents)}
                    </span>
                  </summary>
                  <p>
                    Abonado activo histórico: {pesos(d.paid_cents)}. Leído el{" "}
                    {fecha(d.source_at)}.
                  </p>
                  {d.holds.length > 0 && (
                    <div className={styles.notice}>
                      <strong>Revisión pendiente</strong>
                      <ul>
                        {d.holds.map((h) => (
                          <li key={h}>
                            {reasons[h] ?? "Este dato requiere revisión."}
                          </li>
                        ))}
                      </ul>
                      {d.historical_name !== a.name && (
                        <p>Nombre en el documento: {d.historical_name}.</p>
                      )}
                    </div>
                  )}
                  {d.due_date && (
                    <p>
                      Vencimiento guardado en SICAR:{" "}
                      {d.due_date.split("-").reverse().join("/")}.
                    </p>
                  )}
                  <h3>Abonos conservados como historial</h3>
                  {d.linked_history_complete ? (
                    <ul>
                      {d.payments.map((p) => (
                        <li key={p.key}>
                          <strong>
                            {p.ref} ·{" "}
                            {p.cancelled
                              ? "Cancelado · excluido"
                              : "Activo histórico"}
                          </strong>
                          <span>
                            {pesos(p.amount_cents)} · Fecha mostrada por SICAR:{" "}
                            {p.occurred_label} (mes/día/año).
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      El desglose muestra cero abonos activos. No se observó una
                      lista de vínculos; eso no acredita que el historial
                      completo esté vacío.
                    </p>
                  )}
                  <h3>Productos del documento</h3>
                  <ul>
                    {d.lines.map((l) => (
                      <li key={l.index}>
                        <strong>{l.description}</strong>
                        <span>
                          Código literal: <code>{l.barcode}</code> ·{" "}
                          {l.barcode === "SX00000"
                            ? "Renglón contable; cantidad física sin confirmar."
                            : `Cantidad anotada en origen: ${l.quantity}.`}
                        </span>
                        <span>
                          {l.variant_id
                            ? "Variante identificada por su código en el catálogo de pruebas."
                            : "Sin asignación a una variante de inventario."}
                        </span>
                        {l.holds
                          .filter((h) => h !== "DELIVERY_NOT_OBSERVED")
                          .map((h) => (
                            <span key={h}>
                              {reasons[h] ?? "Revisión de producto pendiente."}
                            </span>
                          ))}
                      </li>
                    ))}
                  </ul>
                  <p className={styles.notice}>
                    Entrega sin acreditar. Documento pagado o variante
                    identificada no significa mercancía entregada, reservada o
                    disponible.
                  </p>
                  <details>
                    <summary>Referencia del documento para auditoría</summary>
                    <p>
                      ID SICAR: <code>{d.source_id}</code>. No se usa como folio
                      de venta nueva.
                    </p>
                  </details>
                </details>
              ))}
              <a
                className="button secondary"
                href={`https://app.sicarx.com/clients/detail/${a.ref}?tab=1`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Consultar cuenta en SICAR
              </a>
            </details>
          ))}
        </div>
        <nav className={styles.pagination} aria-label="Páginas de créditos">
          {view.page > 1 && (
            <Link className="button secondary" href={pageLink(view.page - 1)}>
              Anterior
            </Link>
          )}
          {view.page < view.pages && (
            <Link className="button secondary" href={pageLink(view.page + 1)}>
              Siguiente
            </Link>
          )}
        </nav>
      </section>
      <section className={styles.panel}>
        <h2>Antes de abrir saldos por etapas</h2>
        <p>
          Comprobar los cambios señalados y los productos sin vínculo, acreditar
          entregas y compromisos físicos y renovar el corte completo. La
          consulta de este archivo no autoriza una operación.
        </p>
        <Link
          className="button secondary"
          href="/clientes/heredados-sicar#piloto"
        >
          Revisar inventario del piloto
        </Link>
      </section>
    </div>
  );
}
