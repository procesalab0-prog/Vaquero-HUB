"use client";

import { useEffect, useState } from "react";

import { recentEarn, type LoyaltyMovement } from "@/lib/loyalty-motion";

// En memoria, no en el dispositivo: cada compra se celebra una vez por sesión
// de la aplicación. Mi Vaquero promete guardar sólo el número de socio.
const celebrated = new Set<string>();

const COUNT_MS = 900;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export function PointsBalance({
  availablePoints,
  history,
}: {
  availablePoints: number;
  history: LoyaltyMovement[];
}) {
  const earn = recentEarn(history, availablePoints);
  // Se decide una vez, al aparecer el saldo que llegó del servidor.
  const [plan] = useState(() =>
    earn && !celebrated.has(earn.id) && !prefersReducedMotion() ? earn : null,
  );
  const [count, setCount] = useState<number | null>(() => plan?.from ?? null);

  useEffect(() => {
    if (!plan) return;
    celebrated.add(plan.id);
    const start = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / COUNT_MS);
      const eased = 1 - (1 - t) ** 3;
      setCount(
        t < 1 ? Math.round(plan.from + (plan.to - plan.from) * eased) : null,
      );
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [plan]);

  return (
    <span className={plan ? "mi-points celebrating" : "mi-points"}>
      <small>PUNTOS DISPONIBLES</small>
      <strong>
        <span aria-hidden="true">
          {(count ?? availablePoints).toLocaleString("es-MX")}
        </span>
        <span className="sr-only">
          {availablePoints.toLocaleString("es-MX")}
        </span>
        {plan ? (
          <span className="mi-spur-burst" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <i
                key={index}
                style={
                  { "--spur-angle": `${index * 45}deg` } as React.CSSProperties
                }
              />
            ))}
          </span>
        ) : null}
      </strong>
      {earn ? (
        <em className="mi-points-earned">
          +{earn.points.toLocaleString("es-MX")} puntos de tu compra
        </em>
      ) : null}
    </span>
  );
}
