import type { Metadata } from "next";
import { mockVariants } from "@/lib/mock-data";

export const metadata: Metadata = { title: "Productos" };

export default function ProductsPage() {
  return (
    <section className="module-page">
      <div className="section-heading"><div><p className="eyebrow">Catálogo</p><h1>Productos y variantes</h1></div><button className="primary-button">Nuevo producto</button></div>
      <div className="notice"><strong>Base de trabajo</strong><span>La matriz de tallas y el alta rápida se incorporarán con el diseño aprobado.</span></div>
      <div className="data-table">
        <div className="table-row table-header"><span>Producto</span><span>Código SICAR</span><span>Variante</span><span>Precio</span><span>Existencia</span></div>
        {mockVariants.map((item) => (
          <div className="table-row" key={item.id}><strong>{item.productName}<small>{item.brand}</small></strong><code>{item.legacyCode}</code><span>{item.color} · {item.size}</span><span>{new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(item.price)}</span><span>{item.stock}</span></div>
        ))}
      </div>
    </section>
  );
}
