// Cuándo celebrar puntos en Mi Vaquero. Sólo se celebra lo que el servidor ya
// registró: el movimiento más reciente del historial, si es una compra que
// sumó puntos y ocurrió hace poco.
//
// No se guarda nada en el dispositivo para decidirlo: Mi Vaquero promete
// conservar únicamente el número de socio.

export type LoyaltyMovement = {
  id: string;
  type: string;
  points: number;
  created_at: string;
};

export const RECENT_EARN_HOURS = 48;
// Tolera relojes de teléfono un poco adelantados o atrasados.
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export function recentEarn(
  history: LoyaltyMovement[],
  availablePoints: number,
  now = new Date(),
) {
  const latest = history[0];
  if (!latest || latest.type !== "EARN" || latest.points <= 0) return null;
  const age = now.getTime() - new Date(latest.created_at).getTime();
  if (Number.isNaN(age)) return null;
  if (age < -CLOCK_TOLERANCE_MS || age > RECENT_EARN_HOURS * 3_600_000)
    return null;
  return {
    id: latest.id,
    points: latest.points,
    from: Math.max(0, availablePoints - latest.points),
    to: availablePoints,
  };
}
