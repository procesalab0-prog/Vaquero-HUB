"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export function LabelBarcode({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !code || code === "Sin código") return;
    try {
      JsBarcode(ref.current, code, {
        format: /^\d{13}$/.test(code) ? "EAN13" : "CODE128",
        displayValue: false,
        height: 44,
        margin: 0,
        width: 1.5,
      });
    } catch {
      ref.current.replaceChildren();
    }
  }, [code]);

  if (!code || code === "Sin código") {
    return <span className="label-no-barcode">Sin código imprimible</span>;
  }
  return (
    <svg
      className="label-barcode-svg"
      ref={ref}
      aria-label={`Código de barras ${code}`}
    />
  );
}
