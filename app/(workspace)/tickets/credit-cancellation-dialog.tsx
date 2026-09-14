"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";

import type {
  CancelCreditSaleResult,
  PrepareExchangeResult,
  ReturnAuthorizationResult,
  ReturnableSale,
} from "@/lib/returns";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

export function CreditCancellationDialog({
  saleId,
  folio,
  onClose,
  prepareAction,
  authorizeAction,
  cancelAction,
  onCancelled,
}: {
  saleId: string;
  folio: string;
  onClose: () => void;
  prepareAction: (saleId: string) => Promise<PrepareExchangeResult>;
  authorizeAction: (input: {
    employeeCode: string;
    pin: string;
  }) => Promise<ReturnAuthorizationResult>;
  cancelAction: (input: {
    idempotencyKey: string;
    cashSessionId: string;
    saleId: string;
    refundReferences: Array<{ method_code: string; reference: string }>;
    authorizationToken: string;
    reason: string;
  }) => Promise<CancelCreditSaleResult>;
  onCancelled: (reason: string) => void;
}) {
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [cashSessionId, setCashSessionId] = useState("");
  const [reason, setReason] = useState(
    "Cancelación autorizada de venta a crédito",
  );
  const [managerCode, setManagerCode] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [references, setReferences] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CancelCreditSaleResult | null>(null);
  const started = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;
    void prepareAction(saleId).then((prepared) => {
      if (!active) return;
      setBusy(false);
      if (!prepared.ok) return setError(prepared.message);
      setSale(prepared.sale);
      setCashSessionId(prepared.cashSessionId);
    });
    return () => {
      active = false;
    };
  }, [prepareAction, saleId]);

  const electronic =
    sale?.payments.filter(
      (payment) =>
        payment.requires_reference && Number(payment.amount_cents) > 0,
    ) ?? [];
  const missingReference = electronic.some(
    (payment) => (references[payment.method_code]?.trim().length ?? 0) < 3,
  );

  async function submit() {
    if (!sale || !cashSessionId) return;
    setBusy(true);
    setError("");
    const authorization = await authorizeAction({
      employeeCode: managerCode,
      pin: managerPin,
    });
    if (!authorization.ok) {
      setBusy(false);
      setManagerPin("");
      return setError(authorization.message);
    }
    const cancelled = await cancelAction({
      idempotencyKey: idempotencyKey.current,
      cashSessionId,
      saleId,
      refundReferences: electronic.map((payment) => ({
        method_code: payment.method_code,
        reference: references[payment.method_code]?.trim() ?? "",
      })),
      authorizationToken: authorization.authorizationToken,
      reason: reason.trim(),
    });
    setBusy(false);
    setManagerPin("");
    if (!cancelled.ok) return setError(cancelled.message);
    setResult(cancelled);
    onCancelled(reason.trim());
  }

  return (
    <div className="modal-backdrop">
      <section
        className="checkout-modal compact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-cancel-title"
      >
        <div className="exchange-modal-header">
          <div>
            <p className="eyebrow">M7 · operación compensada</p>
            <h2 id="credit-cancel-title">Cancelar {folio}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Cerrar cancelación"
            onClick={onClose}
            disabled={busy}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {busy && !sale ? (
          <p role="status">Consultando deuda, pagos y caja…</p>
        ) : null}
        {result?.ok ? (
          <div className="exchange-success">
            <span className="exchange-success-icon">
              <Check aria-hidden="true" />
            </span>
            <strong>Cancelación registrada</strong>
            <p>Documento compensatorio {result.returnFolio}</p>
            <div className="return-policy good">
              <strong>
                {money.format(result.debtReductionCents / 100)} redujo la deuda
              </strong>
              <span>
                {money.format(result.paidRefundCents / 100)} se reembolsó por
                los métodos realmente pagados.
              </span>
            </div>
            <button className="primary-button" type="button" onClick={onClose}>
              Terminar
            </button>
          </div>
        ) : sale ? (
          <>
            <div className="return-policy good">
              <strong>La deuda se extingue antes de devolver dinero</strong>
              <span>
                Saldo ligado al ticket:{" "}
                {money.format(Number(sale.credit_outstanding_cents) / 100)}. Los
                artículos restantes volverán al inventario vendible.
              </span>
            </div>
            <div className="form-stack">
              <label>
                <span>Motivo obligatorio</span>
                <textarea
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              {electronic.map((payment) => (
                <label key={payment.method_code}>
                  <span>Referencia del reembolso · {payment.method_name}</span>
                  <input
                    value={references[payment.method_code] ?? ""}
                    onChange={(event) =>
                      setReferences((current) => ({
                        ...current,
                        [payment.method_code]: event.target.value,
                      }))
                    }
                    placeholder="Folio de la terminal o transferencia"
                  />
                </label>
              ))}
              <div className="supervisor-panel">
                <ShieldCheck aria-hidden="true" />
                <div>
                  <strong>Autorización de gerente</strong>
                  <p>
                    La autorización se usa una sola vez y queda en auditoría.
                  </p>
                </div>
              </div>
              <label>
                <span>Código del gerente</span>
                <input
                  value={managerCode}
                  onChange={(event) => setManagerCode(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                <span>PIN del gerente</span>
                <input
                  type="password"
                  inputMode="numeric"
                  value={managerPin}
                  onChange={(event) => setManagerPin(event.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={onClose}
              >
                Volver
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={
                  busy ||
                  reason.trim().length < 3 ||
                  managerCode.trim().length < 1 ||
                  managerPin.length < 4 ||
                  missingReference
                }
                onClick={() => void submit()}
              >
                {busy ? "Cancelando…" : "Cancelar y compensar"}
              </button>
            </div>
          </>
        ) : error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
