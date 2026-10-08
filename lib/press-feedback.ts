// Respuesta al tocar, común a todo Mi Tienda SM y Mi Vaquero.
//
// La huella de luz es una sola capa flotante que se coloca sobre el botón
// tocado: no cambia el estilo, la posición ni el tamaño de ningún botón, así
// que no puede romper el diseño de ninguno ni moverlo bajo el dedo.

export const PRESSABLE_SELECTOR = [
  "button",
  "summary",
  "a[href]",
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
].join(", ");

export const HAPTICS_KEY = "mi-tienda:haptics:v1";
export const HAPTICS_EVENT = "mi-tienda:haptics-change:v1";
export const HAPTIC_MS = 8;

export function hapticsEnabled() {
  try {
    return window.localStorage.getItem(HAPTICS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function hapticsSupported() {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

// Sobre un fondo oscuro la huella es clara; sobre uno claro o transparente,
// café de la marca. Así se nota en cualquier botón sin inventar colores.
export function inkColor(background: string) {
  const match = background.match(/rgba?\(([^)]+)\)/);
  if (!match) return "rgb(91 64 33 / 20%)";
  const [r, g, b, a = "1"] = match[1].split(/[\s,/]+/).filter(Boolean);
  const alpha = Number.parseFloat(a);
  if (!Number.isFinite(alpha) || alpha < 0.3) return "rgb(91 64 33 / 20%)";
  const luminance =
    (0.2126 * Number(r) + 0.7152 * Number(g) + 0.0722 * Number(b)) / 255;
  return luminance < 0.5 ? "rgb(255 255 255 / 38%)" : "rgb(91 64 33 / 20%)";
}
