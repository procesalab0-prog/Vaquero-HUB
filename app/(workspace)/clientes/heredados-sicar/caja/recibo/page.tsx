import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import type { LegacyCashReceipt } from "@/lib/legacy-cash";
import { PrintTrialReceipt } from "./print-button";
import styles from "./receipt.module.css";
import review from "../../../migracion-sicar/review.module.css";
export const metadata: Metadata = {
  title: "Recibo de ensayo · Abono heredado",
};
const money = (v: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    v / 100,
  );
export default async function LegacyCashReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ ensayo?: string }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("credit.collect");
  const { ensayo } = await searchParams;
  if (!ensayo || !/^[a-f0-9-]{36}$/.test(ensayo)) notFound();
  const { data, error } = await supabase.rpc("m9_legacy_cash", {
    p_action: "RECEIPT",
    p_input: { request: ensayo },
  });
  if (error || !data) notFound();
  const receipt = data as LegacyCashReceipt;
  return (
    <div className={review.page}>
      <article
        className={styles.receipt}
        aria-label="Recibo de ensayo revertido"
      >
        <p className={styles.watermark}>
          ENSAYO REVERTIDO · NO VÁLIDO COMO PAGO
        </p>
        <h1>Abono de cliente heredado</h1>
        {receipt.operating_engine ? (
          <p>
            Motor operativo probado con corte SICAR renovado. Cobro real
            bloqueado; esta prueba se revirtió.
          </p>
        ) : null}
        <p>
          <strong>{receipt.folio}</strong>
        </p>
        <p>
          {new Date(receipt.received_at).toLocaleString("es-MX", {
            timeZone: "America/Mexico_City",
          })}
        </p>
        <p>
          Folio temporal del ensayo: la secuencia se revierte y puede repetirse.
          La referencia siguiente identifica esta prueba.
        </p>
        <p>{receipt.customer_name}</p>
        <p>
          Referencia de ensayo: <code>{receipt.request}</code>
        </p>
        <table className={styles.table}>
          <caption>Desglose de métodos del ensayo</caption>
          <thead>
            <tr>
              <th>Método y referencia</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {receipt.parts.map((p) => (
              <tr key={p.method_code}>
                <td>
                  {p.name}
                  {p.reference ? <div>{p.reference}</div> : null}
                  {p.tendered_cents !== undefined ? (
                    <div>
                      Recibido: {money(p.tendered_cents)} · Cambio:{" "}
                      {money(p.change_cents ?? 0)}
                    </div>
                  ) : null}
                </td>
                <td>{money(p.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Total de abono simulado:{" "}
          <strong>{money(receipt.amount_cents)}</strong>
        </p>
        <p>
          Efectivo que sumaría a caja:{" "}
          <strong>{money(receipt.cash_delta_cents)}</strong>
        </p>
        <h2>Aplicación a documentos SICAR</h2>
        <ul>
          {receipt.allocations.map((a) => (
            <li key={a.document}>
              {a.source_folio} · {money(a.amount_cents)}
            </li>
          ))}
        </ul>
        <p>Saldo antes del ensayo: {money(receipt.before_cents)}</p>
        <p>Saldo simulado después: {money(receipt.after_cents)}</p>
        <p>
          Saldo conservado tras revertir:{" "}
          <strong>{money(receipt.retained_balance_cents)}</strong>
        </p>
        <p role="status">
          Ensayo revertido. Se comprobó el reintento sin duplicados. Caja,
          folio, deuda y asignaciones quedaron como antes. No se recibió dinero
          real ni se acreditó entrega.
        </p>
        <div className={styles.actions}>
          <PrintTrialReceipt />
          <Link
            className="button primary"
            href="/clientes/heredados-sicar/caja"
          >
            Nuevo ensayo con caja
          </Link>
          <Link
            className="button secondary"
            href="/clientes/heredados-sicar/saldos"
          >
            Ver saldos conservados
          </Link>
        </div>
      </article>
    </div>
  );
}
