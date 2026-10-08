"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import {
  defaultPurchasePdfFields,
  purchasePdfFields,
  supplierWhatsAppUrl,
  type PurchasePdfFields,
} from "@/lib/purchase-pdf";
import type { PurchaseOrderView, SupplierView } from "./purchases-workspace";

export function PurchasePdfDialog({
  order,
  supplier,
  location,
  canShare,
  locationId,
  prepareShareAction,
  onClose,
}: {
  order: PurchaseOrderView;
  supplier?: SupplierView;
  location: { name: string; address?: string | null; phone?: string | null };
  canShare: boolean;
  locationId: string;
  prepareShareAction: typeof import("./actions").prepareSupplierOrderShare;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<PurchasePdfFields>({
    ...defaultPurchasePdfFields,
  });
  const [names, setNames] = useState<Record<string, string>>({});
  const [terms, setTerms] = useState("");
  const [taxes, setTaxes] = useState("");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState("");
  const shareAvailable =
    canShare && supplier
      ? supplierWhatsAppUrl(supplier.phone, order.folio)
      : null;
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);

  async function prepareShare() {
    if (shareBusy || !downloaded) return;
    setShareBusy(true);
    setError("");
    try {
      const result = await prepareShareAction({
        orderId: order.id,
        locationId,
      });
      if (result.ok) setShareUrl(result.url);
      else {
        setShareUrl(null);
        setError(result.message);
      }
    } catch {
      setError(
        "No fue posible preparar WhatsApp. Revisa tu sesión y vuelve a intentar.",
      );
    } finally {
      setShareBusy(false);
    }
  }

  async function download() {
    if (busy) return;
    setBusy(true);
    setError("");
    setDownloaded(false);
    try {
      let logoBytes: Uint8Array | undefined;
      if (fields.logo) {
        const response = await fetch("/brand/logo-vaquerosm-negro.png", {
          cache: "force-cache",
        });
        if (!response.ok) throw new Error("LOGO_UNAVAILABLE");
        logoBytes = new Uint8Array(await response.arrayBuffer());
      }
      const { createPurchasePdf } = await import("@/lib/purchase-pdf");
      const result = await createPurchasePdf({
        folio: order.folio,
        date: new Date(order.createdAt).toLocaleDateString("es-MX"),
        status: {
          ORDERED: "Pendiente",
          PARTIALLY_RECEIVED: "Recepción parcial",
          RECEIVED: "Recibida",
          CANCELLED: "Cancelada",
        }[order.status],
        locationName: location.name,
        address: location.address,
        phone: location.phone,
        supplierName: order.supplierName,
        supplierContact: supplier?.contactName,
        supplierPhone: supplier?.phone,
        supplierEmail: supplier?.email,
        supplierTaxId: supplier?.taxId,
        delivery: order.expectedAt,
        terms,
        taxes,
        notes,
        fields,
        logoBytes,
        lines: order.items.map((item) => ({
          description: names[item.id]?.trim() || item.product_name,
          code: item.sku,
          quantity: item.ordered_qty,
          unitCostCents: item.unit_cost_cents,
          measureUnit: item.measure_unit,
        })),
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setDownloaded(true);
    } catch {
      setError(
        "No fue posible generar el PDF. Revisa la conexión o desmarca Logo y vuelve a intentar.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="purchase-modal purchase-pdf-modal"
        role="dialog"
        aria-modal="true"
        aria-label="PDF de orden de compra"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Orden #{order.folio}</p>
            <h2>PDF para proveedor</h2>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Cerrar PDF">
            <X />
          </button>
        </div>
        <p>
          Estos cambios son sólo para este PDF. No modifican el catálogo ni la
          orden guardada. Al cerrar se descartan.
        </p>
        <fieldset className="purchase-pdf-options">
          <legend>Datos que se incluyen</legend>
          {Object.entries(purchasePdfFields).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={fields[key as keyof PurchasePdfFields]}
                disabled={busy}
                onChange={(event) => {
                  setFields((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }));
                  setDownloaded(false);
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset className="purchase-pdf-lines">
          <legend>Nombres en el documento (opcional)</legend>
          {order.items.map((item, index) => (
            <label key={item.id}>
              Producto {index + 1} · {item.sku}
              <input
                maxLength={160}
                placeholder={item.product_name}
                value={names[item.id] ?? ""}
                disabled={busy}
                onChange={(event) => {
                  setNames((current) => ({
                    ...current,
                    [item.id]: event.target.value,
                  }));
                  setDownloaded(false);
                }}
              />
              <span>
                {item.ordered_qty} piezas · catálogo: {item.product_name}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="form-grid">
          <label>
            Condiciones de pago (opcional)
            <input
              maxLength={500}
              value={terms}
              disabled={busy || !fields.terms}
              onChange={(event) => {
                setTerms(event.target.value);
                setDownloaded(false);
              }}
            />
          </label>
          <label>
            Información de impuestos (opcional)
            <input
              maxLength={500}
              value={taxes}
              disabled={busy || !fields.taxes}
              onChange={(event) => {
                setTaxes(event.target.value);
                setDownloaded(false);
              }}
            />
            <span>
              Texto informativo; no suma impuestos ni altera el costo de la
              orden.
            </span>
          </label>
        </div>
        <label className="purchase-pdf-note">
          Notas para el proveedor (opcional)
          <textarea
            maxLength={2000}
            value={notes}
            disabled={busy || !fields.notes}
            onChange={(event) => {
              setNotes(event.target.value);
              setDownloaded(false);
            }}
          />
        </label>
        {error && (
          <p className="notice-banner" role="alert">
            {error}
          </p>
        )}
        {downloaded && (
          <p role="status">
            PDF generado. Si lo envías por WhatsApp, adjunta el archivo
            descargado; no se envía automáticamente.
          </p>
        )}
        <div className="purchase-actions purchase-pdf-footer">
          <button onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={busy || !order.items.length}
            onClick={download}
          >
            <Download />
            {busy ? "Generando…" : "Descargar PDF"}
          </button>
          {shareAvailable && downloaded && !shareUrl && (
            <button disabled={shareBusy} onClick={prepareShare}>
              {shareBusy ? "Validando envío…" : "Preparar WhatsApp"}
            </button>
          )}
          {canShare && shareUrl && downloaded && (
            <a
              className="secondary-button"
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir WhatsApp del proveedor
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
