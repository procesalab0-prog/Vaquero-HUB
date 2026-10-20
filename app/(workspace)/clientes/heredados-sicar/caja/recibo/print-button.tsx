"use client";
export function PrintTrialReceipt() {
  return (
    <button
      type="button"
      className="button secondary"
      onClick={() => window.print()}
    >
      Imprimir recibo de ensayo
    </button>
  );
}
