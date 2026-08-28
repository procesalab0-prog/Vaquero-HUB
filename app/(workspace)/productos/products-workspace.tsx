"use client";

import Link from "next/link";
import Image from "next/image";
import { useDeferredValue, useMemo, useState } from "react";
import { Check, PackageOpen, Plus, Search, Tags } from "lucide-react";
import type { ProductVariant } from "@/lib/domain";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const footwearSizes = ["25", "25.5", "26", "26.5", "27", "27.5", "28", "28.5", "29", "30"];
const clothingSizes = ["CH", "M", "G", "XG"];

export function ProductsWorkspace({ initialVariants }: { initialVariants: ProductVariant[] }) {
  const [variants, setVariants] = useState(initialVariants);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [form, setForm] = useState({ productName: "", brand: "", legacyCode: "", color: "", size: "", price: "", stock: "" });
  const deferredQuery = useDeferredValue(query);

  const filteredVariants = useMemo(() => {
    const term = deferredQuery.trim().toLocaleLowerCase("es-MX");
    return variants.filter((item) => {
      const matchesText = !term || [item.productName, item.brand, item.legacyCode, item.color, item.size].join(" ").toLocaleLowerCase("es-MX").includes(term);
      const matchesStock = stockFilter === "all" || (stockFilter === "available" && item.stock > 1) || (stockFilter === "critical" && item.stock <= 1);
      return matchesText && matchesStock;
    });
  }, [deferredQuery, stockFilter, variants]);

  function createProduct() {
    const price = Number(form.price);
    const stock = Number(form.stock);
    if (!form.productName.trim() || !form.legacyCode.trim() || !Number.isFinite(price) || !Number.isFinite(stock)) return;
    const sizes = selectedSizes.length ? selectedSizes : [form.size.trim() || "Única"];
    const created = sizes.map((size, index) => ({ id: `local-${Date.now()}-${index}`, productName: form.productName.trim(), brand: form.brand.trim() || "Sin marca", legacyCode: index === 0 ? form.legacyCode.trim() : `${form.legacyCode.trim()}-${index + 1}`, color: form.color.trim() || "Sin color", size, price, stock }));
    setVariants((current) => [...current, ...created]);
    setOpen(false);
    setSaved(true);
    setForm({ productName: "", brand: "", legacyCode: "", color: "", size: "", price: "", stock: "" });
    setSelectedSizes([]);
  }

  function toggleSize(size: string) {
    setSelectedSizes((current) => current.includes(size) ? current.filter((item) => item !== size) : [...current, size]);
  }

  return (
    <section className="module-page">
      <div className="section-heading"><div><p className="eyebrow">Catálogo</p><h1>Productos y variantes</h1><p className="heading-copy">Crea productos sin alterar los códigos heredados.</p></div><div className="heading-actions"><Link className="secondary-button" href="/etiquetas"><Tags aria-hidden="true" />Etiquetas</Link><button className="primary-button" type="button" onClick={() => setOpen(true)}><Plus aria-hidden="true" />Nuevo producto</button></div></div>
      <div className="notice"><strong>Códigos protegidos</strong><span>Los códigos SICAR existentes nunca se regeneran. Las altas de esta vista son locales hasta conectar el catálogo auditable.</span></div>
      <div className="catalog-toolbar">
        <label className="toolbar-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, marca o código" aria-label="Buscar productos" /></label>
        <div className="filter-pills" aria-label="Filtrar por existencia"><button className={stockFilter === "all" ? "selected" : ""} type="button" onClick={() => setStockFilter("all")}>Todos</button><button className={stockFilter === "available" ? "selected" : ""} type="button" onClick={() => setStockFilter("available")}>Disponibles</button><button className={stockFilter === "critical" ? "selected" : ""} type="button" onClick={() => setStockFilter("critical")}>Críticos</button></div>
      </div>
      <div className="data-table">
        <div className="table-row table-header"><span>Producto</span><span>Código SICAR</span><span>Variante</span><span>Precio</span><span>Existencia</span></div>
        {filteredVariants.map((item) => <div className="table-row" key={item.id}><div className="table-product"><span className="table-product-image">{item.image ? <Image src={item.image} alt="" fill sizes="44px" /> : <PackageOpen aria-hidden="true" />}</span><strong>{item.productName}<small>{item.brand}</small></strong></div><code>{item.legacyCode}</code><span>{item.color} · {item.size}</span><span>{money.format(item.price)}</span><span className={item.stock === 0 ? "stock-number out" : item.stock === 1 ? "stock-number low" : "stock-number good"}>{item.stock}</span></div>)}
      </div>
      {saved ? <div className="inline-success" role="status"><Check aria-hidden="true" />Producto agregado a esta vista<button type="button" onClick={() => setSaved(false)}>Cerrar</button></div> : null}
      {open ? <div className="modal-backdrop"><section className="checkout-modal product-modal" role="dialog" aria-modal="true" aria-labelledby="new-product-title"><p className="eyebrow">Catálogo</p><h2 id="new-product-title">Nuevo producto y variantes</h2><div className="settings-form"><label className="wide-field"><span>Nombre del producto</span><input value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} /></label><label><span>Marca</span><input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label><label><span>Código base nuevo o código existente</span><input value={form.legacyCode} onChange={(event) => setForm({ ...form, legacyCode: event.target.value })} /></label><label><span>Color</span><input value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></label><label><span>Talla personalizada</span><input value={form.size} onChange={(event) => setForm({ ...form, size: event.target.value })} placeholder="Úsala si no aparece abajo" /></label><label><span>Precio</span><input inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label><label><span>Existencia por talla</span><input inputMode="numeric" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} /></label></div><div className="size-picker"><span>Selecciona una o varias tallas</span><small>Calzado</small><div>{footwearSizes.map((size) => <button className={selectedSizes.includes(size) ? "selected" : ""} type="button" key={size} onClick={() => toggleSize(size)}>{size}</button>)}</div><small>Ropa</small><div>{clothingSizes.map((size) => <button className={selectedSizes.includes(size) ? "selected" : ""} type="button" key={size} onClick={() => toggleSize(size)}>{size}</button>)}</div></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-button" type="button" onClick={createProduct}>Crear {selectedSizes.length > 1 ? `${selectedSizes.length} variantes` : "variante"}</button></div></section></div> : null}
    </section>
  );
}
