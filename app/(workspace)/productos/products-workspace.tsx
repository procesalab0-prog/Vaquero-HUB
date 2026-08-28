"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Plus, Tags } from "lucide-react";
import type { ProductVariant } from "@/lib/domain";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function ProductsWorkspace({ initialVariants }: { initialVariants: ProductVariant[] }) {
  const [variants, setVariants] = useState(initialVariants);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ productName: "", brand: "", legacyCode: "", color: "", size: "", price: "", stock: "" });

  function createProduct() {
    const price = Number(form.price);
    const stock = Number(form.stock);
    if (!form.productName.trim() || !form.legacyCode.trim() || !Number.isFinite(price) || !Number.isFinite(stock)) return;
    setVariants((current) => [...current, { id: `local-${Date.now()}`, productName: form.productName.trim(), brand: form.brand.trim() || "Sin marca", legacyCode: form.legacyCode.trim(), color: form.color.trim() || "Sin color", size: form.size.trim() || "Única", price, stock }]);
    setOpen(false);
    setSaved(true);
    setForm({ productName: "", brand: "", legacyCode: "", color: "", size: "", price: "", stock: "" });
  }

  return (
    <section className="module-page">
      <div className="section-heading"><div><p className="eyebrow">Catálogo</p><h1>Productos y variantes</h1><p className="heading-copy">Crea productos sin alterar los códigos heredados.</p></div><div className="heading-actions"><Link className="secondary-button" href="/etiquetas"><Tags aria-hidden="true" />Etiquetas</Link><button className="primary-button" type="button" onClick={() => setOpen(true)}><Plus aria-hidden="true" />Nuevo producto</button></div></div>
      <div className="notice"><strong>Alta rápida</strong><span>Esta vista agrega una variante local. La matriz completa de tallas se conectará al catálogo auditable.</span></div>
      <div className="data-table">
        <div className="table-row table-header"><span>Producto</span><span>Código SICAR</span><span>Variante</span><span>Precio</span><span>Existencia</span></div>
        {variants.map((item) => <div className="table-row" key={item.id}><strong>{item.productName}<small>{item.brand}</small></strong><code>{item.legacyCode}</code><span>{item.color} · {item.size}</span><span>{money.format(item.price)}</span><span>{item.stock}</span></div>)}
      </div>
      {saved ? <div className="inline-success" role="status"><Check aria-hidden="true" />Producto agregado a esta vista<button type="button" onClick={() => setSaved(false)}>Cerrar</button></div> : null}
      {open ? <div className="modal-backdrop"><section className="checkout-modal product-modal" role="dialog" aria-modal="true" aria-labelledby="new-product-title"><p className="eyebrow">Catálogo</p><h2 id="new-product-title">Nueva variante</h2><div className="settings-form"><label className="wide-field"><span>Nombre del producto</span><input value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} /></label><label><span>Marca</span><input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label><label><span>Código existente o nuevo</span><input value={form.legacyCode} onChange={(event) => setForm({ ...form, legacyCode: event.target.value })} /></label><label><span>Color</span><input value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></label><label><span>Talla</span><input value={form.size} onChange={(event) => setForm({ ...form, size: event.target.value })} /></label><label><span>Precio</span><input inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label><label><span>Existencia inicial</span><input inputMode="numeric" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-button" type="button" onClick={createProduct}>Crear variante</button></div></section></div> : null}
    </section>
  );
}
