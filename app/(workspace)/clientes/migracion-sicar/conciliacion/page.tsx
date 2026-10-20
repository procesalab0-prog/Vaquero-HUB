import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import {
  reconcileCustomers,
  type ReconciliationGraph,
} from "@/lib/customer-reconciliation";
import pilot from "@/lib/m9-pilot-barcodes.json";
import styles from "../review.module.css";
export const metadata: Metadata = { title: "Conciliación del piloto SICAR" };
const money = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    n / 100,
  );
const identity: Record<string, string> = {
  NO_NATIVE_MATCH: "Falta cliente nativo acreditado",
  CONTACT_PENDING: "Falta contacto",
  CANDIDATE_ONLY: "Candidato; identidad sin aprobar",
  LINK_PRESENT_REQUIRES_REVALIDATION:
    "Vínculo registrado; revalidar antes de operar",
};
export default async function CustomerReconciliation({
  searchParams,
}: {
  searchParams: Promise<{ alcance?: string }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("customers.manage");
  const { data, error } = await supabase.rpc("m9_customer_reconciliation");
  if (error) throw Error("No fue posible conciliar el origen SICAR.");
  const graph = data as ReconciliationGraph;
  const report = reconcileCustomers(
    graph,
    pilot.barcodes,
    new Date().toISOString(),
  );
  const all = (await searchParams).alcance === "todos";
  const accounts = report.accounts
    .filter((c) => all || c.open_documents > 0 || c.pilot_match)
    .sort(
      (a, b) =>
        Number(b.open_documents > 0) - Number(a.open_documents > 0) ||
        a.name.localeCompare(b.name, "es-MX") ||
        a.key.localeCompare(b.key),
    );
  const s = report.summary;
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Sólo Preview · Consulta sin movimientos</p>
        <h1>Conciliación del piloto SICAR</h1>
        <p>
          Saldo, identidad y entrega se revisan por separado. Esta pantalla no
          abre deudas, cobra ni modifica inventario.
        </p>
        <Link className="button secondary" href="/clientes/migracion-sicar">
          Volver a revisión de cuentas
        </Link>
      </header>
      <div className={styles.summary} aria-label="Resumen de conciliación">
        <section>
          <strong>
            {s.accounts} / {s.documents}
          </strong>
          <span>Cuentas / documentos de origen</span>
        </section>
        <section>
          <strong>{money(s.pending_cents)}</strong>
          <span>{s.open_documents} documentos pendientes</span>
        </section>
        <section>
          <strong>
            {s.exact_variant_lines} / {s.source_lines}
          </strong>
          <span>Líneas con variante literal vigente</span>
        </section>
        <section>
          <strong>{s.financial_exceptions}</strong>
          <span>Diferencias financieras detectadas</span>
        </section>
      </div>
      <section className={styles.panel} aria-label="Estado del corte">
        <h2>
          {report.financial_pass
            ? "Saldos conciliados en el corte de origen"
            : "Hay diferencias: detener la apertura"}
        </h2>
        <p>
          {s.paid_documents} documentos pagados permanecen como historial.
          Abonos activos de los abiertos: {money(s.active_payment_cents)}.
          Cancelados excluidos: {money(s.cancelled_payment_cents)}.
        </p>
        <p>
          Corte almacenado:{" "}
          {new Date(report.source_at).toLocaleString("es-MX", {
            timeZone: "America/Mexico_City",
          })}
          .{" "}
          {report.cut_fresh
            ? "Dentro de 24 horas; renovar y conciliar antes de operar."
            : "Corte vencido; requiere renovación."}
        </p>
        <p>
          <strong>
            {s.linked_accounts} vínculos de cliente registrados ·{" "}
            {s.native_candidates} coincidencias candidatas.
          </strong>{" "}
          Una coincidencia no confirma identidad ni consentimiento.
        </p>
        <p>
          {s.unknown_delivery_lines} líneas sin entrega acreditada. Las
          cantidades reservadas, disponibles e importables siguen sin definir.
          «Recepción de pago» en SICAR no demuestra entrega física.
        </p>
        <p className={styles.notice}>
          Alcance APARTADO; no es todo el padrón ni todos los compromisos de
          SICAR. Conciliado no significa autorizado para operar.
        </p>
      </section>
      <section className={styles.panel} aria-label="Cuentas priorizadas">
        <h2>Revisión por cuenta</h2>
        <p>
          Primero las cuentas con saldo y la coincidencia de mercancía del
          piloto. Puedes consultar el resto del archivo sin responder producto
          por producto.
        </p>
        <nav className={styles.search} aria-label="Alcance de conciliación">
          <Link className="button secondary" href="?alcance=prioridad">
            Pendientes y piloto
          </Link>
          <Link className="button secondary" href="?alcance=todos">
            Todas las cuentas
          </Link>
          <span>{accounts.length} cuentas visibles</span>
        </nav>
        {accounts.map((c) => (
          <article className={styles.document} key={c.key}>
            <h3>{c.name}</h3>
            <p>
              {c.reconciled ? "Saldo conciliado" : "Diferencia por revisar"} ·{" "}
              {money(c.used_cents)} · {identity[c.identity]}
            </p>
            <p>
              Entrega sin confirmar
              {c.pilot_match ? " · Coincide con mercancía del piloto" : ""}.
            </p>
            {report.documents
              .filter(
                (d) =>
                  d.account === c.key &&
                  (all ||
                    d.status === "OPEN" ||
                    graph.lines.some(
                      (l) =>
                        l.document === d.key &&
                        pilot.barcodes.includes(l.barcode),
                    )),
              )
              .map((d) => (
                <p key={d.key}>
                  <strong>{d.folio}</strong> ·{" "}
                  {d.status === "PAID" ? "Archivo pagado" : "Pendiente"} · Total{" "}
                  {money(d.total_cents)} · Abonado {money(d.paid_cents)} · Saldo{" "}
                  {money(d.balance_cents)} ·{" "}
                  {d.reconciled ? "Cuadra" : "No cuadra"}
                </p>
              ))}
            <Link
              className="button secondary"
              href={`/clientes/migracion-sicar?key=${c.key}`}
            >
              Ver documentos y vínculo
            </Link>
          </article>
        ))}
      </section>
      <section className={styles.panel} aria-label="Mercancía del piloto">
        <h2>Los {s.pilot_codes} códigos del piloto</h2>
        <p>
          {s.pilot_with_document} código con coincidencia documental en este
          alcance. Los demás no se consideran libres de compromisos por ausencia
          de coincidencia.
        </p>
        {report.pilot.map((p) => (
          <article className={styles.document} key={p.barcode}>
            <h3>
              <code>{p.barcode}</code>
            </h3>
            {p.lines.length ? (
              p.lines.map((l) => (
                <p key={l.document + "|" + l.quantity}>
                  {l.folio} · {l.quantity} pieza(s) ·{" "}
                  {l.financial_status === "PAID"
                    ? "Pagado; entrega sin confirmar"
                    : "Saldo y entrega por separado"}{" "}
                  · {l.mapped ? "Variante exacta" : "Falta variante exacta"}
                </p>
              ))
            ) : (
              <p>Sin coincidencia en los documentos revisados.</p>
            )}
            <small>
              Cantidad importable: pendiente · Sin reserva ni descuento
              adicional.
            </small>
          </article>
        ))}
      </section>
    </div>
  );
}
