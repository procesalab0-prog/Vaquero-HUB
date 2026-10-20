import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import type { LegacyFinanceView } from "@/lib/legacy-finance";
import { trialLegacyPayment } from "./actions";
import styles from "../../migracion-sicar/review.module.css";
export const metadata: Metadata = { title: "Saldos heredados · Ensayo" };
const money = (v: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    v / 100,
  );
const notices: Record<string, string> = {
  ensayado:
    "Abono de ensayo validado y revertido. El saldo conservado no cambió; caja e inventario siguen intactos.",
  sobrepago:
    "Ese importe supera el saldo pendiente. No se registró ningún movimiento.",
  "sin-saldo": "Esta cuenta no tiene saldo abierto para ensayar.",
  importe:
    "Escribe un importe positivo con hasta dos decimales, sin comas ni signos.",
  conflicto:
    "La solicitud cambió al repetirse. No se duplicó ningún movimiento.",
  error: "No se pudo completar el ensayo. Recarga y revisa la cuenta.",
};
export default async function LegacyBalances({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("customers.manage");
  const { data, error } = await supabase.rpc("m9_legacy_finance", {
    p_action: "LIST",
  });
  if (error) throw Error("No se pudieron consultar los saldos heredados.");
  const view = data as LegacyFinanceView;
  const params = await searchParams;
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Sólo Preview · Sin cobro real</p>
        <h1>Apertura de saldos heredados</h1>
        <p>
          Libro de apertura del corte de SICAR. Conserva lo pendiente por
          documento; los pagos históricos no se cobran otra vez. Alcance:
          cuentas de APARTADO, no todo el padrón.
        </p>
        <Link href="/clientes/heredados-sicar" className="button secondary">
          Volver al registro heredado
        </Link>
      </header>
      <div className={styles.summary}>
        <section>
          <strong>{view.accounts.length}</strong>
          <span>Cuentas con apertura</span>
        </section>
        <section>
          <strong>{view.accounts.reduce((n, c) => n + c.documents, 0)}</strong>
          <span>Documentos abiertos</span>
        </section>
        <section>
          <strong>
            {money(view.accounts.reduce((n, c) => n + c.balance_cents, 0))}
          </strong>
          <span>Saldo conservado en staging</span>
        </section>
        <section>
          <strong>{view.trial_count}</strong>
          <span>Ensayos auditados y revertidos</span>
        </section>
      </div>
      {view.last_trial ? (
        <section className={styles.panel} aria-label="Último ensayo revertido">
          <h2>Último ensayo · Revertido</h2>
          <p>
            Importe ficticio:{" "}
            <strong>{money(view.last_trial.amount_cents)}</strong>. Saldo antes:{" "}
            {money(view.last_trial.before_cents)}. El saldo habría quedado en{" "}
            {money(view.last_trial.after_cents)}.
          </p>
          <p>
            Saldo conservado después de revertir:{" "}
            <strong>{money(view.last_trial.retained_balance_cents)}</strong>. Se
            comprobó el reintento sin duplicados y la asignación a{" "}
            {view.last_trial.allocations.length} documento(s). Caja e
            inventario: sin cambios.
          </p>
          <p>Esta evidencia no es un recibo de pago.</p>
        </section>
      ) : null}
      <section className={styles.panel}>
        <h2>Probar un abono sin cobrar</h2>
        <p>
          El ensayo aplica el importe a los documentos por vencimiento, verifica
          el reintento y revierte todos sus movimientos. Sólo conserva la
          evidencia técnica. No emite un recibo de pago ni recibe dinero,
          autoriza crédito nuevo o acredita entregas.
        </p>
        <p>
          Los cobros operativos permanecen bloqueados hasta integrar y aceptar
          caja. El día del arranque se requiere un corte renovado y conciliado.
        </p>
        {params.status && notices[params.status] ? (
          <p role="status" className={styles.notice}>
            {notices[params.status]}
          </p>
        ) : null}
        {view.accounts.map((c) => (
          <article key={c.id} className={styles.document}>
            <h3>{c.name}</h3>
            <p>
              Referencia heredada: <code>{c.id}</code>
            </p>
            <p>
              Saldo conservado: <strong>{money(c.balance_cents)}</strong>
            </p>
            <ul>
              {c.entries.map((d) => (
                <li key={d.folio}>
                  {d.folio} · {money(d.amount_cents)} · Vencimiento{" "}
                  {d.due ?? "sin registrar"}
                </li>
              ))}
            </ul>
            <form action={trialLegacyPayment} className={styles.form}>
              <input type="hidden" name="request" value={crypto.randomUUID()} />
              <input type="hidden" name="account" value={c.id} />
              <label>
                Importe ficticio del ensayo (MXN)
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  placeholder="Ej. 1.00"
                  autoComplete="off"
                />
              </label>
              <button type="submit" className="button secondary">
                Ensayar abono y revertir
              </button>
            </form>
          </article>
        ))}
      </section>
    </div>
  );
}
