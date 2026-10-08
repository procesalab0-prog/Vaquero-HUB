// Cambio de página sin pantalla de espera: la página actual se queda visible
// hasta que la nueva está lista, y mientras tanto corre una línea de marca.

export const NAVIGATION_START_EVENT = "mi-tienda:navigation-start:v1";

// Para las navegaciones que no salen de un enlace (router.push).
export function startNavigationProgress() {
  window.dispatchEvent(new Event(NAVIGATION_START_EVENT));
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
    url = new URL(link.href, `${current.origin}${current.pathname}`);
  } catch {
    return false;
  }
  if (url.origin !== current.origin) return false;
  return url.pathname !== current.pathname || url.search !== current.search;
}
