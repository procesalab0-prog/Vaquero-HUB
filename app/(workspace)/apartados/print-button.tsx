"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      className="secondary-button no-print"
      type="button"
      onClick={() => window.print()}
    >
      <Printer aria-hidden="true" /> Imprimir comprobante
    </button>
  );
}
