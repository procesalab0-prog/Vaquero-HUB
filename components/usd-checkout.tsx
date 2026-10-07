"use client";
import { useRef, useState } from "react";
import { calculateUsdTender, type UsdExchangeQuote } from "@/lib/usd-exchange";

export type UsdTenderInput = { quoteId: string; receivedUsdCents: number };
export function UsdCheckout({
  sessionId,
  totalCents,
  disabled,
  onConfirm,
  prepareAction,
}: {
  sessionId: string;
  totalCents: number;
  disabled: boolean;
  onConfirm: (input: UsdTenderInput) => Promise<void>;
  prepareAction: (
    sessionId: string,
  ) => Promise<
    { ok: true; quote: UsdExchangeQuote } | { ok: false; message: string }
  >;
}) {
  const [quote, setQuote] = useState<UsdExchangeQuote | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const normalized = text.trim().replace(",", ".");
  const usdCents = /^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)
    ? Number(
        BigInt(normalized.split(".")[0]) * BigInt(100) +
          BigInt((normalized.split(".")[1] ?? "").padEnd(2, "0")),
      )
    : 0;
  const tender = quote
    ? calculateUsdTender(usdCents, Number(quote.rate_million), totalCents)
    : null;
  async function load() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await prepareAction(sessionId);
      if (result.ok) setQuote(result.quote);
      else setError(result.message);
    } catch {
      setError("No fue posible consultar Banxico. Intenta nuevamente.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (!quote || !tender || disabled || lock.current) return;
    if (Date.parse(quote.expires_at) <= Date.now()) {
      setError("La tasa caducó. Actualízala antes de cobrar.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await onConfirm({ quoteId: quote.id, receivedUsdCents: usdCents });
    } catch {
      setError(
        "No se pudo confirmar. Revisa el estado del ticket antes de reintentar.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <fieldset
      className="form-stack"
      disabled={disabled || busy}
      style={{ minWidth: 0 }}
    >
      <legend>Dólares en efectivo</legend>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void load()}
      >
        {quote ? "Actualizar tasa" : "Consultar tasa FIX"}
      </button>
      {quote ? (
        <>
          <p>
            FIX {quote.reference_date} · tasa aplicada:{" "}
            {Number(quote.rate_million) / 1000000} MXN por USD
          </p>
          <label>
            <span>Dólares recibidos (USD)</span>
            <input
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p>
            Equivalente:{" "}
            {tender
              ? `$${(tender.equivalentMxnCents / 100).toFixed(2)} MXN`
              : "Captura un importe que cubra la venta"}
          </p>
          {tender ? (
            <p>Cambio: ${(tender.changeMxnCents / 100).toFixed(2)} MXN</p>
          ) : null}
          <small>
            El cambio y cualquier reembolso se entregan en pesos. El reembolso
            conserva la tasa original.
          </small>
          <button
            type="button"
            className="primary-button"
            disabled={!tender || busy || disabled}
            onClick={() => void confirm()}
          >
            Cobrar en dólares
          </button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="inline-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
