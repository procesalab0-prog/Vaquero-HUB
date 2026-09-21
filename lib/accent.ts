// El color de acento se elige en Ajustes y se conserva por dispositivo. Vive
// aquí, y no duplicado en cada pantalla, porque la capa de marca define su
// propio acento por omisión: si dos archivos describen la paleta, uno de los
// dos termina pisando al diseño sin que nadie lo note.

export const ACCENT_STORAGE_KEY = "mi-tienda:accent:v1";
export const ACCENT_EVENT = "mi-tienda:accent";

export const ACCENT_COLORS: Record<string, string> = {
  vino: "#8E2A1C",
  cuero: "#9A5D32",
  noche: "#241E1B",
};

function mix(hex: string, factor: number, towards: number) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const base = Number.parseInt(value.slice(offset, offset + 2), 16);
    return Math.round(base + (towards - base) * factor);
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// Un acento suelto no basta: el botón se pinta con --accent pero se oscurece
// con --accent-hover y se apoya en --accent-soft. Si sólo cambia el primero,
// el botón cambia de color al pasar el dedo encima.
export function accentTokens(value: string) {
  const accent = ACCENT_COLORS[value];
  if (!accent) return null;
  return {
    "--accent": accent,
    "--accent-hover": mix(accent, 0.15, 0),
    "--accent-pressed": mix(accent, 0.25, 0),
    "--accent-soft": mix(accent, 0.9, 255),
  };
}

const ACCENT_TOKEN_NAMES = [
  "--accent",
  "--accent-hover",
  "--accent-pressed",
  "--accent-soft",
];

// Sin acento elegido se retiran las propiedades en línea y vuelve a mandar la
// hoja de estilos, que es donde vive el acento de la identidad. Así elegir un
// color se puede deshacer.
export function applyAccent(value: string | null) {
  const tokens = value ? accentTokens(value) : null;
  if (!tokens) {
    for (const token of ACCENT_TOKEN_NAMES) {
      document.documentElement.style.removeProperty(token);
    }
    return;
  }
  for (const [token, color] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(token, color);
  }
}

export function storedAccent() {
  try {
    return window.localStorage.getItem(ACCENT_STORAGE_KEY);
  } catch {
    return null;
  }
}
