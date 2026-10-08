"use client";

import { useRef, useState } from "react";
import { useWorkspace } from "./workspace-context";
export type QuickSaleSnapshot = { id: string; folio: string; sold_at: string; status: string; product_name: string; quantity: number; unit_price_cents: number };
export type QuickSaleListResult = { ok: true; items: QuickSaleSnapshot[] } | { ok: false; message: string };

export function QuickSaleCatalog({ loadAction, onChoose }: {
  loadAction: (locationId: string) => Promise<QuickSaleListResult>;
  onChoose: (item: QuickSaleSnapshot) => void;
}) {
  const { activeLocation } = useWorkspace();
  const generation = useRef(0);
  const [result, setResult] = useState<{ locationId: string; items: QuickSaleSnapshot[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const locationId = activeLocation?.id;
  const items = result && result.locationId === locationId ? result.items : [];
  async function load() {
    if (!locationId || busy) return;
    const request = ++generation.current;
    setBusy(true); setMessage("");
    try {
      const data = await loadAction(locationId);
      if (generation.current !== request) return;
      if (data.ok) { setResult({ locationId, items: data.items }); if (!data.items.length) setMessage("No hay productos rápidos cobrados en esta sucursal."); }
      else setMessage(data.message);
    } catch { setMessage("No fue posible recuperar los productos rápidos."); }
    finally { if (generation.current === request) setBusy(false); }
  }
  return <details className="measure-unit-catalog">
    <summary>Productos rápidos cobrados · preparar alta</summary>
    <p>Recupera nombre y precio del ticket. El alta posterior es independiente: no reescribe ventas ni agrega la cantidad vendida al inventario.</p>
    <button type="button" onClick={() => void load()} disabled={busy || !locationId}>{busy ? "Consultando…" : "Consultar esta sucursal"}</button>
    {message ? <p role="status">{message}</p> : null}
    <ul>{items.map(item => <li key={item.id}>
      <span>{item.product_name} · {item.folio} · {item.status === 'CANCELLED' ? 'Venta cancelada' : 'Venta cobrada'}</span>
      <button type="button" onClick={() => onChoose(item)}>Preparar alta de {item.product_name}</button>
    </li>)}</ul>
    {items.length === 100 ? <p>Se muestran los 100 renglones más recientes.</p> : null}
  </details>;
}
