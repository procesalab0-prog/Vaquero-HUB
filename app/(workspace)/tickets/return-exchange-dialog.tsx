"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, Check, RotateCcw, ShieldCheck, X } from "lucide-react";

import type {
  CreateExchangeResult,
  ExchangeSearchResult,
  ExchangeVariant,
  PrepareExchangeResult,
  ReturnAuthorizationResult,
  ReturnableSale,
  ReturnableSaleItem,
} from "@/lib/returns";
import { selectedReturnValue, unitExchangeValue } from "@/lib/returns";

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

type Props = {
  saleId: string;
  folio: string;
  onClose: () => void;
  prepareAction: (saleId: string) => Promise<PrepareExchangeResult>;
  searchAction: (input: {
    query: string;
    priceCents: number;
    excludeVariantId: string;
  }) => Promise<ExchangeSearchResult>;
  authorizeAction: (input: {
    employeeCode: string;
    pin: string;
  }) => Promise<ReturnAuthorizationResult>;
  createAction: (input: {
    idempotencyKey: string;
    cashSessionId: string;
    originalSaleId: string;
    saleItemId: string;
    quantity: number;
    condition: "RESELLABLE" | "DAMAGED";
    outputVariantId?: string | null;
    chargePayments: Array<{
      method_code: "CASH" | "CARD" | "TRANSFER";
      amount_cents: number;
      reference?: string;
    }>;
    refundReferences: Array<{ method_code: string; reference: string }>;
    authorizationToken: string;
    reason: string;
  }) => Promise<CreateExchangeResult>;
};

export function ReturnExchangeDialog({
  saleId,
  folio,
  onClose,
  prepareAction,
  searchAction,
  authorizeAction,
  createAction,
}: Props) {
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [mode, setMode] = useState<"RETURN" | "EXCHANGE">("RETURN");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<"RESELLABLE" | "DAMAGED">(
    "RESELLABLE",
  );
  const [query, setQuery] = useState("");
  const [variants, setVariants] = useState<ExchangeVariant[]>([]);
  const [outputId, setOutputId] = useState("");
  const [chargeMethod, setChargeMethod] = useState<
    "CASH" | "CARD" | "TRANSFER"
  >("CASH");
  const [chargeReference, setChargeReference] = useState("");
  const [refundReferences, setRefundReferences] = useState<
    Record<string, string>
  >({});
  const [reason, setReason] = useState("Devolución solicitada por el cliente");
  const [managerCode, setManagerCode] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreateExchangeResult | null>(null);
  const started = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const selectedItem =
    sale?.items.find((item) => item.sale_item_id === itemId) ?? null;
  const selectedOutput =
    variants.find((variant) => variant.id === outputId) ?? null;
  const returnedCents = selectedItem
    ? selectedReturnValue(selectedItem, quantity)
    : 0;
  const deliveredCents =
    mode === "EXCHANGE" ? (selectedOutput?.priceCents ?? 0) : 0;
  const differenceCents = deliveredCents - returnedCents;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;
    void prepareAction(saleId).then((prepared) => {
      if (!active) return;
      setBusy(false);
      if (!prepared.ok) return setError(prepared.message);
      setSale(prepared.sale);
      setSessionId(prepared.cashSessionId);
      const first = prepared.sale.items.find(
        (item) => Number(item.remaining_quantity) >= 1,
      );
      if (first) setItemId(first.sale_item_id);
    });
    return () => {
      active = false;
    };
  }, [prepareAction, saleId]);

  async function searchVariants(item: ReturnableSaleItem) {
    setBusy(true);
    setError("");
    const found = await searchAction({
      query,
      priceCents: unitExchangeValue(item),
      excludeVariantId: item.variant_id,
    });
    setBusy(false);
    if (!found.ok) return setError(found.message);
    setVariants(found.variants);
    setOutputId("");
  }

  async function submit() {
    if (
      !sale ||
      !selectedItem ||
      !sessionId ||
      (mode === "EXCHANGE" && !selectedOutput)
    )
      return;
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
    const electronicOriginals = sale.payments.filter(
      (payment) => payment.requires_reference,
    );
    const created = await createAction({
      idempotencyKey: idempotencyKey.current,
      cashSessionId: sessionId,
      originalSaleId: sale.id,
      saleItemId: selectedItem.sale_item_id,
      quantity,
      condition,
      outputVariantId: mode === "EXCHANGE" ? selectedOutput?.id : null,
      chargePayments:
        differenceCents > 0
          ? [
              {
                method_code: chargeMethod,
                amount_cents: differenceCents,
                reference:
                  chargeMethod === "CASH" ? undefined : chargeReference.trim(),
              },
            ]
          : [],
      refundReferences:
        differenceCents < 0
          ? electronicOriginals.map((payment) => ({
              method_code: payment.method_code,
              reference: refundReferences[payment.method_code]?.trim() ?? "",
            }))
          : [],
      authorizationToken: authorization.authorizationToken,
      reason,
    });
    setBusy(false);
    setManagerPin("");
    if (!created.ok) return setError(created.message);
    setResult(created);
  }

  const missingRefundReference =
    differenceCents < 0 &&
    Boolean(
      sale?.payments.some(
        (payment) =>
          payment.requires_reference &&
          !(refundReferences[payment.method_code]?.trim().length >= 3),
      ),
    );
  const missingChargeReference =
    differenceCents > 0 &&
    chargeMethod !== "CASH" &&
    chargeReference.trim().length < 3;

  return (
    <div className="modal-backdrop">
      <section
        className="checkout-modal exchange-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-title"
      >
        <div className="exchange-modal-header">
          <div>
            <p className="eyebrow">M5 · operación auditada</p>
            <h2 id="return-title">
              {result?.ok
                ? "Movimiento registrado"
                : `Cambio o devolución · ${folio}`}
            </h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Cerrar"
            disabled={busy}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        {busy && !sale ? (
          <div className="exchange-loading" role="status">
            Consultando ticket, plazo y caja…
          </div>
        ) : null}
        {result?.ok ? (
          <div className="exchange-success">
            <span className="exchange-success-icon">
              <Check aria-hidden="true" />
            </span>
            <strong>{result.folio}</strong>
            <p>
              {result.type === "RETURN" ? "La devolución" : "El cambio"} quedó
              registrado con inventario, pagos, caja y autorización de gerente.
            </p>
            <button className="primary-button" type="button" onClick={onClose}>
              Terminar
            </button>
          </div>
        ) : sale ? (
          <>
            <div
              className={
                sale.within_window
                  ? "return-policy good"
                  : "return-policy blocked"
              }
            >
              <strong>
                {sale.within_window
                  ? `Dentro del plazo de ${sale.window_days} días`
                  : "Plazo vencido"}
              </strong>
              <span>
                Fecha límite:{" "}
                {new Intl.DateTimeFormat("es-MX", {
                  dateStyle: "medium",
                }).format(new Date(sale.return_deadline))}
              </span>
            </div>
            <div className="return-mode-switch" aria-label="Tipo de operación">
              <button
                className={mode === "RETURN" ? "selected" : ""}
                type="button"
                onClick={() => {
                  setMode("RETURN");
                  setOutputId("");
                }}
              >
                <RotateCcw aria-hidden="true" />
                Devolver dinero
              </button>
              <button
                className={mode === "EXCHANGE" ? "selected" : ""}
                type="button"
                onClick={() => setMode("EXCHANGE")}
              >
                <ArrowRightLeft aria-hidden="true" />
                Cambiar producto
              </button>
            </div>
            <section className="exchange-step">
              <div className="exchange-step-heading">
                <span>1</span>
                <div>
                  <strong>Artículo que regresa</strong>
                  <small>Puedes devolver sólo una parte del ticket.</small>
                </div>
              </div>
              <div className="exchange-item-list">
                {sale.items
                  .filter((item) => Number(item.remaining_quantity) >= 1)
                  .map((item) => (
                    <button
                      className={
                        itemId === item.sale_item_id
                          ? "exchange-item selected"
                          : "exchange-item"
                      }
                      type="button"
                      key={item.sale_item_id}
                      onClick={() => {
                        setItemId(item.sale_item_id);
                        setQuantity(1);
                        setOutputId("");
                      }}
                    >
                      <span>
                        <strong>{item.product_name}</strong>
                        <small>
                          {item.variant_description} · {item.sku}
                        </small>
                      </span>
                      <span>
                        <strong>
                          {money.format(unitExchangeValue(item) / 100)}
                        </strong>
                        <small>
                          {Number(item.remaining_quantity)} disponible(s)
                        </small>
                      </span>
                    </button>
                  ))}
              </div>
              {selectedItem ? (
                <div className="return-item-options">
                  <label>
                    <span>Cantidad</span>
                    <select
                      value={quantity}
                      onChange={(event) =>
                        setQuantity(Number(event.target.value))
                      }
                    >
                      {Array.from(
                        { length: Number(selectedItem.remaining_quantity) },
                        (_, index) => (
                          <option value={index + 1} key={index + 1}>
                            {index + 1}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    <span>Estado</span>
                    <select
                      value={condition}
                      onChange={(event) =>
                        setCondition(
                          event.target.value as "RESELLABLE" | "DAMAGED",
                        )
                      }
                    >
                      <option value="RESELLABLE">
                        Puede volver a venderse
                      </option>
                      <option value="DAMAGED">
                        Dañado · no vuelve a existencia
                      </option>
                    </select>
                  </label>
                </div>
              ) : null}
            </section>
            {mode === "EXCHANGE" && selectedItem ? (
              <section className="exchange-step">
                <div className="exchange-step-heading">
                  <span>2</span>
                  <div>
                    <strong>Artículo que se lleva</strong>
                    <small>
                      Puede ser de precio diferente; la diferencia se cobra o
                      devuelve.
                    </small>
                  </div>
                </div>
                <form
                  className="exchange-search"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void searchVariants(selectedItem);
                  }}
                >
                  <label className="module-search">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Nombre, SKU o código"
                      aria-label="Buscar reemplazo"
                    />
                  </label>
                  <button
                    className="secondary-button"
                    type="submit"
                    disabled={busy}
                  >
                    Buscar
                  </button>
                </form>
                <div className="exchange-candidate-list">
                  {variants.map((variant) => (
                    <button
                      className={
                        outputId === variant.id
                          ? "exchange-candidate selected"
                          : "exchange-candidate"
                      }
                      type="button"
                      key={variant.id}
                      onClick={() => setOutputId(variant.id)}
                    >
                      <span>
                        <strong>{variant.productName}</strong>
                        <small>
                          {variant.brand} · Talla {variant.size} ·{" "}
                          {variant.color}
                        </small>
                        <code>{variant.sku}</code>
                      </span>
                      <span>
                        <strong>
                          {money.format(variant.priceCents / 100)}
                        </strong>
                        <small>{variant.stock} disponible(s)</small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {selectedItem && (mode === "RETURN" || selectedOutput) ? (
              <section className="exchange-step">
                <div className="exchange-step-heading">
                  <span>{mode === "RETURN" ? "2" : "3"}</span>
                  <div>
                    <strong>
                      {differenceCents < 0
                        ? "Dinero a devolver"
                        : differenceCents > 0
                          ? "Diferencia a cobrar"
                          : "Sin diferencia"}
                    </strong>
                    <small>
                      {differenceCents < 0
                        ? "El sistema conserva los métodos del ticket original."
                        : "Todo quedará ligado al ticket original."}
                    </small>
                  </div>
                </div>
                <div className="return-total">
                  <span>
                    {differenceCents < 0 ? "Reembolso" : "Diferencia"}
                  </span>
                  <strong>
                    {money.format(Math.abs(differenceCents) / 100)}
                  </strong>
                </div>
                {differenceCents < 0 ? (
                  <div className="refund-methods">
                    <p>
                      <strong>Mismos métodos de la compra</strong>
                    </p>
                    {sale.payments.map((payment) => (
                      <label key={payment.method_code}>
                        <span>
                          {payment.method_name} · hasta{" "}
                          {money.format(Number(payment.amount_cents) / 100)}
                        </span>
                        {payment.requires_reference ? (
                          <input
                            value={refundReferences[payment.method_code] ?? ""}
                            onChange={(event) =>
                              setRefundReferences((current) => ({
                                ...current,
                                [payment.method_code]: event.target.value,
                              }))
                            }
                            placeholder="Referencia del reembolso"
                          />
                        ) : (
                          <small>Se descontará de la caja actual.</small>
                        )}
                      </label>
                    ))}
                  </div>
                ) : null}
                {differenceCents > 0 ? (
                  <div className="return-item-options">
                    <label>
                      <span>Método para cobrar</span>
                      <select
                        value={chargeMethod}
                        onChange={(event) =>
                          setChargeMethod(
                            event.target.value as typeof chargeMethod,
                          )
                        }
                      >
                        <option value="CASH">Efectivo</option>
                        <option value="CARD">Tarjeta</option>
                        <option value="TRANSFER">Transferencia</option>
                      </select>
                    </label>
                    {chargeMethod !== "CASH" ? (
                      <label>
                        <span>Referencia</span>
                        <input
                          value={chargeReference}
                          onChange={(event) =>
                            setChargeReference(event.target.value)
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
                <label className="exchange-reason">
                  <span>Motivo obligatorio</span>
                  <textarea
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              </section>
            ) : null}
            <section className="exchange-step">
              <div className="exchange-step-heading">
                <span>
                  <ShieldCheck aria-hidden="true" />
                </span>
                <div>
                  <strong>Autorización de gerente</strong>
                  <small>
                    El PIN no se muestra ni se guarda en el navegador.
                  </small>
                </div>
              </div>
              <div className="return-item-options">
                <label>
                  <span>Código de gerente</span>
                  <input
                    autoCapitalize="characters"
                    value={managerCode}
                    onChange={(event) =>
                      setManagerCode(event.target.value.toUpperCase())
                    }
                    placeholder="ADMIN0"
                  />
                </label>
                <label>
                  <span>PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={managerPin}
                    onChange={(event) =>
                      setManagerPin(
                        event.target.value.replace(/\D/g, "").slice(0, 8),
                      )
                    }
                  />
                </label>
              </div>
            </section>
          </>
        ) : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        {!result?.ok ? (
          <div className="modal-actions exchange-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={onClose}
            >
              Cerrar
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={
                busy ||
                !sale?.within_window ||
                !selectedItem ||
                (mode === "EXCHANGE" && !selectedOutput) ||
                managerCode.trim().length < 2 ||
                managerPin.length < 4 ||
                reason.trim().length < 3 ||
                missingRefundReference ||
                missingChargeReference
              }
              onClick={() => void submit()}
            >
              {busy ? "Registrando…" : "Autorizar y registrar"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
