import type { Metadata } from "next";
import { mockVariants } from "@/lib/mock-data";

export const metadata: Metadata = { title: "Inventario" };

export default function InventoryPage() {
  const units = mockVariants.reduce((total, item) => total + item.stock, 0);
  return (
    <section className="module-page">
      <div className="section-heading"><div><p className="eyebrow">Sucursal La Piedad</p><h1>Inventario</h1></div><button className="secondary-button">Ver movimientos</button></div>
      <div className="summary-grid"><article><span>Unidades disponibles</span><strong>{units}</strong></article><article><span>Últimas piezas</span><strong>{mockVariants.filter((item) => item.stock === 1).length}</strong></article><article><span>Agotados</span><strong>{mockVariants.filter((item) => item.stock === 0).length}</strong></article></div>
      <div className="notice"><strong>Inventario auditable</strong><span>Los cambios definitivos se registrarán mediante movimientos, nunca reemplazando existencias directamente.</span></div>
    </section>
  );
}
