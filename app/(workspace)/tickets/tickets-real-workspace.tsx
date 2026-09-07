"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Check,
  FileText,
  Gift,
  Printer,
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
  unitExchangeValue,
  type CreateExchangeResult,
  type ExchangeSearchResult,
  type ExchangeVariant,
  type PrepareExchangeResult,
  type ReturnableSale,
  type ReturnableSaleItem,
} from "@/lib/returns";

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
  cancelSaleAction,
  prepareExchangeAction,
  searchExchangeVariantsAction,
  createExchangeAction,
}: {
  tickets: Ticket[];
  status?: string;
  periodStarts: Record<"today" | "week" | "month", string>;
  cancelSaleAction?: (saleId: string, reason: string) => Promise<CancelResult>;
  prepareExchangeAction?: (saleId: string) => Promise<PrepareExchangeResult>;
  searchExchangeVariantsAction?: (input: {
    query: string;
    priceCents: number;
    excludeVariantId: string;
  }) => Promise<ExchangeSearchResult>;
  createExchangeAction?: (input: {
    idempotencyKey: string;
    cashSessionId: string;
    originalSaleId: string;
    saleItemId: string;
    outputVariantId: string;
    reason: string;
  }) => Promise<CreateExchangeResult>;
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
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeSale, setExchangeSale] = useState<ReturnableSale | null>(null);
  const [exchangeCashSessionId, setExchangeCashSessionId] = useState("");
  const [exchangeLoading, setExchangeLoading] = useState(false);
  const [exchangeError, setExchangeError] = useState("");
  const [returnItemId, setReturnItemId] = useState("");
  const [exchangeQuery, setExchangeQuery] = useState("");
  const [exchangeVariants, setExchangeVariants] = useState<ExchangeVariant[]>(
    [],
  );
  const [outputVariantId, setOutputVariantId] = useState("");
  const [exchangeReason, setExchangeReason] = useState("Cambio de talla");
  const [exchangeFolio, setExchangeFolio] = useState("");
  const exchangeOperation = useRef(false);
  const exchangeIdempotencyKey = useRef(crypto.randomUUID());
  const deferredQuery = useDeferredValue(query);
  const selected = rows.find((ticket) => ticket.id === selectedId) ?? null;
  const selectedReturnItem =
    exchangeSale?.items.find((item) => item.sale_item_id === returnItemId) ??
    null;
  const selectedOutput =
    exchangeVariants.find((variant) => variant.id === outputVariantId) ?? null;

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

  async function openExchange() {
    if (!selected || !prepareExchangeAction || exchangeOperation.current)
      return;
    exchangeOperation.current = true;
    setExchangeOpen(true);
    setExchangeLoading(true);
    setExchangeError("");
    setExchangeSale(null);
    setExchangeCashSessionId("");
    setReturnItemId("");
    setExchangeVariants([]);
    setOutputVariantId("");
    setExchangeReason("Cambio de talla");
    setExchangeFolio("");
    exchangeIdempotencyKey.current = crypto.randomUUID();
    const result = await prepareExchangeAction(selected.id);
    setExchangeLoading(false);
    exchangeOperation.current = false;
    if (!result.ok) {
      setExchangeError(result.message);
      return;
    }
    setExchangeSale(result.sale);
    setExchangeCashSessionId(result.cashSessionId);
  }

  async function loadExchangeVariants(
    item: ReturnableSaleItem,
    search: string,
  ) {
    if (!searchExchangeVariantsAction || exchangeOperation.current) return;
    exchangeOperation.current = true;
    setExchangeLoading(true);
    setExchangeError("");
    setOutputVariantId("");
    const result = await searchExchangeVariantsAction({
      query: search,
      priceCents: unitExchangeValue(item),
      excludeVariantId: item.variant_id,
    });
    setExchangeLoading(false);
    exchangeOperation.current = false;
    if (!result.ok) {
      setExchangeError(result.message);
      setExchangeVariants([]);
      return;
    }
    setExchangeVariants(result.variants);
  }

  function chooseReturnItem(item: ReturnableSaleItem) {
    setReturnItemId(item.sale_item_id);
    setExchangeQuery("");
    setOutputVariantId("");
    void loadExchangeVariants(item, "");
  }

  async function confirmExchange() {
    if (
      !exchangeSale ||
      !selectedReturnItem ||
      !selectedOutput ||
      !exchangeCashSessionId ||
      !createExchangeAction ||
      exchangeReason.trim().length < 3 ||
      exchangeOperation.current
    )
      return;
    exchangeOperation.current = true;
    setExchangeLoading(true);
    setExchangeError("");
    const result = await createExchangeAction({
      idempotencyKey: exchangeIdempotencyKey.current,
      cashSessionId: exchangeCashSessionId,
      originalSaleId: exchangeSale.id,
      saleItemId: selectedReturnItem.sale_item_id,
      outputVariantId: selectedOutput.id,
      reason: exchangeReason,
    });
    setExchangeLoading(false);
    exchangeOperation.current = false;
    if (!result.ok) {
      setExchangeError(result.message);
      return;
    }
    setExchangeFolio(result.folio);
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
            placeholder="Buscar folio, producto, SKU o cajero"
            aria-label="Buscar tickets"
          />
        </label>
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
                {prepareExchangeAction && selected.status === "COMPLETED" ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void openExchange()}
                  >
                    <ArrowRightLeft aria-hidden="true" />
                    Registrar cambio
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
      {exchangeOpen && selected ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal exchange-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-exchange-title"
          >
            <div className="exchange-modal-header">
              <div>
                <p className="eyebrow">Cambio con ticket</p>
                <h2 id="ticket-exchange-title">
                  {exchangeFolio
                    ? "Cambio registrado"
                    : `Cambiar artículo de ${selected.folio}`}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Cerrar cambio"
                disabled={exchangeLoading}
                onClick={() => setExchangeOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </div>

            {exchangeLoading && !exchangeSale ? (
              <div className="exchange-loading" role="status">
                Consultando ticket y caja…
              </div>
            ) : null}

            {exchangeFolio ? (
              <div className="exchange-success">
                <span className="exchange-success-icon">
                  <Check aria-hidden="true" />
                </span>
                <strong>{exchangeFolio}</strong>
                <p>
                  El artículo recibido volvió al inventario y la pieza nueva se
                  descontó. Ambos movimientos quedaron auditados.
                </p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setExchangeOpen(false)}
                >
                  Terminar
                </button>
              </div>
            ) : exchangeSale ? (
              <>
                <section className="exchange-step">
                  <div className="exchange-step-heading">
                    <span>1</span>
                    <div>
                      <strong>¿Qué pieza regresa?</strong>
                      <small>Selecciona una pieza del ticket.</small>
                    </div>
                  </div>
                  <div className="exchange-item-list">
                    {exchangeSale.items
                      .filter((item) => Number(item.remaining_quantity) >= 1)
                      .map((item) => (
                        <button
                          className={
                            returnItemId === item.sale_item_id
                              ? "exchange-item selected"
                              : "exchange-item"
                          }
                          type="button"
                          key={item.sale_item_id}
                          disabled={exchangeLoading}
                          onClick={() => chooseReturnItem(item)}
                        >
                          <span>
                            <strong>{item.product_name}</strong>
                            <small>
                              {item.variant_description} · {item.sku}
                            </small>
                          </span>
                          <span>
                            <strong>
                              {money.format(unitExchangeValue(item) / 100)}
                            </strong>
                            <small>
                              {Number(item.remaining_quantity)} disponible(s)
                            </small>
                          </span>
                        </button>
                      ))}
                  </div>
                  {exchangeSale.items.every(
                    (item) => Number(item.remaining_quantity) < 1,
                  ) ? (
                    <p className="inline-warning">
                      Este ticket ya no tiene piezas disponibles para cambio.
                    </p>
                  ) : null}
                </section>

                {selectedReturnItem ? (
                  <section className="exchange-step">
                    <div className="exchange-step-heading">
                      <span>2</span>
                      <div>
                        <strong>¿Qué pieza se lleva?</strong>
                        <small>
                          Sólo aparecen artículos con existencia y el mismo
                          valor.
                        </small>
                      </div>
                    </div>
                    <form
                      className="exchange-search"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void loadExchangeVariants(
                          selectedReturnItem,
                          exchangeQuery,
                        );
                      }}
                    >
                      <label className="module-search">
                        <Search aria-hidden="true" />
                        <input
                          value={exchangeQuery}
                          maxLength={120}
                          onChange={(event) =>
                            setExchangeQuery(event.target.value)
                          }
                          placeholder="Buscar producto, SKU o código"
                          aria-label="Buscar artículo para entregar"
                        />
                      </label>
                      <button
                        className="secondary-button"
                        type="submit"
                        disabled={exchangeLoading}
                      >
                        Buscar
                      </button>
                    </form>
                    <div className="exchange-candidate-list">
                      {exchangeVariants.map((variant) => (
                        <button
                          className={
                            outputVariantId === variant.id
                              ? "exchange-candidate selected"
                              : "exchange-candidate"
                          }
                          type="button"
                          key={variant.id}
                          onClick={() => setOutputVariantId(variant.id)}
                        >
                          <span>
                            <strong>{variant.productName}</strong>
                            <small>
                              {variant.brand} · Talla {variant.size} ·{" "}
                              {variant.color}
                            </small>
                            <code>{variant.sku}</code>
                          </span>
                          <span>
                            <strong>
                              {money.format(variant.priceCents / 100)}
                            </strong>
                            <small>{variant.stock} en existencia</small>
                          </span>
                        </button>
                      ))}
                      {!exchangeLoading && exchangeVariants.length === 0 ? (
                        <p className="demo-caption">
                          Busca por nombre, SKU o código. Sólo mostraremos
                          opciones del mismo valor.
                        </p>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {selectedReturnItem && selectedOutput ? (
                  <section className="exchange-step">
                    <div className="exchange-step-heading">
                      <span>3</span>
                      <div>
                        <strong>Confirma el cambio</strong>
                        <small>La diferencia debe permanecer en $0.00.</small>
                      </div>
                    </div>
                    <div className="exchange-summary">
                      <span>
                        Regresa:{" "}
                        <strong>{selectedReturnItem.product_name}</strong>
                      </span>
                      <ArrowRightLeft aria-hidden="true" />
                      <span>
                        Entrega: <strong>{selectedOutput.productName}</strong>
                      </span>
                    </div>
                    <label className="exchange-reason">
                      <span>Motivo obligatorio</span>
                      <textarea
                        value={exchangeReason}
                        minLength={3}
                        maxLength={500}
                        onChange={(event) =>
                          setExchangeReason(event.target.value)
                        }
                      />
                    </label>
                  </section>
                ) : null}
              </>
            ) : null}

            {exchangeError ? (
              <p className="field-error" role="alert">
                {exchangeError}
              </p>
            ) : null}
            {!exchangeFolio ? (
              <div className="modal-actions exchange-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={exchangeLoading}
                  onClick={() => setExchangeOpen(false)}
                >
                  Cerrar
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    exchangeLoading ||
                    !selectedReturnItem ||
                    !selectedOutput ||
                    exchangeReason.trim().length < 3
                  }
                  onClick={() => void confirmExchange()}
                >
                  {exchangeLoading ? "Registrando…" : "Confirmar cambio"}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
