import { sectionTitle } from "@/lib/section-title";

// Cambio de página sin pantalla de espera: la página actual se queda visible
// hasta que la nueva está lista, y mientras tanto el logo de Vaquero SM brilla
// con un destello dorado junto al nombre de la sección a la que se va.

export const NAVIGATION_START_EVENT = "mi-tienda:navigation-start:v1";

export type NavigationStart = { href?: string; label?: string };

// Para las navegaciones que no salen de un enlace (router.push). Con href se
// muestra el nombre de la sección destino; con label, un texto propio.
export function startNavigationProgress(detail: NavigationStart = {}) {
  window.dispatchEvent(
    new CustomEvent<NavigationStart>(NAVIGATION_START_EVENT, { detail }),
  );
}

// Qué se escribe junto a la animación.
export function navigationLabel(detail: NavigationStart, origin: string) {
  if (detail.label) return detail.label;
  if (!detail.href) return "";
  try {
    return sectionTitle(new URL(detail.href, origin).pathname);
  } catch {
    return "";
  }
}

// ¿Este clic va a cambiar de página dentro del programa? Un enlace a otra
// pestaña, a otro sitio, a una descarga o a la misma página no cuenta.
export function isNavigationClick(
  click: {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  link: { href: string; target: string; download: boolean },
  current: { origin: string; pathname: string; search: string },
) {
  if (click.button !== 0) return false;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey)
    return false;
  if (link.download) return false;
  if (link.target && link.target !== "_self") return false;
  let url: URL;
  try {
    url = new URL(
      link.href,
      `${current.origin}${current.pathname}${current.search}`,
    );
  } catch {
    return false;
  }
  if (url.origin !== current.origin) return false;
  return url.pathname !== current.pathname || url.search !== current.search;
}
