"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  NAVIGATION_START_EVENT,
  type NavigationStart,
  isNavigationClick,
  navigationLabel,
} from "@/lib/navigation-progress";

// Si la página nueva tarda más que esto, algo salió mal (por ejemplo, una
// redirección de vuelta a la misma página): la animación se retira sola.
const NAVIGATION_LIMIT_MS = 8000;
// Lo que tarda la animación en dejarse ver. Una página que llega antes no
// muestra ninguna espera.
const NAVIGATION_VISIBLE_AFTER_MS = 140;
// Lo que dura la animación despidiéndose.
const NAVIGATION_DONE_MS = 260;

// waiting: ya se tocó, pero todavía no vale la pena mostrar nada.
// loading: las huellas caminan. done: la animación se despide.
type State = "idle" | "waiting" | "loading" | "done";

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const location = `${pathname}?${searchParams.toString()}`;
  const [state, setState] = useState<State>("idle");
  const [label, setLabel] = useState("");
  const pendingLink = useRef<HTMLElement | null>(null);
  const timers = useRef<number[]>([]);

  // Empezar: con un clic en un enlace del programa o cuando el código navega.
  useEffect(() => {
    const begin = (link: HTMLElement | null, detail: NavigationStart) => {
      setLabel(navigationLabel(detail, window.location.origin));
      pendingLink.current?.removeAttribute("data-pending");
      pendingLink.current = link;
      // El botón tocado se marca al instante: el toque sí se registró.
      link?.setAttribute("data-pending", "true");
      document.documentElement.dataset.navigating = "true";
      timers.current.forEach((timer) => window.clearTimeout(timer));
      setState("waiting");
      timers.current = [
        window.setTimeout(
          () =>
            setState((current) =>
              current === "waiting" ? "loading" : current,
            ),
          NAVIGATION_VISIBLE_AFTER_MS,
        ),
        window.setTimeout(() => setState("idle"), NAVIGATION_LIMIT_MS),
      ];
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!link) return;
      const navigates = isNavigationClick(
        event,
        {
          href: link.getAttribute("href") ?? "",
          target: link.target,
          download: link.hasAttribute("download"),
        },
        window.location,
      );
      if (navigates) begin(link, { href: link.getAttribute("href") ?? "" });
    };
    const onProgrammatic = (event: Event) =>
      begin(null, (event as CustomEvent<NavigationStart>).detail ?? {});
    // En captura: corre antes de que el enlace del programa tome el clic.
    document.addEventListener("click", onClick, true);
    window.addEventListener(NAVIGATION_START_EVENT, onProgrammatic);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(NAVIGATION_START_EVENT, onProgrammatic);
      timers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  // Terminar: la dirección cambió, la página nueva ya está en pantalla. Si la
  // animación ni siquiera llegó a verse, tampoco se ve despedirse.
  const [shownLocation, setShownLocation] = useState(location);
  if (shownLocation !== location) {
    setShownLocation(location);
    if (state === "loading") setState("done");
    else if (state === "waiting") setState("idle");
  }

  useEffect(() => {
    if (state === "waiting" || state === "loading") return;
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    pendingLink.current?.removeAttribute("data-pending");
    pendingLink.current = null;
    delete document.documentElement.dataset.navigating;
    if (state !== "done") return;
    const timer = window.setTimeout(() => setState("idle"), NAVIGATION_DONE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  // La sección nueva aparece suave. Sólo al cambiar de sección: filtrar o
  // cambiar de pestaña dentro de la misma página no la hace parpadear. Antes
  // de pintar, para que no se vea un cuadro sin la transición.
  const firstPath = useRef(pathname);
  useLayoutEffect(() => {
    if (firstPath.current === pathname) return;
    firstPath.current = pathname;
    const root = document.documentElement;
    root.dataset.pageEnter = root.dataset.pageEnter === "a" ? "b" : "a";
  }, [pathname]);

  // Huellas de herradura que caminan hacia el nombre de la sección: dice
  // «vamos para allá», no «recargando». No gira ni se llena.
  return (
    <>
      <div className="nav-wait" data-state={state} aria-hidden="true">
        <svg className="nav-wait-trail" viewBox="0 0 104 30" focusable="false">
          {HOOFPRINTS.map(([x, y, turn], index) => (
            // La posición va en el grupo: así la animación de la pisada
            // (su propio transform) no la mueve de lugar.
            <g key={index} transform={`translate(${x} ${y}) rotate(${turn})`}>
              {/* Polvo que levanta la pisada, detrás de ella. */}
              <circle cx="-10" cy="-3" r="1.6" />
              <circle cx="-11" cy="3" r="1.2" />
              {/* Herradura vista desde arriba: patas rectas hacia atrás y la
                  punta redonda hacia adelante, en dirección a la sección. */}
              <path d="M-6 -5.5 H0 A5.5 5.5 0 0 1 0 5.5 H-6" />
            </g>
          ))}
        </svg>
        {label ? <span>{label}</span> : null}
      </div>
      <span className="sr-only" role="status">
        {state === "loading" ? `Abriendo ${label || "la sección"}` : ""}
      </span>
    </>
  );
}

// Cuatro pisadas que alternan arriba y abajo, como un caballo al paso.
const HOOFPRINTS: Array<[number, number, number]> = [
  [16, 19, -6],
  [40, 11, 6],
  [64, 19, -6],
  [88, 11, 6],
];
