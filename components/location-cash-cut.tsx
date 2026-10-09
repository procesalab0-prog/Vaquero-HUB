"use client";
import { useState, useRef } from "react";
import { browserOperation } from "@/lib/browser-operations";
export type LocationCutData = {
  sessions: Array<{
    id: string;
    register_name: string;
    cashier_name: string;
    counted_cents: number;
    expected_cents: number;
    difference_cents: number;
    reason: string | null;
    usd?: {
      counted_cents: number;
      expected_cents: number;
      difference_cents: number;
    } | null;
  }>;
  open_sessions?: number;
  counted_cents: number;
  expected_cents: number;
  difference_cents: number;
  saved: boolean;
};
const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});
const loadLocationCut = (locationId: string) =>
  browserOperation<
    { ok: true; data: LocationCutData } | { ok: false; message: string }
  >("/api/operaciones", {
    operation: "cash.cut.preview",
    input: { locationId },
  });
const confirmLocationCut = (
  locationId: string,
  id: string,
  sessionIds: string[],
) =>
  browserOperation<
    { ok: true; data: LocationCutData } | { ok: false; message: string }
  >("/api/operaciones", {
    operation: "cash.cut.confirm",
    input: { locationId, id, sessionIds },
  });
export function LocationCashCut({
  locationId,
  name,
  preview = false,
}: {
  locationId: string;
  name: string;
  preview?: boolean;
}) {
  const [data, setData] = useState<LocationCutData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(crypto.randomUUID());
  return (
    <section className="content-card location-cash-cut">
      <h2>Corte de sucursal · {name}</h2>
      {preview ? (
        <p>
          Demostración: estos importes no son registros de la tienda y no se
          guardan.
        </p>
      ) : null}
      <p>
        Consolida los turnos cerrados desde el corte anterior. Cada cajero
        cierra su turno con conteo ciego; gerencia confirma el corte de toda la
        sucursal.
        El primer corte incluye también los turnos históricos que aún no
        tengan un corte de sucursal; revisa el detalle antes de confirmar.
      </p>
      <button
        className="secondary-button"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = preview
              ? {
                  ok: true as const,
                  data: {
                    sessions: [
                      {
                        id: "demo-turno",
                        register_name: "Caja 01",
                        cashier_name: "Demostración",
                        counted_cents: 10000,
                        expected_cents: 10000,
                        difference_cents: 0,
                        reason: null,
                      },
                    ],
                    open_sessions: 0,
                    counted_cents: 10000,
                    expected_cents: 10000,
                    difference_cents: 0,
                    saved: false,
                  },
                }
              : await loadLocationCut(locationId);
            if (result.ok) {
              setData(result.data);
              request.current = crypto.randomUUID();
            } else setError(result.message);
          } catch {
            setError("No fue posible consultar el corte.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Consultando…" : "Preparar corte de sucursal"}
      </button>
      {data ? (
        <>
          <p>
            Efectivo contado: {money.format(data.counted_cents / 100)} ·
            Esperado: {money.format(data.expected_cents / 100)} · Diferencia:{" "}
            {money.format(data.difference_cents / 100)}
          </p>
          <ul>
            {data.sessions.map((s) => (
              <li key={s.id}>
                {s.register_name} · {s.cashier_name}:{" "}
                {money.format(s.counted_cents / 100)} · Diferencia{" "}
                {money.format(s.difference_cents / 100)}{" "}
                {s.reason ? `(${s.reason})` : ""}
                {s.usd ? (
                  <small>
                    {" "}
                    · USD contado: {(s.usd.counted_cents / 100).toFixed(2)} ·
                    Esperado: {(s.usd.expected_cents / 100).toFixed(2)} ·
                    Diferencia: {(s.usd.difference_cents / 100).toFixed(2)}{" "}
                    (separado de MXN)
                  </small>
                ) : null}
              </li>
            ))}
          </ul>
          {data.open_sessions ? (
            <p role="status">
              Falta cerrar {data.open_sessions} turno(s). No puedes confirmar
              todavía.
            </p>
          ) : null}
          <button
            type="button"
            className="primary-button"
            disabled={
              busy ||
              data.saved ||
              !data.sessions.length ||
              Boolean(data.open_sessions)
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = preview
                  ? { ok: true as const, data: { ...data, saved: true } }
                  : await confirmLocationCut(
                      locationId,
                      request.current,
                      data.sessions.map((s) => s.id),
                    );
                if (result.ok) setData(result.data);
                else setError(result.message);
              } catch {
                setError(
                  "No se pudo confirmar. Reintenta sin preparar un corte nuevo.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {data.saved
              ? "Corte de sucursal guardado"
              : "Confirmar corte de sucursal"}
          </button>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
