"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  LockKeyhole,
  Minus,
  PackageOpen,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Printer,
  UserRoundPlus,
  X,
} from "lucide-react";
import type { CartLine, PaymentMethod, ProductVariant } from "@/lib/domain";
import {
  formatReceiptDate,
  ThermalReceipt,
  type ReceiptLine,
} from "@/components/thermal-receipt";
import { CustomerLookup } from "@/components/customer-lookup";
import { useWorkspace } from "@/components/workspace-context";
import type { CustomerSummary } from "@/lib/customers";

type SalePaymentInput = {
  method_code: "CASH" | "CARD" | "TRANSFER";
  amount_cents: number;
  tendered_cents?: number;
  reference?: string;
};
type SaleActionInput = {
  idempotencyKey: string;
  cashSessionId: string;
  items: Array<{ variant_id: string; quantity: number; gift_receipt: boolean }>;
  payments: SalePaymentInput[];
  customerId?: string | null;
  discount?: { percent: number; authorizationToken: string } | null;
};
type SaleActionResult =
  | {
      ok: true;
      saleId: string;
      folio: string;
      soldAt: string;
      totalCents: number;
      receipt: Record<string, unknown> | null;
    }
  | { ok: false; code: string; message: string };
type StoredReceipt = {
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  cashier_name: string;
  location: { name: string; address: string | null; phone: string | null };
  items: Array<{
    product_name: string;
    variant_description: string;
    sku: string;
    quantity: number;
    unit_price_cents: number;
    gift_receipt: boolean;
  }>;
  payments: Array<{
    method_name: string;
    amount_cents: number;
    tendered_cents: number | null;
    change_cents: number;
  }>;
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const frequentCategories = [
  { label: "Botas", terms: ["bota", "botín"] },
  { label: "Sombreros", terms: ["sombrero", "texana"] },
  { label: "Cintos", terms: ["cinturón", "cinto"] },
  { label: "Camisas", terms: ["camisa"] },
];

function ProductCard({
  variant,
  onAdd,
}: {
  variant: ProductVariant;
  onAdd: () => void;
}) {
  const soldOut = variant.stock === 0;
  return (
    <button
      className="product-card"
      type="button"
      disabled={soldOut}
      onClick={onAdd}
    >
      <span className="product-card-media">
        {variant.image ? (
          <Image
            src={variant.image}
            alt=""
            fill
            sizes="(max-width: 600px) 46vw, 180px"
          />
        ) : (
          <>
            <PackageOpen aria-hidden="true" strokeWidth={1.6} />
            <small>Foto pendiente</small>
          </>
        )}
        {soldOut ? <em>Agotado</em> : null}
      </span>
      <span className="product-card-copy">
        <strong>{variant.productName}</strong>
        <code>{variant.legacyCode}</code>
        <span className="variant-line">
          {variant.color} · {variant.size}
        </span>
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

type CashSession = { id: string; location_id: string; register_name: string };

export function PosWorkspace({
  variants,
  cashSession,
  preview = false,
  status,
  createSaleAction,
  authorizeDiscountAction,
  printAction,
}: {
  variants: ProductVariant[];
  cashSession?: CashSession | null;
  preview?: boolean;
  status?: string;
  createSaleAction?: (input: SaleActionInput) => Promise<SaleActionResult>;
  authorizeDiscountAction?: (input: {
    employeeCode: string;
    pin: string;
  }) => Promise<
    | { ok: true; authorizationToken: string; expiresAt: string }
    | { ok: false; message: string }
  >;
  printAction?: (
    saleId: string,
    mode: "sale" | "gift",
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const router = useRouter();
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
  const [supervisorCode, setSupervisorCode] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");
  const [discountAuthorization, setDiscountAuthorization] = useState<
    string | null
  >(null);
  const [discountError, setDiscountError] = useState("");
  const [extraDialog, setExtraDialog] = useState<"discount" | "layaway" | null>(
    null,
  );
  const [layawayCustomer, setLayawayCustomer] = useState("");
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerSummary | null>(null);
  const [customerLookupOpen, setCustomerLookupOpen] = useState(false);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [cashMode, setCashMode] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [splitCash, setSplitCash] = useState("");
  const [splitCard, setSplitCard] = useState("");
  const [splitTransfer, setSplitTransfer] = useState("");
  const [splitCardReference, setSplitCardReference] = useState("");
  const [splitTransferReference, setSplitTransferReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receiptMode, setReceiptMode] = useState<"sale" | "gift" | null>(null);
  const [paymentUsed, setPaymentUsed] = useState<PaymentMethod>("cash");
  const [receiptPaymentLabel, setReceiptPaymentLabel] = useState("Efectivo");
  const [paymentReference, setPaymentReference] = useState("");
  const [saleError, setSaleError] = useState("");
  const [saleFolio, setSaleFolio] = useState("V-000842");
  const [saleId, setSaleId] = useState("");
  const [storedReceipt, setStoredReceipt] = useState<StoredReceipt | null>(
    null,
  );
  const [receiptDate, setReceiptDate] = useState("");
  const toastTimer = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es-MX");
    if (!showCatalog && !term && !activeCategory) return [];
    if (activeCategory) {
      const category = frequentCategories.find(
        (item) => item.label === activeCategory,
      );
      if (category)
        return variants.filter((variant) =>
          category.terms.some((word) =>
            variant.productName.toLocaleLowerCase("es-MX").includes(word),
          ),
        );
    }
    if (!term) return variants;
    return variants.filter((variant) =>
      [
        variant.productName,
        variant.brand,
        variant.legacyCode,
        variant.color,
        variant.size,
      ]
        .join(" ")
        .toLocaleLowerCase("es-MX")
        .includes(term),
    );
  }, [activeCategory, query, showCatalog, variants]);

  const subtotal = cart.reduce(
    (sum, line) => sum + line.variant.price * line.quantity,
    0,
  );
  const discountAmount = (subtotal * discountPercent) / 100;
  const total = subtotal - discountAmount;
  const quantity = cart.reduce((sum, line) => sum + line.quantity, 0);
  const giftCount = cart.filter((line) => line.giftReceipt).length;
  const cashTendered = Number(cashInput || 0);
  const change = Math.max(0, cashTendered - total);
  const receiptLines: ReceiptLine[] = cart.map((line) => ({
    name: line.variant.productName,
    variant: `${line.variant.color} · ${line.variant.size}`,
    code: line.variant.legacyCode,
    quantity: line.quantity,
    unitPrice: line.variant.price,
  }));
  const paymentLabels: Record<PaymentMethod, string> = {
    cash: "Efectivo",
    card: "Tarjeta",
    transfer: "Transferencia",
  };

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  }

  function addVariant(variant: ProductVariant) {
    if (variant.stock < 1) return;
    setCart((current) => {
      const existing = current.find((line) => line.variant.id === variant.id);
      if (!existing)
        return [...current, { variant, quantity: 1, giftReceipt: false }];
      if (existing.quantity >= variant.stock) return current;
      return current.map((line) =>
        line.variant.id === variant.id
          ? { ...line, quantity: line.quantity + 1 }
          : line,
      );
    });
    notify(`Artículo agregado · ${variant.productName} ${variant.size}`);
    if ("vibrate" in navigator) navigator.vibrate(12);
  }

  function updateLine(
    id: string,
    action: "increase" | "decrease" | "gift" | "remove",
  ) {
    setCart((current) =>
      current.flatMap((line) => {
        if (line.variant.id !== id) return [line];
        if (action === "remove") return [];
        if (action === "gift")
          return [{ ...line, giftReceipt: !line.giftReceipt }];
        if (action === "increase") {
          return [
            {
              ...line,
              quantity: Math.min(line.quantity + 1, line.variant.stock),
            },
          ];
        }
        return line.quantity === 1
          ? []
          : [{ ...line, quantity: line.quantity - 1 }];
      }),
    );
  }

  async function submitSale(
    method: PaymentMethod,
    payments: SalePaymentInput[],
    receiptLabel = paymentLabels[method],
  ) {
    if (submittingRef.current) return;
    if (!preview && !cashSession?.id) {
      setSaleError("Abre una caja antes de cobrar.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSaleError("");
    if (!preview) {
      if (!createSaleAction) {
        submittingRef.current = false;
        setSubmitting(false);
        setSaleError("El servicio de venta no está disponible.");
        return;
      }
      const result = await createSaleAction({
        idempotencyKey: idempotencyKey.current,
        cashSessionId: cashSession!.id,
        items: cart.map((line) => ({
          variant_id: line.variant.id,
          quantity: line.quantity,
          gift_receipt: line.giftReceipt,
        })),
        payments,
        customerId: selectedCustomer?.id ?? null,
        discount:
          discountPercent > 0 && discountAuthorization
            ? {
                percent: discountPercent,
                authorizationToken: discountAuthorization,
              }
            : null,
      });
      if (!result.ok) {
        submittingRef.current = false;
        setSubmitting(false);
        setSaleError(result.message);
        return;
      }
      setSaleFolio(result.folio);
      setSaleId(result.saleId);
      setStoredReceipt(result.receipt as StoredReceipt | null);
      setReceiptDate(formatReceiptDate(new Date(result.soldAt)));
    } else {
      setReceiptDate(formatReceiptDate());
    }
    setPaymentUsed(method);
    setReceiptPaymentLabel(receiptLabel);
    setCheckoutOpen(false);
    setCompleted(true);
  }

  function completeSale(method: PaymentMethod) {
    const totalCents = Math.round(total * 100);
    if (method === "cash") {
      if (cashTendered < total) {
        setSaleError("El efectivo recibido no cubre el total.");
        return;
      }
      void submitSale(method, [
        {
          method_code: "CASH",
          amount_cents: totalCents,
          tendered_cents: Math.round(cashTendered * 100),
        },
      ]);
      return;
    }
    if (paymentReference.trim().length < 3) {
      setSaleError("Captura la referencia del pago electrónico.");
      return;
    }
    void submitSale(method, [
      {
        method_code: method === "card" ? "CARD" : "TRANSFER",
        amount_cents: totalCents,
        reference: paymentReference.trim(),
      },
    ]);
  }

  function completeSplitSale() {
    const totalCents = Math.round(total * 100);
    const cashCents = Math.round(Number(splitCash || 0) * 100);
    const cardCents = Math.round(Number(splitCard || 0) * 100);
    const transferCents = Math.round(Number(splitTransfer || 0) * 100);
    if (cashCents + cardCents + transferCents !== totalCents) {
      setSaleError(
        "La suma de los pagos debe coincidir exactamente con el total.",
      );
      return;
    }
    if (
      (cardCents > 0 && splitCardReference.trim().length < 3) ||
      (transferCents > 0 && splitTransferReference.trim().length < 3)
    ) {
      setSaleError("Captura las referencias de los pagos electrónicos.");
      return;
    }
    const payments: SalePaymentInput[] = [];
    if (cashCents > 0)
      payments.push({
        method_code: "CASH",
        amount_cents: cashCents,
        tendered_cents: cashCents,
      });
    if (cardCents > 0)
      payments.push({
        method_code: "CARD",
        amount_cents: cardCents,
        reference: splitCardReference.trim(),
      });
    if (transferCents > 0)
      payments.push({
        method_code: "TRANSFER",
        amount_cents: transferCents,
        reference: splitTransferReference.trim(),
      });
    void submitSale("cash", payments, "Pago combinado");
  }

  function newSale() {
    setCart([]);
    setCompleted(false);
    setQuery("");
    setShowCatalog(false);
    setDiscountPercent(0);
    setDiscountAuthorization(null);
    setSupervisorCode("");
    setSupervisorPin("");
    setCartDrawerOpen(false);
    setCashMode(false);
    setSplitMode(false);
    setCashInput("");
    setSplitCash("");
    setSplitCard("");
    setSplitTransfer("");
    setSplitCardReference("");
    setSplitTransferReference("");
    setSubmitting(false);
    submittingRef.current = false;
    setReceiptMode(null);
    setSelectedCustomer(null);
    setPaymentReference("");
    setSaleError("");
    setSaleId("");
    setStoredReceipt(null);
    idempotencyKey.current = crypto.randomUUID();
    router.refresh();
  }

  function selectCategory(label: string) {
    setShowCatalog(true);
    setQuery("");
    setActiveCategory((current) => (current === label ? "" : label));
  }

  function appendCashKey(key: string) {
    setCashInput((current) => {
      if (key === "backspace") return current.slice(0, -1);
      if (key === "exact") return total.toFixed(2);
      const next = `${current}${key}`;
      return next.length <= 8 ? next : current;
    });
  }

  async function applyDiscount() {
    const value = Math.min(100, Math.max(0, Number(discountInput)));
    if (!Number.isFinite(value)) return;
    if (value > 0 && !preview) {
      setDiscountError("");
      if (!authorizeDiscountAction) {
        setDiscountError("El servicio de autorización no está disponible.");
        return;
      }
      const authorization = await authorizeDiscountAction({
        employeeCode: supervisorCode,
        pin: supervisorPin,
      });
      if (!authorization.ok) {
        setDiscountError(authorization.message);
        return;
      }
      setDiscountAuthorization(authorization.authorizationToken);
    } else {
      setDiscountAuthorization(null);
    }
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

  async function printReceipt() {
    if (!preview && saleId) {
      if (!printAction) {
        setSaleError("El servicio de impresión no está disponible.");
        return;
      }
      const result = await printAction(saleId, receiptMode ?? "sale");
      if (!result.ok) {
        setSaleError(result.message);
        return;
      }
    }
    window.print();
  }

  if (!preview && !cashSession) {
    return (
      <section className="module-page cash-closed-state">
        <span>
          <LockKeyhole aria-hidden="true" />
        </span>
        <p className="eyebrow">Punto de venta protegido</p>
        <h1>Abre tu caja para vender</h1>
        <p>
          {status ??
            "Cada venta debe quedar ligada a una caja y a un turno. Puedes elegir una caja disponible en el módulo Caja."}
        </p>
        <a className="primary-button" href="/caja">
          Ir a abrir caja
        </a>
      </section>
    );
  }

  if (completed) {
    const officialLines: ReceiptLine[] =
      storedReceipt?.items.map((item) => ({
        name: item.product_name,
        variant: item.variant_description,
        code: item.sku,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price_cents) / 100,
      })) ?? receiptLines;
    const officialGiftLines = officialLines.filter(
      (_, index) =>
        storedReceipt?.items[index]?.gift_receipt ?? cart[index]?.giftReceipt,
    );
    const officialPayments = storedReceipt?.payments ?? [];
    const officialTendered =
      officialPayments.reduce(
        (sum, item) => sum + Number(item.tendered_cents ?? item.amount_cents),
        0,
      ) / 100;
    const officialChange =
      officialPayments.reduce(
        (sum, item) => sum + Number(item.change_cents),
        0,
      ) / 100;
    const officialLocation = storedReceipt
      ? {
          id: cashSession?.location_id ?? "",
          code: "",
          name: storedReceipt.location.name,
          address: storedReceipt.location.address,
          phone: storedReceipt.location.phone,
        }
      : activeLocation;
    return (
      <>
        <section className="sale-success">
          <span className="success-seal">
            <Check aria-hidden="true" strokeWidth={2.5} />
          </span>
          <p className="kicker">Venta completada</p>
          <h2>{money.format(total)}</h2>
          <code>
            Folio {saleFolio} · {quantity} artículos
          </code>
          <div className="success-buttons">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setReceiptMode("sale")}
            >
              <Printer aria-hidden="true" />
              Ver e imprimir ticket
            </button>
            {giftCount > 0 ? (
              <button
                className="gift-button"
                type="button"
                onClick={() => setReceiptMode("gift")}
              >
                <Gift aria-hidden="true" />
                Ver ticket de regalo ({giftCount})
              </button>
            ) : null}
            <button className="primary-button" type="button" onClick={newSale}>
              Nueva venta
            </button>
          </div>
        </section>
        {receiptMode ? (
          <div className="modal-backdrop receipt-modal-backdrop">
            <section
              className="receipt-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="receipt-preview-title"
              data-sale-id={saleId}
            >
              <header>
                <div>
                  <p className="eyebrow">Vista previa · 80 mm</p>
                  <h2 id="receipt-preview-title">
                    {receiptMode === "sale"
                      ? "Ticket de venta"
                      : "Ticket de regalo"}
                  </h2>
                  <p>Datos confirmados por la venta guardada.</p>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar ticket"
                  onClick={() => setReceiptMode(null)}
                >
                  <X aria-hidden="true" />
                </button>
              </header>
              <div className="receipt-paper-stage">
                <ThermalReceipt
                  mode={receiptMode}
                  folio={saleFolio}
                  date={receiptDate}
                  items={
                    receiptMode === "gift" ? officialGiftLines : officialLines
                  }
                  subtotal={
                    storedReceipt
                      ? Number(storedReceipt.subtotal_cents) / 100
                      : subtotal
                  }
                  discount={
                    storedReceipt
                      ? Number(storedReceipt.discount_cents) / 100
                      : discountAmount
                  }
                  total={
                    storedReceipt
                      ? Number(storedReceipt.total_cents) / 100
                      : total
                  }
                  method={
                    officialPayments.length
                      ? officialPayments
                          .map((item) => item.method_name)
                          .join(" + ")
                      : receiptPaymentLabel
                  }
                  tendered={
                    storedReceipt
                      ? officialTendered
                      : paymentUsed === "cash"
                        ? cashTendered
                        : total
                  }
                  change={
                    storedReceipt
                      ? officialChange
                      : paymentUsed === "cash"
                        ? change
                        : 0
                  }
                  cashierName={storedReceipt?.cashier_name ?? identity.name}
                  location={officialLocation}
                />
              </div>
              <div className="receipt-modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setReceiptMode(null)}
                >
                  Volver
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void printReceipt()}
                >
                  <Printer aria-hidden="true" />
                  Imprimir ahora
                </button>
              </div>
            </section>
          </div>
        ) : null}
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
          <button
            className="catalog-button"
            type="button"
            onClick={() => setShowCatalog(true)}
          >
            <ListFilter aria-hidden="true" strokeWidth={1.8} />
            Catálogo
          </button>
        </div>

        <div className="frequent-row">
          <span>Frecuentes</span>
          {frequentCategories.map((category) => (
            <button
              className={activeCategory === category.label ? "selected" : ""}
              type="button"
              key={category.label}
              onClick={() => selectCategory(category.label)}
            >
              {category.label}
            </button>
          ))}
        </div>

        <div className="catalog-canvas">
          {results.length > 0 ? (
            <>
              <div className="catalog-results-heading">
                <div>
                  <span>Catálogo</span>
                  <strong>{results.length} resultados</strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setActiveCategory("");
                    setShowCatalog(false);
                  }}
                >
                  Cerrar
                </button>
              </div>
              <div className="product-grid">
                {results.map((variant) => (
                  <ProductCard
                    key={variant.id}
                    variant={variant}
                    onAdd={() => addVariant(variant)}
                  />
                ))}
              </div>
            </>
          ) : query.trim() ? (
            <div className="no-results-state">
              <Search aria-hidden="true" />
              <h2>Sin resultados para “{query}”</h2>
              <p>Revisa el código o intenta buscar por marca, talla o color.</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setQuery("")}
              >
                Limpiar búsqueda
              </button>
            </div>
          ) : (
            <div className="pos-ready-state">
              <Image
                src="/illustrations/pos-ready.png"
                alt="Cajero de Vaquero SM escaneando una bota"
                width={242}
                height={210}
                priority
              />
              <h2>Listo para vender</h2>
              <p>
                Escanea el primer artículo o abre el catálogo. El carrito de la
                derecha se llena conforme agregas productos.
              </p>
              <div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setShowCatalog(true)}
                >
                  Abrir catálogo
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowCatalog(true)}
                >
                  <Search aria-hidden="true" />
                  Buscar producto
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {cartDrawerOpen ? (
        <button
          className="mobile-cart-backdrop"
          type="button"
          aria-label="Cerrar carrito"
          onClick={() => setCartDrawerOpen(false)}
        />
      ) : null}
      <aside
        className={cartDrawerOpen ? "sale-panel mobile-open" : "sale-panel"}
        aria-label="Carrito de venta"
      >
        <header className="sale-panel-header">
          <strong>
            <ShoppingCart aria-hidden="true" />
            Venta en curso
          </strong>
          <code>{quantity ? `${quantity} artículos` : "Ticket sin folio"}</code>
          <button
            className="mobile-cart-close"
            type="button"
            aria-label="Cerrar carrito"
            onClick={() => setCartDrawerOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <button
          className={
            selectedCustomer ? "sale-customer selected" : "sale-customer"
          }
          type="button"
          onClick={() => setCustomerLookupOpen(true)}
        >
          <UserRoundPlus aria-hidden="true" />
          <span>
            {selectedCustomer ? (
              <>
                <strong>{selectedCustomer.full_name}</strong>
                <small>Socio {selectedCustomer.member_number}</small>
              </>
            ) : (
              <>
                <strong>Agregar cliente</strong>
                <small>Teléfono, socio, nombre o correo</small>
              </>
            )}
          </span>
          <ChevronRight aria-hidden="true" />
        </button>

        <div className="sale-lines">
          {cart.length === 0 ? (
            <div className="empty-sale">
              <Image
                src="/illustrations/empty-cart.png"
                alt="Vaquero SM con un carrito vacío"
                width={196}
                height={215}
              />
              <strong>Carrito vacío</strong>
              <p>Los artículos aparecerán aquí con talla, color y código.</p>
            </div>
          ) : (
            cart.map((line) => (
              <article className="sale-line" key={line.variant.id}>
                <div className="sale-line-top">
                  <span className="sale-thumb">
                    <ShoppingCart aria-hidden="true" strokeWidth={1.6} />
                  </span>
                  <div>
                    <strong>{line.variant.productName}</strong>
                    <small>
                      {line.variant.color} · {line.variant.size} ·{" "}
                      <code>{line.variant.legacyCode}</code>
                    </small>
                  </div>
                  <button
                    className="remove-line"
                    type="button"
                    aria-label={`Quitar ${line.variant.productName}`}
                    onClick={() => updateLine(line.variant.id, "remove")}
                  >
                    <Trash2 aria-hidden="true" strokeWidth={1.8} />
                  </button>
                </div>
                {line.giftReceipt ? (
                  <span className="gift-chip">
                    <Gift aria-hidden="true" />
                    Regalo
                  </span>
                ) : null}
                {line.variant.stock === 1 ? (
                  <span className="stock-warning">
                    Última pieza · confirma físicamente
                  </span>
                ) : null}
                <div className="sale-line-bottom">
                  <div className="quantity-buttons">
                    <button
                      type="button"
                      aria-label="Disminuir cantidad"
                      onClick={() => updateLine(line.variant.id, "decrease")}
                    >
                      <Minus aria-hidden="true" />
                    </button>
                    <strong>{line.quantity}</strong>
                    <button
                      type="button"
                      aria-label="Aumentar cantidad"
                      onClick={() => updateLine(line.variant.id, "increase")}
                    >
                      <Plus aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    className={
                      line.giftReceipt ? "line-gift selected" : "line-gift"
                    }
                    type="button"
                    onClick={() => updateLine(line.variant.id, "gift")}
                  >
                    <Gift aria-hidden="true" />
                    Regalo
                  </button>
                  <b>{money.format(line.variant.price * line.quantity)}</b>
                </div>
              </article>
            ))
          )}
        </div>

        <footer className="sale-summary">
          <div>
            <span>Subtotal ({quantity} artículos)</span>
            <span>{money.format(subtotal)}</span>
          </div>
          <div>
            <span>
              Descuentos {discountPercent ? `(${discountPercent}%)` : ""}
            </span>
            <span>−{money.format(discountAmount)}</span>
          </div>
          <div className="grand-total">
            <strong>Total</strong>
            <b>{money.format(total)}</b>
          </div>
          <button
            className="pay-button"
            type="button"
            disabled={cart.length === 0}
            onClick={() => {
              setCartDrawerOpen(false);
              setCheckoutOpen(true);
            }}
          >
            Cobrar
            <ChevronRight aria-hidden="true" />
          </button>
          <div className="sale-extras">
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => {
                setDiscountInput(String(discountPercent || ""));
                setExtraDialog("discount");
              }}
            >
              Descuento
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => {
                setCart((current) =>
                  current.map((line) => ({ ...line, giftReceipt: true })),
                );
                notify("Todos los artículos se marcaron como regalo");
              }}
            >
              Regalo
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => setExtraDialog("layaway")}
            >
              Apartar
            </button>
          </div>
        </footer>
      </aside>

      <button
        className="mobile-cart-toggle"
        type="button"
        onClick={() => setCartDrawerOpen(true)}
      >
        <span>
          <ShoppingCart aria-hidden="true" />
          <b>{quantity}</b>
        </span>
        <strong>{quantity ? `${quantity} artículos` : "Ver carrito"}</strong>
        <b>{money.format(total)}</b>
      </button>

      {toast ? (
        <div className="pos-toast" role="status">
          <span>
            <Check aria-hidden="true" />
          </span>
          {toast}
        </div>
      ) : null}
      {status ? (
        <div className="inline-error" role="alert">
          No fue posible cargar el punto de venta. Intenta de nuevo.
        </div>
      ) : null}

      {checkoutOpen ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
          >
            <p className="kicker">Confirmar cobro</p>
            <h2 id="checkout-title">{money.format(total)}</h2>
            {saleError ? (
              <div className="field-error" role="alert">
                {saleError}
              </div>
            ) : null}
            {!cashMode && !splitMode ? (
              <>
                <p>Selecciona el método registrado en la venta.</p>
                <div className="payment-options">
                  <button
                    className="payment-cash"
                    type="button"
                    onClick={() => {
                      setSaleError("");
                      setCashMode(true);
                    }}
                  >
                    <Banknote aria-hidden="true" />
                    <strong>Efectivo</strong>
                    <small>Calcular cambio</small>
                  </button>
                  <button
                    className="payment-card"
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setSaleError("");
                      setPaymentUsed("card");
                    }}
                  >
                    <CreditCard aria-hidden="true" />
                    <strong>Tarjeta</strong>
                    <small>Terminal externa</small>
                  </button>
                  <button
                    className="payment-transfer"
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setSaleError("");
                      setPaymentUsed("transfer");
                    }}
                  >
                    <Landmark aria-hidden="true" />
                    <strong>Transferencia</strong>
                    <small>Referencia externa</small>
                  </button>
                </div>
                <button
                  className="secondary-button wide"
                  type="button"
                  onClick={() => {
                    setSaleError("");
                    setSplitMode(true);
                    setPaymentUsed("cash");
                    setPaymentReference("");
                  }}
                >
                  Dividir entre varios métodos
                </button>
              </>
            ) : splitMode ? (
              <div className="split-payment-flow">
                <p>Distribuye el total. La suma debe ser exacta.</p>
                <div className="form-stack">
                  <label>
                    <span>Efectivo</span>
                    <input
                      inputMode="decimal"
                      value={splitCash}
                      onChange={(event) => setSplitCash(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  <label>
                    <span>Tarjeta</span>
                    <input
                      inputMode="decimal"
                      value={splitCard}
                      onChange={(event) => setSplitCard(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  {Number(splitCard) > 0 ? (
                    <label>
                      <span>Referencia de terminal</span>
                      <input
                        value={splitCardReference}
                        onChange={(event) =>
                          setSplitCardReference(event.target.value)
                        }
                      />
                    </label>
                  ) : null}
                  <label>
                    <span>Transferencia</span>
                    <input
                      inputMode="decimal"
                      value={splitTransfer}
                      onChange={(event) => setSplitTransfer(event.target.value)}
                      placeholder="0.00"
                    />
                  </label>
                  {Number(splitTransfer) > 0 ? (
                    <label>
                      <span>Referencia de transferencia</span>
                      <input
                        value={splitTransferReference}
                        onChange={(event) =>
                          setSplitTransferReference(event.target.value)
                        }
                      />
                    </label>
                  ) : null}
                </div>
                <button
                  className="primary-button wide"
                  type="button"
                  disabled={submitting}
                  onClick={completeSplitSale}
                >
                  Confirmar pago combinado
                </button>
              </div>
            ) : (
              <div className="cash-keypad-flow">
                <div className="cash-display">
                  <span>Recibido</span>
                  <strong>{money.format(cashTendered)}</strong>
                  <small className={cashTendered >= total ? "enough" : ""}>
                    {cashTendered >= total
                      ? `Cambio: ${money.format(change)}`
                      : `Faltan ${money.format(total - cashTendered)}`}
                  </small>
                </div>
                <div className="cash-keypad">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map(
                    (key) => (
                      <button
                        type="button"
                        key={key}
                        onClick={() => appendCashKey(key)}
                      >
                        {key}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    aria-label="Borrar último dígito"
                    onClick={() => appendCashKey("backspace")}
                  >
                    <Delete aria-hidden="true" />
                  </button>
                  <button
                    className="exact-key"
                    type="button"
                    onClick={() => appendCashKey("exact")}
                  >
                    Exacto
                  </button>
                </div>
                <button
                  className="confirm-cash-button"
                  type="button"
                  disabled={cashTendered < total || submitting}
                  onClick={() => completeSale("cash")}
                >
                  Confirmar efectivo
                </button>
              </div>
            )}
            {!cashMode && paymentUsed !== "cash" ? (
              <div className="form-stack electronic-reference">
                <label>
                  <span>
                    Referencia de{" "}
                    {paymentUsed === "card" ? "terminal" : "transferencia"}
                  </span>
                  <input
                    value={paymentReference}
                    onChange={(event) =>
                      setPaymentReference(event.target.value)
                    }
                    placeholder="Últimos dígitos o folio"
                  />
                  <small>Escribe al menos 3 caracteres del comprobante.</small>
                </label>
                <button
                  className="primary-button wide"
                  type="button"
                  disabled={submitting}
                  onClick={() => completeSale(paymentUsed)}
                >
                  Confirmar cobro
                </button>
              </div>
            ) : null}
            <button
              className="secondary-button wide"
              type="button"
              onClick={() => {
                if (cashMode || splitMode) {
                  setCashMode(false);
                  setSplitMode(false);
                  setCashInput("");
                } else {
                  setCheckoutOpen(false);
                }
              }}
            >
              {cashMode || splitMode ? "Cambiar método" : "Volver al carrito"}
            </button>
          </section>
        </div>
      ) : null}

      {extraDialog === "discount" ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal compact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discount-title"
          >
            <p className="eyebrow">Venta en curso</p>
            <h2 id="discount-title">Aplicar descuento</h2>
            <div className="form-stack">
              <label>
                <span>Porcentaje autorizado</span>
                <input
                  inputMode="decimal"
                  value={discountInput}
                  onChange={(event) => setDiscountInput(event.target.value)}
                  placeholder="Ej. 10"
                />
              </label>
              {!preview ? (
                <>
                  <label>
                    <span>Código del supervisor</span>
                    <input
                      autoCapitalize="characters"
                      value={supervisorCode}
                      onChange={(event) =>
                        setSupervisorCode(event.target.value)
                      }
                      placeholder="Ej. ADMIN0"
                    />
                  </label>
                  <label>
                    <span>PIN del supervisor</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={supervisorPin}
                      onChange={(event) => setSupervisorPin(event.target.value)}
                    />
                  </label>
                </>
              ) : null}
              {discountError ? (
                <p className="field-error" role="alert">
                  {discountError}
                </p>
              ) : null}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setExtraDialog(null)}
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void applyDiscount()}
              >
                Autorizar y aplicar
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {extraDialog === "layaway" ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal compact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="layaway-title"
          >
            <p className="eyebrow">Apartado</p>
            <h2 id="layaway-title">Guardar apartado</h2>
            <p>
              Los artículos saldrán del carrito y quedarán asociados al cliente.
            </p>
            <div className="form-stack">
              <label>
                <span>Nombre del cliente</span>
                <input
                  value={layawayCustomer}
                  onChange={(event) => setLayawayCustomer(event.target.value)}
                  placeholder="Nombre completo"
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setExtraDialog(null)}
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={createLayaway}
              >
                Crear apartado
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {customerLookupOpen ? (
        <div className="modal-backdrop">
          <CustomerLookup
            selected={selectedCustomer}
            onSelect={setSelectedCustomer}
            onClose={() => setCustomerLookupOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
