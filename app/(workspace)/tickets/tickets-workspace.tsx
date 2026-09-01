"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { FileText, Gift, Printer, Search, X } from "lucide-react";
import { formatReceiptDate, ThermalReceipt, type ReceiptLine } from "@/components/thermal-receipt";
import { useWorkspace } from "@/components/workspace-context";

type Ticket = {
  id: string;
  time: string;
  customer: string;
  method: string;
  total: number;
  gift: boolean;
  items: Array<{ name: string; variant: string; code: string; price: number }>;
};

const tickets: Ticket[] = [
  { id: "V-000842", time: "14:32", customer: "Público general", method: "Tarjeta", total: 5780, gift: true, items: [{ name: "Sombrero 100X El Patrón", variant: "Arena · 57", code: "750204310570", price: 2890 }, { name: "Sombrero 100X El Patrón", variant: "Arena · 57", code: "750204310570", price: 2890 }] },
  { id: "V-000841", time: "13:05", customer: "Público general", method: "Efectivo", total: 2890, gift: false, items: [{ name: "Sombrero 100X El Patrón", variant: "Arena · 57", code: "750204310570", price: 2890 }] },
  { id: "V-000840", time: "11:48", customer: "Público general", method: "Transferencia", total: 2580, gift: true, items: [{ name: "Cinturón vaquero bordado", variant: "Miel · 34", code: "000078421034", price: 890 }, { name: "Camisa western", variant: "Azul · M", code: "195696170455", price: 1690 }] },
  { id: "V-000839", time: "10:21", customer: "Público general", method: "Efectivo", total: 890, gift: false, items: [{ name: "Cinturón vaquero bordado", variant: "Miel · 34", code: "000078421034", price: 890 }] },
];

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function TicketsWorkspace() {
  const { identity, activeLocation } = useWorkspace();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [receiptMode, setReceiptMode] = useState<"sale" | "gift">("sale");
  const [reprintDate, setReprintDate] = useState("");
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter((ticket) => [ticket.id, ticket.method, ticket.customer, ...ticket.items.map((item) => item.code)].join(" ").toLowerCase().includes(term));
  }, [deferredQuery]);
  const receiptLines: ReceiptLine[] = selected?.items.map((item) => ({ name: item.name, variant: item.variant, code: item.code, quantity: 1, unitPrice: item.price })) ?? [];
  const receiptSubtotal = receiptLines.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  function selectTicket(ticket: Ticket) {
    setSelected(ticket);
    setReceiptMode("sale");
    setReprintDate(formatReceiptDate());
  }

  return (
    <section className="module-page tickets-page">
      <div className="section-heading"><div><p className="eyebrow">Ventas de hoy</p><h1>Tickets y comprobantes</h1><p className="heading-copy">Consulta ventas, reimprime el ticket o genera la copia sin precios para regalo.</p></div></div>
      <div className="toolbar-card">
        <label className="module-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar folio, método o código" aria-label="Buscar tickets" /></label>
        <label className="toolbar-select"><span>Periodo</span><select aria-label="Filtrar periodo" defaultValue="today"><option value="today">Hoy</option><option value="week">Esta semana</option></select></label>
        <label className="toolbar-select"><span>Caja</span><select aria-label="Filtrar caja" defaultValue="register-1"><option value="register-1">Caja 01</option></select></label>
      </div>
      <div className="ticket-layout">
        <section className="content-card ticket-list-card">
          <div className="ticket-list-header"><span>Folio</span><span>Hora</span><span>Pago</span><span>Total</span><span /></div>
          {filtered.map((ticket) => (
            <button className={selected?.id === ticket.id ? "ticket-row selected" : "ticket-row"} type="button" key={ticket.id} onClick={() => selectTicket(ticket)}>
              <span><code>{ticket.id}</code>{ticket.gift ? <small><Gift aria-hidden="true" />Regalo</small> : null}</span><span>{ticket.time}</span><span>{ticket.method}</span><strong>{money.format(ticket.total)}</strong><FileText aria-hidden="true" />
            </button>
          ))}
          {filtered.length === 0 ? <div className="empty-list"><Search aria-hidden="true" /><strong>No encontramos tickets</strong><span>Prueba con otro folio o código.</span></div> : null}
        </section>

        <aside className={selected ? "ticket-detail open" : "ticket-detail"}>
          {selected ? (
            <>
              <header><div><p className="eyebrow">Detalle de venta</p><h2>{selected.id}</h2></div><button type="button" aria-label="Cerrar detalle" onClick={() => setSelected(null)}><X aria-hidden="true" /></button></header>
              <div className="receipt-type-switch" aria-label="Tipo de ticket"><button className={receiptMode === "sale" ? "selected" : ""} type="button" onClick={() => setReceiptMode("sale")}>Venta</button><button className={receiptMode === "gift" ? "selected gift" : "gift"} type="button" onClick={() => setReceiptMode("gift")}><Gift aria-hidden="true" />Regalo</button></div>
              <div className="receipt-paper-stage compact-stage"><ThermalReceipt mode={receiptMode} folio={selected.id} date={`27/08/2026 ${selected.time}`} items={receiptLines} subtotal={receiptSubtotal} discount={Math.max(0, receiptSubtotal - selected.total)} total={selected.total} method={selected.method} tendered={selected.total} change={0} reprintLabel={reprintDate} cashierName={identity.name} location={activeLocation} /></div>
              <div className="detail-actions"><button className="primary-button" type="button" onClick={() => window.print()}><Printer aria-hidden="true" />Imprimir esta vista</button></div>
              <p className="demo-caption">Revisa la vista de 80 mm antes de imprimir. El ticket de regalo oculta precios y forma de pago.</p>
            </>
          ) : <div className="detail-placeholder"><FileText aria-hidden="true" /><strong>Selecciona un ticket</strong><span>Aquí verás su detalle y opciones de impresión.</span></div>}
        </aside>
      </div>
    </section>
  );
}
