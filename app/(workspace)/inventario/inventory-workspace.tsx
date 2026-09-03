"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  ClipboardCheck,
  History,
  MapPin,
  PackageOpen,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import type { InventoryItem, InventoryMovement } from "@/lib/domain";

type Location = { id: string; name: string; code: string };

const statusMessages: Record<
  string,
  { title: string; copy: string; tone?: string }
> = {
  "inventario-ajustado": {
    title: "Existencia actualizada",
    copy: "El ajuste y su motivo quedaron registrados en el historial.",
  },
  "inventario-sin-cambios": {
    title: "El conteo coincide",
    copy: "No fue necesario crear un movimiento de inventario.",
  },
  "inventario-desactualizado": {
    title: "La existencia cambió mientras contabas",
    copy: "Revisa la cantidad actual y vuelve a capturar el conteo.",
    tone: "error",
  },
  "inventario-reservado": {
    title: "No se puede bajar a esa cantidad",
    copy: "Hay piezas reservadas. Libera la reserva o revisa el conteo.",
    tone: "error",
  },
  "inventario-sin-permiso": {
    title: "No tienes permiso para ajustar",
    copy: "El intento no modificó el inventario.",
    tone: "error",
  },
  "inventario-datos-invalidos": {
    title: "Revisa el conteo y el motivo",
    copy: "No se guardó ningún cambio.",
    tone: "error",
  },
  "inventario-no-disponible": {
    title: "Inventario temporalmente no disponible",
    copy: "No mostramos cantidades simuladas. Intenta de nuevo en unos momentos.",
    tone: "error",
  },
  "inventario-sin-sucursal": {
    title: "No tienes una sucursal asignada",
    copy: "Un administrador debe asignarte una ubicación para consultar inventario.",
    tone: "error",
  },
  "inventario-error": {
    title: "No fue posible guardar el ajuste",
    copy: "Revisa los datos e intenta nuevamente.",
    tone: "error",
  },
};

const movementLabels: Record<string, string> = {
  INITIAL_IMPORT: "Carga inicial",
  SALE: "Venta",
  RETURN: "Devolución",
  PURCHASE: "Recepción",
  TRANSFER_OUT: "Salida por traspaso",
  TRANSFER_IN: "Entrada por traspaso",
  ADJUSTMENT: "Ajuste",
  CANCELLATION: "Cancelación",
  COUNT: "Conteo",
};

const quantityFormatter = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 3,
});
const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatQuantity(value: number) {
  return quantityFormatter.format(value);
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function variantDescription(item: InventoryItem) {
  const values = Object.values(item.attributes).filter(Boolean);
  return values.length ? values.join(" · ") : "Variante única";
}

export function InventoryWorkspace({
  items,
  movements,
  locations,
  activeLocationId,
  canAdjust = false,
  adjustmentAction,
  status,
  preview = false,
}: {
  items: InventoryItem[];
  movements: InventoryMovement[];
  locations: Location[];
  activeLocationId: string;
  canAdjust?: boolean;
  adjustmentAction?: (formData: FormData) => void | Promise<void>;
  status?: string;
  preview?: boolean;
}) {
  const [showMovements, setShowMovements] = useState(false);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const activeLocation = locations.find(
    (location) => location.id === activeLocationId,
  );
  const availableUnits = items.reduce(
    (total, item) => total + item.availableQuantity,
    0,
  );
  const reservedUnits = items.reduce(
    (total, item) => total + item.reservedQuantity,
    0,
  );
  const filteredItems = useMemo(() => {
    const term = deferredQuery.trim().toLocaleLowerCase("es-MX");
    return items.filter((item) => {
      const matchesText =
        !term ||
        [
          item.productName,
          item.brand,
          item.code,
          item.sku,
          ...Object.values(item.attributes),
        ]
          .join(" ")
          .toLocaleLowerCase("es-MX")
          .includes(term);
      const matchesStatus =
        filter === "all" ||
        (filter === "available" && item.availableQuantity > 1) ||
        (filter === "last" && item.availableQuantity === 1) ||
        (filter === "out" && item.availableQuantity <= 0);
      return matchesText && matchesStatus;
    });
  }, [deferredQuery, filter, items]);
  const message = status ? statusMessages[status] : undefined;

  return (
    <section className="module-page inventory-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{activeLocation?.name ?? "Sin sucursal"}</p>
          <h1>Inventario</h1>
          <p className="heading-copy">
            Existencias reales por variante y sucursal.
          </p>
        </div>
        <div className="heading-actions inventory-heading-actions">
          {locations.length > 1 ? (
            <label className="inventory-location-picker">
              <MapPin aria-hidden="true" />
              <span className="sr-only">Sucursal</span>
              <select
                value={activeLocationId}
                onChange={(event) =>
                  window.location.assign(
                    `/inventario?ubicacion=${encodeURIComponent(event.target.value)}`,
                  )
                }
              >
                {locations.map((location) => (
                  <option value={location.id} key={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            onClick={() => setShowMovements(true)}
          >
            <History aria-hidden="true" />
            Ver movimientos
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={`inventory-feedback ${message.tone ?? "success"}`}
          role="status"
        >
          <strong>{message.title}</strong>
          <span>{message.copy}</span>
        </div>
      ) : null}

      <div className="summary-grid inventory-summary">
        <article>
          <span>Disponibles para vender</span>
          <strong>{formatQuantity(availableUnits)}</strong>
        </article>
        <article>
          <span>Piezas reservadas</span>
          <strong>{formatQuantity(reservedUnits)}</strong>
        </article>
        <article>
          <span>Variantes agotadas</span>
          <strong>
            {items.filter((item) => item.availableQuantity <= 0).length}
          </strong>
        </article>
      </div>

      <div className="notice inventory-notice">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Inventario auditable</strong>
          <span>
            Cada corrección conserva la cantidad anterior, la nueva, el motivo y
            la persona que la realizó.
          </span>
        </div>
      </div>

      <div className="catalog-toolbar">
        <label className="toolbar-search">
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar producto, variante o código"
            aria-label="Buscar inventario"
          />
        </label>
        <div className="filter-pills" aria-label="Filtrar inventario">
          {[
            ["all", "Todos"],
            ["available", "Disponible"],
            ["last", "Última"],
            ["out", "Agotado"],
          ].map(([value, label]) => (
            <button
              className={filter === value ? "selected" : ""}
              type="button"
              onClick={() => setFilter(value)}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="data-table inventory-table">
        <div className="table-row inventory-row table-header">
          <span>Producto</span>
          <span>Código</span>
          <span>Variante</span>
          <span>Disponible</span>
          <span>Físico</span>
          <span>Acción</span>
        </div>
        {filteredItems.map((item) => {
          const tone =
            item.availableQuantity <= 0
              ? "out"
              : item.availableQuantity === 1
                ? "low"
                : "good";
          return (
            <div className="table-row inventory-row" key={item.variantId}>
              <div className="table-product" data-label="Producto">
                <span className="table-product-image">
                  <PackageOpen aria-hidden="true" />
                </span>
                <strong>
                  {item.productName}
                  <small>{item.brand}</small>
                </strong>
              </div>
              <code data-label="Código">{item.code}</code>
              <span data-label="Variante">{variantDescription(item)}</span>
              <span data-label="Disponible" className={`stock-number ${tone}`}>
                {formatQuantity(item.availableQuantity)}
              </span>
              <span data-label="Físico">
                {formatQuantity(item.quantity)}
                {item.reservedQuantity > 0 ? (
                  <small className="inventory-reserved">
                    {formatQuantity(item.reservedQuantity)} reservadas
                  </small>
                ) : null}
              </span>
              <span data-label="Acción">
                {canAdjust ? (
                  <button
                    className="table-edit-button inventory-adjust-button"
                    type="button"
                    onClick={() => setAdjusting(item)}
                  >
                    <ClipboardCheck aria-hidden="true" />
                    Contar
                  </button>
                ) : (
                  <span className="inventory-read-only">Sólo consulta</span>
                )}
              </span>
            </div>
          );
        })}
        {filteredItems.length === 0 ? (
          <div className="inventory-empty">
            <PackageOpen aria-hidden="true" />
            <strong>No encontramos variantes</strong>
            <span>
              {items.length
                ? "Prueba otro filtro o búsqueda."
                : "Aún no hay productos para mostrar."}
            </span>
          </div>
        ) : null}
      </div>

      {preview ? (
        <p className="inventory-preview-note">
          Vista de demostración: los cambios se habilitan al conectar Supabase.
        </p>
      ) : null}

      {adjusting ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal inventory-adjust-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-adjust-title"
          >
            <header className="modal-heading">
              <div>
                <p className="eyebrow">Conteo físico</p>
                <h2 id="inventory-adjust-title">{adjusting.productName}</h2>
                <p>{variantDescription(adjusting)}</p>
              </div>
              <button
                type="button"
                aria-label="Cerrar ajuste"
                onClick={() => setAdjusting(null)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <form action={adjustmentAction} className="inventory-adjust-form">
              <input
                type="hidden"
                name="variant_id"
                value={adjusting.variantId}
              />
              <input
                type="hidden"
                name="location_id"
                value={activeLocationId}
              />
              <input
                type="hidden"
                name="expected_quantity"
                value={adjusting.quantity}
              />
              <div className="inventory-current-balance">
                <span>Existencia registrada</span>
                <strong>{formatQuantity(adjusting.quantity)}</strong>
                {adjusting.reservedQuantity > 0 ? (
                  <small>
                    Incluye {formatQuantity(adjusting.reservedQuantity)}{" "}
                    reservadas
                  </small>
                ) : null}
              </div>
              <label>
                <span>¿Cuántas piezas contaste?</span>
                <input
                  name="counted_quantity"
                  type="number"
                  min="0"
                  max="999999999.999"
                  step="0.001"
                  inputMode="decimal"
                  defaultValue={adjusting.quantity}
                  required
                />
              </label>
              <label>
                <span>Motivo</span>
                <select name="reason" defaultValue="CONTEO_FISICO" required>
                  <option value="CONTEO_FISICO">Conteo físico</option>
                  <option value="MERMA">Merma</option>
                  <option value="ROBO">Robo</option>
                  <option value="DAÑO">Producto dañado</option>
                  <option value="ERROR_CAPTURA">Error de captura</option>
                  <option value="MUESTRA">Producto de muestra</option>
                  <option value="DEVOLUCION_PROVEEDOR">
                    Devolución a proveedor
                  </option>
                </select>
              </label>
              <label>
                <span>Nota opcional</span>
                <textarea
                  name="note"
                  maxLength={500}
                  placeholder="Agrega un detalle que ayude a entender el ajuste"
                />
              </label>
              <p className="inventory-adjust-warning">
                Guardar no reemplaza el historial: crea un movimiento con tu
                usuario, fecha y motivo.
              </p>
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setAdjusting(null)}
                >
                  Cancelar
                </button>
                <button className="primary-button" type="submit">
                  Guardar conteo
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showMovements ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal movement-modal inventory-movement-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-movements-title"
          >
            <header className="modal-heading">
              <div>
                <p className="eyebrow">Auditoría · {activeLocation?.name}</p>
                <h2 id="inventory-movements-title">Movimientos recientes</h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar movimientos"
                onClick={() => setShowMovements(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="movement-list">
              {movements.map((item) => (
                <article key={item.id}>
                  <span
                    className={
                      item.quantity > 0
                        ? "movement-kind income"
                        : "movement-kind outcome"
                    }
                  >
                    {item.quantity > 0 ? (
                      <ArrowDownLeft aria-hidden="true" />
                    ) : (
                      <ArrowUpRight aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <strong>{item.productName}</strong>
                    <small>
                      {movementLabels[item.type] ?? item.type} · {item.sku} ·{" "}
                      {formatDate(item.occurredAt)}
                    </small>
                    <small>
                      {item.userName} · {item.referenceId}
                    </small>
                  </div>
                  <b className={item.quantity > 0 ? "positive" : "negative"}>
                    {item.quantity > 0 ? "+" : ""}
                    {formatQuantity(item.quantity)}
                  </b>
                </article>
              ))}
              {movements.length === 0 ? (
                <div className="inventory-empty compact">
                  <History aria-hidden="true" />
                  <strong>Aún no hay movimientos</strong>
                  <span>El primer ajuste aparecerá aquí.</span>
                </div>
              ) : null}
            </div>
            <button
              className="secondary-button wide"
              type="button"
              onClick={() => setShowMovements(false)}
            >
              Cerrar
            </button>
          </section>
        </div>
      ) : null}
    </section>
  );
}
