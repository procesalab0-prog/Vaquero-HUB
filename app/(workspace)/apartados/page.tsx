import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarClock,
  CircleDollarSign,
  PackageCheck,
  Search,
} from "lucide-react";

import { resolveActiveLocation } from "@/lib/auth/active-location";
import { requirePermission } from "@/lib/auth/authorization";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { receiveLayawayPayment } from "./actions";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Apartados" };

type LayawayRow = {
  id: string;
  folio: string;
  status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "COMPLETED" | "CANCELLED";
  due_date: string;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  customer_name: string;
  member_number: string;
  item_count: number;
  unit_count: number;
  created_at: string;
};

type PaymentReceipt = {
  folio: string;
  layaway_folio: string;
  received_at: string;
  total_cents: number;
  balance_before_cents: number;
  balance_cents: number;
  customer_name: string;
  member_number: string;
  location_name: string;
  cashier_name: string;
  register_name: string;
  parts: Array<{
    method_name: string;
    amount_cents: number;
    reference?: string;
  }>;
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });
const activeStatuses = new Set<LayawayRow["status"]>([
  "OPEN",
  "PARTIALLY_PAID",
  "PAID",
]);

const statusLabels: Record<LayawayRow["status"], string> = {
  OPEN: "Abierto",
  PARTIALLY_PAID: "Con abonos",
  PAID: "Liquidado",
  COMPLETED: "Entregado",
  CANCELLED: "Cancelado",
};

export default async function LayawaysPage({
  searchParams,
}: {
  searchParams: Promise<{
    ubicacion?: string;
    busqueda?: string;
    estado?: string;
    status?: string;
    payment?: string;
  }>;
}) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) {
    return <LayawayPageContent rows={[]} locationId="preview" preview />;
  }
  const { supabase, profile } = await requirePermission("layaways.manage");
  const locations = (profile?.user_locations ?? []).flatMap((entry) =>
    Array.isArray(entry.locations)
      ? entry.locations
      : entry.locations
        ? [entry.locations]
        : [],
  );
  const location = await resolveActiveLocation(locations, params.ubicacion);
  if (!location) {
    return (
      <LayawayPageContent
        rows={[]}
        locationId=""
        status="No tienes una sucursal disponible."
      />
    );
  }
  const allowedStatus = [
    "OPEN",
    "PARTIALLY_PAID",
    "PAID",
    "COMPLETED",
    "CANCELLED",
  ].includes(params.estado ?? "")
    ? params.estado!
    : null;
  const [result, receiptResult] = await Promise.all([
    supabase.rpc("list_layaways", {
      p_location_id: location.id,
      p_query: (params.busqueda ?? "").trim().slice(0, 100),
      p_status: allowedStatus,
      p_limit: 100,
    }),
    params.payment
      ? supabase.rpc("get_layaway_payment_receipt", {
          p_payment_id: params.payment,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);
  return (
    <LayawayPageContent
      rows={(result.data ?? []) as LayawayRow[]}
      locationId={location.id}
      query={params.busqueda ?? ""}
      selectedStatus={allowedStatus ?? ""}
      status={result.error?.message}
      operationStatus={params.status}
      receipt={receiptResult.data as PaymentReceipt | null}
    />
  );
}

function LayawayPageContent({
  rows,
  locationId,
  query = "",
  selectedStatus = "",
  status,
  operationStatus,
  receipt,
  preview = false,
}: {
  rows: LayawayRow[];
  locationId: string;
  query?: string;
  selectedStatus?: string;
  status?: string;
  operationStatus?: string;
  receipt?: PaymentReceipt | null;
  preview?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const warningDate = new Date();
  warningDate.setDate(warningDate.getDate() + 7);
  const warning = warningDate.toISOString().slice(0, 10);
  return (
    <section className="module-page layaways-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Mercancía comprometida</p>
          <h1>Apartados</h1>
          <p className="heading-copy">
            Consulta reservas reales por folio, cliente o número de socio.
          </p>
        </div>
        <Link className="primary-button" href={`/pos?ubicacion=${locationId}`}>
          <PackageCheck aria-hidden="true" /> Nuevo desde Venta
        </Link>
      </div>
      {operationStatus === "abono-registrado" ? (
        <p className="notice-banner" role="status">
          Abono registrado. El saldo y la caja ya fueron actualizados.
        </p>
      ) : null}
      {operationStatus?.startsWith("abono-") &&
      operationStatus !== "abono-registrado" ? (
        <p className="inline-error operation-feedback" role="alert">
          {operationStatus === "abono-caja-requerida"
            ? "Abre tu caja antes de recibir un abono."
            : operationStatus === "abono-mayor-saldo"
              ? "El abono supera el saldo pendiente."
              : "No fue posible registrar el abono. Revisa importes y referencias."}
        </p>
      ) : null}
      {receipt ? (
        <article className="layaway-receipt print-receipt">
          <header>
            <div>
              <small>Comprobante de abono</small>
              <strong>{receipt.folio}</strong>
            </div>
            <PrintButton />
          </header>
          <h2>Mi Tienda SM</h2>
          <p>
            {receipt.location_name} · {receipt.register_name}
          </p>
          <dl>
            <div>
              <dt>Apartado</dt>
              <dd>{receipt.layaway_folio}</dd>
            </div>
            <div>
              <dt>Cliente</dt>
              <dd>
                {receipt.customer_name} · {receipt.member_number}
              </dd>
            </div>
            <div>
              <dt>Atendió</dt>
              <dd>{receipt.cashier_name}</dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{date.format(new Date(receipt.received_at))}</dd>
            </div>
          </dl>
          <div className="layaway-receipt-parts">
            {receipt.parts.map((part, index) => (
              <p key={`${part.method_name}-${index}`}>
                <span>{part.method_name}</span>
                <strong>{money.format(Number(part.amount_cents) / 100)}</strong>
              </p>
            ))}
          </div>
          <p className="layaway-receipt-total">
            <span>Abono</span>
            <strong>{money.format(Number(receipt.total_cents) / 100)}</strong>
          </p>
          <p>
            <span>
              Saldo anterior:{" "}
              {money.format(Number(receipt.balance_before_cents) / 100)}
            </span>
            <br />
            <strong>
              Saldo pendiente:{" "}
              {money.format(Number(receipt.balance_cents) / 100)}
            </strong>
          </p>
        </article>
      ) : null}
      <form className="layaway-filters" method="get">
        <input type="hidden" name="ubicacion" value={locationId} />
        <label>
          <Search aria-hidden="true" />
          <input
            name="busqueda"
            defaultValue={query}
            placeholder="Folio, cliente o número de socio"
            maxLength={100}
          />
        </label>
        <select
          name="estado"
          defaultValue={selectedStatus}
          aria-label="Estado del apartado"
        >
          <option value="">Todos los estados</option>
          <option value="OPEN">Abiertos</option>
          <option value="PARTIALLY_PAID">Con abonos</option>
          <option value="PAID">Liquidados</option>
          <option value="COMPLETED">Entregados</option>
          <option value="CANCELLED">Cancelados</option>
        </select>
        <button className="secondary-button" type="submit">
          Buscar
        </button>
      </form>
      {status ? (
        <p className="inline-error operation-feedback" role="alert">
          No fue posible consultar apartados.
        </p>
      ) : null}
      {preview ? (
        <p className="notice-banner">
          Vista previa: conecta Supabase para crear reservas reales.
        </p>
      ) : null}
      <div className="layaway-list">
        {rows.length === 0 ? (
          <div className="empty-state">
            <CalendarClock aria-hidden="true" />
            <strong>No hay apartados con esos filtros</strong>
            <p>Créalo desde el carrito de Venta para reservar la mercancía.</p>
          </div>
        ) : (
          rows.map((row) => {
            const active = activeStatuses.has(row.status);
            const timing = !active
              ? "closed"
              : row.due_date < today
                ? "overdue"
                : row.due_date <= warning
                  ? "warning"
                  : "current";
            return (
              <article className={`layaway-card ${timing}`} key={row.id}>
                <header>
                  <div>
                    <code>{row.folio}</code>
                    <strong>{row.customer_name}</strong>
                  </div>
                  <span>{statusLabels[row.status]}</span>
                </header>
                <div className="layaway-card-grid">
                  <span>
                    <small>Vence</small>
                    <strong>
                      {date.format(new Date(`${row.due_date}T12:00:00`))}
                    </strong>
                  </span>
                  <span>
                    <small>Mercancía</small>
                    <strong>
                      {Number(row.unit_count)} pzas · {Number(row.item_count)}{" "}
                      variantes
                    </strong>
                  </span>
                  <span>
                    <small>Pagado</small>
                    <strong>
                      {money.format(Number(row.paid_cents) / 100)}
                    </strong>
                  </span>
                  <span>
                    <small>Saldo</small>
                    <strong>
                      {money.format(Number(row.balance_cents) / 100)}
                    </strong>
                  </span>
                </div>
                <footer>
                  Socio {row.member_number} · Total{" "}
                  {money.format(Number(row.total_cents) / 100)}
                </footer>
                {active && Number(row.balance_cents) > 0 ? (
                  <details className="layaway-payment-panel">
                    <summary>
                      <CircleDollarSign aria-hidden="true" /> Recibir abono
                    </summary>
                    <form action={receiveLayawayPayment}>
                      <input type="hidden" name="layaway_id" value={row.id} />
                      <p>
                        Puede combinar métodos. La suma no debe superar{" "}
                        {money.format(Number(row.balance_cents) / 100)}.
                      </p>
                      <div className="credit-payment-grid">
                        <label>
                          <span>Efectivo</span>
                          <input
                            name="cash"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={Number(row.balance_cents) / 100}
                            step="0.01"
                            placeholder="0.00"
                          />
                        </label>
                        <label>
                          <span>Tarjeta</span>
                          <input
                            name="card"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={Number(row.balance_cents) / 100}
                            step="0.01"
                            placeholder="0.00"
                          />
                        </label>
                        <label>
                          <span>Referencia tarjeta</span>
                          <input
                            name="card_reference"
                            placeholder="Mínimo 3 caracteres"
                          />
                        </label>
                        <label>
                          <span>Transferencia</span>
                          <input
                            name="transfer"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={Number(row.balance_cents) / 100}
                            step="0.01"
                            placeholder="0.00"
                          />
                        </label>
                        <label>
                          <span>Referencia transferencia</span>
                          <input
                            name="transfer_reference"
                            placeholder="Mínimo 3 caracteres"
                          />
                        </label>
                        <label>
                          <span>Nota opcional</span>
                          <input name="note" minLength={3} maxLength={500} />
                        </label>
                      </div>
                      <button className="primary-button" type="submit">
                        Confirmar abono
                      </button>
                    </form>
                  </details>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
