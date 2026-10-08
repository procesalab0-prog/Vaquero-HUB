// Cuándo se reproduce la escena de la pantalla de acceso.
//
// Una cajera entra varias veces al día. La escena editorial completa se ve la
// primera vez del día en cada dispositivo; después basta una versión corta. Si
// se llega por un error, no se anima nada: la persona necesita leer y volver a
// escribir.
//
// La cookie sólo decide una animación: no lleva identidad y no sirve para
// autorizar nada. Alterarla sólo cambia lo que se anima.

export const MOTION_DAY_COOKIE = "mts_movimiento_dia";
export const MOTION_DAY_COOKIE_MAX_AGE = 60 * 60 * 36;

export type MotionScene = "full" | "short" | "none";

const STORE_TIME_ZONE = "America/Mexico_City";

export function storeDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: STORE_TIME_ZONE,
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function loginScene({
  hasError,
  lastFullDay,
  today,
}: {
  hasError: boolean;
  lastFullDay: string | undefined;
  today: string;
}): MotionScene {
  if (hasError) return "none";
  return lastFullDay === today ? "short" : "full";
}
