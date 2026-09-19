"use client";

import { useEffect, useId, useState } from "react";

const RECEIPT_BOLD_KEY = "mi-tienda-receipt-bold:v1";

function readStoredPreference() {
  try {
    return window.localStorage.getItem(RECEIPT_BOLD_KEY) === "true";
  } catch {
    return false;
  }
}

export function useReceiptBoldPreference() {
  const [boldReceipt, setBoldReceiptState] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setBoldReceiptState(readStoredPreference());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function setBoldReceipt(enabled: boolean) {
    setBoldReceiptState(enabled);
    try {
      window.localStorage.setItem(RECEIPT_BOLD_KEY, String(enabled));
    } catch {
      // La preferencia sigue funcionando durante esta sesión aunque el
      // navegador bloquee el almacenamiento privado.
    }
  }

  return { boldReceipt, setBoldReceipt };
}

export function ReceiptBoldToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="receipt-bold-toggle">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>
        <strong>Todo en negritas</strong>
        <small>Mejora el contraste en impresoras térmicas.</small>
      </label>
    </div>
  );
}
