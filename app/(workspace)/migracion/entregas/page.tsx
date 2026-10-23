import { randomUUID } from "node:crypto";
import { DeliveryCaptureForm } from "./capture-form";
import { saveDeliveryObservation } from "./actions";
import {
  isDeliveryCapturePage,
  deliveryCaptureQuery,
} from "@/lib/m9-delivery-capture";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import {
  deliveryEvidenceHref,
  deliveryReviewPageHref,
} from "@/lib/m9-delivery-review";
import styles from "./review.module.css";
export const dynamic = "force-dynamic";
export const metadata = { title: "Entregas SICAR · Revisión por documento" };
const date = (value: string) =>
  new Date(value).toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
export default async function DeliveryReview({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    filter?: string;
    page?: string;
    document?: string;
    review_filter?: string;
  }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { profile, supabase } = await requirePermission("customers.manage");
  const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
  if (role?.code !== "ADMIN") notFound();
  const query = deliveryCaptureQuery(await searchParams),
    { data, error } = await supabase.rpc("m9_delivery_capture_read", {
      p_input: query,
    });
  if (error?.code === "42501") notFound();
  if (error || !isDeliveryCapturePage(data))
    throw Error("No se pudo consultar la revisión de entregas.");
  const view = data;
  if (!view.ready)
    return (
      <div className={styles.page}>
        <h1>Entregas por documento</h1>
        <p>
          El archivo todavía no está disponible. No se habilitó ninguna entrega.
        </p>
        <Link className="button secondary" href="/migracion">
          Volver a migración
        </Link>
      </div>
    );
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Preview · Declaraciones documentales</p>
        <h1>Entregas por documento</h1>
        <p>
          Revisaremos cada folio con todos sus productos juntos. Así no hay que
          responder una pregunta por cada renglón.
        </p>
        <Link className="button secondary" href="/migracion">
          Volver al centro de migración
        </Link>
      </header>
      <section className={styles.notice} aria-label="Alcance de esta consulta">
        <h2>Primero revisar, después confirmar</h2>
        <p>
          Aquí puedes guardar una declaración sobre cada documento. El archivo
          original conserva UNKNOWN: no registra entregas, cobros ni movimientos
          de inventario.
        </p>
        <p>
          Archivo leído del {date(view.source_from)} al{" "}
          {date(view.source_until)}.
          {view.source_older_than_24h
            ? " El corte ya superó las 24 horas."
            : " No es un cierre simultáneo."}{" "}
          SICAR sigue en uso; consultar aquí no actualiza esa fuente.
        </p>
      </section>
      <div className={styles.cards}>
        <section>
          <strong>{view.summary.pending_documentary_reviews}</strong>
          <h2>Documentos por revisar</h2>
          <p>
            {view.summary.concrete_documentary_reviews} tienen declaración
            concreta vigente. Parcial y sin confirmar siguen pendientes; ninguna
            respuesta autoriza una entrega.
          </p>
        </section>
        <section>
          <strong>{view.summary.unknown_documents}</strong>
          <h2>Documentos sin entrega acreditada</h2>
          <p>
            {view.summary.unknown_lines} líneas conservan su estado sin
            confirmar.
          </p>
        </section>
        <section>
          <strong>
            {view.summary.raw_mapped_lines} / {view.summary.lines}
          </strong>
          <h2>Identidades del archivo original</h2>
          <p>
            {view.summary.raw_unmapped_lines} quedaron sin variante en ese
            archivo; se conserva intacto.
          </p>
        </section>
        <section>
          <strong>{view.summary.live_documentary_links}</strong>
          <h2>Vínculos documentales adicionales</h2>
          <p>
            {view.summary.effective_documentary_identities} identidades al sumar
            los vínculos vigentes. Identificar el producto no acredita su
            entrega.
          </p>
        </section>
      </div>
      <section id="documentos" className={styles.panel}>
        <h2>Buscar un documento</h2>
        <form className={styles.filters} method="get">
          <label>
            Cliente, folio o código
            <input name="q" maxLength={100} defaultValue={query.q} />
          </label>
          <label>
            Mostrar
            <select name="filter" defaultValue={query.filter}>
              <option value="all">Todos los documentos</option>
              <option value="unknown">
                Fuente UNKNOWN (todos los documentos)
              </option>
              <option value="identity">Con identidad pendiente</option>
              <option value="sidecar">Con vínculo documental adicional</option>
            </select>
          </label>
          <label>
            Revisión documental
            <select name="review_filter" defaultValue={query.review_filter}>
              <option value="pending">
                Por revisar (incluye parcial y sin confirmar)
              </option>
              <option value="concrete">Con declaración concreta vigente</option>
              <option value="all">Todas las declaraciones</option>
            </select>
          </label>
          <button className="button primary" type="submit">
            Buscar documentos
          </button>
          <Link
            className="button secondary"
            href="/migracion/entregas#documentos"
          >
            Limpiar
          </Link>
        </form>
        <p role="status">
          {view.total} documentos encontrados · Página {view.page} de{" "}
          {view.pages}
        </p>
        <div className={styles.documents}>
          {view.rows.length === 0 ? (
            <p>
              No hay documentos con estos filtros. Esto no confirma entregas ni
              ausencia de deuda.
            </p>
          ) : (
            view.rows.map((doc) => (
              <article className={styles.document} key={doc.document_key}>
                <header>
                  <p className={styles.badge}>Entrega sin confirmar</p>
                  <h3>
                    {doc.account_name} · Folio {doc.folio}
                  </h3>
                  <p>
                    Leído el {date(doc.source_at)} · {doc.lines.length}{" "}
                    renglón(es).
                    {doc.historical_name !== doc.account_name
                      ? ` Nombre en el documento: ${doc.historical_name}.`
                      : ""}
                  </p>
                </header>
                <h4>¿Qué mercancía de este documento ya se entregó?</h4>
                <p>
                  Declaración documental:{" "}
                  {doc.capture_context.status === "LIVE"
                    ? ({
                        ALL_PENDING: "Todo pendiente",
                        ALL_DELIVERED: "Todo entregado",
                        MIXED: "Parcial: detalle pendiente",
                        UNKNOWN: "Sin confirmar",
                      }[doc.documentary_statement] ?? "En revisión")
                    : doc.capture_context.status === "STALE"
                      ? "La evidencia cambió; necesita nueva revisión"
                      : doc.capture_context.status === "REVOKED"
                        ? "Última declaración retirada"
                        : "Todavía sin respuesta"}
                  . El estado físico de origen sigue sin confirmar.
                </p>
                <DeliveryCaptureForm
                  saveAction={saveDeliveryObservation}
                  key={`${doc.document_key}/${doc.capture_context.revision}`}
                  archive={view.archive_sha256}
                  document={doc.document_key}
                  context={doc.capture_context}
                  generic={doc.generic_lines > 0}
                  requestId={randomUUID()}
                  revokeRequestId={randomUUID()}
                />
                <details className={styles.products}>
                  <summary>
                    Ver los {doc.lines.length} renglón(es) de este documento
                  </summary>
                  <ul>
                    {doc.lines.map((line) => (
                      <li key={line.index}>
                        <strong>{line.description}</strong>
                        <p>
                          Código literal: <code>{line.barcode}</code>.
                        </p>
                        <p>
                          {line.generic_debt
                            ? "Renglón genérico de deuda. No identifica piezas físicas ni permite convertir su cantidad en mercancía."
                            : `Cantidad anotada en origen: ${line.source_quantity}. No acredita existencia, reserva o entrega.`}
                        </p>
                        <p>
                          {line.identity_kind === "ARCHIVE"
                            ? "Identidad conservada en el archivo histórico."
                            : line.identity_kind === "SIDECAR"
                              ? "Identidad documental adicional vigente; el archivo original no se modificó."
                              : "Identidad de producto pendiente; no se asigna por nombre o talla."}
                        </p>
                        {line.identity_kind === "UNRESOLVED" &&
                        line.sidecar_status !== "UNREVIEWED" ? (
                          <p>
                            El vínculo documental necesita revisión o fue
                            anulado.
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
                <div className={styles.links}>
                  <Link
                    className="button primary"
                    href={deliveryEvidenceHref(doc)}
                  >
                    Ver documento y evidencia de origen
                  </Link>
                </div>
                <details className={styles.references}>
                  <summary>Referencias para distinguir este documento</summary>
                  <p>
                    Cuenta SICAR: <code>{doc.client_ref}</code>
                  </p>
                  <p>
                    ID original del documento:{" "}
                    <code>{doc.source_document_id}</code>
                  </p>
                  <p>
                    Huella de evidencia:{" "}
                    <code>{doc.source_evidence_sha256}</code>
                  </p>
                </details>
                {doc.observation_revision > 0 ? (
                  <p>
                    Hay historial de revisión documental. No sustituye el estado
                    físico ni autoriza movimientos.
                  </p>
                ) : null}
                <p className={styles.caption}>
                  Un documento pagado o un producto identificado no significa
                  que la mercancía ya se entregó.
                </p>
              </article>
            ))
          )}
        </div>
        <nav className={styles.pagination} aria-label="Páginas de documentos">
          {view.page > 1 ? (
            <Link
              className="button secondary"
              href={deliveryReviewPageHref(query, view.page - 1)}
            >
              Anterior
            </Link>
          ) : null}
          {view.page < view.pages ? (
            <Link
              className="button secondary"
              href={deliveryReviewPageHref(query, view.page + 1)}
            >
              Siguiente
            </Link>
          ) : null}
        </nav>
      </section>
    </div>
  );
}
