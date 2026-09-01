"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Banknote, Check, CreditCard, Landmark, LockKeyhole, Plus } from "lucide-react";
import { useWorkspace } from "@/components/workspace-context";

type Movement = { id: number; time: string; type: "Entrada" | "Retiro"; concept: string; amount: number };

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const initialMovements: Movement[] = [
  { id: 1, time: "10:12", type: "Retiro", concept: "Pago a paquetería", amount: 350 },
  { id: 2, time: "12:40", type: "Entrada", concept: "Cambio adicional", amount: 500 },
];

export function CashRegister() {
  const { identity, activeLocation } = useWorkspace();
  const employeeName = identity.name.trim().split(/\s+/)[0] || identity.name;
  const [open, setOpen] = useState(true);
  const [movements, setMovements] = useState(initialMovements);
  const [movementType, setMovementType] = useState<Movement["type"] | null>(null);
  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const [message, setMessage] = useState("");
  const [cutOpen, setCutOpen] = useState(false);
  const [countedAmount, setCountedAmount] = useState("");

  const movementBalance = movements.reduce((sum, item) => sum + (item.type === "Entrada" ? item.amount : -item.amount), 0);
  const expected = 2500 + 16240 + movementBalance;
  const counted = Number(countedAmount || 0);
  const difference = counted - expected;

  function addMovement() {
    const parsed = Number(amount);
    if (!movementType || !concept.trim() || !Number.isFinite(parsed) || parsed <= 0) return;
    setMovements((current) => [{ id: Date.now(), time: "Ahora", type: movementType, concept: concept.trim(), amount: parsed }, ...current]);
    setMovementType(null);
    setAmount("");
    setConcept("");
    setMessage("Movimiento registrado en la vista de diseño");
  }

  function closeRegister() {
    if (!countedAmount || !Number.isFinite(counted) || counted < 0) return;
    setCutOpen(false);
    setOpen(false);
    setCountedAmount("");
  }

  if (!open) {
    return (
      <section className="module-page cash-closed-state">
        <span><LockKeyhole aria-hidden="true" /></span><p className="eyebrow">Caja 01</p><h1>Caja cerrada</h1>
        <p>Abre una sesión para registrar ventas y movimientos en {activeLocation?.name ?? "tu sucursal"}.</p>
        <button className="primary-button" type="button" onClick={() => setOpen(true)}>Abrir caja con {money.format(2500)}</button>
      </section>
    );
  }

  return (
    <section className="module-page">
      <div className="section-heading">
        <div><p className="eyebrow">Sesión abierta · Caja 01</p><h1>Control de caja</h1><p className="heading-copy">Abierta hoy a las 09:52 por {employeeName}.</p></div>
        <button className="secondary-button danger-outline" type="button" onClick={() => { setCountedAmount(""); setCutOpen(true); }}><LockKeyhole aria-hidden="true" />Realizar corte</button>
      </div>

      <div className="metric-grid cash-metrics">
        <article className="metric-card metric-cash"><span>Fondo inicial</span><strong>{money.format(2500)}</strong><small>Registrado al abrir</small></article>
        <article className="metric-card metric-sales"><span>Ventas del turno</span><strong>{money.format(16240)}</strong><small>8 operaciones</small></article>
        <article className="metric-card metric-units"><span>Movimientos</span><strong>{money.format(movementBalance)}</strong><small>{movements.length} movimientos manuales</small></article>
        <article className="accent-metric metric-card"><span>Efectivo esperado</span><strong>{money.format(expected)}</strong><small>Antes de contar físicamente</small></article>
      </div>

      <div className="cash-columns">
        <section className="content-card">
          <div className="card-heading"><div><p className="eyebrow">Resumen</p><h2>Pagos registrados</h2></div></div>
          <div className="payment-summary-list">
            <div className="cash-payment-row"><span className="payment-icon"><Banknote aria-hidden="true" /></span><span><strong>Efectivo</strong><small>4 ventas</small></span><b>{money.format(7290)}</b></div>
            <div className="card-payment-row"><span className="payment-icon"><CreditCard aria-hidden="true" /></span><span><strong>Tarjeta</strong><small>3 ventas</small></span><b>{money.format(6050)}</b></div>
            <div className="transfer-payment-row"><span className="payment-icon"><Landmark aria-hidden="true" /></span><span><strong>Transferencia</strong><small>1 venta</small></span><b>{money.format(2900)}</b></div>
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
              <article key={item.id}><span className={item.type === "Entrada" ? "movement-kind income" : "movement-kind outcome"}>{item.type === "Entrada" ? <ArrowDownLeft aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}</span><div><strong>{item.concept}</strong><small>{item.time} · {employeeName}</small></div><b className={item.type === "Entrada" ? "positive" : "negative"}>{item.type === "Entrada" ? "+" : "−"}{money.format(item.amount)}</b></article>
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

      {cutOpen ? (
        <div className="modal-backdrop">
          <section className="checkout-modal cut-modal" role="dialog" aria-modal="true" aria-labelledby="cut-title">
            <p className="eyebrow">Cierre guiado · Caja 01</p><h2 id="cut-title">Realizar corte</h2>
            <div className="cut-progress" aria-label="Paso 1 de 2"><span className="active">1</span><i /><span>2</span></div>
            <div className="cut-expected"><span>Efectivo esperado</span><strong>{money.format(expected)}</strong><small>Fondo, ventas y movimientos del turno</small></div>
            <div className="form-stack"><label><span>Efectivo contado físicamente</span><input inputMode="decimal" placeholder="0.00" value={countedAmount} onChange={(event) => setCountedAmount(event.target.value)} /></label></div>
            {countedAmount && Number.isFinite(counted) ? <div className={difference === 0 ? "cut-difference balanced" : "cut-difference unbalanced"}><span>Diferencia</span><strong>{difference > 0 ? "+" : ""}{money.format(difference)}</strong><small>{difference === 0 ? "Caja cuadrada" : difference > 0 ? "Sobrante por revisar" : "Faltante por revisar"}</small></div> : null}
            <div className="cut-warning"><LockKeyhole aria-hidden="true" /><span>Al confirmar, la sesión quedará cerrada. Este paso debe generar un registro auditable cuando se conecte el backend.</span></div>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setCutOpen(false)}>Cancelar</button><button className="danger-button" type="button" disabled={!countedAmount || !Number.isFinite(counted)} onClick={closeRegister}>Confirmar y cerrar caja</button></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
