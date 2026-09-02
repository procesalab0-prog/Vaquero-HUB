"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, CircleDollarSign, Power, Tags, X } from "lucide-react";

import type { BatchActionResult, ProductVariant } from "@/lib/domain";

type Props = {
  selected: ProductVariant[];
  clearSelection: () => void;
  statusAction?: (
    variantIds: string[],
    isActive: boolean,
  ) => Promise<BatchActionResult>;
  priceAction?: (
    changes: Array<{
      variantId: string;
      expectedPriceCents: number;
      newPriceCents: number;
    }>,
  ) => Promise<BatchActionResult>;
  onStatusApplied: (variantIds: string[], isActive: boolean) => void;
  onPricesApplied: (variantIds: string[], price: number) => void;
};

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export function CatalogBatchActions({
  selected,
  clearSelection,
  statusAction,
  priceAction,
  onStatusApplied,
  onPricesApplied,
}: Props) {
  const [statusTarget, setStatusTarget] = useState<boolean | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [feedback, setFeedback] = useState<BatchActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const newPrice = Number(priceInput);
  const validPrice =
    Number.isFinite(newPrice) &&
    newPrice >= 0 &&
    selected.some((variant) => variant.price !== newPrice);
  const changedVariants = useMemo(
    () => selected.filter((variant) => variant.price !== newPrice),
    [newPrice, selected],
  );

  function applyStatus() {
    if (statusTarget === null || !statusAction) return;
    const ids = selected.map((variant) => variant.id);
    startTransition(async () => {
      const result = await statusAction(ids, statusTarget);
      setFeedback(result);
      if (result.ok) {
        onStatusApplied(ids, statusTarget);
        setStatusTarget(null);
        clearSelection();
      }
    });
  }

  function applyPrices() {
    if (!priceAction || !validPrice) return;
    const priceCents = Math.round(newPrice * 100);
    const changes = changedVariants.map((variant) => ({
      variantId: variant.id,
      expectedPriceCents: Math.round(variant.price * 100),
      newPriceCents: priceCents,
    }));
    startTransition(async () => {
      const result = await priceAction(changes);
      setFeedback(result);
      if (result.ok) {
        onPricesApplied(
          changes.map((change) => change.variantId),
          newPrice,
        );
        setPriceOpen(false);
        setPriceInput("");
        clearSelection();
      }
    });
  }

  function prepareLabels() {
    window.sessionStorage.setItem(
      "mi-tienda-label-selection",
      JSON.stringify(selected.map((variant) => variant.id)),
    );
    window.location.assign("/etiquetas?desde=productos");
  }

  if (selected.length === 0) return null;

  return (
    <>
      <aside
        className="batch-toolbar"
        aria-label="Acciones para variantes seleccionadas"
      >
        <div>
          <CheckCircle2 aria-hidden="true" />
          <strong>{selected.length} seleccionadas</strong>
        </div>
        <div className="batch-toolbar-actions">
          <button type="button" onClick={prepareLabels}>
            <Tags aria-hidden="true" />
            Etiquetas
          </button>
          {priceAction ? (
            <button type="button" onClick={() => setPriceOpen(true)}>
              <CircleDollarSign aria-hidden="true" />
              Cambiar precio
            </button>
          ) : null}
          {statusAction ? (
            <>
              <button type="button" onClick={() => setStatusTarget(true)}>
                <Power aria-hidden="true" />
                Activar
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => setStatusTarget(false)}
              >
                <Power aria-hidden="true" />
                Dar de baja
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-label="Cancelar selección"
            onClick={clearSelection}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </aside>

      {feedback && !feedback.ok ? (
        <div className="admin-status error" role="alert">
          {feedback.message}
        </div>
      ) : null}

      {statusTarget !== null ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal compact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-status-title"
          >
            <p className="eyebrow">Cambio en lote</p>
            <h2 id="batch-status-title">
              {statusTarget
                ? "¿Reactivar variantes?"
                : "¿Dar variantes de baja?"}
            </h2>
            <p>
              {statusTarget
                ? `${selected.length} variantes volverán a estar disponibles para los procesos operativos.`
                : `${selected.length} variantes dejarán de venderse. Sus códigos e historial se conservan.`}
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isPending}
                onClick={() => setStatusTarget(null)}
              >
                Cancelar
              </button>
              <button
                className={statusTarget ? "primary-button" : "danger-button"}
                type="button"
                disabled={isPending}
                onClick={applyStatus}
              >
                {isPending
                  ? "Guardando…"
                  : statusTarget
                    ? "Sí, reactivar"
                    : "Sí, dar de baja"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {priceOpen ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal batch-price-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-price-title"
          >
            <header>
              <div>
                <p className="eyebrow">Vista previa obligatoria</p>
                <h2 id="batch-price-title">Cambiar precio de venta</h2>
                <p>
                  El mismo precio se aplicará sólo a las variantes que realmente
                  cambien.
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setPriceOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <label className="batch-price-input">
              <span>Nuevo precio</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
                placeholder="0.00"
              />
            </label>
            <div className="batch-price-preview" aria-live="polite">
              {validPrice ? (
                <>
                  <strong>{changedVariants.length} cambios</strong>
                  {changedVariants.slice(0, 12).map((variant) => (
                    <div key={variant.id}>
                      <span>
                        {variant.productName} · {variant.color} · {variant.size}
                      </span>
                      <span>
                        <del>{money.format(variant.price)}</del> →{" "}
                        <b>{money.format(newPrice)}</b>
                      </span>
                    </div>
                  ))}
                  {changedVariants.length > 12 ? (
                    <small>
                      Y {changedVariants.length - 12} variantes más.
                    </small>
                  ) : null}
                </>
              ) : (
                <p>
                  Escribe un precio distinto para ver exactamente qué cambiará.
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={isPending}
                onClick={() => setPriceOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={!validPrice || isPending}
                onClick={applyPrices}
              >
                {isPending ? "Guardando…" : "Confirmar precios"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
