"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Banknote, Check, CreditCard, Landmark, LockKeyhole, Plus } from "lucide-react";
import { useWorkspace } from "@/components/workspace-context";

type Register = { id: string; code: string; name: string; is_active: boolean; open_session_id: string | null; cashier_name: string | null };
type PaymentSummary = { method_code: string; count: number };
type Movement = { id: number; type: "DEPOSIT" | "WITHDRAWAL"; reason: string; amount_cents: number; occurred_at: string };
type Session = { id: string; register_name: string; opening_amount_cents: number; opened_at: string; sales_count: number; payments: PaymentSummary[]; manual_movements: Movement[] };
type ActionResult = { ok: true; data?: Record<string, unknown> } | { ok: false; message: string };
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const pesos = (value: number) => money.format(Number(value || 0) / 100);

export function CashRegister({ registers = [], session = null, locationId = "", canManageRegisters = false, preview = false, status, openAction, createRegisterAction, movementAction, previewCloseAction, closeAction }: { registers?: Register[]; session?: Session | null; locationId?: string; canManageRegisters?: boolean; preview?: boolean; status?: string; openAction?: (registerId: string, amount: number) => Promise<ActionResult>; createRegisterAction?: (locationId: string, code: string, name: string) => Promise<ActionResult>; movementAction?: (input: { sessionId: string; type: "DEPOSIT" | "WITHDRAWAL"; amount: number; reason: string }) => Promise<ActionResult>; previewCloseAction?: (sessionId: string, amount: number) => Promise<ActionResult>; closeAction?: (input: { sessionId: string; countedAmount: number; reason?: string }) => Promise<ActionResult> }) {
  const router = useRouter();
  const { identity, activeLocation } = useWorkspace();
  const [selectedRegister, setSelectedRegister] = useState(registers.find((item) => !item.open_session_id)?.id ?? "");
  const [openingAmount, setOpeningAmount] = useState("2500");
  const [movementType, setMovementType] = useState<Movement["type"] | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(status ?? "");
  const [busy, setBusy] = useState(false);
  const [cutOpen, setCutOpen] = useState(false);
  const [countedAmount, setCountedAmount] = useState("");
  const [closePreview, setClosePreview] = useState<{ expected: number; difference: number } | null>(null);
  const [differenceReason, setDifferenceReason] = useState("");
  const [newRegisterOpen, setNewRegisterOpen] = useState(false);
  const [newRegisterCode, setNewRegisterCode] = useState("");
  const [newRegisterName, setNewRegisterName] = useState("");
  const demoSession: Session | null = preview ? { id: "demo", register_name: "Caja 01", opening_amount_cents: 250000, opened_at: new Date().toISOString(), sales_count: 8, payments: [{ method_code: "CASH", count: 4 }, { method_code: "CARD", count: 3 }, { method_code: "TRANSFER", count: 1 }], manual_movements: [] } : null;
  const activeSession = session ?? demoSession;

  async function openRegister() {
    if (!selectedRegister || Number(openingAmount) < 0) return;
    setBusy(true); setError("");
    if (preview) { setMessage("Caja abierta en la vista de diseño"); setBusy(false); return; }
    if (!openAction) { setError("El servicio de caja no está disponible."); setBusy(false); return; }
    const result = await openAction(selectedRegister, Number(openingAmount));
    if (!result.ok) setError(result.message); else router.refresh();
    setBusy(false);
  }
  async function saveRegister() {
    if (!locationId || newRegisterCode.trim().length < 2 || newRegisterName.trim().length < 3) return;
    setBusy(true); setError("");
    if (!createRegisterAction) { setError("El servicio de configuración no está disponible."); setBusy(false); return; }
    const result = await createRegisterAction(locationId, newRegisterCode, newRegisterName);
    if (!result.ok) setError(result.message); else { setNewRegisterOpen(false); router.refresh(); }
    setBusy(false);
  }
  async function saveMovement() {
    if (!activeSession || !movementType || Number(amount) <= 0 || reason.trim().length < 3) return;
    setBusy(true); setError("");
    if (preview) { setMessage("Movimiento registrado en la vista de diseño"); setMovementType(null); setBusy(false); return; }
    if (!movementAction) { setError("El servicio de caja no está disponible."); setBusy(false); return; }
    const result = await movementAction({ sessionId: activeSession.id, type: movementType, amount: Number(amount), reason });
    if (!result.ok) setError(result.message); else { setMovementType(null); setAmount(""); setReason(""); router.refresh(); }
    setBusy(false);
  }
  async function countForClose() {
    if (!activeSession || Number(countedAmount) < 0 || countedAmount === "") return;
    setBusy(true); setError("");
    if (preview) { setClosePreview({ expected: 2500, difference: Number(countedAmount) - 2500 }); setBusy(false); return; }
    if (!previewCloseAction) { setError("El servicio de cierre no está disponible."); setBusy(false); return; }
    const result = await previewCloseAction(activeSession.id, Number(countedAmount));
    if (!result.ok) setError(result.message);
    else setClosePreview({ expected: Number(result.data?.expected_amount_cents ?? 0) / 100, difference: Number(result.data?.difference_cents ?? 0) / 100 });
    setBusy(false);
  }
  async function confirmClose() {
    if (!activeSession || !closePreview || (closePreview.difference !== 0 && differenceReason.trim().length < 3)) return;
    setBusy(true); setError("");
    if (preview) { setCutOpen(false); setMessage("Caja cerrada en la vista de diseño"); setBusy(false); return; }
    if (!closeAction) { setError("El servicio de cierre no está disponible."); setBusy(false); return; }
    const result = await closeAction({ sessionId: activeSession.id, countedAmount: Number(countedAmount), reason: differenceReason });
    if (!result.ok) setError(result.message); else router.refresh();
    setBusy(false);
  }

  if (!activeSession) return <section className="module-page"><div className="section-heading"><div><p className="eyebrow">{activeLocation?.name ?? "Sucursal"}</p><h1>Elegir y abrir caja</h1><p className="heading-copy">Cada empleado puede tener una sola sesión abierta, pero la tienda puede operar varias cajas al mismo tiempo.</p></div>{canManageRegisters ? <button className="secondary-button" type="button" onClick={() => setNewRegisterOpen(true)}><Plus />Agregar caja</button> : null}</div>{error ? <div className="inline-error" role="alert">{error}</div> : null}<div className="register-grid">{registers.map((item) => <button type="button" key={item.id} disabled={!item.is_active || Boolean(item.open_session_id)} className={selectedRegister === item.id ? "content-card selected" : "content-card"} onClick={() => setSelectedRegister(item.id)}><Banknote aria-hidden="true" /><strong>{item.name}</strong><small>{item.open_session_id ? `En uso por ${item.cashier_name}` : "Disponible"}</small></button>)}</div><section className="content-card open-register-card"><label><span>Fondo inicial</span><input inputMode="decimal" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} /></label><button className="primary-button" type="button" disabled={busy || !selectedRegister} onClick={() => void openRegister()}>Abrir caja</button></section>{newRegisterOpen ? <div className="modal-backdrop"><section className="checkout-modal compact-modal"><p className="eyebrow">Configuración de sucursal</p><h2>Agregar otra caja</h2><div className="form-stack"><label><span>Código</span><input value={newRegisterCode} onChange={(event) => setNewRegisterCode(event.target.value)} placeholder="CAJA02" /></label><label><span>Nombre visible</span><input value={newRegisterName} onChange={(event) => setNewRegisterName(event.target.value)} placeholder="Caja 02" /></label></div><div className="modal-actions"><button className="secondary-button" onClick={() => setNewRegisterOpen(false)}>Cancelar</button><button className="primary-button" disabled={busy} onClick={() => void saveRegister()}>Guardar caja</button></div></section></div> : null}</section>;

  const payments = new Map(activeSession.payments.map((item) => [item.method_code, item]));
  const employeeName = identity.name.trim().split(/\s+/)[0] || identity.name;
  return <section className="module-page">
    <div className="section-heading"><div><p className="eyebrow">Sesión abierta · {activeSession.register_name}</p><h1>Control de caja</h1><p className="heading-copy">Abierta por {employeeName}. El efectivo esperado permanecerá oculto hasta que termines el conteo.</p></div><button className="secondary-button danger-outline" type="button" onClick={() => { setCountedAmount(""); setClosePreview(null); setCutOpen(true); }}><LockKeyhole aria-hidden="true" />Realizar corte</button></div>
    {error ? <div className="inline-error" role="alert">{error}</div> : null}{message ? <div className="inline-success" role="status"><Check aria-hidden="true" />{message}</div> : null}
    <div className="metric-grid cash-metrics"><article className="metric-card metric-cash"><span>Fondo inicial</span><strong>{pesos(activeSession.opening_amount_cents)}</strong></article><article className="metric-card metric-sales"><span>Ventas del turno</span><strong>{activeSession.sales_count}</strong><small>operaciones cobradas</small></article><article className="metric-card metric-units"><span>Movimientos manuales</span><strong>{activeSession.manual_movements.length}</strong></article><article className="accent-metric metric-card"><span>Estado</span><strong>En operación</strong><small>Conteo ciego al cerrar</small></article></div>
    <div className="cash-columns"><section className="content-card"><div className="card-heading"><div><p className="eyebrow">Resumen</p><h2>Pagos registrados</h2></div></div><div className="payment-summary-list"><PaymentRow icon={<Banknote />} label="Efectivo" summary={payments.get("CASH")} /><PaymentRow icon={<CreditCard />} label="Tarjeta" summary={payments.get("CARD")} /><PaymentRow icon={<Landmark />} label="Transferencia" summary={payments.get("TRANSFER")} /></div><div className="cash-actions"><button type="button" onClick={() => setMovementType("DEPOSIT")}><ArrowDownLeft />Registrar entrada</button><button type="button" onClick={() => setMovementType("WITHDRAWAL")}><ArrowUpRight />Registrar retiro</button></div></section>
    <section className="content-card"><div className="card-heading"><div><p className="eyebrow">Auditoría</p><h2>Movimientos manuales</h2></div><button className="text-button" type="button" onClick={() => setMovementType("DEPOSIT")}><Plus />Nuevo</button></div><div className="movement-list">{activeSession.manual_movements.length ? activeSession.manual_movements.map((item) => <article key={item.id}><span className={item.type === "DEPOSIT" ? "movement-kind income" : "movement-kind outcome"}>{item.type === "DEPOSIT" ? <ArrowDownLeft /> : <ArrowUpRight />}</span><div><strong>{item.reason}</strong><small>{new Date(item.occurred_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} · {employeeName}</small></div><b className={item.type === "DEPOSIT" ? "positive" : "negative"}>{item.type === "DEPOSIT" ? "+" : "−"}{pesos(Math.abs(item.amount_cents))}</b></article>) : <p className="empty-copy">Todavía no hay entradas o retiros manuales.</p>}</div></section></div>
    {movementType ? <div className="modal-backdrop"><section className="checkout-modal"><p className="eyebrow">Movimiento de caja</p><h2>{movementType === "DEPOSIT" ? "Registrar entrada" : "Registrar retiro"}</h2><div className="form-stack"><label><span>Importe</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label><span>Motivo obligatorio</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label></div><div className="modal-actions"><button className="secondary-button" onClick={() => setMovementType(null)}>Cancelar</button><button className="primary-button" disabled={busy} onClick={() => void saveMovement()}>Guardar movimiento</button></div></section></div> : null}
    {cutOpen ? <div className="modal-backdrop"><section className="checkout-modal cut-modal"><p className="eyebrow">Cierre guiado · {activeSession.register_name}</p><h2>Realizar corte</h2>{!closePreview ? <><p>Cuenta físicamente el efectivo. El sistema aún no te mostrará cuánto espera.</p><div className="form-stack"><label><span>Efectivo contado</span><input inputMode="decimal" value={countedAmount} onChange={(event) => setCountedAmount(event.target.value)} /></label></div></> : <><div className="cut-expected"><span>Efectivo esperado</span><strong>{money.format(closePreview.expected)}</strong></div><div className={closePreview.difference === 0 ? "cut-difference balanced" : "cut-difference unbalanced"}><span>Diferencia</span><strong>{money.format(closePreview.difference)}</strong><small>{closePreview.difference === 0 ? "Caja cuadrada" : "Explica la diferencia para continuar"}</small></div>{closePreview.difference !== 0 ? <div className="form-stack"><label><span>Motivo de la diferencia</span><input value={differenceReason} onChange={(event) => setDifferenceReason(event.target.value)} /></label></div> : null}</>}<div className="modal-actions"><button className="secondary-button" onClick={() => setCutOpen(false)}>Cancelar</button>{closePreview ? <button className="danger-button" disabled={busy || (closePreview.difference !== 0 && differenceReason.trim().length < 3)} onClick={() => void confirmClose()}>Confirmar y cerrar</button> : <button className="primary-button" disabled={busy || countedAmount === ""} onClick={() => void countForClose()}>Comparar conteo</button>}</div></section></div> : null}
  </section>;
}

function PaymentRow({ icon, label, summary }: { icon: React.ReactNode; label: string; summary?: PaymentSummary }) {
  const count = summary?.count ?? 0;
  return <div><span className="payment-icon">{icon}</span><span><strong>{label}</strong><small>{count === 1 ? "1 venta" : `${count} ventas`}</small></span><b>{count}</b></div>;
}
