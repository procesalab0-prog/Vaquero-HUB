"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Barcode,
  Check,
  ChevronRight,
  Gift,
  ListFilter,
  Minus,
  PackageOpen,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import type { CartLine, PaymentMethod, ProductVariant } from "@/lib/domain";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const frequentCategories = ["Botas", "Botines", "Texanas", "Cintos", "Camisas"];

function ProductCard({ variant, onAdd }: { variant: ProductVariant; onAdd: () => void }) {
  const soldOut = variant.stock === 0;
  return (
    <button className="product-card" type="button" disabled={soldOut} onClick={onAdd}>
      <span className="product-card-media">
        <PackageOpen aria-hidden="true" strokeWidth={1.6} />
        {soldOut ? <em>Agotado</em> : null}
      </span>
      <span className="product-card-copy">
        <strong>{variant.productName}</strong>
        <code>{variant.legacyCode}</code>
        <span className="variant-line">{variant.color} · {variant.size}</span>
        <span className="product-card-bottom">
          <b>{money.format(variant.price)}</b>
          <small className={variant.stock === 1 ? "last-unit" : ""}>
            {variant.stock === 1 ? "Última" : `${variant.stock} pzas`}
          </small>
        </span>
      </span>
    </button>
  );
}

export function PosWorkspace({ variants }: { variants: ProductVariant[] }) {
  const [query, setQuery] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es-MX");
    if (!showCatalog && !term) return [];
    if (!term) return variants;
    return variants.filter((variant) =>
      [variant.productName, variant.brand, variant.legacyCode, variant.color, variant.size]
        .join(" ")
        .toLocaleLowerCase("es-MX")
        .includes(term),
    );
  }, [query, showCatalog, variants]);

  const total = cart.reduce((sum, line) => sum + line.variant.price * line.quantity, 0);
  const quantity = cart.reduce((sum, line) => sum + line.quantity, 0);
  const giftCount = cart.filter((line) => line.giftReceipt).length;

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
    setToast(`Artículo agregado · ${variant.productName} ${variant.size}`);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
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
    setShowCatalog(false);
  }

  if (completed) {
    return (
      <section className="sale-success">
        <span className="success-seal"><Check aria-hidden="true" strokeWidth={2.5} /></span>
        <p className="kicker">Venta completada</p>
        <h2>{money.format(total)}</h2>
        <code>Folio V-000842 · {quantity} artículos</code>
        <div className="success-buttons">
          <button className="secondary-button" type="button">Imprimir ticket</button>
          {giftCount > 0 ? (
            <button className="gift-button" type="button"><Gift aria-hidden="true" />Ticket de regalo ({giftCount})</button>
          ) : null}
          <button className="primary-button" type="button" onClick={newSale}>Nueva venta</button>
        </div>
      </section>
    );
  }

  return (
    <div className="pos-screen">
      <section className="pos-catalog">
        <div className="scan-row">
          <label className="scan-input">
            <Barcode aria-hidden="true" strokeWidth={1.8} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setShowCatalog(true)}
              placeholder="Escanea el código o busca por nombre, SKU o marca"
              aria-label="Buscar o escanear producto"
            />
            <span className="scan-caret" aria-hidden="true" />
          </label>
          <button className="catalog-button" type="button" onClick={() => setShowCatalog(true)}>
            <ListFilter aria-hidden="true" strokeWidth={1.8} />Catálogo
          </button>
        </div>

        <div className="frequent-row">
          <span>Frecuentes</span>
          {frequentCategories.map((category) => (
            <button type="button" key={category} onClick={() => { setShowCatalog(true); setQuery(category); }}>
              {category}
            </button>
          ))}
        </div>

        <div className="catalog-canvas">
          {results.length > 0 ? (
            <>
              <div className="catalog-results-heading">
                <div><span>Catálogo</span><strong>{results.length} resultados</strong></div>
                <button type="button" onClick={() => { setQuery(""); setShowCatalog(false); }}>Cerrar</button>
              </div>
              <div className="product-grid">
                {results.map((variant) => (
                  <ProductCard key={variant.id} variant={variant} onAdd={() => addVariant(variant)} />
                ))}
              </div>
            </>
          ) : query.trim() ? (
            <div className="no-results-state">
              <Search aria-hidden="true" />
              <h2>Sin resultados para “{query}”</h2>
              <p>Revisa el código o intenta buscar por marca, talla o color.</p>
              <button className="secondary-button" type="button" onClick={() => setQuery("")}>Limpiar búsqueda</button>
            </div>
          ) : (
            <div className="pos-ready-state">
              <Image src="/illustrations/pos-ready.png" alt="Cajero de Vaqueros SM escaneando una bota" width={242} height={210} priority />
              <h2>Listo para vender</h2>
              <p>Escanea el primer artículo o abre el catálogo. El carrito de la derecha se llena conforme agregas productos.</p>
              <div>
                <button className="primary-button" type="button" onClick={() => setShowCatalog(true)}>Abrir catálogo</button>
                <button className="secondary-button" type="button" onClick={() => setShowCatalog(true)}><Search aria-hidden="true" />Buscar producto</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="sale-panel" aria-label="Carrito de venta">
        <header className="sale-panel-header">
          <strong>Venta en curso</strong>
          <code>{quantity ? `${quantity} artículos` : "Ticket sin folio"}</code>
        </header>

        <div className="sale-lines">
          {cart.length === 0 ? (
            <div className="empty-sale">
              <Image src="/illustrations/empty-cart.png" alt="Vaquero SM con un carrito vacío" width={196} height={215} />
              <strong>Carrito vacío</strong>
              <p>Los artículos aparecerán aquí con talla, color y código.</p>
            </div>
          ) : (
            cart.map((line) => (
              <article className="sale-line" key={line.variant.id}>
                <div className="sale-line-top">
                  <span className="sale-thumb"><ShoppingCart aria-hidden="true" strokeWidth={1.6} /></span>
                  <div>
                    <strong>{line.variant.productName}</strong>
                    <small>{line.variant.color} · {line.variant.size} · <code>{line.variant.legacyCode}</code></small>
                  </div>
                  <button className="remove-line" type="button" aria-label={`Quitar ${line.variant.productName}`} onClick={() => updateLine(line.variant.id, "remove")}>
                    <Trash2 aria-hidden="true" strokeWidth={1.8} />
                  </button>
                </div>
                {line.giftReceipt ? <span className="gift-chip"><Gift aria-hidden="true" />Regalo</span> : null}
                {line.variant.stock === 1 ? <span className="stock-warning">Última pieza · confirma físicamente</span> : null}
                <div className="sale-line-bottom">
                  <div className="quantity-buttons">
                    <button type="button" aria-label="Disminuir cantidad" onClick={() => updateLine(line.variant.id, "decrease")}><Minus aria-hidden="true" /></button>
                    <strong>{line.quantity}</strong>
                    <button type="button" aria-label="Aumentar cantidad" onClick={() => updateLine(line.variant.id, "increase")}><Plus aria-hidden="true" /></button>
                  </div>
                  <button className={line.giftReceipt ? "line-gift selected" : "line-gift"} type="button" onClick={() => updateLine(line.variant.id, "gift")}>
                    <Gift aria-hidden="true" />Regalo
                  </button>
                  <b>{money.format(line.variant.price * line.quantity)}</b>
                </div>
              </article>
            ))
          )}
        </div>

        <footer className="sale-summary">
          <div><span>Subtotal ({quantity} artículos)</span><span>{money.format(total)}</span></div>
          <div><span>Descuentos</span><span>{money.format(0)}</span></div>
          <div className="grand-total"><strong>Total</strong><b>{money.format(total)}</b></div>
          <button className="pay-button" type="button" disabled={cart.length === 0} onClick={() => setCheckoutOpen(true)}>
            Cobrar<ChevronRight aria-hidden="true" />
          </button>
          <div className="sale-extras">
            <button type="button" disabled={cart.length === 0}>Descuento</button>
            <button type="button" disabled={cart.length === 0} onClick={() => setCart((current) => current.map((line) => ({ ...line, giftReceipt: true })))}>Regalo</button>
            <button type="button">Apartar</button>
          </div>
        </footer>
      </aside>

      {toast ? (
        <div className="pos-toast" role="status"><span><Check aria-hidden="true" /></span>{toast}</div>
      ) : null}

      {checkoutOpen ? (
        <div className="modal-backdrop">
          <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
            <p className="kicker">Confirmar cobro</p>
            <h2 id="checkout-title">{money.format(total)}</h2>
            <p>Selecciona el método registrado en la venta.</p>
            <div className="payment-options">
              <button type="button" onClick={() => completeSale("cash")}><strong>Efectivo</strong><small>Calcular cambio</small></button>
              <button type="button" onClick={() => completeSale("card")}><strong>Tarjeta</strong><small>Terminal externa</small></button>
              <button type="button" onClick={() => completeSale("transfer")}><strong>Transferencia</strong><small>Capturar referencia</small></button>
            </div>
            <button className="secondary-button wide" type="button" onClick={() => setCheckoutOpen(false)}>Volver al carrito</button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
