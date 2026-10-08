"use client";

import { useEffect, useRef, useState } from "react";

import { paidFraction, paidPercent } from "@/lib/layaway-progress";

// Barra de lo pagado de un apartado, con su porcentaje siempre escrito.
// Cuando la página llega de registrar un abono a este apartado, la barra se
// llena desde lo que había antes, y si el abono lo liquidó cae el sello. El
// abono ya está guardado y su comprobante emitido: aquí sólo se muestra.
export function LayawayProgress({
  paidCents,
  totalCents,
  previousPaidCents,
  liquidated,
}: {
  paidCents: number;
  totalCents: number;
  previousPaidCents?: number;
  liquidated: boolean;
}) {
  const to = paidFraction(paidCents, totalCents);
  const from =
    previousPaidCents === undefined
      ? to
      : paidFraction(previousPaidCents, totalCents);
  const advancing = from < to;
  const ref = useRef<HTMLDivElement>(null);
  // El abono suele quedar debajo del comprobante: la barra espera a verse.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!advancing || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [advancing]);

  return (
    <div
      ref={ref}
      className="layaway-progress"
      data-advancing={advancing ? (visible ? "running" : "waiting") : undefined}
      style={
        {
          "--layaway-from": from,
          "--layaway-to": to,
        } as React.CSSProperties
      }
    >
      <span className="layaway-progress-track" aria-hidden="true">
        <i />
      </span>
      <small>
        {paidPercent(paidCents, totalCents)} % pagado
        {advancing && previousPaidCents !== undefined
          ? " · abono registrado"
          : ""}
      </small>
      {advancing && liquidated ? (
        <span className="layaway-paid-stamp">Liquidado</span>
      ) : null}
    </div>
  );
}
