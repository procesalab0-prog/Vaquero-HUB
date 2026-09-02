"use client";

import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  Barcode,
  Camera,
  Check,
  PackageOpen,
  Pencil,
  Plus,
  Search,
  Tags,
  Upload,
  X,
} from "lucide-react";

import { BarcodeScanner } from "@/components/barcode-scanner";
import type { CatalogImportState } from "@/lib/catalog-import-shared";
import type { ProductVariant } from "@/lib/domain";
import { CatalogImportDialog } from "./catalog-import-dialog";

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
  registerBarcodeAction?: (formData: FormData) => Promise<void>;
  lookupBarcodeAction?: (code: string) => Promise<ProductVariant | null>;
  updateProductAction?: (formData: FormData) => Promise<void>;
  updateVariantAction?: (formData: FormData) => Promise<void>;
  updatePriceAction?: (formData: FormData) => Promise<void>;
  previewImportAction?: (
    state: CatalogImportState,
    formData: FormData,
  ) => Promise<CatalogImportState>;
  commitImportAction?: (
    state: CatalogImportState,
    formData: FormData,
  ) => Promise<CatalogImportState>;
  initialImportState?: CatalogImportState;
};

type ModalMode = "create" | "add";
type ScannerTarget = "search" | "barcode";

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
  "codigo-registrado":
    "Código guardado como principal. Los códigos anteriores siguen funcionando.",
  "producto-actualizado":
    "Los datos generales del producto quedaron actualizados.",
  "variante-actualizada":
    "El costo y el estado de la variante quedaron actualizados.",
  "precio-actualizado": "El nuevo precio quedó guardado en la bitácora.",
  "codigo-ya-asignado":
    "Ese código ya pertenece a otra variante. Verifica cada talla antes de guardarlo.",
  "codigo-invalido":
    "El código no corresponde a la simbología elegida. Revisa los dígitos y vuelve a escanearlo.",
  "codigo-origen-invalido":
    "Los códigos de SICAR y los generados sólo pueden entrar por sus procesos protegidos.",
  "codigo-prefijo-reservado":
    "Ese código empieza con 20-29, que es el rango del generador interno. " +
    "Genera un código propio y vuelve a etiquetar el producto.",
  "variante-no-encontrada":
    "La variante ya no está activa. Actualiza la pantalla antes de continuar.",
  "codigo-error":
    "No fue posible guardar el código. No se cambió el código principal anterior.",
  "producto-duplicado":
    "Ese SKU o código de barras ya existe. No se guardó ningún renglón.",
  "producto-combinacion-repetida":
    "Hay dos renglones con la misma talla y el mismo color. Deja uno solo: " +
    "si la variante ya existía y se dio de baja, se reactiva en vez de crearla otra vez.",
  "producto-datos-invalidos":
    "Completa producto, categoría, color, costo, precio y al menos una talla. " +
    "El SKU y el código de barras los genera el sistema.",
  "producto-sin-permiso": "Tu rol no tiene permiso para modificar el catálogo.",
  "producto-categoria-invalida":
    "La categoría ya no está disponible. Elige una categoría activa.",
  "producto-precio-invalido": "Escribe un precio válido mayor o igual a cero.",
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
  registerBarcodeAction,
  lookupBarcodeAction,
  updateProductAction,
  updateVariantAction,
  updatePriceAction,
  previewImportAction,
  commitImportAction,
  initialImportState,
}: Props) {
  const availableCategories = categories.length
    ? categories
    : previewCategories;
  const availableValues = attributeValues.length
    ? attributeValues
    : previewValues;
  const [variants, setVariants] = useState(initialVariants);
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [selectedBarcodeVariant, setSelectedBarcodeVariant] = useState(
    initialVariants[0]?.id ?? "",
  );
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [barcodeCode, setBarcodeCode] = useState("");
  const [scannerTarget, setScannerTarget] = useState<ScannerTarget | null>(
    null,
  );
  const [scanFeedback, setScanFeedback] = useState<{
    kind: "working" | "found" | "missing";
    message: string;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [excludedCombinations, setExcludedCombinations] = useState<string[]>(
    [],
  );
  const deferredQuery = useDeferredValue(query);
  useEffect(() => {
    if (barcodeOpen) barcodeInputRef.current?.focus();
  }, [barcodeOpen]);
  const products = useMemo(() => {
    const unique = new Map<
      string,
      {
        id: string;
        name: string;
        brand: string;
        categoryId: string;
        description: string;
        isActive: boolean;
      }
    >();
    for (const item of variants) {
      const id = item.productId ?? `preview:${item.productName}`;
      if (!unique.has(id)) {
        unique.set(id, {
          id,
          name: item.productName,
          brand: item.brand,
          categoryId: item.categoryId ?? availableCategories[0]?.id ?? "",
          description: item.description ?? "",
          isActive: item.productActive ?? true,
        });
      }
    }
    return [...unique.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "es-MX"),
    );
  }, [availableCategories, variants]);
  const editingVariant = variants.find((item) => item.id === editingVariantId);
  const canEdit = preview || Boolean(updateProductAction || updatePriceAction);

  const category = availableCategories.find(
    (item) => item.id === selectedCategory,
  );
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
    setSelectedCategory("");
    setModalMode("create");
  }

  function openBarcodeModal() {
    setBarcodeCode("");
    setBarcodeOpen(true);
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

  function registerPreviewBarcode(formData: FormData) {
    const variantId = String(formData.get("variant_id") ?? "");
    const code = String(formData.get("code") ?? "").trim();
    if (!variantId || !code) return;
    setVariants((current) =>
      current.map((item) =>
        item.id === variantId ? { ...item, legacyCode: code } : item,
      ),
    );
    setBarcodeOpen(false);
    setSaved(true);
  }

  function updatePreviewProduct(formData: FormData) {
    const productId = String(formData.get("product_id") ?? "");
    const name = String(formData.get("product_name") ?? "").trim();
    const brand =
      String(formData.get("brand_name") ?? "").trim() || "Sin marca";
    const categoryId = String(formData.get("category_id") ?? "");
    const description = String(formData.get("description") ?? "").trim();
    if (!productId || !name || !categoryId) return;
    setVariants((current) =>
      current.map((item) =>
        (item.productId ?? `preview:${item.productName}`) === productId
          ? {
              ...item,
              productName: name,
              brand,
              categoryId,
              description,
              productActive: formData.get("is_active") === "on",
            }
          : item,
      ),
    );
    setSaved(true);
  }

  function updatePreviewVariant(formData: FormData) {
    const variantId = String(formData.get("variant_id") ?? "");
    const cost = Number(formData.get("cost"));
    if (!variantId || !Number.isFinite(cost) || cost < 0) return;
    setVariants((current) =>
      current.map((item) =>
        item.id === variantId
          ? { ...item, cost, isActive: formData.get("is_active") === "on" }
          : item,
      ),
    );
    setSaved(true);
  }

  function updatePreviewPrice(formData: FormData) {
    const variantId = String(formData.get("variant_id") ?? "");
    const price = Number(formData.get("price"));
    if (!variantId || !Number.isFinite(price) || price < 0) return;
    setVariants((current) =>
      current.map((item) =>
        item.id === variantId ? { ...item, price } : item,
      ),
    );
    setSaved(true);
  }

  async function handleScannedCode(code: string, target: ScannerTarget) {
    setScannerTarget(null);
    if (target === "barcode") {
      setBarcodeCode(code);
      setScanFeedback({
        kind: "found",
        message: `Código ${code} listo para revisar y guardar.`,
      });
      return;
    }

    setQuery(code);
    const localMatch = variants.find((item) => item.legacyCode === code);
    if (localMatch) {
      setScanFeedback({
        kind: "found",
        message: `${localMatch.productName} · ${localMatch.color} · talla ${localMatch.size}`,
      });
      return;
    }

    if (preview || !lookupBarcodeAction) {
      setScanFeedback({
        kind: "missing",
        message: `No encontramos el código ${code} en el catálogo.`,
      });
      return;
    }

    setScanFeedback({ kind: "working", message: "Buscando en el catálogo…" });
    const match = await lookupBarcodeAction(code);
    if (!match) {
      setScanFeedback({
        kind: "missing",
        message: `No encontramos el código ${code} en el catálogo.`,
      });
      return;
    }

    setVariants((current) =>
      current.some((item) => item.id === match.id)
        ? current
        : [match, ...current],
    );
    setQuery(match.legacyCode);
    setScanFeedback({
      kind: "found",
      message: `${match.productName} · ${match.color} · talla ${match.size}`,
    });
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
          {previewImportAction && commitImportAction && initialImportState ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => setImportOpen(true)}
            >
              <Upload aria-hidden="true" />
              Carga masiva
            </button>
          ) : null}
          <Link className="secondary-button" href="/etiquetas">
            <Tags aria-hidden="true" />
            Etiquetas
          </Link>
          {preview || registerBarcodeAction ? (
            <button
              className="secondary-button"
              type="button"
              onClick={openBarcodeModal}
              disabled={variants.length === 0}
            >
              <Barcode aria-hidden="true" />
              Registrar código
            </button>
          ) : null}
          {preview || addVariantsAction ? (
            <button
              className="secondary-button"
              type="button"
              onClick={openAddModal}
              disabled={products.length === 0}
            >
              <Plus aria-hidden="true" />
              Agregar variantes
            </button>
          ) : null}
          {preview || createAction ? (
            <button
              className="primary-button"
              type="button"
              onClick={openCreateModal}
            >
              <Plus aria-hidden="true" />
              Nuevo producto
            </button>
          ) : null}
        </div>
      </div>

      {status && statusMessages[status] ? (
        <div
          className={
            [
              "producto-creado",
              "variantes-agregadas",
              "codigo-registrado",
              "producto-actualizado",
              "variante-actualizada",
              "precio-actualizado",
            ].includes(status)
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
            onChange={(event) => {
              setQuery(event.target.value);
              setScanFeedback(null);
            }}
            placeholder="Buscar producto, marca o código"
            aria-label="Buscar productos"
          />
        </label>
        <button
          className="secondary-button scan-camera-button"
          type="button"
          onClick={() => setScannerTarget("search")}
        >
          <Camera aria-hidden="true" />
          Escanear con cámara
        </button>
      </div>

      {scanFeedback ? (
        <div
          className={`scan-feedback ${scanFeedback.kind}`}
          role={scanFeedback.kind === "missing" ? "alert" : "status"}
        >
          <span>{scanFeedback.message}</span>
          {scanFeedback.kind === "missing" ? (
            <button
              className="text-button"
              type="button"
              onClick={openCreateModal}
            >
              Dar de alta
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="data-table">
        <div className={`table-row table-header${canEdit ? " editable" : ""}`}>
          <span>Producto</span>
          <span>Código</span>
          <span>Variante</span>
          <span>Precio</span>
          <span>Inventario</span>
          {canEdit ? <span>Acciones</span> : null}
        </div>
        {filteredVariants.map((item) => (
          <div
            className={`table-row${canEdit ? " editable" : ""}`}
            key={item.id}
          >
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
                {item.isActive === false ? (
                  <em className="variant-inactive">Dada de baja</em>
                ) : null}
                <small>{item.brand}</small>
              </strong>
            </div>
            <code>{item.legacyCode}</code>
            <span>
              {item.color} · {item.size}
            </span>
            <span>{money.format(item.price)}</span>
            <span className="stock-number out">Se activa en M3</span>
            {canEdit ? (
              <button
                className="table-edit-button"
                type="button"
                onClick={() => setEditingVariantId(item.id)}
                aria-label={`Editar ${item.productName}, ${item.color}, talla ${item.size}`}
              >
                <Pencil aria-hidden="true" />
                Editar
              </button>
            ) : null}
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
                        <option value="" disabled>
                          Selecciona una categoría
                        </option>
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
                {!selectedCategory ? (
                  <p>
                    Elige primero la categoría para mostrar las tallas que le
                    corresponden.
                  </p>
                ) : sizes.length === 0 ? (
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

      {barcodeOpen ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal product-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="barcode-modal-title"
          >
            <header className="modal-heading">
              <div>
                <p className="eyebrow">Identificación física</p>
                <h2 id="barcode-modal-title">Registrar código</h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setBarcodeOpen(false)}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <p className="barcode-modal-copy">
              El nuevo código quedará como principal. Los anteriores no se
              borran y seguirán encontrando esta misma variante.
            </p>
            <form
              action={preview ? registerPreviewBarcode : registerBarcodeAction}
            >
              <div className="settings-form">
                <label className="wide-field">
                  <span>Producto y variante</span>
                  <select
                    name="variant_id"
                    value={selectedBarcodeVariant}
                    onChange={(event) =>
                      setSelectedBarcodeVariant(event.target.value)
                    }
                    required
                  >
                    {/* Sólo las activas: `register_variant_barcode` exige que la
                        variante y su producto lo estén, así que ofrecer una dada
                        de baja sólo produce un «variante no encontrada». */}
                    {variants
                      .filter((variant) => variant.isActive !== false)
                      .map((variant) => (
                        <option value={variant.id} key={variant.id}>
                          {variant.productName} · {variant.color} · talla{" "}
                          {variant.size}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span>Motivo</span>
                  <select name="source" defaultValue="SUPPLIER" required>
                    <option value="SUPPLIER">Código del proveedor</option>
                    <option value="MANUAL">Reimpresión / reemplazo</option>
                  </select>
                </label>
                <label>
                  <span>Simbología</span>
                  <select name="symbology" defaultValue="EAN13" required>
                    <option value="EAN13">EAN-13</option>
                    <option value="CODE128">CODE 128</option>
                  </select>
                </label>
                <div className="wide-field barcode-capture-field">
                  <label>
                    <span>Código leído</span>
                    <input
                      ref={barcodeInputRef}
                      name="code"
                      autoComplete="off"
                      inputMode="text"
                      maxLength={80}
                      placeholder="Escanea o escribe el código"
                      value={barcodeCode}
                      onChange={(event) => setBarcodeCode(event.target.value)}
                      required
                    />
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setScannerTarget("barcode")}
                  >
                    <Camera aria-hidden="true" />
                    Usar cámara
                  </button>
                </div>
              </div>
              <div className="notice barcode-warning">
                <strong>Antes de usar uno del proveedor</strong>
                <span>
                  Escanea dos tallas distintas. Si muestran el mismo número, no
                  lo registres: no permitiría distinguir el inventario.
                </span>
              </div>
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setBarcodeOpen(false)}
                >
                  Cancelar
                </button>
                <BarcodeSubmitButton />
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {editingVariant ? (
        <div className="modal-backdrop">
          <section
            className="checkout-modal product-modal edit-product-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-product-title"
          >
            <header className="modal-heading">
              <div>
                <p className="eyebrow">Edición protegida</p>
                <h2 id="edit-product-title">Editar producto y variante</h2>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setEditingVariantId(null)}
              >
                <X aria-hidden="true" />
              </button>
            </header>

            {preview || updateProductAction ? (
              <form
                action={preview ? updatePreviewProduct : updateProductAction}
              >
                <fieldset className="edit-section">
                  <legend>Datos generales del producto</legend>
                  <p>Estos cambios se aplican a todas sus tallas y colores.</p>
                  <input
                    type="hidden"
                    name="product_id"
                    value={
                      editingVariant.productId ??
                      `preview:${editingVariant.productName}`
                    }
                  />
                  <div className="settings-form">
                    <label className="wide-field">
                      <span>Nombre del producto</span>
                      <input
                        name="product_name"
                        defaultValue={editingVariant.productName}
                        maxLength={180}
                        required
                      />
                    </label>
                    <label>
                      <span>Marca</span>
                      <input
                        name="brand_name"
                        defaultValue={
                          editingVariant.brand === "Sin marca"
                            ? ""
                            : editingVariant.brand
                        }
                        maxLength={120}
                      />
                    </label>
                    <label>
                      <span>Categoría</span>
                      <select
                        name="category_id"
                        defaultValue={editingVariant.categoryId}
                        required
                      >
                        {availableCategories.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="wide-field">
                      <span>Descripción</span>
                      <textarea
                        name="description"
                        defaultValue={editingVariant.description}
                        maxLength={4000}
                        rows={3}
                      />
                    </label>
                    <label className="toggle-field wide-field">
                      <input
                        type="checkbox"
                        name="is_active"
                        defaultChecked={editingVariant.productActive ?? true}
                      />
                      <span>Producto activo para la operación</span>
                    </label>
                  </div>
                  <EditSubmitButton label="Guardar datos generales" />
                </fieldset>
              </form>
            ) : null}

            <fieldset className="edit-section identity-section">
              <legend>Identidad protegida</legend>
              <p>Se muestra para verificarla, pero no puede editarse.</p>
              <div className="identity-grid">
                <label>
                  <span>SKU</span>
                  <input
                    value={editingVariant.sku ?? "Generado por el sistema"}
                    readOnly
                  />
                </label>
                <label>
                  <span>Código principal</span>
                  <input value={editingVariant.legacyCode} readOnly />
                </label>
                <label>
                  <span>Color</span>
                  <input value={editingVariant.color} readOnly />
                </label>
                <label>
                  <span>Talla</span>
                  <input value={editingVariant.size} readOnly />
                </label>
              </div>
            </fieldset>

            {preview || updateVariantAction ? (
              <form
                action={preview ? updatePreviewVariant : updateVariantAction}
              >
                <fieldset className="edit-section">
                  <legend>Costo y estado de esta variante</legend>
                  <input
                    type="hidden"
                    name="variant_id"
                    value={editingVariant.id}
                  />
                  <div className="settings-form">
                    <label>
                      <span>Costo</span>
                      <input
                        name="cost"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        defaultValue={editingVariant.cost ?? 0}
                        required
                      />
                    </label>
                    <label className="toggle-field">
                      <input
                        type="checkbox"
                        name="is_active"
                        defaultChecked={editingVariant.isActive ?? true}
                      />
                      <span>Variante activa</span>
                    </label>
                  </div>
                  <EditSubmitButton label="Guardar costo y estado" />
                </fieldset>
              </form>
            ) : null}

            {preview || updatePriceAction ? (
              <form action={preview ? updatePreviewPrice : updatePriceAction}>
                <fieldset className="edit-section price-edit-section">
                  <legend>Precio de venta</legend>
                  <p>
                    El cambio requiere permiso especial y queda registrado en la
                    bitácora.
                  </p>
                  <input
                    type="hidden"
                    name="variant_id"
                    value={editingVariant.id}
                  />
                  <label>
                    <span>Precio</span>
                    <input
                      name="price"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      defaultValue={editingVariant.price}
                      required
                    />
                  </label>
                  <EditSubmitButton label="Cambiar precio" />
                </fieldset>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}

      {scannerTarget ? (
        <BarcodeScanner
          title={
            scannerTarget === "search"
              ? "Buscar producto por código"
              : "Capturar código físico"
          }
          onClose={() => setScannerTarget(null)}
          onDetected={(code) => handleScannedCode(code, scannerTarget)}
        />
      ) : null}

      {importOpen &&
      previewImportAction &&
      commitImportAction &&
      initialImportState ? (
        <CatalogImportDialog
          onClose={() => setImportOpen(false)}
          previewAction={previewImportAction}
          commitAction={commitImportAction}
          initialState={initialImportState}
        />
      ) : null}
    </section>
  );
}

function BarcodeSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? "Guardando…" : "Guardar como principal"}
    </button>
  );
}

function EditSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="secondary-button edit-save-button"
      type="submit"
      disabled={pending}
    >
      {pending ? "Guardando…" : label}
    </button>
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
