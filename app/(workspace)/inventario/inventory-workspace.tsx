"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import type {
  InventoryCatalog,
  InventoryCatalogLookup,
} from "@/lib/inventory-catalog";
import {
  useInventoryCatalog,
  InventoryPagination,
} from "./inventory-catalog-browser";
import { groupInventory } from "@/lib/inventory-groups";
import {
  measureQuantityStep,
  parseMeasureQuantity,
  quantityUnit,
} from "@/lib/measure-units";

import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  ClipboardCheck,
  History,
  MapPin,
  PackageOpen,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import type {
  InventoryCount,
  InventoryItem,
  InventoryMovement,
  InventoryTransfer,
} from "@/lib/domain";
import { useWorkspace } from "@/components/workspace-context";
import { saveActiveLocationPreference } from "@/lib/location-preference";
import { TransferProgress } from "./transfer-progress";

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
  "inventario-cantidad-invalida": {
    title: "Revisa la cantidad y su unidad",
    copy: "Piezas y pares requieren enteros; las unidades fraccionarias admiten hasta tres decimales. No se guardó ningún cambio.",
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
  "conteo-creado": {
    title: "Conteo iniciado",
    copy: "Ya puedes capturar las cantidades físicas.",
  },
  "conteo-capturado": {
    title: "Cantidad guardada",
    copy: "La pieza quedó incluida en el conteo.",
  },
  "conteo-cerrado": {
    title: "Conteo cerrado",
    copy: "Las diferencias quedaron aplicadas y auditadas.",
  },
  "conteo-cerrado-con-avisos": {
    title: "Conteo cerrado con avisos",
    copy: "Hubo movimientos mientras se contaba. Revisa los renglones marcados.",
    tone: "error",
  },
  "conteo-cancelado": {
    title: "Conteo cancelado",
    copy: "No se modificó ninguna existencia.",
  },
  "traspaso-creado": {
    title: "Traspaso solicitado",
    copy: "Está listo para autorización.",
  },
  "traspaso-aprobado": {
    title: "Traspaso aprobado",
    copy: "El origen ya puede preparar la mercancía.",
  },
  "traspaso-preparado": {
    title: "Traspaso preparado",
    copy: "Revisa las cantidades antes de enviarlo.",
  },
  "traspaso-en-transito": {
    title: "Mercancía en tránsito",
    copy: "Ya salió del origen y todavía no está disponible en el destino.",
  },
  "traspaso-recibido": {
    title: "Traspaso recibido",
    copy: "Las cantidades recibidas ya están disponibles en el destino.",
  },
  "traspaso-cancelado": {
    title: "Traspaso cancelado",
    copy: "No se movió inventario.",
  },
  "inventario-separacion-funciones": {
    title: "Se requiere otra persona",
    copy: "Quien aprobó o envió el traspaso no puede recibirlo. Debe confirmarlo otra persona autorizada en la sucursal destino.",
    tone: "error",
  },
  "inventario-sin-existencia": {
    title: "Existencia insuficiente",
    copy: "El origen ya no tiene todas las piezas preparadas.",
    tone: "error",
  },
  "inventario-operacion-invalida": {
    title: "La operación ya no es válida",
    copy: "Actualiza la pantalla y revisa el estado del documento.",
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

const countStatus: Record<InventoryCount["status"], string> = {
  OPEN: "Abierto",
  COUNTING: "En captura",
  CLOSED: "Cerrado",
  CANCELLED: "Cancelado",
};

const transferStatus: Record<InventoryTransfer["status"], string> = {
  REQUESTED: "Solicitado",
  APPROVED: "Aprobado",
  PREPARED: "Preparado",
  IN_TRANSIT: "En tránsito",
  RECEIVED: "Recibido",
  CANCELLED: "Cancelado",
};

type ServerAction = (formData: FormData) => void | Promise<void>;
type CountActionResult = {
  ok: boolean;
  status: string;
  variantId?: string;
  countedQuantity?: number;
};
type InlineCountAction = (formData: FormData) => Promise<CountActionResult>;

function ContinuousCountCapture({
  action,
  count,
  items,
  locationId,
  closeAction,
  cancelAction,
  catalog,
  lookupCatalog,
}: {
  action?: InlineCountAction;
  count: InventoryCount;
  items: InventoryItem[];
  locationId: string;
  closeAction?: ServerAction;
  cancelAction?: ServerAction;
  catalog?: InventoryCatalog;
  lookupCatalog?: InventoryCatalogLookup;
}) {
  const [captured, setCaptured] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      count.items.map((i) => [i.variantId, i.countedQuantity]),
    ),
  );
  const [capturedDetails, setCapturedDetails] = useState<
    Record<string, InventoryItem>
  >({});
  const browser = useInventoryCatalog({
    items,
    initialData: catalog,
    lookup: lookupCatalog,
    locationId,
  });
  const candidates = browser.data?.items ?? [];
  const [selectedId, setSelectedId] = useState("");
  const selected = selectedId
    ? candidates.find((i) => i.variantId === selectedId)
    : candidates.find((i) => captured[i.variantId] === undefined);
  const [quantity, setQuantity] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const quantityRef = useRef<HTMLInputElement>(null);
  const selectedUnit = quantityUnit(selected ?? {});
  const selectedVariantId = selected?.variantId;
  useEffect(() => {
    if (selectedVariantId) quantityRef.current?.focus();
  }, [selectedVariantId]);
  function submitCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || browser.pending || browser.error || !selected) return;
    const countedQuantity = parseMeasureQuantity(quantity, selectedUnit, true);
    if (quantity === "" || countedQuantity === null || countedQuantity < 0) {
      setFeedback("Escribe una cantidad válida para la unidad seleccionada.");
      return;
    }
    const chosen = selected;
    const formData = new FormData();
    formData.set("count_id", count.id);
    formData.set("location_id", locationId);
    formData.set("variant_id", chosen.variantId);
    formData.set("counted_quantity", String(countedQuantity));
    startTransition(async () => {
      const result = action
        ? await action(formData)
        : { ok: true, status: "conteo-capturado" };
      if (!result.ok) {
        setFeedback(
          statusMessages[result.status]?.copy ??
            "No fue posible guardar esta captura.",
        );
        return;
      }
      const nextValues = { ...captured, [chosen.variantId]: countedQuantity };
      const next = candidates.find(
        (i) => nextValues[i.variantId] === undefined,
      );
      setCaptured(nextValues);
      setCapturedDetails((v) => ({ ...v, [chosen.variantId]: chosen }));
      setQuantity("");
      setSelectedId(next?.variantId ?? "");
      setFeedback(
        next
          ? "Guardado. Puedes capturar el siguiente renglón."
          : "Página capturada. Busca otro código o cambia de página; esto no significa que todo el catálogo esté contado.",
      );
    });
  }
  return (
    <div className="continuous-count">
      <div className="continuous-count-progress" role="status">
        <strong>
          {Object.keys(captured).length} capturadas ·{" "}
          {browser.data?.summary.variantCount ?? "—"} variantes en catálogo
        </strong>
        <span>
          Enter en cantidad guarda. Enter en búsqueda localiza el código exacto.
        </span>
      </div>
      <form className="inventory-count-capture" onSubmit={submitCapture}>
        <label className="inventory-count-search">
          <span>Buscar por nombre, SKU o código</span>
          <input
            type="search"
            maxLength={120}
            value={browser.query}
            onChange={(e) => {
              browser.setQuery(e.target.value);
              setSelectedId("");
              setQuantity("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                browser.setExact(true);
                setSelectedId("");
                setQuantity("");
              }
            }}
            placeholder="Escanea o escribe para filtrar"
          />
        </label>
        <label>
          <span>Producto</span>
          <select
            aria-label="Producto a contar"
            value={selected?.variantId ?? ""}
            disabled={browser.pending || Boolean(browser.error)}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setQuantity(
                captured[e.target.value] === undefined
                  ? ""
                  : String(captured[e.target.value]),
              );
            }}
            required
          >
            <option value="" disabled>
              Selecciona un producto
            </option>
            {candidates.map((i) => (
              <option key={i.variantId} value={i.variantId}>
                {captured[i.variantId] !== undefined ? "✓ " : ""}
                {i.productName} · {variantDescription(i)} · {i.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Cantidad física · {selectedUnit.name}</span>
          <input
            ref={quantityRef}
            aria-label="Cantidad física"
            type="number"
            min="0"
            step={measureQuantityStep(selectedUnit)}
            inputMode={
              selectedUnit.decimal_places === 3 ? "decimal" : "numeric"
            }
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </label>
        <button
          className="secondary-button"
          type="submit"
          disabled={
            isPending || browser.pending || Boolean(browser.error) || !selected
          }
        >
          {isPending ? "Guardando…" : "Guardar y siguiente"}
        </button>
      </form>
      {browser.exact ? (
        <button
          type="button"
          className="secondary-button"
          onClick={() => browser.setExact(false)}
        >
          Buscar texto
        </button>
      ) : null}
      <InventoryPagination
        data={browser.data}
        pending={browser.pending}
        error={browser.error}
        onPage={(p) => {
          browser.setPage(p);
          setSelectedId("");
          setQuantity("");
        }}
        onRetry={browser.refresh}
        label="Páginas de productos a contar"
      />
      {feedback ? <p className="inventory-count-feedback">{feedback}</p> : null}
      <div className="inventory-count-results">
        {Object.entries(captured).map(([id, value]) => {
          const item =
            capturedDetails[id] ??
            candidates.find((i) => i.variantId === id) ??
            items.find((i) => i.variantId === id);
          return (
            <span key={id}>
              <b>{item?.productName ?? id}</b>
              <small>
                {item ? variantDescription(item) : ""} · Contado:{" "}
                {formatQuantity(value)}
              </small>
            </span>
          );
        })}
      </div>
      <div className="inventory-document-actions">
        <form action={cancelAction}>
          <input type="hidden" name="count_id" value={count.id} />
          <input type="hidden" name="location_id" value={locationId} />
          <button className="secondary-button" type="submit">
            Cancelar
          </button>
        </form>
        <form action={closeAction}>
          <input type="hidden" name="count_id" value={count.id} />
          <input type="hidden" name="location_id" value={locationId} />
          <button
            className="primary-button"
            type="submit"
            disabled={!Object.keys(captured).length || isPending}
          >
            Cerrar y aplicar
          </button>
        </form>
      </div>
    </div>
  );
}

function TransferItemForm({
  action,
  transfer,
  locationId,
  mode,
  label,
}: {
  action?: ServerAction;
  transfer: InventoryTransfer;
  locationId: string;
  mode: "prepare" | "receive";
  label: string;
}) {
  const initial = Object.fromEntries(
    transfer.items.map((item) => [
      item.variantId,
      mode === "prepare"
        ? item.requestedQuantity
        : (item.sentQuantity ?? item.requestedQuantity),
    ]),
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(initial);
  const payload = transfer.items.map((item) => ({
    variant_id: item.variantId,
    qty: quantities[item.variantId] ?? 0,
  }));
  return (
    <form action={action} className="inventory-document-action">
      <input type="hidden" name="transfer_id" value={transfer.id} />
      <input type="hidden" name="location_id" value={locationId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      <div className="inventory-document-items editable">
        {transfer.items.map((item) => (
          <label key={item.variantId}>
            <span>
              {item.productName}
              <small>
                {item.sku} · {quantityUnit(item).name}
              </small>
            </span>
            <input
              type="number"
              min={
                mode === "prepare" ? measureQuantityStep(quantityUnit(item)) : 0
              }
              max={
                mode === "prepare"
                  ? item.requestedQuantity
                  : (item.sentQuantity ?? item.requestedQuantity)
              }
              step={measureQuantityStep(quantityUnit(item))}
              inputMode={
                quantityUnit(item).decimal_places === 3 ? "decimal" : "numeric"
              }
              value={quantities[item.variantId] ?? 0}
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [item.variantId]: Number(event.target.value),
                }))
              }
              aria-label={`${label}: ${item.productName}`}
              required
            />
          </label>
        ))}
      </div>
      <button className="primary-button wide" type="submit">
        {label}
      </button>
    </form>
  );
}

function NewTransferForm({
  action,
  items,
  locations,
  fromLocationId,
  catalog,
  lookupCatalog,
}: {
  action?: ServerAction;
  items: InventoryItem[];
  locations: Location[];
  fromLocationId: string;
  catalog?: InventoryCatalog;
  lookupCatalog?: InventoryCatalogLookup;
}) {
  const browser = useInventoryCatalog({
    items,
    initialData: catalog,
    lookup: lookupCatalog,
    locationId: fromLocationId,
    initialFilter: "available",
  });
  const [selected, setSelected] = useState<
    Record<string, { item: InventoryItem; quantity: number }>
  >({});
  const payload = Object.values(selected)
    .filter((s) => s.quantity > 0)
    .map((s) => ({ variant_id: s.item.variantId, qty: s.quantity }));
  const destinations = locations.filter((l) => l.id !== fromLocationId);
  function choose(item: InventoryItem, value: string) {
    setSelected((rows) => ({
      ...rows,
      [item.variantId]: { item, quantity: Number(value) },
    }));
  }
  return (
    <form
      action={action}
      className="inventory-adjust-form inventory-new-transfer"
    >
      <input type="hidden" name="from_location_id" value={fromLocationId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />
      <label>
        <span>Sucursal destino</span>
        <select name="to_location_id" required defaultValue="">
          <option value="" disabled>
            Selecciona una sucursal
          </option>
          {destinations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="inventory-transfer-picker">
        <div className="inventory-transfer-search">
          <label>
            <span>Buscar mercancía</span>
            <input
              type="search"
              maxLength={120}
              value={browser.query}
              onChange={(e) => browser.setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  browser.setExact(true);
                }
              }}
              placeholder="Nombre, talla, color, SKU o código"
            />
          </label>
          <small>{payload.length} renglones seleccionados</small>
        </div>
        {browser.exact ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => browser.setExact(false)}
          >
            Buscar texto
          </button>
        ) : null}
        <InventoryPagination
          data={browser.data}
          pending={browser.pending}
          error={browser.error}
          onPage={browser.setPage}
          onRetry={browser.refresh}
          label="Páginas de mercancía para traspaso"
        />
        {(browser.data?.items ?? []).map((item) => (
          <label key={item.variantId}>
            <span>
              {item.productName}
              <small>
                {item.code} · {variantDescription(item)} ·{" "}
                {formatQuantity(item.availableQuantity)}{" "}
                {quantityUnit(item).name} disponibles
              </small>
            </span>
            <input
              type="number"
              min="0"
              max={item.availableQuantity}
              step={measureQuantityStep(quantityUnit(item))}
              inputMode={
                quantityUnit(item).decimal_places === 3 ? "decimal" : "numeric"
              }
              value={selected[item.variantId]?.quantity ?? 0}
              onChange={(e) => choose(item, e.target.value)}
              aria-label={`Cantidad de ${item.productName}`}
            />
          </label>
        ))}
        {browser.data?.totalCount === 0 ? (
          <p className="inventory-preview-note">
            No hay mercancía disponible que coincida.
          </p>
        ) : null}
      </div>
      {payload.length ? (
        <div className="inventory-document-items">
          <strong>
            Mercancía seleccionada · se conserva al cambiar de página
          </strong>
          {Object.values(selected)
            .filter((s) => s.quantity > 0)
            .map(({ item, quantity }) => (
              <label key={item.variantId}>
                <span>
                  {item.productName} · {item.code}
                  <small>
                    {formatQuantity(quantity)} {quantityUnit(item).name}
                  </small>
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setSelected((rows) => {
                      const copy = { ...rows };
                      delete copy[item.variantId];
                      return copy;
                    })
                  }
                >
                  Quitar {item.code}
                </button>
              </label>
            ))}
        </div>
      ) : null}
      <label>
        <span>Nota opcional</span>
        <textarea
          name="note"
          maxLength={500}
          placeholder="Motivo o indicación para quien recibe"
        />
      </label>
      <button
        className="primary-button wide"
        type="submit"
        disabled={
          !payload.length ||
          !destinations.length ||
          browser.pending ||
          Boolean(browser.error)
        }
      >
        Solicitar traspaso
      </button>
    </form>
  );
}

export function InventoryWorkspace({
  items,
  movements,
  counts,
  transfers,
  locations,
  transferLocations,
  activeLocationId,
  catalog,
  lookupCatalog,
  canReviewPending = false,
  canAdjust = false,
  canCount = false,
  canCreateTransfer = false,
  canApproveTransfer = false,
  canReceiveTransfer = false,
  initialShowTransfers = false,
  adjustmentAction,
  createCountAction,
  recordCountAction,
  closeCountAction,
  cancelCountAction,
  createTransferAction,
  approveTransferAction,
  prepareTransferAction,
  dispatchTransferAction,
  receiveTransferAction,
  cancelTransferAction,
  status,
  preview = false,
}: {
  items: InventoryItem[];
  movements: InventoryMovement[];
  counts: InventoryCount[];
  transfers: InventoryTransfer[];
  locations: Location[];
  transferLocations: Location[];
  activeLocationId: string;
  catalog?: InventoryCatalog;
  lookupCatalog?: InventoryCatalogLookup;
  canReviewPending?: boolean;
  canAdjust?: boolean;
  canCount?: boolean;
  canCreateTransfer?: boolean;
  canApproveTransfer?: boolean;
  canReceiveTransfer?: boolean;
  initialShowTransfers?: boolean;
  adjustmentAction?: ServerAction;
  createCountAction?: ServerAction;
  recordCountAction?: InlineCountAction;
  closeCountAction?: ServerAction;
  cancelCountAction?: ServerAction;
  createTransferAction?: ServerAction;
  approveTransferAction?: ServerAction;
  prepareTransferAction?: ServerAction;
  dispatchTransferAction?: ServerAction;
  receiveTransferAction?: ServerAction;
  cancelTransferAction?: ServerAction;
  status?: string;
  preview?: boolean;
}) {
  const searchParams = useSearchParams();
  const requestedCode = searchParams.get("codigo") ?? "";
  const browser = useInventoryCatalog({
    items,
    initialData: catalog,
    lookup: lookupCatalog,
    locationId: activeLocationId,
    initialQuery: catalog?.query ?? requestedCode,
    initialExact: catalog?.exact ?? Boolean(requestedCode),
  });
  const inventorySummary =
    catalog || preview
      ? (browser.data?.summary ?? catalog?.summary)
      : undefined;
  const { identity } = useWorkspace();
  const [showMovements, setShowMovements] = useState(false);
  const [showCounts, setShowCounts] = useState(false);
  const [showTransfers, setShowTransfers] = useState(
    initialShowTransfers &&
      (canCreateTransfer || canApproveTransfer || canReceiveTransfer),
  );
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const query = browser.query;
  const setQuery = browser.setQuery;
  const filter = browser.filter;
  const [expandAll, setExpandAll] = useState(false);
  const activeLocation = locations.find(
    (location) => location.id === activeLocationId,
  );
  const availableUnits =
    inventorySummary?.units
      .map(
        (group) =>
          `${formatQuantity(group.availableQuantity)} ${group.unit.name}`,
      )
      .join(" · ") ?? "—";
  const reservedUnits =
    inventorySummary?.units
      .map(
        (group) =>
          `${formatQuantity(group.reservedQuantity)} ${group.unit.name}`,
      )
      .join(" · ") ?? "—";
  const filteredItems = browser.data?.items ?? [];
  const productGroups = useMemo(
    () => groupInventory(browser.data?.items ?? []),
    [browser.data],
  );
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
                onChange={(event) => {
                  saveActiveLocationPreference(event.target.value);
                  window.location.assign(
                    `/inventario?ubicacion=${encodeURIComponent(event.target.value)}`,
                  );
                }}
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
          {canCount ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowCounts(true)}
            >
              <ClipboardCheck aria-hidden="true" />
              Conteos
            </button>
          ) : null}
          {canCreateTransfer || canApproveTransfer || canReceiveTransfer ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => setShowTransfers(true)}
            >
              <ArrowRightLeft aria-hidden="true" />
              Traspasos
            </button>
          ) : null}
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
          <strong>{availableUnits}</strong>
        </article>
        <article>
          <span>Cantidades reservadas</span>
          <strong>{reservedUnits}</strong>
        </article>
        <article>
          <span>Variantes agotadas</span>
          <strong>{inventorySummary?.outCount ?? "—"}</strong>
        </article>
      </div>

      <div className="notice inventory-notice">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Inventario auditable</strong>
          <span>
            {inventorySummary
              ? `${inventorySummary.variantCount.toLocaleString("es-MX")} variantes del catálogo completo. Los totales no se recortan por búsqueda ni por página.`
              : "No fue posible obtener el resumen del catálogo."}
          </span>
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
            maxLength={120}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                browser.setExact(true);
              }
            }}
            placeholder="Nombre, talla, SKU o código"
            aria-label="Buscar inventario"
          />
        </label>
        <div className="filter-pills" aria-label="Filtrar inventario">
          {[
            ["all", "Todos"],
            ["available", "Disponible"],
            ["last", "1 unidad o menos"],
            ["out", "Agotado"],
          ].map(([value, label]) => (
            <button
              className={filter === value ? "selected" : ""}
              aria-pressed={filter === value}
              type="button"
              onClick={() =>
                browser.setFilter(value as "all" | "available" | "last" | "out")
              }
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!query.trim()}
          onClick={() => browser.setExact(!browser.exact)}
        >
          {browser.exact ? "Buscar texto" : "Código exacto"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setExpandAll((value) => !value)}
        >
          {expandAll ? "Contraer variantes" : "Desplegar variantes"}
        </button>
      </div>

      {browser.exact ? (
        <p className="inventory-search-mode">
          Código exacto: <code>{query}</code>. Enter busca el código completo,
          conservando ceros iniciales.
        </p>
      ) : null}
      {catalog || preview ? (
        <InventoryPagination
          data={browser.data}
          pending={browser.pending}
          error={browser.error}
          onPage={browser.setPage}
          onRetry={browser.refresh}
        />
      ) : null}
      <div className="data-table inventory-table">
        <div className="table-row inventory-row table-header">
          <span>Producto</span>
          <span>Código</span>
          <span>Variante</span>
          <span>Disponible</span>
          <span>Físico</span>
          <span>Acción</span>
        </div>
        {productGroups.map((group) => (
          <details
            className="inventory-product-group"
            key={`${activeLocationId}:${group.productId}:${query}:${filter}:${expandAll}`}
            open={expandAll || Boolean(query.trim()) || filter !== "all"}
          >
            <summary>
              <strong>
                {group.name}
                <small>{group.brand}</small>
              </strong>
              <span>
                {group.items.length} variantes
                {query.trim() || filter !== "all" ? " coincidentes" : ""}
                <small className="inventory-group-health">
                  {
                    group.items.filter((item) => item.availableQuantity <= 0)
                      .length
                  }{" "}
                  agotadas ·{" "}
                  {
                    group.items.filter((item) => item.reservedQuantity > 0)
                      .length
                  }{" "}
                  con reserva
                </small>
              </span>
            </summary>
            {group.items.map((item) => {
              const tone =
                item.availableQuantity <= 0
                  ? "out"
                  : item.availableQuantity <= 1
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
                  <span data-label="Variante">
                    {variantDescription(item)} · {quantityUnit(item).name}
                  </span>
                  <span
                    data-label="Disponible"
                    className={`stock-number ${tone}`}
                  >
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
          </details>
        ))}
        {!browser.pending && !browser.error && filteredItems.length === 0 ? (
          <div className="inventory-empty">
            <PackageOpen aria-hidden="true" />
            <strong>No encontramos variantes</strong>
            <span>
              {items.length
                ? "Prueba otro filtro o búsqueda."
                : "Aún no hay productos para mostrar."}
            </span>
            {canReviewPending && browser.exact ? (
              <Link
                className="secondary-button"
                href={`/productos/migracion-pendientes?${new URLSearchParams({ q: query, mode: "exact", page: "1" })}`}
              >
                Consultar este código pendiente de SICAR
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {catalog || preview ? (
        <InventoryPagination
          data={browser.data}
          pending={browser.pending}
          error={browser.error}
          onPage={browser.setPage}
          onRetry={browser.refresh}
          label="Más páginas de inventario"
        />
      ) : null}

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
                <span>¿Cuánto contaste? · {quantityUnit(adjusting).name}</span>
                <input
                  name="counted_quantity"
                  type="number"
                  min="0"
                  max="999999999.999"
                  step={measureQuantityStep(quantityUnit(adjusting))}
                  inputMode={
                    quantityUnit(adjusting).decimal_places === 3
                      ? "decimal"
                      : "numeric"
                  }
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

      {showCounts ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal inventory-document-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-counts-title"
          >
            <header className="modal-heading">
              <div>
                <p className="eyebrow">
                  Control físico · {activeLocation?.name}
                </p>
                <h2 id="inventory-counts-title">Conteos</h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar conteos"
                onClick={() => setShowCounts(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <form action={createCountAction}>
              <input
                type="hidden"
                name="location_id"
                value={activeLocationId}
              />
              <button className="primary-button wide" type="submit">
                Iniciar conteo
              </button>
            </form>
            <div className="inventory-document-list">
              {counts.map((count) => {
                const active =
                  count.status === "OPEN" || count.status === "COUNTING";
                return (
                  <article className="inventory-document-card" key={count.id}>
                    <header>
                      <div>
                        <strong>Conteo #{count.folio}</strong>
                        <small>
                          {formatDate(count.createdAt)}
                          {!active ? ` · ${count.items.length} capturas` : ""}
                        </small>
                      </div>
                      <span
                        className={`status-chip ${count.status.toLowerCase()}`}
                      >
                        {countStatus[count.status]}
                      </span>
                    </header>
                    {active ? (
                      <ContinuousCountCapture
                        action={recordCountAction}
                        catalog={catalog}
                        lookupCatalog={lookupCatalog}
                        count={count}
                        items={items}
                        locationId={activeLocationId}
                        closeAction={closeCountAction}
                        cancelAction={cancelCountAction}
                      />
                    ) : null}
                    {!active && count.items.length ? (
                      <div className="inventory-count-results">
                        {count.items.map((item) => {
                          const catalog = items.find(
                            (entry) => entry.variantId === item.variantId,
                          );
                          return (
                            <span key={item.variantId}>
                              <b>{catalog?.productName ?? item.variantId}</b>
                              <small>
                                Contado: {formatQuantity(item.countedQuantity)}
                                {item.difference !== null
                                  ? ` · Diferencia: ${formatQuantity(item.difference)}`
                                  : ""}
                                {item.hadMovementAfterCount
                                  ? " · Revisar movimientos"
                                  : ""}
                              </small>
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {!counts.length ? (
                <div className="inventory-empty compact">
                  <ClipboardCheck aria-hidden="true" />
                  <strong>No hay conteos todavía</strong>
                  <span>Inicia uno para comparar el inventario físico.</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {showTransfers ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal inventory-document-modal transfer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-transfers-title"
          >
            <header className="modal-heading">
              <div>
                <p className="eyebrow">Entre sucursales</p>
                <h2 id="inventory-transfers-title">Traspasos</h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar traspasos"
                onClick={() => setShowTransfers(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            {canCreateTransfer ? (
              <details className="inventory-new-document">
                <summary>Nueva solicitud</summary>
                <NewTransferForm
                  catalog={catalog}
                  lookupCatalog={lookupCatalog}
                  action={createTransferAction}
                  items={items}
                  locations={transferLocations}
                  fromLocationId={activeLocationId}
                />
              </details>
            ) : null}
            <div className="inventory-document-list">
              {transfers.map((transfer) => {
                const isOrigin = transfer.fromLocationId === activeLocationId;
                const isDestination =
                  transfer.toLocationId === activeLocationId;
                const receiveNeedsAnotherEmployee =
                  transfer.approvedById === identity.id ||
                  transfer.sentById === identity.id;
                return (
                  <article
                    className="inventory-document-card"
                    key={transfer.id}
                  >
                    <header>
                      <div>
                        <strong>Traspaso #{transfer.folio}</strong>
                        <small>
                          {transfer.fromLocationName} →{" "}
                          {transfer.toLocationName}
                        </small>
                      </div>
                      <span
                        className={`status-chip ${transfer.status.toLowerCase()}`}
                      >
                        {transferStatus[transfer.status]}
                      </span>
                    </header>
                    <TransferProgress transfer={transfer} />
                    <div className="inventory-document-items">
                      {transfer.items.map((item) => (
                        <span key={item.variantId}>
                          <b>
                            {item.productName}
                            <small>{item.sku}</small>
                          </b>
                          <em>
                            Solicitado {formatQuantity(item.requestedQuantity)}
                            {item.sentQuantity !== null
                              ? ` · Enviado ${formatQuantity(item.sentQuantity)}`
                              : ""}
                            {item.receivedQuantity !== null
                              ? ` · Recibido ${formatQuantity(item.receivedQuantity)}`
                              : ""}
                          </em>
                        </span>
                      ))}
                    </div>
                    {transfer.note ? (
                      <p className="inventory-document-note">{transfer.note}</p>
                    ) : null}
                    {transfer.status === "REQUESTED" && canApproveTransfer ? (
                      <form action={approveTransferAction}>
                        <input
                          type="hidden"
                          name="transfer_id"
                          value={transfer.id}
                        />
                        <input
                          type="hidden"
                          name="location_id"
                          value={activeLocationId}
                        />
                        <button className="primary-button wide" type="submit">
                          Aprobar solicitud
                        </button>
                      </form>
                    ) : null}
                    {transfer.status === "APPROVED" &&
                    isOrigin &&
                    canCreateTransfer ? (
                      <TransferItemForm
                        action={prepareTransferAction}
                        transfer={transfer}
                        locationId={activeLocationId}
                        mode="prepare"
                        label="Confirmar preparación"
                      />
                    ) : null}
                    {transfer.status === "PREPARED" &&
                    isOrigin &&
                    canCreateTransfer ? (
                      <form action={dispatchTransferAction}>
                        <input
                          type="hidden"
                          name="transfer_id"
                          value={transfer.id}
                        />
                        <input
                          type="hidden"
                          name="location_id"
                          value={activeLocationId}
                        />
                        <button className="primary-button wide" type="submit">
                          Enviar mercancía
                        </button>
                      </form>
                    ) : null}
                    {transfer.status === "IN_TRANSIT" &&
                    isDestination &&
                    canReceiveTransfer &&
                    !receiveNeedsAnotherEmployee ? (
                      <TransferItemForm
                        action={receiveTransferAction}
                        transfer={transfer}
                        locationId={activeLocationId}
                        mode="receive"
                        label="Confirmar recepción"
                      />
                    ) : null}
                    {transfer.status === "IN_TRANSIT" &&
                    isDestination &&
                    canReceiveTransfer &&
                    receiveNeedsAnotherEmployee ? (
                      <div className="admin-inline-warning">
                        <strong>Otra persona debe recibirlo</strong>
                        <span>
                          Tú aprobaste o enviaste este traspaso. Pide a otro
                          empleado autorizado de {transfer.toLocationName} que
                          confirme las cantidades recibidas.
                        </span>
                      </div>
                    ) : null}
                    {isOrigin &&
                    canCreateTransfer &&
                    ["REQUESTED", "APPROVED", "PREPARED"].includes(
                      transfer.status,
                    ) ? (
                      <form action={cancelTransferAction}>
                        <input
                          type="hidden"
                          name="transfer_id"
                          value={transfer.id}
                        />
                        <input
                          type="hidden"
                          name="location_id"
                          value={activeLocationId}
                        />
                        <button className="secondary-button wide" type="submit">
                          Cancelar traspaso
                        </button>
                      </form>
                    ) : null}
                  </article>
                );
              })}
              {!transfers.length ? (
                <div className="inventory-empty compact">
                  <ArrowRightLeft aria-hidden="true" />
                  <strong>No hay traspasos</strong>
                  <span>Las solicitudes aparecerán aquí.</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
