"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Banknote, Check, CreditCard, Landmark, LockKeyhole, Plus } from "lucide-react";

type Movement = { id: number; time: string; type: "Entrada" | "Retiro"; concept: string; amount: number };

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const initialMovements: Movement[] = [
  { id: 1, time: "10:12", type: "Retiro", concept: "Pago a paquetería", amount: 350 },
  { id: 2, time: "12:40", type: "Entrada", concept: "Cambio adicional", amount: 500 },
];

export function CashRegister() {
  const [open, setOpen] = useState(true);
  const [movements, setMovements] = useState(initialMovements);
  const [movementType, setMovementType] = useState<Movement["type"] | null>(null);
  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const [message, setMessage] = useState("");

  const movementBalance = movements.reduce((sum, item) => sum + (item.type === "Entrada" ? item.amount : -item.amount), 0);
  const expected = 2500 + 16240 + movementBalance;

  function addMovement() {
    const parsed = Number(amount);
    if (!movementType || !concept.trim() || !Number.isFinite(parsed) || parsed <= 0) return;
    setMovements((current) => [{ id: Date.now(), time: "Ahora", type: movementType, concept: concept.trim(), amount: parsed }, ...current]);
    setMovementType(null);
    setAmount("");
    setConcept("");
    setMessage("Movimiento registrado en la vista de diseño");
  }

  if (!open) {
    return (
      <section className="module-page cash-closed-state">
        <span><LockKeyhole aria-hidden="true" /></span><p className="eyebrow">Caja 01</p><h1>Caja cerrada</h1>
        <p>Abre una sesión para registrar ventas y movimientos en La Piedad.</p>
        <button className="primary-button" type="button" onClick={() => setOpen(true)}>Abrir caja con {money.format(2500)}</button>
      </section>
    );
  }

  return (
    <section className="module-page">
      <div className="section-heading">
        <div><p className="eyebrow">Sesión abierta · Caja 01</p><h1>Control de caja</h1><p className="heading-copy">Abierta hoy a las 09:52 por Salomon.</p></div>
        <button className="secondary-button danger-outline" type="button" onClick={() => setOpen(false)}><LockKeyhole aria-hidden="true" />Realizar corte</button>
      </div>

      <div className="metric-grid cash-metrics">
        <article><span>Fondo inicial</span><strong>{money.format(2500)}</strong><small>Registrado al abrir</small></article>
        <article><span>Ventas del turno</span><strong>{money.format(16240)}</strong><small>8 operaciones</small></article>
        <article><span>Movimientos</span><strong>{money.format(movementBalance)}</strong><small>{movements.length} movimientos manuales</small></article>
        <article className="accent-metric"><span>Efectivo esperado</span><strong>{money.format(expected)}</strong><small>Antes de contar físicamente</small></article>
      </div>

      <div className="cash-columns">
        <section className="content-card">
          <div className="card-heading"><div><p className="eyebrow">Resumen</p><h2>Pagos registrados</h2></div></div>
          <div className="payment-summary-list">
            <div><span className="payment-icon"><Banknote aria-hidden="true" /></span><span><strong>Efectivo</strong><small>4 ventas</small></span><b>{money.format(7290)}</b></div>
            <div><span className="payment-icon"><CreditCard aria-hidden="true" /></span><span><strong>Tarjeta</strong><small>3 ventas</small></span><b>{money.format(6050)}</b></div>
            <div><span className="payment-icon"><Landmark aria-hidden="true" /></span><span><strong>Transferencia</strong><small>1 venta</small></span><b>{money.format(2900)}</b></div>
          </div>
          <div className="cash-actions">
            <button type="button" onClick={() => setMovementType("Entrada")}><ArrowDownLeft aria-hidden="true" />Registrar entrada</button>
            <button type="button" onClick={() => setMovementType("Retiro")}><ArrowUpRight aria-hidden="true" />Registrar retiro</button>
          </div>
        </section>

        <section className="content-card">
          <div className="card-heading"><div><p className="eyebrow">Auditoría</p><h2>Movimientos manuales</h2></div><button className="text-button" type="button" onClick={() => setMovementType("Entrada")}><Plus aria-hidden="true" />Nuevo</button></div>
          <div className="movement-list">
            {movements.map((item) => (
              <article key={item.id}><span className={item.type === "Entrada" ? "movement-kind income" : "movement-kind outcome"}>{item.type === "Entrada" ? <ArrowDownLeft aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}</span><div><strong>{item.concept}</strong><small>{item.time} · Salomon</small></div><b className={item.type === "Entrada" ? "positive" : "negative"}>{item.type === "Entrada" ? "+" : "−"}{money.format(item.amount)}</b></article>
            ))}
          </div>
        </section>
      </div>

      {message ? <div className="inline-success" role="status"><Check aria-hidden="true" />{message}<button type="button" onClick={() => setMessage("")}>Cerrar</button></div> : null}

      {movementType ? (
        <div className="modal-backdrop">
          <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="movement-title">
            <p className="eyebrow">Movimiento de caja</p><h2 id="movement-title">Registrar {movementType.toLowerCase()}</h2>
            <div className="form-stack">
              <label><span>Importe</span><input inputMode="decimal" placeholder="$0.00" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
              <label><span>Concepto o motivo</span><input placeholder="Ej. pago a paquetería" value={concept} onChange={(event) => setConcept(event.target.value)} /></label>
            </div>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setMovementType(null)}>Cancelar</button><button className="primary-button" type="button" onClick={addMovement}>Guardar movimiento</button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
