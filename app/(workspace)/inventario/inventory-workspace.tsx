"use client";

import Image from "next/image";
import { useDeferredValue, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, History, PackageOpen, Search, X } from "lucide-react";
import type { ProductVariant } from "@/lib/domain";

const movements = [
  { id: 1, type: "Venta", product: "Sombrero 100X El Patrón · 57", quantity: -1, time: "14:32", reference: "V-000842" },
  { id: 2, type: "Venta", product: "Cinturón vaquero bordado · 34", quantity: -1, time: "13:05", reference: "V-000841" },
  { id: 3, type: "Recepción", product: "Bota Cuadra piel de venado · 25", quantity: 3, time: "10:18", reference: "REC-00128" },
];

export function InventoryWorkspace({ variants }: { variants: ProductVariant[] }) {
  const [showMovements, setShowMovements] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const units = variants.reduce((total, item) => total + item.stock, 0);
  const filteredVariants = useMemo(() => {
    const term = deferredQuery.trim().toLocaleLowerCase("es-MX");
    return variants.filter((item) => {
      const matchesText = !term || [item.productName, item.brand, item.legacyCode, item.color, item.size].join(" ").toLocaleLowerCase("es-MX").includes(term);
      const matchesStatus = status === "all" || (status === "available" && item.stock > 1) || (status === "last" && item.stock === 1) || (status === "out" && item.stock === 0);
      return matchesText && matchesStatus;
    });
  }, [deferredQuery, status, variants]);
  return <section className="module-page"><div className="section-heading"><div><p className="eyebrow">Sucursal La Piedad</p><h1>Inventario</h1><p className="heading-copy">Existencias por variante y movimientos rastreables.</p></div><button className="secondary-button" type="button" onClick={() => setShowMovements(true)}><History aria-hidden="true" />Ver movimientos</button></div><div className="summary-grid"><article><span>Unidades disponibles</span><strong>{units}</strong></article><article><span>Últimas piezas</span><strong>{variants.filter((item) => item.stock === 1).length}</strong></article><article><span>Agotados</span><strong>{variants.filter((item) => item.stock === 0).length}</strong></article></div><div className="notice"><strong>Inventario auditable</strong><span>Los cambios definitivos se registrarán mediante movimientos, nunca reemplazando existencias directamente.</span></div><div className="catalog-toolbar"><label className="toolbar-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, variante o código" aria-label="Buscar inventario" /></label><div className="filter-pills" aria-label="Filtrar inventario"><button className={status === "all" ? "selected" : ""} type="button" onClick={() => setStatus("all")}>Todos</button><button className={status === "available" ? "selected" : ""} type="button" onClick={() => setStatus("available")}>Disponible</button><button className={status === "last" ? "selected" : ""} type="button" onClick={() => setStatus("last")}>Última</button><button className={status === "out" ? "selected" : ""} type="button" onClick={() => setStatus("out")}>Agotado</button></div></div><div className="data-table"><div className="table-row table-header"><span>Producto</span><span>Código</span><span>Variante</span><span>Existencia</span><span>Estado</span></div>{filteredVariants.map((item) => <div className="table-row" key={item.id}><div className="table-product"><span className="table-product-image">{item.image ? <Image src={item.image} alt="" fill sizes="44px" /> : <PackageOpen aria-hidden="true" />}</span><strong>{item.productName}<small>{item.brand}</small></strong></div><code>{item.legacyCode}</code><span>{item.color} · {item.size}</span><span className={item.stock === 0 ? "stock-number out" : item.stock === 1 ? "stock-number low" : "stock-number good"}>{item.stock}</span><span className={item.stock === 0 ? "stock-status out" : item.stock === 1 ? "stock-status low" : "stock-status good"}>{item.stock === 0 ? "Agotado" : item.stock === 1 ? "Última" : "Disponible"}</span></div>)}</div>{showMovements ? <div className="modal-backdrop"><section className="checkout-modal movement-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-movements-title"><header className="modal-heading"><div><p className="eyebrow">Auditoría</p><h2 id="inventory-movements-title">Movimientos recientes</h2></div><button type="button" aria-label="Cerrar movimientos" onClick={() => setShowMovements(false)}><X aria-hidden="true" /></button></header><div className="movement-list">{movements.map((item) => <article key={item.id}><span className={item.quantity > 0 ? "movement-kind income" : "movement-kind outcome"}>{item.quantity > 0 ? <ArrowDownLeft aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}</span><div><strong>{item.product}</strong><small>{item.type} · {item.reference} · {item.time}</small></div><b className={item.quantity > 0 ? "positive" : "negative"}>{item.quantity > 0 ? "+" : ""}{item.quantity}</b></article>)}</div><button className="secondary-button wide" type="button" onClick={() => setShowMovements(false)}>Cerrar</button></section></div> : null}</section>;
}
