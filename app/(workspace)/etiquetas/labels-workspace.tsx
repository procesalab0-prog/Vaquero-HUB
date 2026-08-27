"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Barcode, Check, Info, Minus, Plus, Printer, Search, Tags } from "lucide-react";
import type { ProductVariant } from "@/lib/domain";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function LabelsWorkspace({ variants }: { variants: ProductVariant[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [printed, setPrinted] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    if (!term) return variants;
    return variants.filter((item) => [item.productName, item.brand, item.legacyCode, item.color, item.size].join(" ").toLowerCase().includes(term));
  }, [deferredQuery, variants]);
  const totalLabels = Object.values(selected).reduce((sum, count) => sum + count, 0);
  const preview = variants.find((item) => selected[item.id]) ?? variants[0];

  function changeCount(id: string, delta: number) {
    setSelected((current) => {
      const next = Math.max(0, (current[id] ?? 0) + delta);
      if (next === 0) {
        const { [id]: removed, ...rest } = current;
        void removed;
        return rest;
      }
      return { ...current, [id]: next };
    });
  }

  function printLabels() {
    if (!totalLabels) return;
    setPrinted(true);
    window.print();
  }

  return (
    <section className="module-page labels-page">
      <div className="section-heading"><div><p className="eyebrow">Productos y variantes</p><h1>Etiquetas y códigos de barras</h1><p className="heading-copy">Usa los códigos existentes de SICAR o prepara etiquetas para productos nuevos.</p></div><button className="primary-button" type="button" disabled={!totalLabels} onClick={printLabels}><Printer aria-hidden="true" />Imprimir {totalLabels || ""} etiquetas</button></div>
      <div className="rule-notice"><Info aria-hidden="true" /><div><strong>Los códigos heredados nunca se regeneran</strong><span>El mismo código físico seguirá identificando la misma variante en SICAR, Vaquero HUB y WooCommerce.</span></div></div>
      <div className="labels-layout">
        <section className="content-card labels-selector">
          <label className="module-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, talla o código" aria-label="Buscar productos para etiquetar" /></label>
          <div className="label-product-list">
            {results.map((item) => {
              const count = selected[item.id] ?? 0;
              return <article className={count ? "label-product selected" : "label-product"} key={item.id}><span className="barcode-icon"><Barcode aria-hidden="true" /></span><div><strong>{item.productName}</strong><small>{item.color} · {item.size} · {money.format(item.price)}</small><code>{item.legacyCode}</code></div><div className="label-stepper"><button type="button" disabled={!count} aria-label={`Quitar etiqueta de ${item.productName}`} onClick={() => changeCount(item.id, -1)}><Minus aria-hidden="true" /></button><strong>{count}</strong><button type="button" aria-label={`Agregar etiqueta de ${item.productName}`} onClick={() => changeCount(item.id, 1)}><Plus aria-hidden="true" /></button></div></article>;
            })}
          </div>
        </section>
        <aside className="content-card label-preview-panel">
          <div className="card-heading"><div><p className="eyebrow">Vista previa</p><h2>Etiqueta 50 × 30 mm</h2></div><Tags aria-hidden="true" /></div>
          <div className="product-label">
            <span className="label-brand">VAQUEROS SM</span><strong>{preview.productName}</strong><small>{preview.color} · Talla {preview.size}</small>
            <div className="barcode-bars" aria-hidden="true" />
            <code>{preview.legacyCode}</code><b>{money.format(preview.price)}</b>
          </div>
          <dl className="label-settings"><div><dt>Formato</dt><dd>CODE 128</dd></div><div><dt>Origen</dt><dd>Código SICAR</dd></div><div><dt>Sucursal</dt><dd>La Piedad</dd></div></dl>
          <p className="demo-caption">Esta es una vista de diseño. La generación escaneable y el controlador de la impresora se conectarán en la fase de hardware.</p>
        </aside>
      </div>
      {printed ? <div className="inline-success" role="status"><Check aria-hidden="true" />Solicitud de impresión preparada en esta vista<button type="button" onClick={() => setPrinted(false)}>Cerrar</button></div> : null}
    </section>
  );
}
