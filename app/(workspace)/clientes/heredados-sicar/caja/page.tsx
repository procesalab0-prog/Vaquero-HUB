import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/authorization";
import { customerReviewEnabled } from "@/lib/customer-migration";
import type { LegacyFinanceView } from "@/lib/legacy-finance";
import type { LegacyCashContext } from "@/lib/legacy-cash";
import { trialLegacyCash } from "./actions";
import payment from "./payment.module.css";
import styles from "../../migracion-sicar/review.module.css";
export const metadata: Metadata = {
  title: "Abonos heredados con caja · Ensayo",
};
const money = (v: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    v / 100,
  );
const notices: Record<string, string> = {
  sobrepago:
    "El abono supera el saldo pendiente. No se registró ningún movimiento.",
  caja: "La sesión de caja cambió o no está abierta para ti. Recarga y revisa Caja.",
  sucursal: "La cuenta y la caja pertenecen a sucursales diferentes.",
  referencia:
    "Tarjeta y transferencia requieren una referencia de 3 a 100 caracteres.",
  efectivo: "El efectivo recibido debe cubrir el importe aplicado en efectivo.",
  conflicto: "Cambió una solicitud repetida. No se duplicó el movimiento.",
  metodo: "Este método de pago ya no está disponible.",
  datos:
    "Revisa los importes. Usa cantidades positivas, con hasta dos decimales, y completa el método seleccionado.",
};
export default async function LegacyCashPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  if (!customerReviewEnabled(process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { supabase } = await requirePermission("credit.collect");
  const [finance, context, params] = await Promise.all([
    supabase.rpc("m9_legacy_finance", { p_action: "LIST" }),
    supabase.rpc("m9_legacy_cash", { p_action: "CONTEXT" }),
    searchParams,
  ]);
  if (finance.error || context.error)
    throw Error("No se pudo consultar el ensayo de abonos con caja.");
  const view = finance.data as LegacyFinanceView,
    ctx = context.data as LegacyCashContext;
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">M9 · Preview · No recibe dinero real</p>
        <h1>Abonos heredados con caja</h1>
        <p>
          Prueba abonos con efectivo, tarjeta o transferencia. Todo el
          movimiento se revierte y sólo queda su comprobante de ensayo.
        </p>
        <Link
          className="button secondary"
          href="/clientes/heredados-sicar/saldos"
        >
          Volver a saldos heredados
        </Link>
      </header>
      <section className={styles.panel}>
        <h2>Caja de la prueba</h2>
        {ctx.session ? (
          <p>
            Sesión abierta en {ctx.session.location}. Sólo el efectivo aplicado
            al abono sumaría a caja; tarjeta y transferencia no aumentan el
            efectivo. No se muestra el efectivo esperado del corte.
          </p>
        ) : (
          <p>
            No tienes una sesión de caja abierta.{" "}
            <Link href="/caja">Revisar Caja</Link>
          </p>
        )}
        <p>
          El recibo estará marcado como ENSAYO y no acredita un pago. No uses
          este flujo para recibir abonos reales.
        </p>
        {ctx.last_trial ? (
          <Link
            className="button secondary"
            href={`/clientes/heredados-sicar/caja/recibo?ensayo=${ctx.last_trial.id}`}
          >
            Ver último recibo de ensayo
          </Link>
        ) : null}
        {params.status && notices[params.status] ? (
          <p role="status" className={styles.notice}>
            {notices[params.status]}
          </p>
        ) : null}
      </section>
      <section className={styles.panel}>
        <h2>Preparar abono ficticio</h2>
        <form
          action={trialLegacyCash}
          className={`${styles.form} ${payment.form}`}
        >
          <input type="hidden" name="request" value={crypto.randomUUID()} />
          <input type="hidden" name="session" value={ctx.session?.id ?? ""} />
          <label>
            Cuenta heredada
            <select name="account" required defaultValue="">
              <option value="" disabled>
                Elige una cuenta
              </option>
              {view.accounts
                .filter((c) => c.balance_cents > 0)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {money(c.balance_cents)}
                  </option>
                ))}
            </select>
          </label>
          <p>Completa uno o varios métodos. Deja vacíos los que no usarás.</p>
          <fieldset className={payment.group}>
            <legend>Efectivo</legend>
            <label>
              Importe del abono en efectivo
              <input
                name="cash_amount"
                inputMode="decimal"
                placeholder="Ej. 100.00"
              />
            </label>
            <label>
              Efectivo recibido para el ensayo
              <input
                name="tendered"
                inputMode="decimal"
                placeholder="Ej. 200.00"
              />
            </label>
          </fieldset>
          <fieldset className={payment.group}>
            <legend>Tarjeta</legend>
            <label>
              Importe con tarjeta
              <input
                name="card_amount"
                inputMode="decimal"
                placeholder="Ej. 100.00"
              />
            </label>
            <label>
              Referencia de tarjeta
              <input
                name="card_reference"
                maxLength={100}
                placeholder="ENSAYO: terminal"
              />
            </label>
          </fieldset>
          <fieldset className={payment.group}>
            <legend>Transferencia</legend>
            <label>
              Importe por transferencia
              <input
                name="transfer_amount"
                inputMode="decimal"
                placeholder="Ej. 100.00"
              />
            </label>
            <label>
              Referencia de transferencia
              <input
                name="transfer_reference"
                maxLength={100}
                placeholder="ENSAYO: banco"
              />
            </label>
          </fieldset>
          <button
            type="submit"
            className="button primary"
            disabled={!ctx.session}
          >
            Ensayar con caja y abrir recibo
          </button>
        </form>
      </section>
    </div>
  );
}
