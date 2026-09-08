"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, ImagePlus, X } from "lucide-react";

import type { VariantView } from "./purchases-workspace";

export type PurchaseCategory = {
  id: string;
  name: string;
  default_size_scale_code: string | null;
};
export type PurchaseAttributeValue = {
  id: string;
  type_code: string;
  scale_code: string | null;
  value: string;
  display_order: number;
};

export function QuickProductForm({
  categories,
  attributeValues,
  action,
  onCancel,
  onCreated,
}: {
  categories: PurchaseCategory[];
  attributeValues: PurchaseAttributeValue[];
  action: (formData: FormData) => Promise<{
    ok: boolean;
    message: string;
    data?: Record<string, unknown>;
  }>;
  onCancel: () => void;
  onCreated: (variants: VariantView[], message: string) => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const category = categories.find((item) => item.id === categoryId);
  const colorOptions = useMemo(
    () => attributeValues.filter((item) => item.type_code === "COLOR"),
    [attributeValues],
  );
  const sizeOptions = useMemo(
    () =>
      attributeValues.filter(
        (item) =>
          item.type_code === "TALLA" &&
          item.scale_code === category?.default_size_scale_code,
      ),
    [attributeValues, category?.default_size_scale_code],
  );
  const combinations = colors.flatMap((color) =>
    sizes.map((size) => `${color}:${size}`),
  );

  function toggle(
    id: string,
    selected: string[],
    set: (next: string[]) => void,
  ) {
    set(
      selected.includes(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id],
    );
  }

  return (
    <div className="modal-backdrop quick-product-backdrop">
      <section
        className="purchase-modal quick-product-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-product-title"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Sin salir de la orden</p>
            <h2 id="quick-product-title">Crear producto faltante</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cerrar">
            <X />
          </button>
        </div>
        <p className="heading-copy">
          Captura los datos una vez. Todas las tallas y colores seleccionados se
          agregarán a esta orden con una pieza inicial editable.
        </p>
        {message ? (
          <p className="notice-banner operation-feedback" role="alert">
            {message}
          </p>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            combinations.forEach((combination) =>
              form.append("variant_combo", combination),
            );
            setMessage("");
            startTransition(async () => {
              const result = await action(form);
              if (!result.ok) {
                setMessage(result.message);
                return;
              }
              const variants = (result.data?.variants ?? []) as VariantView[];
              onCreated(variants, result.message);
            });
          }}
        >
          <div className="form-grid">
            <label>
              Nombre del producto
              <input name="product_name" required maxLength={180} />
            </label>
            <label>
              Marca
              <input name="brand_name" maxLength={120} placeholder="Opcional" />
            </label>
            <label>
              Categoría
              <select
                name="category_id"
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setSizes([]);
                }}
                required
              >
                <option value="">Selecciona</option>
                {categories.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Foto del producto
              <span className="quick-image-input">
                <ImagePlus />
                <input
                  name="product_image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
              </span>
              <small>Opcional · JPG, PNG o WebP · máximo 4 MB</small>
            </label>
            <label>
              Costo por pieza
              <input
                name="cost"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Precio de venta
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                required
              />
            </label>
          </div>

          <fieldset className="quick-options">
            <legend>1. Colores</legend>
            <div className="picker-quick-actions">
              <button
                type="button"
                onClick={() => setColors(colorOptions.map((item) => item.id))}
              >
                Marcar todos
              </button>
              <button type="button" onClick={() => setColors([])}>
                Limpiar
              </button>
            </div>
            <div className="quick-option-list">
              {colorOptions.map((item) => (
                <label
                  className={colors.includes(item.id) ? "selected" : ""}
                  key={item.id}
                >
                  <input
                    type="checkbox"
                    checked={colors.includes(item.id)}
                    onChange={() => toggle(item.id, colors, setColors)}
                  />
                  {item.value}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="quick-options">
            <legend>2. Tallas</legend>
            <div className="picker-quick-actions">
              <button
                type="button"
                onClick={() => setSizes(sizeOptions.map((item) => item.id))}
                disabled={!sizeOptions.length}
              >
                Marcar todas
              </button>
              <button type="button" onClick={() => setSizes([])}>
                Limpiar
              </button>
            </div>
            <div className="quick-option-list">
              {sizeOptions.map((item) => (
                <label
                  className={sizes.includes(item.id) ? "selected" : ""}
                  key={item.id}
                >
                  <input
                    type="checkbox"
                    checked={sizes.includes(item.id)}
                    onChange={() => toggle(item.id, sizes, setSizes)}
                  />
                  {item.value}
                </label>
              ))}
            </div>
            {!categoryId ? (
              <small>Elige una categoría para mostrar sus tallas.</small>
            ) : null}
          </fieldset>

          <div className="variant-summary">
            <strong>{combinations.length} variantes</strong>
            <span>
              El sistema generará SKU y código de barras para cada una.
            </span>
          </div>
          <div className="modal-actions quick-product-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={onCancel}
            >
              Volver a la orden
            </button>
            <button
              className="primary-button"
              disabled={pending || !combinations.length}
            >
              <Check />
              {pending
                ? "Creando…"
                : `Crear y agregar ${combinations.length || ""}`}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
