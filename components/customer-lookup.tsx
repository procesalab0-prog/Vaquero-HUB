"use client";

import { Check, Search, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";

import { formatCustomerPhone, type CustomerSummary } from "@/lib/customers";

export function CustomerLookup({ selected, onSelect, onClose }: { selected: CustomerSummary | null; onSelect: (customer: CustomerSummary | null) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 && !/^\d{4}$/.test(trimmed)) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal, cache: "no-store" });
        const payload = await response.json() as { customers?: CustomerSummary[] };
        setResults(response.ok ? payload.customers ?? [] : []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  return <section className="checkout-modal customer-lookup-modal" role="dialog" aria-modal="true" aria-labelledby="customer-lookup-title">
    <header><div><p className="eyebrow">Venta en curso</p><h2 id="customer-lookup-title">Asociar cliente</h2><p>Escribe teléfono, número de socio, nombre o correo.</p></div><button type="button" aria-label="Cerrar búsqueda de cliente" onClick={onClose}><X aria-hidden="true" /></button></header>
    {selected ? <div className="selected-customer"><span><Check aria-hidden="true" /></span><div><strong>{selected.full_name}</strong><small>{formatCustomerPhone(selected.phone_e164)} · Socio {selected.member_number}</small></div><button type="button" onClick={() => onSelect(null)}>Quitar</button></div> : null}
    <label className="customer-lookup-input"><Search aria-hidden="true" /><span className="sr-only">Buscar cliente</span><input value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (value.trim().length < 3 && !/^\d{4}$/.test(value.trim())) setResults([]); }} placeholder="Ej. 352 123 4567" /></label>
    <div className="customer-lookup-results">
      {loading ? <p>Buscando…</p> : results.map((customer) => <button type="button" key={customer.id} onClick={() => { onSelect(customer); onClose(); }}><UserRound aria-hidden="true" /><span><strong>{customer.full_name}</strong><small>{formatCustomerPhone(customer.phone_e164)} · {customer.member_number}</small></span></button>)}
      {!loading && query.trim().length >= 3 && results.length === 0 ? <p>No encontramos coincidencias. Puedes darlo de alta desde Clientes.</p> : null}
    </div>
  </section>;
}
