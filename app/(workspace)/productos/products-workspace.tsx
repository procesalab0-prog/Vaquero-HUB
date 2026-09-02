"use client";

import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, PackageOpen, Plus, Search, Tags, X } from "lucide-react";

import type { ProductVariant } from "@/lib/domain";

type Category = {
  id: string;
  name: string;
  default_size_scale_code: string | null;
};
type AttributeValue = {
  id: string;
  type_code: string;
  scale_code: string | null;
  value: string;
  display_order: number;
};

type Props = {
  initialVariants: ProductVariant[];
  categories: Category[];
  attributeValues: AttributeValue[];
  preview?: boolean;
  status?: string;
  createAction?: (formData: FormData) => Promise<void>;
  addVariantsAction?: (formData: FormData) => Promise<void>;
};

type ModalMode = "create" | "add";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const previewCategories: Category[] = [
  { id: "preview-botas", name: "Botas", default_size_scale_code: "CALZADO_MX" },
];
const previewValues: AttributeValue[] = [
  ...["25", "25.5", "26", "26.5", "27", "27.5", "28", "28.5", "29", "30"].map(
    (value, index) => ({
      id: `preview-size-${value}`,
      type_code: "TALLA",
      scale_code: "CALZADO_MX",
      value,
      display_order: index,
    }),
  ),
  ...["Negro", "Café", "Miel"].map((value, index) => ({
    id: `preview-color-${value}`,
    type_code: "COLOR",
    scale_code: null,
    value,
    display_order: index,
  })),
];

const statusMessages: Record<string, string> = {
  "producto-creado": "Producto y variantes guardados correctamente.",
  "variantes-agregadas":
    "Las nuevas variantes se agregaron sin cambiar los SKU ni códigos existentes.",
  "producto-duplicado":
    "Ese SKU o código de barras ya existe. No se guardó ningún renglón.",
  "producto-combinacion-repetida":
    "Hay dos renglones con la misma talla y el mismo color. Deja uno solo: " +
    "si la variante ya existía y se dio de baja, se reactiva en vez de crearla otra vez.",
  "producto-datos-invalidos":
    "Completa producto, categoría, color, costo, precio y al menos una talla. " +
    "El SKU y el código de barras los genera el sistema.",
  "producto-sin-permiso": "Tu rol no tiene permiso para crear productos.",
  "producto-no-encontrado":
    "El producto ya no existe o fue desactivado. Actualiza la pantalla.",
  "producto-cliente-desactualizado":
    "Esta pantalla intentó mandar el SKU o el código de barras, que ahora los " +
    "genera la base de datos. Recarga la página para tomar la versión nueva.",
  "producto-error":
    "No fue posible crear el producto. Revisa los datos e inténtalo de nuevo.",
  "catalogo-pendiente":
    "La interfaz está lista; falta aplicar la migración M2 en el staging conectado a esta web.",
};

export function ProductsWorkspace({
  initialVariants,
  categories,
  attributeValues,
  preview = false,
  status,
  createAction,
  addVariantsAction,
}: Props) {
  const availableCategories = categories.length
    ? categories
    : previewCategories;
  const availableValues = attributeValues.length
    ? attributeValues
    : previewValues;
  const [variants, setVariants] = useState(initialVariants);
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(
    availableCategories[0]?.id ?? "",
  );
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [excludedCombinations, setExcludedCombinations] = useState<string[]>(
    [],
  );
  const deferredQuery = useDeferredValue(query);
  const products = useMemo(() => {
    const unique = new Map<
      string,
      { id: string; name: string; brand: string; categoryId: string }
    >();
    for (const item of variants) {
      const id = item.productId ?? `preview:${item.productName}`;
      if (!unique.has(id)) {
        unique.set(id, {
          id,
          name: item.productName,
          brand: item.brand,
          categoryId: item.categoryId ?? availableCategories[0]?.id ?? "",
        });
      }
    }
    return [...unique.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "es-MX"),
    );
  }, [availableCategories, variants]);

  const category =
    availableCategories.find((item) => item.id === selectedCategory) ??
    availableCategories[0];
  const sizes = useMemo(
    () =>
      availableValues.filter(
        (item) =>
          item.type_code === "TALLA" &&
          item.scale_code === category?.default_size_scale_code,
      ),
    [availableValues, category?.default_size_scale_code],
  );
  const colors = useMemo(
    () => availableValues.filter((item) => item.type_code === "COLOR"),
    [availableValues],
  );
  const combinations = selectedColors.flatMap((colorId) =>
    selectedSizes.map((sizeId) => `${colorId}:${sizeId}`),
  );
  const existingCombinations = useMemo(() => {
    if (modalMode !== "add") return new Set<string>();
    return new Set(
      variants
        .filter(
          (item) =>
            (item.productId ?? `preview:${item.productName}`) ===
            selectedProductId,
        )
        .map((item) => {
          const color = colors.find((value) => value.value === item.color);
          const size = sizes.find((value) => value.value === item.size);
          return color && size ? `${color.id}:${size.id}` : "";
        })
        .filter(Boolean),
    );
  }, [colors, modalMode, selectedProductId, sizes, variants]);
  const activeCombinations = combinations.filter(
    (combination) =>
      !excludedCombinations.includes(combination) &&
      !existingCombinations.has(combination),
  );
  const filteredVariants = useMemo(() => {
    const term = deferredQuery.trim().toLocaleLowerCase("es-MX");
    return variants.filter(
      (item) =>
        !term ||
        [item.productName, item.brand, item.legacyCode, item.color, item.size]
          .join(" ")
          .toLocaleLowerCase("es-MX")
          .includes(term),
    );
  }, [deferredQuery, variants]);

  function toggleSize(id: string) {
    setSelectedSizes((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setExcludedCombinations((current) =>
      current.filter((combination) => !combination.endsWith(`:${id}`)),
    );
  }

  function toggleColor(id: string) {
    setSelectedColors((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setExcludedCombinations((current) =>
      current.filter((combination) => !combination.startsWith(`${id}:`)),
    );
  }

  function toggleCombination(combination: string) {
    setExcludedCombinations((current) =>
      current.includes(combination)
        ? current.filter((item) => item !== combination)
        : [...current, combination],
    );
  }

  function changeCategory(id: string) {
    setSelectedCategory(id);
    setSelectedSizes([]);
    setExcludedCombinations([]);
  }

  function resetVariantSelection() {
    setSelectedSizes([]);
    setSelectedColors([]);
    setExcludedCombinations([]);
  }

  function openCreateModal() {
    resetVariantSelection();
    setModalMode("create");
  }

  function openAddModal() {
    const product = products[0];
    if (!product) return;
    resetVariantSelection();
    setSelectedProductId(product.id);
    changeCategory(product.categoryId);
    setModalMode("add");
  }

  function changeProduct(id: string) {
    setSelectedProductId(id);
    const product = products.find((item) => item.id === id);
    if (product) changeCategory(product.categoryId);
  }

  function createPreviewProduct(formData: FormData) {
    const name = String(formData.get("product_name") ?? "").trim();
    const brand =
      String(formData.get("brand_name") ?? "").trim() || "Sin marca";
    const price = Number(formData.get("price"));
    if (!name || !Number.isFinite(price) || activeCombinations.length === 0)
      return;
    const created = activeCombinations.map((combination, index) => {
      const [colorId, sizeId] = combination.split(":");
      return {
        id: `preview-${Date.now()}-${index}`,
        productName: name,
        brand,
        legacyCode: `Se genera al guardar · ${index + 1}`,
        color: colors.find((item) => item.id === colorId)?.value ?? "Sin color",
        size: sizes.find((item) => item.id === sizeId)?.value ?? "Única",
        price,
        stock: 0,
      };
    });
    setVariants((current) => [...current, ...created]);
    setModalMode(null);
    setSaved(true);
    setSelectedSizes([]);
    setSelectedColors([]);
    setExcludedCombinations([]);
  }

  function addPreviewVariants(formData: FormData) {
    const product = products.find(
      (item) => item.id === String(formData.get("product_id") ?? ""),
    );
    const price = Number(formData.get("price"));
    if (!product || !Number.isFinite(price) || activeCombinations.length === 0)
      return;
    const created = activeCombinations.map((combination, index) => {
      const [colorId, sizeId] = combination.split(":");
      return {
        id: `preview-added-${Date.now()}-${index}`,
        productId: product.id,
        categoryId: product.categoryId,
        productName: product.name,
        brand: product.brand,
        legacyCode: `Se genera al guardar · ${index + 1}`,
        color: colors.find((item) => item.id === colorId)?.value ?? "Sin color",
        size: sizes.find((item) => item.id === sizeId)?.value ?? "Única",
        price,
        stock: 0,
      };
    });
    setVariants((current) => [...current, ...created]);
    setModalMode(null);
    setSaved(true);
    resetVariantSelection();
  }

  return (
    <section className="module-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">M2 · Catálogo</p>
          <h1>Productos y variantes</h1>
          <p className="heading-copy">
            Captura una sola vez y genera todas las combinaciones de talla.
          </p>
        </div>
        <div className="heading-actions">
          <Link className="secondary-button" href="/etiquetas">
            <Tags aria-hidden="true" />
            Etiquetas
          </Link>
          <button
            className="secondary-button"
            type="button"
            onClick={openAddModal}
            disabled={products.length === 0}
          >
            <Plus aria-hidden="true" />
            Agregar variantes
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={openCreateModal}
          >
            <Plus aria-hidden="true" />
            Nuevo producto
          </button>
        </div>
      </div>

      {status && statusMessages[status] ? (
        <div
          className={
            status.includes("creado") || status.includes("agregadas")
              ? "admin-status"
              : "admin-status error"
          }
          role="status"
        >
          {statusMessages[status]}
        </div>
      ) : null}
      <div className="notice">
        <strong>Códigos protegidos</strong>
        <span>
          {preview
            ? "Modo de demostración: las altas se conservan sólo en esta pantalla."
            : "El sistema genera SKU y código de barras dentro de Supabase. Los campos de SICAR sólo los puede escribir el importador."}
        </span>
      </div>

      <div className="catalog-toolbar">
        <label className="toolbar-search">
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar producto, marca o código"
            aria-label="Buscar productos"
          />
        </label>
      </div>

      <div className="data-table">
        <div className="table-row table-header">
          <span>Producto</span>
          <span>Código</span>
          <span>Variante</span>
          <span>Precio</span>
          <span>Inventario</span>
        </div>
        {filteredVariants.map((item) => (
          <div className="table-row" key={item.id}>
            <div className="table-product">
              <span className="table-product-image">
                {item.image ? (
                  <Image src={item.image} alt="" fill sizes="44px" />
                ) : (
                  <PackageOpen aria-hidden="true" />
                )}
              </span>
              <strong>
                {item.productName}
                <small>{item.brand}</small>
              </strong>
            </div>
            <code>{item.legacyCode}</code>
            <span>
              {item.color} · {item.size}
            </span>
            <span>{money.format(item.price)}</span>
            <span className="stock-number out">Se activa en M3</span>
          </div>
        ))}
        {filteredVariants.length === 0 ? (
          <div className="admin-empty">
            <PackageOpen aria-hidden="true" />
            <strong>No hay variantes</strong>
            <span>Crea el primer producto o cambia la búsqueda.</span>
          </div>
        ) : null}
      </div>

      {saved ? (
        <div className="inline-success" role="status">
          <Check aria-hidden="true" />
          Vista previa agregada
          <button type="button" onClick={() => setSaved(false)}>
            Cerrar
          </button>
        </div>
      ) : null}

      {modalMode ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal product-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
          >
            <header className="modal-heading">
              <div>
                <p className="eyebrow">Generador de variantes</p>
                <h2 id="product-modal-title">
                  {modalMode === "create"
                    ? "Nuevo producto"
                    : "Agregar variantes"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setModalMode(null)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <form
              action={
                preview
                  ? modalMode === "create"
                    ? createPreviewProduct
                    : addPreviewVariants
                  : modalMode === "create"
                    ? createAction
                    : addVariantsAction
              }
            >
              <div className="settings-form">
                {modalMode === "create" ? (
                  <>
                    <label className="wide-field">
                      <span>Nombre del producto</span>
                      <input name="product_name" required />
                    </label>
                    <label>
                      <span>Marca</span>
                      <input name="brand_name" placeholder="Opcional" />
                    </label>
                    <label>
                      <span>Categoría</span>
                      <select
                        name="category_id"
                        value={selectedCategory}
                        onChange={(event) => changeCategory(event.target.value)}
                        required
                      >
                        {availableCategories.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <label className="wide-field">
                    <span>Producto existente</span>
                    <select
                      name="product_id"
                      value={selectedProductId}
                      onChange={(event) => changeProduct(event.target.value)}
                      required
                    >
                      {products.map((product) => (
                        <option value={product.id} key={product.id}>
                          {product.name} · {product.brand}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <span>Costo</span>
                  <input
                    name="cost"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    required
                  />
                </label>
                <label>
                  <span>Precio</span>
                  <input
                    name="price"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    required
                  />
                </label>
              </div>
              <div className="size-picker color-picker">
                <span>1. Selecciona uno o varios colores</span>
                <div>
                  {colors.map((color) => (
                    <label
                      className={
                        selectedColors.includes(color.id)
                          ? "size-option selected"
                          : "size-option"
                      }
                      key={color.id}
                    >
                      <input
                        type="checkbox"
                        checked={selectedColors.includes(color.id)}
                        onChange={() => toggleColor(color.id)}
                        aria-label={`Color ${color.value}`}
                      />
                      <span>{color.value}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="size-picker">
                <span>2. Selecciona una o varias tallas</span>
                <small>{category?.name ?? "Tallas"}</small>
                <div>
                  {sizes.map((size) => (
                    <label
                      className={
                        selectedSizes.includes(size.id)
                          ? "size-option selected"
                          : "size-option"
                      }
                      key={size.id}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSizes.includes(size.id)}
                        onChange={() => toggleSize(size.id)}
                        aria-label={`Talla ${size.value}`}
                      />
                      <span>{size.value}</span>
                    </label>
                  ))}
                </div>
                {sizes.length === 0 ? (
                  <p>
                    La escala de esta categoría está pendiente de confirmar con
                    la tienda.
                  </p>
                ) : null}
              </div>
              {combinations.length ? (
                <div className="variant-matrix">
                  <span>3. Revisa la matriz antes de guardar</span>
                  <small>Desmarca las combinaciones que no llegaron.</small>
                  <div className="variant-matrix-grid">
                    {selectedColors.map((colorId) => {
                      const color = colors.find((item) => item.id === colorId);
                      return selectedSizes.map((sizeId) => {
                        const size = sizes.find((item) => item.id === sizeId);
                        const combination = `${colorId}:${sizeId}`;
                        const alreadyExists =
                          existingCombinations.has(combination);
                        const enabled =
                          !alreadyExists &&
                          !excludedCombinations.includes(combination);
                        return (
                          <label
                            className={enabled ? "selected" : ""}
                            key={combination}
                          >
                            <input
                              type="checkbox"
                              name="variant_combo"
                              value={combination}
                              checked={enabled}
                              disabled={alreadyExists}
                              onChange={() => toggleCombination(combination)}
                              aria-label={`${color?.value ?? "Color"}, talla ${size?.value ?? "única"}`}
                            />
                            <strong>{color?.value}</strong>
                            <span>{size?.value}</span>
                            {alreadyExists ? <small>Ya existe</small> : null}
                          </label>
                        );
                      });
                    })}
                  </div>
                </div>
              ) : null}
              <div className="variant-summary">
                <strong>
                  {activeCombinations.length}{" "}
                  {activeCombinations.length === 1 ? "variante" : "variantes"}
                </strong>
                <span>
                  SKU y código se generan solos; si algo falla, no se guarda
                  ninguna.
                </span>
              </div>
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setModalMode(null)}
                >
                  Cancelar
                </button>
                <SubmitButton
                  count={activeCombinations.length}
                  mode={modalMode}
                />
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SubmitButton({ count, mode }: { count: number; mode: ModalMode }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="primary-button"
      type="submit"
      disabled={pending || count === 0}
    >
      {pending
        ? "Guardando…"
        : `${mode === "create" ? "Crear" : "Agregar"} ${count || ""} ${count === 1 ? "variante" : "variantes"}`}
    </button>
  );
}
