"use client";

import { CalendarDays, Check, Download, FileText, Plus, Search, Send, ShoppingCart, UserRound, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";

import { CustomerLookup } from "@/components/customer-lookup";
import type { CustomerSummary } from "@/lib/customers";
import { quoteLinePricing, type QuotePriceInput } from "@/lib/quote-pricing";
import { measureLineCents,measureQuantityStep,parseMeasureQuantity,quantityUnit,type MeasureUnit } from "@/lib/measure-units";

type QuoteActionResult = { ok: true; id?: string; folio?: string; href?: string } | { ok: false; message: string };

export type QuoteVariant = {
  id: string;
  name: string;
  brand: string;
  sku: string;
  description: string;
  priceCents: number;
  measureUnit?: MeasureUnit;
};
export type QuotePayload = {
  id: string;
  folio: string;
  status: "DRAFT" | "SENT" | "CONVERTED" | "EXPIRED";
  total_cents: number;
  customer_name?: string | null;
  discount_cents?: number;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  created_by_name: string;
  converted_sale_id: string | null;
  customer: CustomerSummary | null;
  items: Array<{
    variant_id: string;
    product_name: string;
    sku: string;
    variant_description: string;
    quantity: number;
    unit_price_cents: number;
    original_unit_price_cents?: number;
    discount_cents?: number;
    line_total_cents: number;
    measureUnit?: MeasureUnit;
  }>;
};

type CreateQuoteInput = {
  locationId: string;
  customerId?: string | null;
  customerName?: string;
  items: QuotePriceInput[];
  validUntil?: string | null;
  notes?: string;
};
const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const statusLabels = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  CONVERTED: "Vendida",
  EXPIRED: "Vencida",
} as const;

export function QuotesWorkspace({ locationId, locationName = "La Piedad", locationAddress, locationPhone, variants, quotes, preview = false, canPersonalize = false, status, createAction, sendAction, loadAction, validityAction }: { locationId: string; locationName?: string; locationAddress?: string | null; locationPhone?: string | null; variants: QuoteVariant[]; quotes: QuotePayload[]; preview?: boolean; canPersonalize?: boolean; status?: string; createAction?: (input: CreateQuoteInput) => Promise<QuoteActionResult>; sendAction?: (quoteId: string) => Promise<QuoteActionResult>; loadAction?: (quoteId: string) => Promise<QuoteActionResult>; validityAction?: (input: { quoteId: string; validUntil: string; reason: string }) => Promise<QuoteActionResult> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [discounts, setDiscounts] = useState<Record<string, string>>({});
  const [exceptionQuote, setExceptionQuote] = useState<string | null>(null);
  const [exceptionDate, setExceptionDate] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState(status ?? "");
  const [pending, startTransition] = useTransition();
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es-MX");
    return variants.filter((variant) => !term || `${variant.name} ${variant.brand} ${variant.sku} ${variant.description}`.toLocaleLowerCase("es-MX").includes(term)).slice(0, 80);
  }, [query, variants]);
  const selected = variants.flatMap(variant=>{
    const quantity=parseMeasureQuantity(quantities[variant.id]??'0',quantityUnit(variant),true);
    return quantity!==null&&quantity>0 ? [{variant,quantity}]:[];
  });
  let pricingValid = variants.every(variant=>parseMeasureQuantity(quantities[variant.id]||'0',quantityUnit(variant),true)!==null);
  let total = 0;
  const pricedItems: QuotePriceInput[] = [];
  for (const { variant, quantity } of selected) {
    try {
      const item = quoteLinePricing(variant.id, quantity, variant.priceCents, canPersonalize ? prices[variant.id] : "", canPersonalize ? discounts[variant.id] : "",quantityUnit(variant));
      pricedItems.push(item);
      total += measureLineCents(item.unit_price_cents ?? variant.priceCents,quantity,quantityUnit(variant))! - (item.discount_cents ?? 0);
    } catch { pricingValid = false; }
  }
  pricingValid = pricingValid && Number.isSafeInteger(total);

  function resetForm() {
    setQuantities({});
    setCustomer(null);
    setCustomerName("");
    setPrices({});
    setDiscounts({});
    setValidUntil("");
    setNotes("");
    setQuery("");
    setOpen(false);
  }
  function create() {
    if (!createAction || selected.length === 0 || !pricingValid || total <= 0) {
      setFeedback("Agrega al menos un artículo.");
      return;
    }
    startTransition(async () => {
      const result = await createAction({
        locationId,
        customerId: customer?.id ?? null,
        customerName: customer ? undefined : customerName,
        items: pricedItems,
        validUntil: validUntil || null,
        notes,
      });
      if (!result.ok) {
        setFeedback(result.message);
        return;
      }
      setFeedback(`Cotización ${result.folio} creada. No se apartó inventario.`);
      resetForm();
      router.refresh();
    });
  }
  function runQuoteAction(action: ((id: string) => Promise<QuoteActionResult>) | undefined, id: string) {
    if (!action) return;
    startTransition(async () => {
      const result = await action(id);
      if (!result.ok) {
        setFeedback(result.message);
        return;
      }
      if (result.href) {
        startNavigationProgress();
        router.push(result.href);
        return;
      }
      setFeedback(`Cotización ${result.folio} marcada como enviada.`);
      router.refresh();
    });
  }

  async function downloadQuotePdf(quote: QuotePayload) {
    const { createCommercialPdf, downloadCommercialPdf } = await import("@/lib/commercial-pdf");
    const subtotalCents = quote.items.reduce((sum, item) => sum + Number(item.line_total_cents)+Number(item.discount_cents??0), 0);
    const { blob, fileName } = await createCommercialPdf({
      kind: "QUOTE",
      folio: quote.folio,
      date: new Date(quote.created_at).toLocaleString("es-MX"),
      locationName,
      address: locationAddress,
      phone: locationPhone,
      customerName: quote.customer?.full_name ?? quote.customer_name,
      customerEmail: quote.customer?.email,
      validUntil: quote.valid_until,
      notes: quote.notes,
      lines: quote.items.map((item) => ({
        description: `${item.product_name} - ${item.variant_description || "Unica"}${item.measureUnit?` - ${item.measureUnit.name}`:''}`,
        code: item.sku,
        quantity: Number(item.quantity),
        unitPriceCents: Number(item.unit_price_cents),
        originalUnitPriceCents: Number(item.original_unit_price_cents ?? item.unit_price_cents),
        discountCents: Number(item.discount_cents ?? 0),
        lineTotalCents: Number(item.line_total_cents),
      })),
      subtotalCents,
      discountCents: Math.max(0, subtotalCents - Number(quote.total_cents)),
      totalCents: Number(quote.total_cents),
    });
    downloadCommercialPdf(blob, fileName);
  }

  return (
    <section className="module-page quotes-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Ventas antes del cobro</p>
          <h1>Cotizaciones</h1>
          <p className="heading-copy">Prepara una propuesta con precio vigente. No aparta mercancía ni mueve caja.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          Nueva cotización
        </button>
      </div>
      {feedback ? (
        <div className="operation-feedback inline-error" role="status">
          {feedback}
          <button type="button" aria-label="Cerrar mensaje" onClick={() => setFeedback("")}>
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <form className="quote-filters" action="/cotizaciones">
        <label>
          <Search aria-hidden="true" />
          <span className="sr-only">Buscar cotizaciones</span>
          <input name="busqueda" placeholder="Folio, cliente, producto o SKU" />
        </label>
        <select name="estado" aria-label="Estado">
          <option value="">Todos los estados</option>
          <option value="DRAFT">Borradores</option>
          <option value="SENT">Enviadas</option>
          <option value="CONVERTED">Vendidas</option>
          <option value="EXPIRED">Vencidas</option>
        </select>
        <button className="secondary-button" type="submit">
          Buscar
        </button>
      </form>
      {quotes.length ? (
        <div className="quote-grid">
          {quotes.map((quote) => (
            <article className="quote-card" key={quote.id}>
              <header>
                <div>
                  <span className={`quote-status ${quote.status.toLowerCase()}`}>{statusLabels[quote.status]}</span>
                  <h2>{quote.folio}</h2>
                  <small>
                    {new Date(quote.created_at).toLocaleString("es-MX")} · {quote.created_by_name}
                  </small>
                </div>
                <strong>{money.format(Number(quote.total_cents) / 100)}</strong>
              </header>
              <p className="quote-customer">
                <UserRound aria-hidden="true" />
                {quote.customer?.full_name ?? quote.customer_name ?? "Público general"}
              </p>
              <div className="quote-items">
                {quote.items.map((item) => (
                  <span key={item.variant_id}>
                    <span>
                      <strong>
                        {item.quantity} × {item.product_name}
                      </strong>
                      <small>
                        {item.sku} · {item.variant_description || "Única"}
                      </small>
                      <small>Original {money.format(Number(item.original_unit_price_cents ?? item.unit_price_cents) / 100)} · Cotizado {money.format(Number(item.unit_price_cents) / 100)} · Descuento {money.format(Number(item.discount_cents ?? 0) / 100)}</small>
                    </span>
                    <b>{money.format(Number(item.line_total_cents) / 100)}</b>
                  </span>
                ))}
              </div>
              <footer>
                <span>
                  <CalendarDays aria-hidden="true" />
                  {quote.valid_until ? `Válida hasta ${new Date(`${quote.valid_until}T12:00:00`).toLocaleDateString("es-MX")}` : "Sin fecha límite"}
                </span>
                <div>
                  {canPersonalize && quote.status !== "CONVERTED" ? <button className="secondary-button" type="button" onClick={() => { setExceptionQuote(quote.id); setExceptionDate(quote.valid_until ?? ""); setExceptionReason(""); }}>Autorizar vigencia</button> : null}
                  <button className="secondary-button" type="button" onClick={() => void downloadQuotePdf(quote)}>
                    <Download aria-hidden="true" />
                    PDF formal
                  </button>
                  {quote.status === "DRAFT" ? (
                    <button className="secondary-button" disabled={pending} type="button" onClick={() => runQuoteAction(sendAction, quote.id)}>
                      <Send aria-hidden="true" />
                      Marcar enviada
                    </button>
                  ) : null}
                  {["DRAFT", "SENT"].includes(quote.status) ? (
                    <button className="primary-button" disabled={pending} type="button" onClick={() => runQuoteAction(loadAction, quote.id)}>
                      <ShoppingCart aria-hidden="true" />
                      Cobrar en Venta
                    </button>
                  ) : null}
                  {quote.status === "CONVERTED" ? (
                    <span className="quote-converted">
                      <Check aria-hidden="true" />
                      Venta registrada
                    </span>
                  ) : null}
                </div>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-module">
          <FileText aria-hidden="true" />
          <h2>Aún no hay cotizaciones</h2>
          <p>Crea la primera sin afectar inventario ni caja.</p>
        </div>
      )}
      {open ? (
        <div className="modal-backdrop">
          <section className={customerOpen ? "checkout-modal quote-modal quote-modal-hidden" : "checkout-modal quote-modal"} role="dialog" aria-modal="true" aria-labelledby="quote-title">
            <header>
              <div>
                <p className="eyebrow">Nueva cotización</p>
                <h2 id="quote-title">Arma la propuesta</h2>
              </div>
              <button type="button" aria-label="Cerrar" onClick={resetForm}>
                <X aria-hidden="true" />
              </button>
            </header>
            <button className="quote-customer-button" type="button" onClick={() => setCustomerOpen(true)}>
              <UserRound aria-hidden="true" />
              <span>
                <strong>{customer?.full_name ?? "Público general"}</strong>
                <small>{customer ? `Socio ${customer.member_number}` : "Toca para asociar un cliente"}</small>
              </span>
            </button>
            {!customer ? <label className="quote-search">Nombre para la cotización (sin registrar cliente)<input maxLength={160} value={customerName} onChange={event => setCustomerName(event.target.value)} /></label> : null}
            <label className="quote-search">
              <Search aria-hidden="true" />
              <span className="sr-only">Buscar productos</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, talla, color o SKU" />
            </label>
            <div className="quote-product-list">
              {filtered.map((variant) => (
                <label key={variant.id}>
                  <span>
                    <strong>{variant.name}</strong>
                    <small>
                      {variant.sku} · {variant.description}
                    </small>
                  </span>
                  <b>{money.format(variant.priceCents / 100)}</b>
                  <input
                    type="number"
                    inputMode={quantityUnit(variant).decimal_places===3?'decimal':'numeric'}
                    min="0"
                    max="999"
                    step={measureQuantityStep(quantityUnit(variant))}
                    aria-label={`Cantidad de ${variant.name} ${variant.description}`}
                    value={quantities[variant.id] ?? 0}
                    onChange={(event) =>
                      setQuantities((current) => ({
                        ...current,
                        [variant.id]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            {canPersonalize && selected.length ? <div className="quote-details">
              <p>Solo cambia esta cotización. El catálogo conserva sus precios. Descuento por renglón en pesos.</p>
              {selected.map(({ variant, quantity }) => <fieldset key={variant.id}>
                <legend>{quantity} × {variant.name} · {variant.description}</legend>
                <small>Original {money.format(variant.priceCents / 100)}</small>
                <label>Precio unitario cotizado<input inputMode="decimal" placeholder={(variant.priceCents / 100).toFixed(2)} value={prices[variant.id] ?? ""} onChange={event => setPrices(current => ({ ...current, [variant.id]: event.target.value }))} /></label>
                <label>Descuento del renglón<input inputMode="decimal" placeholder="0.00" value={discounts[variant.id] ?? ""} onChange={event => setDiscounts(current => ({ ...current, [variant.id]: event.target.value }))} /></label>
              </fieldset>)}
            </div> : null}
            <div className="quote-details">
              <label>
                Vigencia opcional
                <input type="date" min={new Date().toISOString().slice(0, 10)} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
              </label>
              <label>
                Notas opcionales
                <textarea maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Condiciones o aclaraciones para el cliente" />
              </label>
            </div>
            <div className="quote-summary">
              {!pricingValid ? <p role="alert">Usa importes positivos con hasta dos decimales. El descuento no puede superar el importe del renglón.</p> : null}
              <span>{selected.length} renglones seleccionados</span>
              <strong>Total {money.format(total / 100)}</strong>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={resetForm}>
                Cancelar
              </button>
              <button className="primary-button" type="button" disabled={!createAction || pending || selected.length === 0 || !pricingValid || total <= 0} onClick={create}>
                {pending ? "Guardando…" : "Crear cotización"}
              </button>
            </div>
          </section>
          {customerOpen ? <CustomerLookup selected={customer} onSelect={setCustomer} onClose={() => setCustomerOpen(false)} /> : null}
        </div>
      ) : null}
      {exceptionQuote ? <div className="modal-backdrop"><section className="checkout-modal" role="dialog" aria-modal="true" aria-label="Autorizar vigencia">
        <h2>Autorizar vigencia</h2><p>No modifica precios, inventario ni caja. La decisión queda auditada.</p>
        <label>Nueva fecha<input type="date" value={exceptionDate} onChange={event => setExceptionDate(event.target.value)} /></label>
        <label>Motivo obligatorio<textarea maxLength={300} value={exceptionReason} onChange={event => setExceptionReason(event.target.value)} /></label>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setExceptionQuote(null)} type="button">Cancelar</button><button className="primary-button" disabled={pending || !validityAction || !exceptionDate || !exceptionReason.trim()} type="button" onClick={() => startTransition(async () => {
          const result = await validityAction!({ quoteId: exceptionQuote, validUntil: exceptionDate, reason: exceptionReason });
          setFeedback(result.ok ? "Vigencia autorizada y registrada." : result.message);
          if (result.ok) { setExceptionQuote(null); router.refresh(); }
        })}>Autorizar</button></div>
      </section></div> : null}
      {preview ? <p className="notice">Vista previa: conecta Supabase para guardar cotizaciones.</p> : null}
    </section>
  );
}
