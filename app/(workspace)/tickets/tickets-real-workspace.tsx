"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  FileText,
  Gift,
  Printer,
  ScanLine,
  Search,
  Undo2,
  X,
} from "lucide-react";

import {
  formatReceiptDate,
  ThermalReceipt,
  type ReceiptLine,
} from "@/components/thermal-receipt";
import {
  type CreateExchangeResult,
  type ExchangeSearchResult,
  type PrepareExchangeResult,
  type ReturnAuthorizationResult,
} from "@/lib/returns";
import { ReturnExchangeDialog } from "./return-exchange-dialog";
import { BarcodeScanner } from "@/components/barcode-scanner";

type TicketItem = {
  line_number: number;
  product_name: string;
  variant_description: string;
  sku: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  line_total_cents: number;
  gift_receipt: boolean;
};
type TicketPayment = {
  method_code: string;
  method_name: string;
  amount_cents: number;
  tendered_cents: number | null;
  change_cents: number;
  reference: string | null;
};
export type Ticket = {
  id: string;
  folio: string;
  status: "COMPLETED" | "CANCELLED";
  sold_at: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  cashier_name: string;
  register_name: string;
  cash_session_status: "OPEN" | "CLOSED";
  cancellation_reason: string | null;
  location: {
    id: string;
    code: string;
    name: string;
    address: string | null;
    phone: string | null;
  };
  items: TicketItem[];
  payments: TicketPayment[];
};
type CancelResult =
  { ok: true; folio: string } | { ok: false; code: string; message: string };
const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const ticketTime = new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Mexico_City",
});

export function TicketsRealWorkspace({
  tickets,
  status,
  periodStarts,
  returnWindowDays = 15,
  locationId,
  findTicketAction,
  cancelSaleAction,
  prepareExchangeAction,
  searchExchangeVariantsAction,
  authorizeReturnAction,
  createReturnExchangeAction,
  initialReturnLookup = false,
}: {
  tickets: Ticket[];
  status?: string;
  periodStarts: Record<"today" | "week" | "month", string>;
  returnWindowDays?: number;
  locationId?: string;
  findTicketAction?: (input: {
    locationId: string;
    code: string;
  }) => Promise<{ ok: true; ticket: Ticket } | { ok: false; message: string }>;
  cancelSaleAction?: (saleId: string, reason: string) => Promise<CancelResult>;
  prepareExchangeAction?: (saleId: string) => Promise<PrepareExchangeResult>;
  searchExchangeVariantsAction?: (input: {
    query: string;
    priceCents: number;
    excludeVariantId: string;
  }) => Promise<ExchangeSearchResult>;
  authorizeReturnAction?: (input: {
    employeeCode: string;
    pin: string;
  }) => Promise<ReturnAuthorizationResult>;
  createReturnExchangeAction?: (input: {
    idempotencyKey: string;
    cashSessionId: string;
    originalSaleId: string;
    saleItemId: string;
    quantity: number;
    condition: "RESELLABLE" | "DAMAGED";
    outputVariantId?: string | null;
    chargePayments: Array<{
      method_code: "CASH" | "CARD" | "TRANSFER";
      amount_cents: number;
      reference?: string;
    }>;
    refundReferences: Array<{ method_code: string; reference: string }>;
    authorizationToken: string;
    reason: string;
  }) => Promise<CreateExchangeResult>;
  initialReturnLookup?: boolean;
}) {
  const [rows, setRows] = useState(tickets);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [receiptMode, setReceiptMode] = useState<"sale" | "gift">("sale");
  const [reprintDate, setReprintDate] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [ticketScannerOpen, setTicketScannerOpen] =
    useState(initialReturnLookup);
  const deferredQuery = useDeferredValue(query);
  const selected = rows.find((ticket) => ticket.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const start = new Date(periodStarts[period]);
    const term = deferredQuery.trim().toLocaleLowerCase("es-MX");
    return rows.filter(
      (ticket) =>
        new Date(ticket.sold_at) >= start &&
        (!term ||
          [
            ticket.folio,
            ticket.cashier_name,
            ...ticket.payments.map((item) => item.method_name),
            ...ticket.items.flatMap((item) => [item.sku, item.product_name]),
          ]
            .join(" ")
            .toLocaleLowerCase("es-MX")
            .includes(term)),
    );
  }, [deferredQuery, period, periodStarts, rows]);

  const lines: ReceiptLine[] =
    selected?.items.map((item) => ({
      name: item.product_name,
      variant: item.variant_description,
      code: item.sku,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price_cents) / 100,
    })) ?? [];
  const payments = selected?.payments ?? [];
  const method = payments.map((item) => item.method_name).join(" + ");
  const tendered =
    payments.reduce(
      (sum, item) => sum + Number(item.tendered_cents ?? item.amount_cents),
      0,
    ) / 100;
  const change =
    payments.reduce((sum, item) => sum + Number(item.change_cents), 0) / 100;

  function selectTicket(ticket: Ticket) {
    setSelectedId(ticket.id);
    setReceiptMode("sale");
    setReprintDate(formatReceiptDate());
    setError("");
  }

  async function findScannedTicket(code: string) {
    const normalized = code.trim().toLocaleUpperCase("es-MX");
    setQuery(normalized);
    const ticket = rows.find(
      (row) => row.folio.toLocaleUpperCase("es-MX") === normalized,
    );
    if (ticket) selectTicket(ticket);
    else if (findTicketAction && locationId) {
      const result = await findTicketAction({ locationId, code: normalized });
      if (result.ok) {
        setRows((current) =>
          current.some((row) => row.id === result.ticket.id)
            ? current
            : [result.ticket, ...current],
        );
        selectTicket(result.ticket);
      } else setError(result.message);
    } else setError("No encontramos ese ticket en esta sucursal.");
    setTicketScannerOpen(false);
  }

  async function cancelTicket() {
    if (!selected || !cancelSaleAction || cancelReason.trim().length < 3)
      return;
    setBusy(true);
    setError("");
    const result = await cancelSaleAction(selected.id, cancelReason);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRows((current) =>
      current.map((ticket) =>
        ticket.id === selected.id
          ? {
              ...ticket,
              status: "CANCELLED",
              cancellation_reason: cancelReason.trim(),
            }
          : ticket,
      ),
    );
    setCancelOpen(false);
    setCancelReason("");
  }

  return (
    <section className="module-page tickets-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Últimos 30 días</p>
          <h1>Tickets y comprobantes</h1>
          <p className="heading-copy">
            Consulta ventas reales, reimprime o cancela con autorización
            mientras la caja original siga abierta.
          </p>
        </div>
      </div>
      {initialReturnLookup ? (
        <div className="admin-status" role="status">
          Escanea el ticket del cliente o escribe su folio para iniciar el
          cambio o la devolución.
        </div>
      ) : null}
      {status ? (
        <div className="inline-error" role="alert">
          No fue posible consultar los tickets. {status}
        </div>
      ) : null}
      <div className="toolbar-card">
        <label className="module-search">
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void findScannedTicket(query);
            }}
            placeholder="Buscar folio, producto, SKU o cajero"
            aria-label="Buscar tickets"
          />
        </label>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setTicketScannerOpen(true)}
        >
          <ScanLine aria-hidden="true" />
          Escanear ticket
        </button>
        <label className="toolbar-select">
          <span>Periodo</span>
          <select
            aria-label="Filtrar periodo"
            value={period}
            onChange={(event) =>
              setPeriod(event.target.value as "today" | "week" | "month")
            }
          >
            <option value="today">Hoy</option>
            <option value="week">Últimos 7 días</option>
            <option value="month">Últimos 30 días</option>
          </select>
        </label>
      </div>
      {error && !selected ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="ticket-layout">
        <section className="content-card ticket-list-card">
          <div className="ticket-list-header">
            <span>Folio</span>
            <span>Hora</span>
            <span>Pago</span>
            <span>Total</span>
            <span />
          </div>
          {filtered.map((ticket) => (
            <button
              className={
                selected?.id === ticket.id
                  ? "ticket-row selected"
                  : "ticket-row"
              }
              type="button"
              key={ticket.id}
              onClick={() => selectTicket(ticket)}
            >
              <span>
                <code>{ticket.folio}</code>
                {ticket.status === "CANCELLED" ? (
                  <small>Cancelada</small>
                ) : ticket.items.some((item) => item.gift_receipt) ? (
                  <small>
                    <Gift aria-hidden="true" />
                    Regalo
                  </small>
                ) : null}
              </span>
              <span>{ticketTime.format(new Date(ticket.sold_at))}</span>
              <span>
                {ticket.payments.map((item) => item.method_name).join(" + ")}
              </span>
              <strong>{money.format(Number(ticket.total_cents) / 100)}</strong>
              <FileText aria-hidden="true" />
            </button>
          ))}
          {filtered.length === 0 ? (
            <div className="empty-list">
              <Search aria-hidden="true" />
              <strong>No encontramos tickets</strong>
              <span>Prueba con otro periodo, folio o producto.</span>
            </div>
          ) : null}
        </section>
        <aside className={selected ? "ticket-detail open" : "ticket-detail"}>
          {selected ? (
            <>
              <header>
                <div>
                  <p className="eyebrow">
                    {selected.status === "CANCELLED"
                      ? "Venta cancelada"
                      : "Detalle de venta"}
                  </p>
                  <h2>{selected.folio}</h2>
                  <small>
                    {selected.register_name} · {selected.cashier_name}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar detalle"
                  onClick={() => setSelectedId(null)}
                >
                  <X aria-hidden="true" />
                </button>
              </header>
              <div className="receipt-type-switch" aria-label="Tipo de ticket">
                <button
                  className={receiptMode === "sale" ? "selected" : ""}
                  type="button"
                  onClick={() => setReceiptMode("sale")}
                >
                  Venta
                </button>
                <button
                  className={receiptMode === "gift" ? "selected gift" : "gift"}
                  type="button"
                  onClick={() => setReceiptMode("gift")}
                >
                  <Gift aria-hidden="true" />
                  Regalo
                </button>
              </div>
              <div className="receipt-paper-stage compact-stage">
                <ThermalReceipt
                  mode={receiptMode}
                  folio={selected.folio}
                  date={formatReceiptDate(new Date(selected.sold_at))}
                  items={
                    receiptMode === "gift"
                      ? lines.filter(
                          (_, index) => selected.items[index]?.gift_receipt,
                        )
                      : lines
                  }
                  subtotal={Number(selected.subtotal_cents) / 100}
                  discount={Number(selected.discount_cents) / 100}
                  total={Number(selected.total_cents) / 100}
                  method={method}
                  tendered={tendered}
                  change={change}
                  reprintLabel={reprintDate}
                  cashierName={selected.cashier_name}
                  location={selected.location}
                  returnWindowDays={returnWindowDays}
                />
              </div>
              {selected.status === "CANCELLED" ? (
                <p className="inline-warning">
                  Cancelada: {selected.cancellation_reason}
                </p>
              ) : null}
              {error ? (
                <p className="field-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="detail-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => window.print()}
                >
                  <Printer aria-hidden="true" />
                  Imprimir esta vista
                </button>
                {prepareExchangeAction &&
                searchExchangeVariantsAction &&
                authorizeReturnAction &&
                createReturnExchangeAction &&
                selected.status === "COMPLETED" ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setReturnDialogOpen(true)}
                  >
                    <ArrowRightLeft aria-hidden="true" />
                    Cambio o devolución
                  </button>
                ) : null}
                {cancelSaleAction &&
                selected.status === "COMPLETED" &&
                selected.cash_session_status === "OPEN" ? (
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Undo2 aria-hidden="true" />
                    Cancelar venta
                  </button>
                ) : null}
              </div>
              {selected.status === "COMPLETED" &&
              selected.cash_session_status === "CLOSED" ? (
                <p className="demo-caption">
                  La caja original ya cerró. Si el cliente regresa mercancía,
                  registra una devolución.
                </p>
              ) : null}
            </>
          ) : (
            <div className="detail-placeholder">
              <FileText aria-hidden="true" />
              <strong>Selecciona un ticket</strong>
              <span>Aquí verás su detalle y las acciones disponibles.</span>
            </div>
          )}
        </aside>
      </div>
      {cancelOpen && selected ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal compact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-cancel-title"
          >
            <p className="eyebrow">Acción con auditoría</p>
            <h2 id="ticket-cancel-title">Cancelar {selected.folio}</h2>
            <p>
              Se devolverán los artículos al inventario y se revertirá el
              efectivo dentro de la caja original.
            </p>
            <div className="form-stack">
              <label>
                <span>Motivo obligatorio</span>
                <textarea
                  value={cancelReason}
                  maxLength={500}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="Ej. Cobro duplicado"
                />
              </label>
            </div>
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setCancelOpen(false)}
              >
                Volver
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={busy || cancelReason.trim().length < 3}
                onClick={() => void cancelTicket()}
              >
                {busy ? "Cancelando…" : "Confirmar cancelación"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {returnDialogOpen &&
      selected &&
      prepareExchangeAction &&
      searchExchangeVariantsAction &&
      authorizeReturnAction &&
      createReturnExchangeAction ? (
        <ReturnExchangeDialog
          saleId={selected.id}
          folio={selected.folio}
          onClose={() => setReturnDialogOpen(false)}
          prepareAction={prepareExchangeAction}
          searchAction={searchExchangeVariantsAction}
          authorizeAction={authorizeReturnAction}
          createAction={createReturnExchangeAction}
        />
      ) : null}
      {ticketScannerOpen ? (
        <BarcodeScanner
          title="Escanear ticket"
          onClose={() => setTicketScannerOpen(false)}
          onDetected={findScannedTicket}
        />
      ) : null}
    </section>
  );
}
