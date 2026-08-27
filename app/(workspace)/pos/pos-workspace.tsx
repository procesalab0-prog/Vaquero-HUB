"use client";

import { useMemo, useState } from "react";
import type { CartLine, PaymentMethod, ProductVariant } from "@/lib/domain";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function PosWorkspace({ variants }: { variants: ProductVariant[] }) {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [completed, setCompleted] = useState(false);

  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es-MX");
    if (!term) return variants;
    return variants.filter((variant) =>
      [variant.productName, variant.brand, variant.legacyCode, variant.color, variant.size]
        .join(" ")
        .toLocaleLowerCase("es-MX")
        .includes(term),
    );
  }, [query, variants]);

  const total = cart.reduce((sum, line) => sum + line.variant.price * line.quantity, 0);
  const quantity = cart.reduce((sum, line) => sum + line.quantity, 0);

  function addVariant(variant: ProductVariant) {
    if (variant.stock < 1) return;
    setCart((current) => {
      const existing = current.find((line) => line.variant.id === variant.id);
      if (!existing) return [...current, { variant, quantity: 1, giftReceipt: false }];
      if (existing.quantity >= variant.stock) return current;
      return current.map((line) =>
        line.variant.id === variant.id ? { ...line, quantity: line.quantity + 1 } : line,
      );
    });
    setQuery("");
  }

  function updateLine(id: string, action: "increase" | "decrease" | "gift" | "remove") {
    setCart((current) => current.flatMap((line) => {
      if (line.variant.id !== id) return [line];
      if (action === "remove") return [];
      if (action === "gift") return [{ ...line, giftReceipt: !line.giftReceipt }];
      if (action === "increase") {
        return [{ ...line, quantity: Math.min(line.quantity + 1, line.variant.stock) }];
      }
      return line.quantity === 1 ? [] : [{ ...line, quantity: line.quantity - 1 }];
    }));
  }

  function completeSale(method: PaymentMethod) {
    void method;
    setCheckoutOpen(false);
    setCompleted(true);
  }

  function newSale() {
    setCart([]);
    setCompleted(false);
    setQuery("");
  }

  if (completed) {
    const giftCount = cart.filter((line) => line.giftReceipt).length;
    return (
      <section className="success-state">
        <span className="success-icon">✓</span>
        <p className="eyebrow">Venta completada</p>
        <h1>{money.format(total)}</h1>
        <p>Folio VH-LP-0001842 · {quantity} artículos</p>
        <div className="success-actions">
          <button className="secondary-button">Imprimir ticket</button>
          {giftCount > 0 && <button className="secondary-button">Imprimir ticket de regalo ({giftCount})</button>}
          <button className="primary-button" onClick={newSale}>Nueva venta</button>
        </div>
      </section>
    );
  }

  return (
    <div className="pos-layout">
      <section className="catalog-panel">
        <div className="section-heading">
          <div><p className="eyebrow">Caja 01</p><h1>Punto de venta</h1></div>
          <span className="connection-badge">En línea</span>
        </div>
        <label className="search-box">
          <span>Buscar</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Escanea un código o busca un producto"
          />
        </label>
        <div className="results-header"><strong>Productos</strong><span>{results.length} resultados</span></div>
        <div className="product-list">
          {results.map((variant) => (
            <button
              className="product-row"
              disabled={variant.stock === 0}
              key={variant.id}
              onClick={() => addVariant(variant)}
            >
              <span className="product-placeholder">{variant.brand.slice(0, 1)}</span>
              <span className="product-copy">
                <strong>{variant.productName}</strong>
                <small>{variant.color} · Talla {variant.size} · {variant.legacyCode}</small>
              </span>
              <span className={variant.stock === 1 ? "stock last" : "stock"}>
                {variant.stock === 0 ? "Agotado" : variant.stock === 1 ? "Última pieza" : `${variant.stock} disponibles`}
              </span>
              <strong className="price">{money.format(variant.price)}</strong>
            </button>
          ))}
          {results.length === 0 && <div className="empty-list"><strong>Sin resultados</strong><p>Revisa el código o intenta con otro término.</p></div>}
        </div>
      </section>

      <aside className="cart-panel" aria-label="Carrito de venta">
        <div className="cart-title"><div><p className="eyebrow">Venta actual</p><h2>Carrito</h2></div><span>{quantity} artículos</span></div>
        <div className="cart-lines">
          {cart.length === 0 ? (
            <div className="empty-cart"><span>0</span><strong>El carrito está vacío</strong><p>Escanea un código o selecciona un producto para comenzar.</p></div>
          ) : cart.map((line) => (
            <article className="cart-line" key={line.variant.id}>
              <div className="cart-line-heading">
                <div><strong>{line.variant.productName}</strong><small>{line.variant.color} · Talla {line.variant.size}</small></div>
                <button className="text-button danger" onClick={() => updateLine(line.variant.id, "remove")}>Quitar</button>
              </div>
              <div className="cart-line-controls">
                <div className="quantity-control">
                  <button aria-label="Disminuir cantidad" onClick={() => updateLine(line.variant.id, "decrease")}>−</button>
                  <strong>{line.quantity}</strong>
                  <button aria-label="Aumentar cantidad" onClick={() => updateLine(line.variant.id, "increase")}>+</button>
                </div>
                <strong>{money.format(line.variant.price * line.quantity)}</strong>
              </div>
              <label className="gift-toggle">
                <input type="checkbox" checked={line.giftReceipt} onChange={() => updateLine(line.variant.id, "gift")} />
                <span>Generar ticket de regalo para este artículo</span>
              </label>
            </article>
          ))}
        </div>
        <div className="cart-footer">
          <div className="total-row"><span>Total</span><strong>{money.format(total)}</strong></div>
          <button className="primary-button pay-button" disabled={cart.length === 0} onClick={() => setCheckoutOpen(true)}>Cobrar</button>
        </div>
      </aside>

      {checkoutOpen && (
        <div className="modal-backdrop">
          <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
            <p className="eyebrow">Confirmar cobro</p>
            <h2 id="checkout-title">{money.format(total)}</h2>
            <p>Selecciona el método registrado en la venta.</p>
            <div className="payment-options">
              <button onClick={() => completeSale("cash")}><strong>Efectivo</strong><small>Calcular cambio</small></button>
              <button onClick={() => completeSale("card")}><strong>Tarjeta</strong><small>Terminal externa</small></button>
              <button onClick={() => completeSale("transfer")}><strong>Transferencia</strong><small>Capturar referencia</small></button>
            </div>
            <button className="secondary-button wide" onClick={() => setCheckoutOpen(false)}>Volver al carrito</button>
          </section>
        </div>
      )}
    </div>
  );
}
