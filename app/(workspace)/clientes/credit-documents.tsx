"use client";

import { Printer, X } from "lucide-react";
import Link from "next/link";

type StatementEntry = {
  id: string;
  entry_type: "CHARGE" | "PAYMENT" | "RETURN" | "CANCELLATION" | "ADJUSTMENT";
  amount_cents: number;
  occurred_at: string;
  due_date: string | null;
  outstanding_cents: number | null;
  location_name: string;
  actor_name: string;
  metadata?: { folio?: string };
};

export type CreditStatement = {
  customer_id: string;
  member_number: string;
  customer_name: string;
  balance_cents: number;
  oldest_due_date: string | null;
  entries: StatementEntry[];
};

export type CreditPaymentReceipt = {
  id: string;
  folio: string;
  received_at: string;
  total_cents: number;
  note: string | null;
  customer_name: string;
  member_number: string;
  location_name: string;
  cashier_name: string;
  register_name: string;
  balance_cents: number;
  parts: Array<{
    method_code: string;
    method_name: string;
    amount_cents: number;
    reference: string | null;
  }>;
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const dateTime = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Mexico_City",
});
const entryLabels: Record<StatementEntry["entry_type"], string> = {
  CHARGE: "Venta a crédito",
  PAYMENT: "Abono",
  RETURN: "Devolución",
  CANCELLATION: "Cancelación",
  ADJUSTMENT: "Ajuste",
};

export function CreditDocuments({
  statement,
  receipt,
  from,
  to,
}: {
  statement: CreditStatement;
  receipt: CreditPaymentReceipt | null;
  from: string;
  to: string;
}) {
  return (
    <section
      className="credit-documents"
      aria-labelledby="credit-statement-title"
    >
      <header>
        <div>
          <p className="eyebrow">M7 · Cartera del cliente</p>
          <h2 id="credit-statement-title">Estado de cuenta</h2>
          <p>
            {statement.customer_name} · Socio {statement.member_number}
          </p>
        </div>
        <Link
          className="icon-button"
          href="/clientes"
          aria-label="Cerrar estado de cuenta"
        >
          <X aria-hidden="true" />
        </Link>
      </header>

      <form className="credit-statement-filters" action="/clientes">
        <input type="hidden" name="credit" value={statement.customer_id} />
        <label>
          <span>Desde</span>
          <input type="date" name="from" defaultValue={from} />
        </label>
        <label>
          <span>Hasta</span>
          <input type="date" name="to" defaultValue={to} />
        </label>
        <button className="secondary-button" type="submit">
          Aplicar periodo
        </button>
      </form>

      <div className="credit-statement-summary">
        <span>Saldo actual</span>
        <strong>{money.format(statement.balance_cents / 100)}</strong>
        <small>
          {statement.oldest_due_date
            ? `Vencimiento más antiguo: ${statement.oldest_due_date}`
            : "Sin cargos pendientes"}
        </small>
      </div>

      <div className="credit-statement-list">
        {statement.entries.map((entry) => (
          <article key={entry.id}>
            <div>
              <strong>{entryLabels[entry.entry_type]}</strong>
              <small>
                {dateTime.format(new Date(entry.occurred_at))} ·{" "}
                {entry.location_name}
              </small>
              <small>
                {entry.metadata?.folio
                  ? `Folio ${entry.metadata.folio} · `
                  : ""}
                Registró {entry.actor_name}
              </small>
            </div>
            <span className={entry.amount_cents > 0 ? "charge" : "payment"}>
              {entry.amount_cents > 0 ? "+" : "−"}
              {money.format(Math.abs(entry.amount_cents) / 100)}
            </span>
          </article>
        ))}
        {statement.entries.length === 0 ? (
          <p className="credit-empty">No hay movimientos.</p>
        ) : null}
      </div>

      {receipt ? (
        <article
          className="credit-payment-receipt print-receipt"
          aria-label="Comprobante de abono"
        >
          <header>
            <strong>MI TIENDA SM</strong>
            <span>COMPROBANTE DE ABONO</span>
          </header>
          <dl>
            <div>
              <dt>Folio</dt>
              <dd>{receipt.folio}</dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{dateTime.format(new Date(receipt.received_at))}</dd>
            </div>
            <div>
              <dt>Cliente</dt>
              <dd>{receipt.customer_name}</dd>
            </div>
            <div>
              <dt>Socio</dt>
              <dd>{receipt.member_number}</dd>
            </div>
            <div>
              <dt>Sucursal</dt>
              <dd>{receipt.location_name}</dd>
            </div>
            <div>
              <dt>Recibió</dt>
              <dd>
                {receipt.cashier_name} · {receipt.register_name}
              </dd>
            </div>
          </dl>
          <div className="credit-receipt-parts">
            {receipt.parts.map((part) => (
              <div key={part.method_code}>
                <span>
                  {part.method_name}
                  {part.reference ? ` · ${part.reference}` : ""}
                </span>
                <strong>{money.format(part.amount_cents / 100)}</strong>
              </div>
            ))}
          </div>
          <div className="credit-receipt-total">
            <span>ABONO</span>
            <strong>{money.format(receipt.total_cents / 100)}</strong>
          </div>
          <div className="credit-receipt-balance">
            Saldo restante:{" "}
            <strong>{money.format(receipt.balance_cents / 100)}</strong>
          </div>
          {receipt.note ? <p>Nota: {receipt.note}</p> : null}
        </article>
      ) : null}

      {receipt ? (
        <div className="credit-document-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => window.print()}
          >
            <Printer aria-hidden="true" /> Imprimir comprobante
          </button>
        </div>
      ) : null}
    </section>
  );
}
