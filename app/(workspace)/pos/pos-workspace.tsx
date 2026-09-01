"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Barcode,
  Check,
  ChevronRight,
  CreditCard,
  Delete,
  Gift,
  Landmark,
  ListFilter,
  Minus,
  PackageOpen,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Printer,
  X,
} from "lucide-react";
import type { CartLine, PaymentMethod, ProductVariant } from "@/lib/domain";
import { formatReceiptDate, ThermalReceipt, type ReceiptLine } from "@/components/thermal-receipt";
import { useWorkspace } from "@/components/workspace-context";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const frequentCategories = [
  { label: "Botas", terms: ["bota", "botín"] },
  { label: "Sombreros", terms: ["sombrero", "texana"] },
  { label: "Cintos", terms: ["cinturón", "cinto"] },
  { label: "Camisas", terms: ["camisa"] },
];

function ProductCard({ variant, onAdd }: { variant: ProductVariant; onAdd: () => void }) {
  const soldOut = variant.stock === 0;
  return (
    <button className="product-card" type="button" disabled={soldOut} onClick={onAdd}>
      <span className="product-card-media">
        {variant.image ? (
          <Image src={variant.image} alt="" fill sizes="(max-width: 600px) 46vw, 180px" />
        ) : (
          <><PackageOpen aria-hidden="true" strokeWidth={1.6} /><small>Foto pendiente</small></>
        )}
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
  const { identity, activeLocation } = useWorkspace();
  const [query, setQuery] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [toast, setToast] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountInput, setDiscountInput] = useState("");
  const [extraDialog, setExtraDialog] = useState<"discount" | "layaway" | null>(null);
  const [layawayCustomer, setLayawayCustomer] = useState("");
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [cashMode, setCashMode] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receiptMode, setReceiptMode] = useState<"sale" | "gift" | null>(null);
  const [paymentUsed, setPaymentUsed] = useState<PaymentMethod>("cash");
  const [receiptDate, setReceiptDate] = useState("");
  const toastTimer = useRef<number | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es-MX");
    if (!showCatalog && !term && !activeCategory) return [];
    if (activeCategory) {
      const category = frequentCategories.find((item) => item.label === activeCategory);
      if (category) return variants.filter((variant) => category.terms.some((word) => variant.productName.toLocaleLowerCase("es-MX").includes(word)));
    }
    if (!term) return variants;
    return variants.filter((variant) =>
      [variant.productName, variant.brand, variant.legacyCode, variant.color, variant.size]
        .join(" ")
        .toLocaleLowerCase("es-MX")
        .includes(term),
    );
  }, [activeCategory, query, showCatalog, variants]);

  const subtotal = cart.reduce((sum, line) => sum + line.variant.price * line.quantity, 0);
  const discountAmount = subtotal * discountPercent / 100;
  const total = subtotal - discountAmount;
  const quantity = cart.reduce((sum, line) => sum + line.quantity, 0);
  const giftCount = cart.filter((line) => line.giftReceipt).length;
  const cashTendered = Number(cashInput || 0);
  const change = Math.max(0, cashTendered - total);
  const receiptLines: ReceiptLine[] = cart.map((line) => ({ name: line.variant.productName, variant: `${line.variant.color} · ${line.variant.size}`, code: line.variant.legacyCode, quantity: line.quantity, unitPrice: line.variant.price }));
  const giftLines = receiptLines.filter((_, index) => cart[index]?.giftReceipt);
  const paymentLabels: Record<PaymentMethod, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia" };

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }

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
    notify(`Artículo agregado · ${variant.productName} ${variant.size}`);
    if ("vibrate" in navigator) navigator.vibrate(12);
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
    if (submittingRef.current) return;
    if (method === "cash" && cashTendered < total) return;
    submittingRef.current = true;
    setSubmitting(true);
    setPaymentUsed(method);
    setReceiptDate(formatReceiptDate());
    setCheckoutOpen(false);
    setCompleted(true);
  }

  function newSale() {
    setCart([]);
    setCompleted(false);
    setQuery("");
    setShowCatalog(false);
    setDiscountPercent(0);
    setCartDrawerOpen(false);
    setCashMode(false);
    setCashInput("");
    setSubmitting(false);
    submittingRef.current = false;
    setReceiptMode(null);
  }

  function selectCategory(label: string) {
    setShowCatalog(true);
    setQuery("");
    setActiveCategory((current) => current === label ? "" : label);
  }

  function appendCashKey(key: string) {
    setCashInput((current) => {
      if (key === "backspace") return current.slice(0, -1);
      if (key === "exact") return total.toFixed(2);
      const next = `${current}${key}`;
      return next.length <= 8 ? next : current;
    });
  }

  function applyDiscount() {
    const value = Math.min(100, Math.max(0, Number(discountInput)));
    if (!Number.isFinite(value)) return;
    setDiscountPercent(value);
    setExtraDialog(null);
    notify(value ? `Descuento de ${value}% aplicado` : "Descuento eliminado");
  }

  function createLayaway() {
    if (!layawayCustomer.trim() || cart.length === 0) return;
    setExtraDialog(null);
    setCart([]);
    setDiscountPercent(0);
    setLayawayCustomer("");
    notify("Apartado AP-000128 creado correctamente");
  }

  if (completed) {
    return (
      <><section className="sale-success">
          <span className="success-seal"><Check aria-hidden="true" strokeWidth={2.5} /></span>
          <p className="kicker">Venta completada</p>
          <h2>{money.format(total)}</h2>
          <code>Folio V-000842 · {quantity} artículos</code>
          <div className="success-buttons">
            <button className="secondary-button" type="button" onClick={() => setReceiptMode("sale")}><Printer aria-hidden="true" />Ver e imprimir ticket</button>
            {giftCount > 0 ? (
              <button className="gift-button" type="button" onClick={() => setReceiptMode("gift")}><Gift aria-hidden="true" />Ver ticket de regalo ({giftCount})</button>
            ) : null}
            <button className="primary-button" type="button" onClick={newSale}>Nueva venta</button>
          </div>
        </section>
        {receiptMode ? <div className="modal-backdrop receipt-modal-backdrop"><section className="receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-preview-title"><header><div><p className="eyebrow">Vista previa · 80 mm</p><h2 id="receipt-preview-title">{receiptMode === "sale" ? "Ticket de venta" : "Ticket de regalo"}</h2><p>Así saldrá de la impresora térmica.</p></div><button type="button" aria-label="Cerrar ticket" onClick={() => setReceiptMode(null)}><X aria-hidden="true" /></button></header><div className="receipt-paper-stage"><ThermalReceipt mode={receiptMode} folio="V-000842" date={receiptDate} items={receiptMode === "gift" ? giftLines : receiptLines} subtotal={subtotal} discount={discountAmount} total={total} method={paymentLabels[paymentUsed]} tendered={paymentUsed === "cash" ? cashTendered : total} change={paymentUsed === "cash" ? change : 0} cashierName={identity.name} location={activeLocation} /></div><div className="receipt-modal-actions"><button className="secondary-button" type="button" onClick={() => setReceiptMode(null)}>Volver</button><button className="primary-button" type="button" onClick={() => window.print()}><Printer aria-hidden="true" />Imprimir ahora</button></div></section></div> : null}
      </>
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
            <button className={activeCategory === category.label ? "selected" : ""} type="button" key={category.label} onClick={() => selectCategory(category.label)}>
              {category.label}
            </button>
          ))}
        </div>

        <div className="catalog-canvas">
          {results.length > 0 ? (
            <>
              <div className="catalog-results-heading">
                <div><span>Catálogo</span><strong>{results.length} resultados</strong></div>
                <button type="button" onClick={() => { setQuery(""); setActiveCategory(""); setShowCatalog(false); }}>Cerrar</button>
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
              <Image src="/illustrations/pos-ready.png" alt="Cajero de Vaquero SM escaneando una bota" width={242} height={210} priority />
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

      {cartDrawerOpen ? <button className="mobile-cart-backdrop" type="button" aria-label="Cerrar carrito" onClick={() => setCartDrawerOpen(false)} /> : null}
      <aside className={cartDrawerOpen ? "sale-panel mobile-open" : "sale-panel"} aria-label="Carrito de venta">
        <header className="sale-panel-header">
          <strong><ShoppingCart aria-hidden="true" />Venta en curso</strong>
          <code>{quantity ? `${quantity} artículos` : "Ticket sin folio"}</code>
          <button className="mobile-cart-close" type="button" aria-label="Cerrar carrito" onClick={() => setCartDrawerOpen(false)}><X aria-hidden="true" /></button>
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
          <div><span>Subtotal ({quantity} artículos)</span><span>{money.format(subtotal)}</span></div>
          <div><span>Descuentos {discountPercent ? `(${discountPercent}%)` : ""}</span><span>−{money.format(discountAmount)}</span></div>
          <div className="grand-total"><strong>Total</strong><b>{money.format(total)}</b></div>
          <button className="pay-button" type="button" disabled={cart.length === 0} onClick={() => { setCartDrawerOpen(false); setCheckoutOpen(true); }}>
            Cobrar<ChevronRight aria-hidden="true" />
          </button>
          <div className="sale-extras">
            <button type="button" disabled={cart.length === 0} onClick={() => { setDiscountInput(String(discountPercent || "")); setExtraDialog("discount"); }}>Descuento</button>
            <button type="button" disabled={cart.length === 0} onClick={() => { setCart((current) => current.map((line) => ({ ...line, giftReceipt: true }))); notify("Todos los artículos se marcaron como regalo"); }}>Regalo</button>
            <button type="button" disabled={cart.length === 0} onClick={() => setExtraDialog("layaway")}>Apartar</button>
          </div>
        </footer>
      </aside>

      <button className="mobile-cart-toggle" type="button" onClick={() => setCartDrawerOpen(true)}>
        <span><ShoppingCart aria-hidden="true" /><b>{quantity}</b></span>
        <strong>{quantity ? `${quantity} artículos` : "Ver carrito"}</strong>
        <b>{money.format(total)}</b>
      </button>

      {toast ? (
        <div className="pos-toast" role="status"><span><Check aria-hidden="true" /></span>{toast}</div>
      ) : null}

      {checkoutOpen ? (
        <div className="modal-backdrop">
          <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
            <p className="kicker">Confirmar cobro</p>
            <h2 id="checkout-title">{money.format(total)}</h2>
            {!cashMode ? (
              <><p>Selecciona el método registrado en la venta.</p>
              <div className="payment-options">
                <button className="payment-cash" type="button" onClick={() => setCashMode(true)}><Banknote aria-hidden="true" /><strong>Efectivo</strong><small>Calcular cambio</small></button>
                <button className="payment-card" type="button" disabled={submitting} onClick={() => completeSale("card")}><CreditCard aria-hidden="true" /><strong>Tarjeta</strong><small>Terminal externa</small></button>
                <button className="payment-transfer" type="button" disabled={submitting} onClick={() => completeSale("transfer")}><Landmark aria-hidden="true" /><strong>Transferencia</strong><small>Referencia externa</small></button>
              </div></>
            ) : (
              <div className="cash-keypad-flow">
                <div className="cash-display"><span>Recibido</span><strong>{money.format(cashTendered)}</strong><small className={cashTendered >= total ? "enough" : ""}>{cashTendered >= total ? `Cambio: ${money.format(change)}` : `Faltan ${money.format(total - cashTendered)}`}</small></div>
                <div className="cash-keypad">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map((key) => <button type="button" key={key} onClick={() => appendCashKey(key)}>{key}</button>)}
                  <button type="button" aria-label="Borrar último dígito" onClick={() => appendCashKey("backspace")}><Delete aria-hidden="true" /></button>
                  <button className="exact-key" type="button" onClick={() => appendCashKey("exact")}>Exacto</button>
                </div>
                <button className="confirm-cash-button" type="button" disabled={cashTendered < total || submitting} onClick={() => completeSale("cash")}>Confirmar efectivo</button>
              </div>
            )}
            <button className="secondary-button wide" type="button" onClick={() => { if (cashMode) { setCashMode(false); setCashInput(""); } else { setCheckoutOpen(false); } }}>{cashMode ? "Cambiar método" : "Volver al carrito"}</button>
          </section>
        </div>
      ) : null}

      {extraDialog === "discount" ? (
        <div className="modal-backdrop"><section className="checkout-modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="discount-title"><p className="eyebrow">Venta en curso</p><h2 id="discount-title">Aplicar descuento</h2><div className="form-stack"><label><span>Porcentaje autorizado</span><input inputMode="decimal" value={discountInput} onChange={(event) => setDiscountInput(event.target.value)} placeholder="Ej. 10" /></label></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setExtraDialog(null)}>Cancelar</button><button className="primary-button" type="button" onClick={applyDiscount}>Aplicar descuento</button></div></section></div>
      ) : null}

      {extraDialog === "layaway" ? (
        <div className="modal-backdrop"><section className="checkout-modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="layaway-title"><p className="eyebrow">Apartado</p><h2 id="layaway-title">Guardar apartado</h2><p>Los artículos saldrán del carrito y quedarán asociados al cliente.</p><div className="form-stack"><label><span>Nombre del cliente</span><input value={layawayCustomer} onChange={(event) => setLayawayCustomer(event.target.value)} placeholder="Nombre completo" /></label></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setExtraDialog(null)}>Cancelar</button><button className="primary-button" type="button" onClick={createLayaway}>Crear apartado</button></div></section></div>
      ) : null}
    </div>
  );
}
