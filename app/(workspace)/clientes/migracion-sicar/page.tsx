import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import {
  customerReviewEnabled,
  type SourceReviewList,
  type SourceReviewDetail,
  type SourceTrialResult,
} from "@/lib/customer-migration";
import { submitSourceReview, submitSourceTrial } from "./actions";
import styles from "./review.module.css";
export const metadata: Metadata = { title: "Revisión de clientes SICAR" };
const money = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    n / 100,
  );
const notices: Record<string, string> = {
  guardado:
    "Revisión guardada. No se activaron deudas ni se fusionaron clientes.",
  "ensayo-listo":
    "Ensayo completado con sesión real. Los movimientos nativos se revirtieron.",
  sobrepago:
    "El abono supera el saldo. Fue rechazado y no se guardó ningún cobro.",
  "sin-saldo": "El ensayo ya no tiene saldo pendiente.",
  conflicto: "La solicitud cambió al repetirla. No se duplicó el abono.",
  "sin-candidato": "El destino no cumple la revisión de identidad.",
  "corte-vencido": "El corte venció. Hay que renovarlo antes del ensayo.",
  error:
    "No fue posible completar la solicitud. No se activaron saldos ni cobros.",
  "sin-permiso": "No tienes permiso para esa operación.",
};
export default async function CustomerSourceReview({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    key?: string;
    run?: string;
    status?: string;
  }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("customers.manage");
  const params = await searchParams;
  const page = Math.max(1, Math.min(1000, Number(params.page) || 1));
  const { data, error } = await supabase.rpc("m9_customer_review", {
    p_action: "LIST",
    p_input: { q: (params.q ?? "").slice(0, 100), page },
  });
  if (error) throw Error("No se pudo consultar la revisión SICAR.");
  const list = data as SourceReviewList;
  let detail: SourceReviewDetail | null = null,
    trial: SourceTrialResult | null = null;
  if (params.key && /^[a-f0-9]{64}$/.test(params.key)) {
    const r = await supabase.rpc("m9_customer_review", {
      p_action: "DETAIL",
      p_input: { key: params.key },
    });
    if (!r.error) detail = r.data as SourceReviewDetail;
  }
  if (params.run && /^[a-f0-9-]{36}$/.test(params.run)) {
    const r = await supabase.rpc("m9_customer_review", {
      p_action: "QA_STATE",
      p_input: { run: params.run },
    });
    if (!r.error) trial = r.data as SourceTrialResult;
  }
  const run = trial?.run ?? crypto.randomUUID(),
    request = crypto.randomUUID();
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Sólo Preview</p>
        <h1>Revisión de clientes SICAR</h1>
        <p>
          Consulta el origen y revisa coincidencias. Guardar una revisión no
          activa deuda ni crea un socio.
        </p>
        <Link href="/clientes" className="button secondary">
          Volver a clientes
        </Link>
        <Link
          href="/clientes/migracion-sicar/conciliacion"
          className="button primary"
        >
          Ver conciliación del piloto
        </Link>
        <Link href="/clientes/heredados-sicar" className="button secondary">
          Registro heredado y hoja de inventario
        </Link>
      </header>
      <div className={styles.summary}>
        <section>
          <strong>{list.summary.accounts}</strong>
          <span>Cuentas de origen</span>
        </section>
        <section>
          <strong>{money(list.summary.pending_cents)}</strong>
          <span>Deuda pendiente del corte</span>
        </section>
        <section>
          <strong>{list.summary.missing_contact}</strong>
          <span>Sin teléfono utilizable</span>
        </section>
        <section>
          <strong>{list.summary.reviewed}</strong>
          <span>Revisiones guardadas</span>
        </section>
      </div>
      {params.status && notices[params.status] ? (
        <p role="status" className={styles.notice}>
          {notices[params.status]}
        </p>
      ) : null}
      <section className={styles.panel}>
        <h2>Buscar una cuenta</h2>
        <p>
          Alcance: cuentas marcadas como APARTADO. Todavía no es todo el padrón
          SICAR.
        </p>
        <form className={styles.search}>
          <label>
            Nombre o teléfono
            <input name="q" defaultValue={params.q ?? ""} maxLength={100} />
          </label>
          <button className="button primary" type="submit">
            Buscar cuentas
          </button>
          <Link href="/clientes/migracion-sicar" className="button secondary">
            Limpiar
          </Link>
        </form>
        <div className={styles.accounts}>
          {list.rows.map((c) => (
            <article key={c.key}>
              <div>
                <h3>{c.name}</h3>
                <p>{c.phone ?? "Teléfono pendiente"}</p>
                <small>
                  {c.review ? "Revisión guardada" : "Pendiente de revisión"}
                </small>
              </div>
              <div>
                <strong>{money(c.balance_cents)}</strong>
                <Link className="button secondary" href={`?key=${c.key}`}>
                  Revisar cuenta
                </Link>
              </div>
            </article>
          ))}
        </div>
        {!list.rows.length ? (
          <p>No hay cuentas que coincidan con la búsqueda.</p>
        ) : null}
        <nav aria-label="Páginas de cuentas" className={styles.search}>
          {page > 1 ? (
            <Link
              className="button secondary"
              href={`?page=${page - 1}&q=${encodeURIComponent(params.q ?? "")}`}
            >
              Anterior
            </Link>
          ) : null}
          <span>
            Página {page} · {list.total} cuentas encontradas
          </span>
          {page * 20 < list.total ? (
            <Link
              className="button secondary"
              href={`?page=${page + 1}&q=${encodeURIComponent(params.q ?? "")}`}
            >
              Siguiente
            </Link>
          ) : null}
        </nav>
      </section>
      {detail ? (
        <section className={styles.panel} aria-label="Detalle de cuenta">
          <h2>{detail.name}</h2>
          <p>
            {detail.phone ?? "Falta teléfono"} · Pendiente:{" "}
            <strong>{money(detail.balance_cents)}</strong>
          </p>
          <p>
            Corte:{" "}
            {new Date(detail.source_at).toLocaleString("es-MX", {
              timeZone: "America/Mexico_City",
            })}
            . El consentimiento no se copió ni se dio por confirmado.
          </p>
          <h3>Posibles vínculos</h3>
          <p>
            {detail.candidates.length
              ? "Coincidencia de teléfono. Aún requiere revisión individual."
              : "No hay un cliente válido con ese teléfono en Mi Tienda. No se creará ni se fusionará automáticamente."}
          </p>
          <form action={submitSourceReview} className={styles.form}>
            <input type="hidden" name="key" value={detail.key} />
            <label>
              Resultado de la revisión
              <select
                name="disposition"
                defaultValue={detail.review?.disposition ?? "PENDING"}
              >
                <option value="PENDING">Mantener pendiente</option>
                <option value="NEEDS_CONTACT">Faltan datos de contacto</option>
                {detail.candidates.length ? (
                  <option value="CANDIDATE">
                    Guardar candidato para revisión
                  </option>
                ) : null}
              </select>
            </label>
            {detail.candidates.length ? (
              <label>
                Cliente candidato
                <select name="target">
                  {detail.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.phone}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Nota de revisión
              <textarea
                name="note"
                minLength={5}
                maxLength={500}
                required
                defaultValue={detail.review?.note ?? ""}
              />
            </label>
            <button className="button primary" type="submit">
              Guardar revisión sin activar deuda
            </button>
          </form>
          <h3>Documentos y abonos de origen</h3>
          <p>
            Pagar no demuestra entrega. Todas las entregas siguen pendientes de
            confirmar; esta pantalla no reserva ni descuenta mercancía.
          </p>
          {detail.documents.map((d) => (
            <article key={d.key} className={styles.document}>
              <h4>
                {d.folio} · {d.status === "PAID" ? "Pagado" : "Pendiente"}
              </h4>
              <p>
                Total {money(d.total_cents)} · Abonado histórico{" "}
                {money(d.paid_cents)} · Saldo {money(d.balance_cents)}
              </p>
              {d.due_date ? <p>Vencimiento: {d.due_date}</p> : null}
              {d.payments.map((p) => (
                <p key={p.reference}>
                  {p.reference}: {money(p.amount_cents)}{" "}
                  {p.cancelled ? "· CANCELADO — excluido" : "· Activo"}
                </p>
              ))}
              {!d.payments.length ? (
                <p>
                  Sin detalle de abonos capturado para este documento; no se
                  inventan pagos.
                </p>
              ) : null}
              <ul>
                {d.lines.map((l, i) => (
                  <li key={`${l.barcode}-${i}`}>
                    <code>{l.barcode}</code> · {l.quantity} pieza(s) ·{" "}
                    {l.mapped
                      ? "Variante identificada"
                      : "Variante pendiente de revisión"}{" "}
                    · Entrega sin confirmar
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ) : null}
      <section
        className={`${styles.panel} ${styles.qa}`}
        aria-label="Ensayo de vínculo y abonos"
      >
        <h2>Ensayo de vínculo y abonos</h2>
        <p>
          Fuente sintética de $10.00. Usa tu sesión real y el flujo nativo, pero
          revierte sus movimientos antes de responder. No es un cobro, ticket ni
          vínculo SICAR válido.
        </p>
        {trial ? (
          <>
            <h3>Saldo del ensayo: {money(trial.balance_cents)}</h3>
            <p>
              {trial.payment_count} abonos ensayados · Movimientos nativos
              revertidos.
            </p>
          </>
        ) : null}
        {!list.qa_available ? (
          <p>
            La ventana de ensayo está cerrada para esta sesión. La consulta de
            origen sigue disponible.
          </p>
        ) : !trial ? (
          <form action={submitSourceTrial}>
            <input type="hidden" name="operation" value="QA_LINK" />
            <input type="hidden" name="run" value={run} />
            <input type="hidden" name="request" value={request} />
            <button type="submit" className="button primary">
              Ensayar vínculo de prueba
            </button>
          </form>
        ) : trial.balance_cents > 0 ? (
          <form action={submitSourceTrial} className={styles.form}>
            <input type="hidden" name="operation" value="QA_PAY" />
            <input type="hidden" name="run" value={run} />
            <input type="hidden" name="request" value={request} />
            <label>
              Abono de ensayo en pesos
              <input
                name="amount"
                inputMode="decimal"
                placeholder="4.00"
                required
              />
            </label>
            <button className="button primary" type="submit">
              Ensayar abono sin guardar cobro
            </button>
          </form>
        ) : (
          <p className={styles.notice}>
            Ensayo liquidado. Saldo cero y ningún cobro operativo guardado.
          </p>
        )}
      </section>
    </div>
  );
}
