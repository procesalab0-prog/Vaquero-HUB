"use client";

import { useState } from "react";
import { Printer, Tags } from "lucide-react";
import Link from "next/link";
import {
  formatReceiptDate,
  ThermalReceipt,
  type ReceiptLine,
} from "@/components/thermal-receipt";
import { useWorkspace } from "@/components/workspace-context";
import { RECEIPT_WIDTH_MM } from "@/lib/printing";

// Renglones inventados a propósito: nombres largos y un acento, que es donde
// se nota si el ancho o la fuente quedaron mal calibrados.
const sampleLines: ReceiptLine[] = [
  {
    name: "Bota vaquera piel de avestruz",
    variant: "Miel · 27",
    code: "2000010000005",
    quantity: 1,
    unitPrice: 2890,
  },
  {
    name: "Cinturón piteado",
    variant: "Café · 34",
    code: "2000010000012",
    quantity: 2,
    unitPrice: 890,
  },
];

const subtotal = sampleLines.reduce(
  (sum, line) => sum + line.quantity * line.unitPrice,
  0,
);

export function PrintTest() {
  const { identity, activeLocation } = useWorkspace();
  const [mode, setMode] = useState<"sale" | "gift">("sale");

  return (
    <section className="module-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Puesta a punto</p>
          <h1>Prueba de impresión</h1>
          <p className="heading-copy">
            Imprime un ticket de muestra para calibrar la impresora del
            mostrador. <strong>No registra ninguna venta</strong>: no toca
            inventario, ni caja, ni folios.
          </p>
        </div>
      </div>

      <div className="content-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Antes del primer ticket</p>
            <h2>Ajustes del navegador y del controlador</h2>
          </div>
        </div>
        <ol className="setup-steps">
          <li>
            En el diálogo de impresión: <strong>márgenes en Ninguno</strong>,{" "}
            <strong>escala 100 %</strong> (no «Ajustar a la página») y{" "}
            <strong>sin encabezados ni pies de página</strong>. Si no, el ticket
            sale con la dirección web y la fecha impresas.
          </li>
          <li>
            Elige la <strong>BIXOLON SRP-330II</strong>, que es la de tickets.
            La SICAR EVA58 es la de etiquetas.
          </li>
          <li>
            Si al final alimenta papel de más, el arreglo{" "}
            <strong>no está en el sistema</strong>: entra a Dispositivos e
            impresoras → BIXOLON → Preferencias y pon el tamaño de{" "}
            <strong>rollo continuo de {RECEIPT_WIDTH_MM} mm</strong>. Se
            configura una vez y queda.
          </li>
          <li>
            Revisa que el corte caiga después del último renglón y que el logo y
            el código se lean.
          </li>
        </ol>
      </div>

      <div className="toolbar-card">
        <div className="receipt-type-switch" aria-label="Tipo de ticket">
          <button
            className={mode === "sale" ? "selected" : ""}
            type="button"
            onClick={() => setMode("sale")}
          >
            Ticket de venta
          </button>
          <button
            className={mode === "gift" ? "selected gift" : "gift"}
            type="button"
            onClick={() => setMode("gift")}
          >
            Ticket de regalo
          </button>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => window.print()}
        >
          <Printer aria-hidden="true" />
          Imprimir muestra
        </button>
        <Link className="secondary-button" href="/etiquetas">
          <Tags aria-hidden="true" />
          Probar etiquetas
        </Link>
      </div>

      <div className="receipt-paper-stage">
        <ThermalReceipt
          mode={mode}
          folio="PRUEBA-000000"
          date={formatReceiptDate()}
          items={sampleLines}
          subtotal={subtotal}
          discount={0}
          total={subtotal}
          method="Efectivo"
          tendered={5000}
          change={5000 - subtotal}
          cashierName={identity.name}
          location={activeLocation}
        />
      </div>
    </section>
  );
}
