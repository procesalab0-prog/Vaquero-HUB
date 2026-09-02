"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Check,
  Info,
  Minus,
  Monitor,
  Plus,
  Printer,
  Search,
  Settings2,
  Tags,
} from "lucide-react";

import { LabelBarcode } from "@/components/label-barcode";
import type { LabelTemplate, ProductVariant } from "@/lib/domain";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

const statusMessages: Record<string, string> = {
  "plantilla-guardada": "La plantilla quedó guardada y lista para imprimir.",
  "plantilla-invalida":
    "Revisa el nombre, las medidas y conserva al menos el código visible o escaneable.",
  "plantilla-duplicada": "Ya existe una plantilla con ese nombre.",
  "plantilla-sin-permiso":
    "Tu rol puede imprimir, pero no modificar plantillas.",
  "plantilla-error": "No fue posible guardar la plantilla.",
  "etiquetas-pendientes":
    "La vista de diseño está disponible; falta aplicar la migración de etiquetas en este entorno.",
};

function ProductLabel({
  variant,
  template,
  printable = false,
}: {
  variant: ProductVariant;
  template: LabelTemplate;
  printable?: boolean;
}) {
  return (
    <article
      className={`product-label label-layout-${template.layout.toLowerCase()}${printable ? " print-product-label" : ""}`}
      style={
        {
          "--label-width": `${template.widthMm}mm`,
          "--label-height": `${template.heightMm}mm`,
        } as CSSProperties
      }
      aria-label={`Etiqueta de ${variant.productName}, ${variant.color}, talla ${variant.size}`}
    >
      {template.showLogo ? (
        <Image
          className="label-logo"
          src="/brand/logo-vaquerosm-negro.png"
          alt="Vaquero SM"
          width={300}
          height={200}
        />
      ) : null}
      {template.showProductName ? (
        <strong className="label-product-name">{variant.productName}</strong>
      ) : null}
      {template.showBrand ? (
        <span className="label-product-brand">{variant.brand}</span>
      ) : null}
      {template.showSize || template.showColor ? (
        <small className="label-variant">
          {[
            template.showColor ? variant.color : "",
            template.showSize ? `Talla ${variant.size}` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      ) : null}
      {template.showBarcode ? <LabelBarcode code={variant.legacyCode} /> : null}
      {template.showCode ? <code>{variant.legacyCode}</code> : null}
      {template.showSku && variant.sku ? (
        <span className="label-sku">SKU {variant.sku}</span>
      ) : null}
      {template.showPrice ? <b>{money.format(variant.price)}</b> : null}
    </article>
  );
}

export function LabelsWorkspace({
  variants,
  templates,
  canManageTemplates = false,
  saveTemplateAction,
  preview = false,
  status,
  fromProducts = false,
}: {
  variants: ProductVariant[];
  templates: LabelTemplate[];
  canManageTemplates?: boolean;
  saveTemplateAction?: (formData: FormData) => Promise<void>;
  preview?: boolean;
  status?: string;
  fromProducts?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [templateId, setTemplateId] = useState(
    templates.find((template) => template.isDefault)?.id ?? templates[0]?.id,
  );
  const [printed, setPrinted] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const activeTemplate =
    templates.find((template) => template.id === templateId) ?? templates[0];

  useEffect(() => {
    if (!fromProducts) return;
    try {
      const ids = JSON.parse(
        window.sessionStorage.getItem("mi-tienda-label-selection") ?? "[]",
      ) as unknown;
      if (Array.isArray(ids)) {
        const available = new Set(variants.map((variant) => variant.id));
        setSelected(
          Object.fromEntries(
            ids
              .filter(
                (id): id is string =>
                  typeof id === "string" && available.has(id),
              )
              .map((id) => [id, 1]),
          ),
        );
      }
      window.sessionStorage.removeItem("mi-tienda-label-selection");
    } catch {
      window.sessionStorage.removeItem("mi-tienda-label-selection");
    }
  }, [fromProducts, variants]);

  const results = useMemo(() => {
    const term = deferredQuery.trim().toLocaleLowerCase("es-MX");
    if (!term) return variants;
    return variants.filter((item) =>
      [
        item.productName,
        item.brand,
        item.legacyCode,
        item.sku,
        item.color,
        item.size,
      ]
        .join(" ")
        .toLocaleLowerCase("es-MX")
        .includes(term),
    );
  }, [deferredQuery, variants]);
  const totalLabels = Object.values(selected).reduce(
    (sum, count) => sum + count,
    0,
  );
  const previewVariant =
    variants.find((item) => selected[item.id]) ?? variants[0];
  const printQueue = variants.flatMap((variant) =>
    Array.from({ length: selected[variant.id] ?? 0 }, (_, index) => ({
      variant,
      key: `${variant.id}-${index}`,
    })),
  );

  function changeCount(id: string, delta: number) {
    if (delta > 0 && totalLabels >= 500) return;
    setSelected((current) => {
      const next = Math.min(99, Math.max(0, (current[id] ?? 0) + delta));
      if (next === 0) {
        const { [id]: removed, ...rest } = current;
        void removed;
        return rest;
      }
      return { ...current, [id]: next };
    });
  }

  function printLabels() {
    if (!totalLabels) return;
    setPrinted(true);
    window.requestAnimationFrame(() => window.print());
  }

  if (!activeTemplate || !previewVariant) {
    return (
      <section className="module-page labels-page">
        <div className="section-heading">
          <div>
            <p className="eyebrow">M2.5 · Etiquetas</p>
            <h1>Etiquetas y códigos de barras</h1>
          </div>
        </div>
        <div className="admin-empty">
          <Tags aria-hidden="true" />
          <strong>No hay productos activos para etiquetar</strong>
          <span>Activa o crea una variante en Productos.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="module-page labels-page">
      <style media="print">{`@page { size: ${activeTemplate.widthMm}mm ${activeTemplate.heightMm}mm; margin: 0; }`}</style>
      <div className="section-heading">
        <div>
          <p className="eyebrow">M2.5 · Catálogo</p>
          <h1>Etiquetas y códigos de barras</h1>
          <p className="heading-copy">
            Selecciona variantes, revisa la etiqueta real y manda el lote a la
            impresora.
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={!totalLabels}
          onClick={printLabels}
        >
          <Printer aria-hidden="true" />
          Imprimir {totalLabels || ""} etiquetas
        </button>
      </div>
      {status && statusMessages[status] ? (
        <div
          className={
            status === "plantilla-guardada"
              ? "admin-status"
              : "admin-status error"
          }
          role="status"
        >
          {statusMessages[status]}
        </div>
      ) : null}
      <div className="rule-notice">
        <Info aria-hidden="true" />
        <div>
          <strong>Los códigos no se regeneran al imprimir</strong>
          <span>
            La etiqueta usa el código principal que ya identifica a la variante.
            Reimprimir nunca cambia su identidad.
          </span>
        </div>
      </div>
      <div className="desktop-print-notice">
        <Monitor aria-hidden="true" />
        <span>
          <strong>Imprime desde la computadora de trastienda</strong> Esta
          pantalla genera códigos escaneables; la medida física debe probarse
          con la impresora y rollo reales.
        </span>
      </div>

      <div className="labels-layout">
        <section className="content-card labels-selector">
          <label className="module-search">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar producto, talla o código"
              aria-label="Buscar productos para etiquetar"
            />
          </label>
          <div className="label-product-list">
            {results.map((item) => {
              const count = selected[item.id] ?? 0;
              return (
                <article
                  className={count ? "label-product selected" : "label-product"}
                  key={item.id}
                >
                  <span className="barcode-icon">
                    <Tags aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{item.productName}</strong>
                    <small>
                      {item.color} · {item.size} · {money.format(item.price)}
                    </small>
                    <code>{item.legacyCode}</code>
                  </div>
                  <div className="label-stepper">
                    <button
                      type="button"
                      disabled={!count}
                      aria-label={`Quitar etiqueta de ${item.productName}`}
                      onClick={() => changeCount(item.id, -1)}
                    >
                      <Minus aria-hidden="true" />
                    </button>
                    <strong>{count}</strong>
                    <button
                      type="button"
                      disabled={count >= 99 || totalLabels >= 500}
                      aria-label={`Agregar etiqueta de ${item.productName}`}
                      onClick={() => changeCount(item.id, 1)}
                    >
                      <Plus aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="content-card label-preview-panel">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Vista previa real</p>
              <h2>{activeTemplate.name}</h2>
            </div>
            <Tags aria-hidden="true" />
          </div>
          <label className="template-select">
            <span>Plantilla</span>
            <select
              value={activeTemplate.id}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.isDefault ? " · Predeterminada" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="label-preview-stage">
            <ProductLabel variant={previewVariant} template={activeTemplate} />
          </div>
          <dl className="label-settings">
            <div>
              <dt>Medida</dt>
              <dd>
                {activeTemplate.widthMm} × {activeTemplate.heightMm} mm
              </dd>
            </div>
            <div>
              <dt>Acomodo</dt>
              <dd>
                {activeTemplate.layout === "BALANCED"
                  ? "Balanceado"
                  : activeTemplate.layout === "PRODUCT_FOCUS"
                    ? "Producto destacado"
                    : "Precio destacado"}
              </dd>
            </div>
            <div>
              <dt>Código</dt>
              <dd>
                {/^\d{13}$/.test(previewVariant.legacyCode)
                  ? "EAN-13"
                  : "CODE 128"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      {canManageTemplates && saveTemplateAction ? (
        <details className="content-card label-template-editor">
          <summary>
            <Settings2 aria-hidden="true" />
            <span>
              <strong>Editar plantilla seleccionada</strong>
              <small>Medida, acomodo y campos visibles</small>
            </span>
          </summary>
          <form
            action={saveTemplateAction}
            className="label-template-form"
            key={activeTemplate.id}
          >
            <input
              type="hidden"
              name="id"
              value={
                activeTemplate.id.startsWith("preview-")
                  ? ""
                  : activeTemplate.id
              }
            />
            <label>
              <span>Nombre</span>
              <input
                name="name"
                defaultValue={activeTemplate.name}
                maxLength={80}
                required
              />
            </label>
            <label>
              <span>Ancho (mm)</span>
              <input
                name="width_mm"
                type="number"
                min="20"
                max="120"
                step="0.1"
                defaultValue={activeTemplate.widthMm}
                required
              />
            </label>
            <label>
              <span>Alto (mm)</span>
              <input
                name="height_mm"
                type="number"
                min="15"
                max="100"
                step="0.1"
                defaultValue={activeTemplate.heightMm}
                required
              />
            </label>
            <label>
              <span>Acomodo</span>
              <select name="layout" defaultValue={activeTemplate.layout}>
                <option value="BALANCED">Balanceado</option>
                <option value="PRODUCT_FOCUS">Producto destacado</option>
                <option value="PRICE_FOCUS">Precio destacado</option>
              </select>
            </label>
            <fieldset>
              <legend>Campos visibles</legend>
              {[
                ["show_logo", "Logo", activeTemplate.showLogo],
                [
                  "show_product_name",
                  "Producto",
                  activeTemplate.showProductName,
                ],
                ["show_brand", "Marca", activeTemplate.showBrand],
                ["show_size", "Talla", activeTemplate.showSize],
                ["show_color", "Color", activeTemplate.showColor],
                ["show_price", "Precio", activeTemplate.showPrice],
                ["show_sku", "SKU", activeTemplate.showSku],
                ["show_barcode", "Barras", activeTemplate.showBarcode],
                ["show_code", "Número de código", activeTemplate.showCode],
              ].map(([name, label, checked]) => (
                <label className="label-field-toggle" key={String(name)}>
                  <input
                    type="checkbox"
                    name={String(name)}
                    defaultChecked={Boolean(checked)}
                  />
                  <span>{String(label)}</span>
                </label>
              ))}
            </fieldset>
            <label className="label-field-toggle">
              <input
                type="checkbox"
                name="is_default"
                defaultChecked={activeTemplate.isDefault}
              />
              <span>Usar como predeterminada</span>
            </label>
            <label className="label-field-toggle">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={activeTemplate.isActive}
              />
              <span>Plantilla activa</span>
            </label>
            <button className="primary-button" type="submit">
              Guardar plantilla
            </button>
          </form>
        </details>
      ) : null}

      <div className="print-label-sheet" aria-hidden="true">
        {printQueue.map(({ variant, key }) => (
          <ProductLabel
            key={key}
            variant={variant}
            template={activeTemplate}
            printable
          />
        ))}
      </div>
      {printed ? (
        <div className="inline-success" role="status">
          <Check aria-hidden="true" />
          Lote enviado al diálogo de impresión
          <button type="button" onClick={() => setPrinted(false)}>
            Cerrar
          </button>
        </div>
      ) : null}
      {preview ? (
        <p className="demo-caption">
          Modo de demostración: la plantilla real se guarda al conectar
          Supabase.
        </p>
      ) : null}
    </section>
  );
}
