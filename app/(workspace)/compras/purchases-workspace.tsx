"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
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
import { saveActiveLocationPreference } from "@/lib/location-preference";
import { publishWorkspaceNotification } from "@/lib/workspace-notifications";
import {
  measureQuantityStep,
  parseMeasureQuantity,
  quantityUnit,
  summarizeMeasureQuantities,
  type MeasureUnit,
} from "@/lib/measure-units";
import { PurchasePdfDialog } from "./purchase-pdf-dialog";
import {
  QuickProductForm,
  type PurchaseAttributeValue,
  type PurchaseCategory,
} from "./quick-product-form";

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
  measureUnit?: MeasureUnit;
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
    measure_unit?: MeasureUnit;
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
    measure_unit?: MeasureUnit;
  }>;
};
type Location = {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
};
type Tab = "ordenes" | "recibir" | "proveedores" | "recepciones";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const quantities = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 });
function measureSummary(
  items: Array<{ measure_unit?: MeasureUnit; qty: number }>,
) {
  return summarizeMeasureQuantities(
    items.map((item) => ({
      measureUnit: item.measure_unit,
      availableQuantity: item.qty,
      reservedQuantity: 0,
    })),
  )
    .map(
      (group) =>
        `${quantities.format(group.availableQuantity)} ${group.unit.name}`,
    )
    .join(" · ");
}
function canLabelUnit(item: { measure_unit?: MeasureUnit; qty: number }) {
  return (
    quantityUnit({ measureUnit: item.measure_unit }).decimal_places === 0 &&
    Number.isSafeInteger(item.qty) &&
    item.qty > 0
  );
}
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
  createPurchaseProductAction,
  categories,
  attributeValues,
  canCreateProducts,
  canShareSupplierPdf = false,
  prepareSupplierOrderShareAction,
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
  createPurchaseProductAction: typeof import("./actions").createPurchaseProduct;
  categories: PurchaseCategory[];
  attributeValues: PurchaseAttributeValue[];
  canCreateProducts: boolean;
  canShareSupplierPdf?: boolean;
  prepareSupplierOrderShareAction: typeof import("./actions").prepareSupplierOrderShare;
}) {
  const router = useRouter();
  const validTab = (
    ["ordenes", "recibir", "proveedores", "recepciones"] as Tab[]
  ).includes(initialTab as Tab)
    ? (initialTab as Tab)
    : "ordenes";
  const tab = validTab;

  function selectTab(nextTab: Tab) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    startNavigationProgress({ href: `${url.pathname}${url.search}` });
    router.push(`${url.pathname}${url.search}`);
  }
  const [notice, setNotice] = useState("");
  const [isPending, startTransition] = useTransition();
  const [orderOpen, setOrderOpen] = useState(false);
  const [pdfOrder, setPdfOrder] = useState<PurchaseOrderView | null>(null);
  const currentPdfOrder = orders.find((order) => order.id === pdfOrder?.id);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [orderDetails, setOrderDetails] = useState({
    supplierId: "",
    expectedAt: "",
    notes: "",
  });
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
    done?: (result: {
      ok: boolean;
      message: string;
      data?: Record<string, unknown>;
    }) => void,
  ) {
    setNotice("");
    startTransition(async () => {
      let result: {
        ok: boolean;
        message: string;
        data?: Record<string, unknown>;
      };
      try {
        result = await task();
      } catch {
        // A lost response does not prove the transaction was rolled back.
        result = {
          ok: false,
          message:
            "No pudimos confirmar la respuesta. Revisa el historial antes de repetir la operación.",
        };
      }
      setNotice(result.message);
      if (!preview && activeLocationId)
        void publishWorkspaceNotification({
          title: result.ok
            ? "Compras: operación confirmada"
            : "Revisa la operación de compras",
          message: result.message,
          locationId: activeLocationId,
          kind: result.ok ? "success" : "error",
        });
      if (result.ok) done?.(result);
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
  async function createPreviewPurchaseProduct(formData: FormData) {
    const name = String(formData.get("product_name") ?? "").trim();
    const costCents = Math.round(Number(formData.get("cost")) * 100);
    const combos = formData.getAll("variant_combo").map(String);
    const created = combos.map((combo, index) => {
      const [colorId, sizeId] = combo.split(":");
      const color = attributeValues.find((item) => item.id === colorId)?.value;
      const size = attributeValues.find((item) => item.id === sizeId)?.value;
      return {
        id: `preview-purchase-${Date.now()}-${index}`,
        name,
        sku: `Se genera-${index + 1}`,
        attributes: `${color ?? "Sin color"} · ${size ?? "Única"}`,
        costCents,
      };
    });
    return {
      ok: true,
      message: `${created.length} variantes agregadas a la orden en esta demostración.`,
      data: { variants: created },
    };
  }
  function openReceive(order: PurchaseOrderView) {
    setReceivingOrder(order);
    setReceiveQty(
      Object.fromEntries(
        order.items.map((item) => [item.id, item.remaining_qty]),
      ),
    );
    selectTab("recibir");
  }
  function printReceiptLabels(receipt: ReceiptView) {
    sessionStorage.setItem(
      "mi-tienda-label-selection",
      JSON.stringify(
        Object.fromEntries(
          receipt.items
            .filter(canLabelUnit)
            .map((item) => [item.variant_id, item.qty]),
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
            saveActiveLocationPreference(event.target.value);
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
        <p className="notice-banner operation-feedback" role="status">
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
            onClick={() => selectTab(value)}
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
                      Recibido:{" "}
                      {measureSummary(
                        order.items.map((item) => ({
                          measure_unit: item.measure_unit,
                          qty: item.received_qty,
                        })),
                      )}
                      {" · Pedido: "}
                      {measureSummary(
                        order.items.map((item) => ({
                          measure_unit: item.measure_unit,
                          qty: item.ordered_qty,
                        })),
                      )}
                      · {money.format(order.totalCents / 100)}
                    </p>
                  </div>
                  <div className="purchase-progress">
                    <span
                      style={{
                        width: `${order.items.length ? (order.items.reduce((sum, item) => sum + (item.ordered_qty ? item.received_qty / item.ordered_qty : 0), 0) / order.items.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="purchase-actions">
                    <button onClick={() => setPdfOrder(order)}>
                      PDF para proveedor
                    </button>
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
              <p>Captura de corrido según la unidad de cada producto.</p>
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
                  <span>
                    {measureSummary(
                      order.items.map((item) => ({
                        measure_unit: item.measure_unit,
                        qty: item.remaining_qty,
                      })),
                    )}{" "}
                    pendientes
                  </span>
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
                if (
                  receivingOrder.items.some(
                    (item) =>
                      parseMeasureQuantity(
                        String(receiveQty[item.id] ?? 0),
                        quantityUnit({ measureUnit: item.measure_unit }),
                        true,
                      ) === null,
                  )
                ) {
                  setNotice(
                    "Revisa las cantidades según la unidad de cada producto.",
                  );
                  return;
                }
                const labelCounts = Object.fromEntries(
                  receivingOrder.items
                    .filter((item) =>
                      canLabelUnit({
                        measure_unit: item.measure_unit,
                        qty: receiveQty[item.id] ?? 0,
                      }),
                    )
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
                    if (Object.keys(labelCounts).length)
                      startNavigationProgress({ href: "/etiquetas" });
                      router.push("/etiquetas?desde=recepcion");
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
                <p className="form-hint">
                  Al recibir, el costo se actualiza por promedio ponderado con
                  las existencias de todas las sucursales, incluidas reservas y
                  tránsito. Los costos de ventas anteriores no cambian.
                </p>
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
                      <small>
                        {item.sku} ·{" "}
                        {quantityUnit({ measureUnit: item.measure_unit }).name}
                      </small>
                    </span>
                    <span>{item.ordered_qty}</span>
                    <span>{item.received_qty}</span>
                    <input
                      aria-label={`Recibir ${item.product_name}`}
                      inputMode={
                        item.measure_unit?.decimal_places === 3
                          ? "decimal"
                          : "numeric"
                      }
                      type="number"
                      min="0"
                      max={item.remaining_qty}
                      step={measureQuantityStep(
                        quantityUnit({ measureUnit: item.measure_unit }),
                      )}
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
                    {measureSummary(receipt.items)} · {receipt.receivedByName} ·{" "}
                    {new Date(receipt.createdAt).toLocaleString("es-MX")}
                  </p>
                </div>
                {receipt.items.some(canLabelUnit) ? (
                  <Link
                    className="secondary-button"
                    href="/etiquetas?desde=recepcion"
                    onClick={() => printReceiptLabels(receipt)}
                  >
                    <Printer />
                    Imprimir etiquetas
                  </Link>
                ) : (
                  <span className="form-hint">
                    Etiquetas por pieza no aplican a esta recepción.
                  </span>
                )}
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

      {currentPdfOrder && (
        <PurchasePdfDialog
          key={`${activeLocationId}:${currentPdfOrder.id}`}
          order={currentPdfOrder}
          supplier={suppliers.find(
            (supplier) => supplier.id === currentPdfOrder.supplierId,
          )}
          location={
            locations.find((location) => location.id === activeLocationId) ?? {
              name: "",
            }
          }
          canShare={canShareSupplierPdf}
          locationId={activeLocationId}
          prepareShareAction={prepareSupplierOrderShareAction}
          onClose={() => setPdfOrder(null)}
        />
      )}
      {orderOpen && !quickProductOpen && (
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
                if (
                  orderLines.some(
                    (line) =>
                      parseMeasureQuantity(
                        String(line.qty),
                        quantityUnit(line.variant),
                      ) === null,
                  )
                ) {
                  setNotice(
                    "Revisa las cantidades según la unidad de cada producto.",
                  );
                  return;
                }
                run(
                  () =>
                    createPurchaseOrderAction({
                      supplierId: orderDetails.supplierId,
                      locationId: activeLocationId,
                      expectedAt: orderDetails.expectedAt,
                      notes: orderDetails.notes,
                      items: orderLines.map((line) => ({
                        variantId: line.variant.id,
                        qty: line.qty,
                        unitCostCents: Math.round(Number(line.cost) * 100),
                      })),
                    }),
                  () => {
                    setOrderOpen(false);
                    setOrderLines([]);
                    setOrderDetails({
                      supplierId: "",
                      expectedAt: "",
                      notes: "",
                    });
                  },
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Proveedor
                  <select
                    name="supplier"
                    value={orderDetails.supplierId}
                    onChange={(event) =>
                      setOrderDetails((current) => ({
                        ...current,
                        supplierId: event.target.value,
                      }))
                    }
                    required
                  >
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
                  <input
                    type="date"
                    name="expectedAt"
                    value={orderDetails.expectedAt}
                    onChange={(event) =>
                      setOrderDetails((current) => ({
                        ...current,
                        expectedAt: event.target.value,
                      }))
                    }
                  />
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
              {canCreateProducts ? (
                <button
                  className="quick-create-product"
                  type="button"
                  onClick={() => setQuickProductOpen(true)}
                >
                  <Plus />
                  ¿No aparece? Crear producto nuevo sin salir de la orden
                </button>
              ) : null}
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
                      Cantidad · {quantityUnit(line.variant).name}
                      <input
                        type="number"
                        inputMode={
                          line.variant.measureUnit?.decimal_places === 3
                            ? "decimal"
                            : "numeric"
                        }
                        min={measureQuantityStep(quantityUnit(line.variant))}
                        step={measureQuantityStep(quantityUnit(line.variant))}
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
                      Costo por{" "}
                      {quantityUnit(line.variant).name.toLocaleLowerCase(
                        "es-MX",
                      )}
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
                <textarea
                  name="notes"
                  rows={2}
                  value={orderDetails.notes}
                  onChange={(event) =>
                    setOrderDetails((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
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

      {quickProductOpen ? (
        <QuickProductForm
          categories={categories}
          attributeValues={attributeValues}
          action={
            preview ? createPreviewPurchaseProduct : createPurchaseProductAction
          }
          onCancel={() => setQuickProductOpen(false)}
          onCreated={(created, message) => {
            setOrderLines((current) => {
              const known = new Set(current.map((line) => line.variant.id));
              return [
                ...current,
                ...created
                  .filter((variant) => !known.has(variant.id))
                  .map((variant) => ({
                    variant,
                    qty: 1,
                    cost: (variant.costCents / 100).toFixed(2),
                  })),
              ];
            });
            setNotice(message);
            setQuickProductOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
