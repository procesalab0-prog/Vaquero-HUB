"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  ClipboardList,
  PackageCheck,
  Plus,
  Printer,
  Search,
  Truck,
  X,
} from "lucide-react";

export type SupplierView = {
  id: string;
  code: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  taxId: string;
  notes: string;
  isActive: boolean;
};
export type VariantView = {
  id: string;
  name: string;
  sku: string;
  attributes: string;
  costCents: number;
};
export type PurchaseOrderView = {
  id: string;
  folio: number;
  status: "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  supplierId: string;
  supplierName: string;
  expectedAt: string | null;
  notes: string | null;
  createdAt: string;
  orderedQty: number;
  receivedQty: number;
  totalCents: number;
  items: Array<{
    id: string;
    variant_id: string;
    sku: string;
    product_name: string;
    ordered_qty: number;
    received_qty: number;
    remaining_qty: number;
    unit_cost_cents: number;
  }>;
};
export type ReceiptView = {
  id: string;
  folio: number;
  orderId: string;
  orderFolio: number;
  supplierName: string;
  receivedByName: string;
  createdAt: string;
  items: Array<{
    variant_id: string;
    sku: string;
    product_name: string;
    qty: number;
    unit_cost_cents: number;
  }>;
};
type Location = { id: string; name: string; code: string };
type Tab = "ordenes" | "recibir" | "proveedores" | "recepciones";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const statusLabels = {
  ORDERED: "Pendiente",
  PARTIALLY_RECEIVED: "Recepción parcial",
  RECEIVED: "Recibida",
  CANCELLED: "Cancelada",
};

export function PurchasesWorkspace({
  suppliers,
  orders,
  receipts,
  variants,
  locations,
  activeLocationId,
  canManage,
  canReceive,
  initialTab,
  preview = false,
  saveSupplierAction,
  createPurchaseOrderAction,
  receivePurchaseOrderAction,
  cancelPurchaseOrderAction,
}: {
  suppliers: SupplierView[];
  orders: PurchaseOrderView[];
  receipts: ReceiptView[];
  variants: VariantView[];
  locations: Location[];
  activeLocationId: string;
  canManage: boolean;
  canReceive: boolean;
  initialTab?: string;
  preview?: boolean;
  saveSupplierAction: typeof import("./actions").saveSupplier;
  createPurchaseOrderAction: typeof import("./actions").createPurchaseOrder;
  receivePurchaseOrderAction: typeof import("./actions").receivePurchaseOrder;
  cancelPurchaseOrderAction: typeof import("./actions").cancelPurchaseOrder;
}) {
  const validTab = (
    ["ordenes", "recibir", "proveedores", "recepciones"] as Tab[]
  ).includes(initialTab as Tab)
    ? (initialTab as Tab)
    : "ordenes";
  const [tab, setTab] = useState<Tab>(validTab);
  const [notice, setNotice] = useState("");
  const [isPending, startTransition] = useTransition();
  const [orderOpen, setOrderOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [orderLines, setOrderLines] = useState<
    Array<{ variant: VariantView; qty: number; cost: string }>
  >([]);
  const [receivingOrder, setReceivingOrder] =
    useState<PurchaseOrderView | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);
  const openOrders = orders.filter(
    (order) =>
      order.status === "ORDERED" || order.status === "PARTIALLY_RECEIVED",
  );
  const filteredVariants = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return needle
      ? variants
          .filter((variant) =>
            `${variant.name} ${variant.sku} ${variant.attributes}`
              .toLowerCase()
              .includes(needle),
          )
          .slice(0, 12)
      : [];
  }, [query, variants]);

  function run(
    task: () => Promise<{
      ok: boolean;
      message: string;
      data?: Record<string, unknown>;
    }>,
    done?: () => void,
  ) {
    setNotice("");
    startTransition(async () => {
      const result = await task();
      setNotice(result.message);
      if (result.ok) done?.();
    });
  }
  function addVariant(variant: VariantView) {
    setOrderLines((current) =>
      current.some((line) => line.variant.id === variant.id)
        ? current
        : [
            ...current,
            {
              variant,
              qty: 1,
              cost: variant.costCents
                ? (variant.costCents / 100).toFixed(2)
                : "",
            },
          ],
    );
    setQuery("");
  }
  function openReceive(order: PurchaseOrderView) {
    setReceivingOrder(order);
    setReceiveQty(
      Object.fromEntries(
        order.items.map((item) => [item.id, item.remaining_qty]),
      ),
    );
    setTab("recibir");
  }
  function printReceiptLabels(receipt: ReceiptView) {
    sessionStorage.setItem(
      "mi-tienda-label-selection",
      JSON.stringify(
        Object.fromEntries(
          receipt.items.map((item) => [item.variant_id, item.qty]),
        ),
      ),
    );
  }

  return (
    <section className="module-page purchases-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Inventario que sí cuadra</p>
          <h1>Compras y recepción</h1>
          <p className="heading-copy">
            Crea la orden primero. La existencia sólo cambia cuando confirmas lo
            que llegó.
          </p>
        </div>
        <select
          aria-label="Sucursal"
          value={activeLocationId}
          onChange={(event) => {
            location.href = `/compras?ubicacion=${event.target.value}&tab=${tab}`;
          }}
        >
          {locations.map((location) => (
            <option value={location.id} key={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </div>
      {preview && (
        <p className="notice-banner">
          Vista de demostración: conecta Supabase para guardar.
        </p>
      )}
      {notice && (
        <p className="notice-banner" role="status">
          {notice}
        </p>
      )}
      <div className="purchase-tabs" role="tablist" aria-label="Compras">
        {(
          [
            ["ordenes", "Órdenes", ClipboardList],
            ["recibir", "Recibir", PackageCheck],
            ["proveedores", "Proveedores", Truck],
            ["recepciones", "Historial", Check],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
            role="tab"
            aria-selected={tab === value}
            key={value}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === "ordenes" && (
        <div className="purchase-section">
          <div className="purchase-toolbar">
            <div>
              <h2>Órdenes de compra</h2>
              <p>{openOrders.length} con mercancía pendiente</p>
            </div>
            {canManage && (
              <button
                className="primary-button"
                onClick={() => setOrderOpen(true)}
              >
                <Plus />
                Nueva orden
              </button>
            )}
          </div>
          <div className="purchase-list">
            {orders.length ? (
              orders.map((order) => (
                <article className="purchase-card" key={order.id}>
                  <div>
                    <span
                      className={`purchase-status ${order.status.toLowerCase()}`}
                    >
                      {statusLabels[order.status]}
                    </span>
                    <h3>
                      Orden #{order.folio} · {order.supplierName}
                    </h3>
                    <p>
                      {order.receivedQty} de {order.orderedQty} piezas recibidas
                      · {money.format(order.totalCents / 100)}
                    </p>
                  </div>
                  <div className="purchase-progress">
                    <span
                      style={{
                        width: `${order.orderedQty ? (order.receivedQty / order.orderedQty) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="purchase-actions">
                    {canReceive &&
                      (order.status === "ORDERED" ||
                        order.status === "PARTIALLY_RECEIVED") && (
                        <button onClick={() => openReceive(order)}>
                          Recibir mercancía
                        </button>
                      )}
                    {canManage && order.status === "ORDERED" && (
                      <button
                        className="text-danger"
                        onClick={() => {
                          const reason = prompt("Motivo de cancelación");
                          if (reason)
                            run(() =>
                              cancelPurchaseOrderAction({
                                orderId: order.id,
                                reason,
                              }),
                            );
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <PackageCheck />
                <h3>Aún no hay órdenes</h3>
                <p>
                  La primera orden no moverá inventario hasta que registres la
                  recepción.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "recibir" && (
        <div className="purchase-section">
          <div className="purchase-toolbar">
            <div>
              <h2>Recepción rápida</h2>
              <p>Captura de corrido; las cantidades son piezas enteras.</p>
            </div>
          </div>
          {!receivingOrder ? (
            <div className="purchase-list">
              {openOrders.map((order) => (
                <button
                  className="purchase-order-picker"
                  onClick={() => openReceive(order)}
                  key={order.id}
                >
                  <span>
                    <strong>Orden #{order.folio}</strong>
                    <small>{order.supplierName}</small>
                  </span>
                  <span>{order.orderedQty - order.receivedQty} pendientes</span>
                </button>
              ))}
              {!openOrders.length && (
                <div className="empty-state">
                  <Check />
                  <h3>No hay mercancía pendiente</h3>
                </div>
              )}
            </div>
          ) : (
            <form
              className="receive-sheet"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const received = receivingOrder.items
                  .map((item) => ({
                    purchaseItemId: item.id,
                    qty: receiveQty[item.id] ?? 0,
                  }))
                  .filter((item) => item.qty > 0);
                const labelCounts = Object.fromEntries(
                  receivingOrder.items
                    .filter((item) => (receiveQty[item.id] ?? 0) > 0)
                    .map((item) => [item.variant_id, receiveQty[item.id]]),
                );
                run(
                  () =>
                    receivePurchaseOrderAction({
                      orderId: receivingOrder.id,
                      idempotencyKey: crypto.randomUUID(),
                      notes: String(form.get("notes") ?? ""),
                      items: received,
                    }),
                  () => {
                    sessionStorage.setItem(
                      "mi-tienda-label-selection",
                      JSON.stringify(labelCounts),
                    );
                    setReceivingOrder(null);
                    setReceiveQty({});
                  },
                );
              }}
            >
              <div className="receive-heading">
                <div>
                  <button type="button" onClick={() => setReceivingOrder(null)}>
                    ← Cambiar orden
                  </button>
                  <h3>
                    Orden #{receivingOrder.folio} ·{" "}
                    {receivingOrder.supplierName}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setReceiveQty(
                      Object.fromEntries(
                        receivingOrder.items.map((item) => [
                          item.id,
                          item.remaining_qty,
                        ]),
                      ),
                    )
                  }
                >
                  Recibir todo pendiente
                </button>
              </div>
              <div className="receive-table">
                <div className="receive-row receive-header">
                  <span>Producto</span>
                  <span>Pedido</span>
                  <span>Ya llegó</span>
                  <span>Recibo hoy</span>
                </div>
                {receivingOrder.items.map((item) => (
                  <label className="receive-row" key={item.id}>
                    <span>
                      <strong>{item.product_name}</strong>
                      <small>{item.sku}</small>
                    </span>
                    <span>{item.ordered_qty}</span>
                    <span>{item.received_qty}</span>
                    <input
                      inputMode="numeric"
                      type="number"
                      min="0"
                      max={item.remaining_qty}
                      step="1"
                      value={receiveQty[item.id] ?? 0}
                      onChange={(event) =>
                        setReceiveQty((current) => ({
                          ...current,
                          [item.id]: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <label>
                Nota de recepción
                <textarea name="notes" rows={2} />
              </label>
              <button
                className="primary-button receive-submit"
                disabled={isPending}
              >
                {isPending ? "Guardando…" : "Confirmar recepción e inventario"}
              </button>
            </form>
          )}
        </div>
      )}

      {tab === "proveedores" && (
        <div className="purchase-section">
          <div className="purchase-toolbar">
            <div>
              <h2>Proveedores</h2>
              <p>{activeSuppliers.length} activos</p>
            </div>
            {canManage && (
              <button
                className="primary-button"
                onClick={() => setSupplierOpen(true)}
              >
                <Plus />
                Agregar proveedor
              </button>
            )}
          </div>
          <div className="supplier-grid">
            {suppliers.map((supplier) => (
              <article className="supplier-card" key={supplier.id}>
                <span>{supplier.code}</span>
                <h3>{supplier.name}</h3>
                <p>
                  {supplier.contactName || "Sin contacto"}
                  {supplier.phone ? ` · ${supplier.phone}` : ""}
                </p>
                {supplier.email && (
                  <a href={`mailto:${supplier.email}`}>{supplier.email}</a>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "recepciones" && (
        <div className="purchase-section">
          <div className="purchase-toolbar">
            <div>
              <h2>Recepciones</h2>
              <p>Quién recibió, cuándo y qué entró.</p>
            </div>
          </div>
          <div className="purchase-list">
            {receipts.map((receipt) => (
              <article className="purchase-card" key={receipt.id}>
                <div>
                  <span className="purchase-status received">
                    Recepción #{receipt.folio}
                  </span>
                  <h3>
                    Orden #{receipt.orderFolio} · {receipt.supplierName}
                  </h3>
                  <p>
                    {receipt.items.reduce((sum, item) => sum + item.qty, 0)}{" "}
                    piezas · {receipt.receivedByName} ·{" "}
                    {new Date(receipt.createdAt).toLocaleString("es-MX")}
                  </p>
                </div>
                <Link
                  className="secondary-button"
                  href="/etiquetas?desde=recepcion"
                  onClick={() => printReceiptLabels(receipt)}
                >
                  <Printer />
                  Imprimir etiquetas
                </Link>
              </article>
            ))}
            {!receipts.length && (
              <div className="empty-state">
                <PackageCheck />
                <h3>Aún no hay recepciones</h3>
              </div>
            )}
          </div>
        </div>
      )}

      {orderOpen && (
        <div className="modal-backdrop">
          <div
            className="purchase-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Nueva orden"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Sin mover inventario</p>
                <h2>Nueva orden</h2>
              </div>
              <button onClick={() => setOrderOpen(false)} aria-label="Cerrar">
                <X />
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                run(
                  () =>
                    createPurchaseOrderAction({
                      supplierId: String(form.get("supplier")),
                      locationId: activeLocationId,
                      expectedAt: String(form.get("expectedAt")),
                      notes: String(form.get("notes")),
                      items: orderLines.map((line) => ({
                        variantId: line.variant.id,
                        qty: line.qty,
                        unitCostCents: Math.round(Number(line.cost) * 100),
                      })),
                    }),
                  () => {
                    setOrderOpen(false);
                    setOrderLines([]);
                  },
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Proveedor
                  <select name="supplier" required>
                    <option value="">Selecciona</option>
                    {activeSuppliers.map((supplier) => (
                      <option value={supplier.id} key={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fecha estimada
                  <input type="date" name="expectedAt" />
                </label>
              </div>
              <label>
                Buscar producto
                <div className="purchase-search">
                  <Search />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Nombre, SKU, talla o color"
                  />
                </div>
              </label>
              {filteredVariants.length > 0 && (
                <div className="variant-results">
                  {filteredVariants.map((variant) => (
                    <button
                      type="button"
                      onClick={() => addVariant(variant)}
                      key={variant.id}
                    >
                      <span>
                        <strong>{variant.name}</strong>
                        <small>
                          {variant.sku} · {variant.attributes}
                        </small>
                      </span>
                      <Plus />
                    </button>
                  ))}
                </div>
              )}
              <div className="order-lines">
                {orderLines.map((line, index) => (
                  <div className="order-line" key={line.variant.id}>
                    <span>
                      <strong>{line.variant.name}</strong>
                      <small>
                        {line.variant.sku} · {line.variant.attributes}
                      </small>
                    </span>
                    <label>
                      Piezas
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={line.qty}
                        onChange={(event) =>
                          setOrderLines((current) =>
                            current.map((candidate, i) =>
                              i === index
                                ? {
                                    ...candidate,
                                    qty: Number(event.target.value),
                                  }
                                : candidate,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Costo por pieza
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={line.cost}
                        onChange={(event) =>
                          setOrderLines((current) =>
                            current.map((candidate, i) =>
                              i === index
                                ? { ...candidate, cost: event.target.value }
                                : candidate,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      aria-label="Quitar"
                      onClick={() =>
                        setOrderLines((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <X />
                    </button>
                  </div>
                ))}
              </div>
              <label>
                Notas
                <textarea name="notes" rows={2} />
              </label>
              <button
                className="primary-button receive-submit"
                disabled={isPending || !orderLines.length}
              >
                {isPending ? "Creando…" : "Crear orden"}
              </button>
            </form>
          </div>
        </div>
      )}

      {supplierOpen && (
        <div className="modal-backdrop">
          <div
            className="purchase-modal compact"
            role="dialog"
            aria-modal="true"
            aria-label="Nuevo proveedor"
          >
            <div className="modal-heading">
              <h2>Nuevo proveedor</h2>
              <button
                onClick={() => setSupplierOpen(false)}
                aria-label="Cerrar"
              >
                <X />
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                run(
                  () =>
                    saveSupplierAction({
                      code: String(form.get("code")),
                      name: String(form.get("name")),
                      contactName: String(form.get("contact")),
                      phone: String(form.get("phone")),
                      email: String(form.get("email")),
                      taxId: String(form.get("taxId")),
                      notes: String(form.get("notes")),
                    }),
                  () => setSupplierOpen(false),
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Código
                  <input
                    name="code"
                    required
                    maxLength={32}
                    placeholder="LEON"
                  />
                </label>
                <label>
                  Nombre
                  <input name="name" required maxLength={160} />
                </label>
                <label>
                  Contacto
                  <input name="contact" />
                </label>
                <label>
                  Teléfono
                  <input name="phone" inputMode="tel" />
                </label>
                <label>
                  Correo
                  <input name="email" type="email" />
                </label>
                <label>
                  RFC
                  <input name="taxId" />
                </label>
              </div>
              <label>
                Notas
                <textarea name="notes" rows={2} />
              </label>
              <button
                className="primary-button receive-submit"
                disabled={isPending}
              >
                {isPending ? "Guardando…" : "Guardar proveedor"}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
