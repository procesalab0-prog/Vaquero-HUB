"use client";

import { useEffect } from "react";

import {
  HAPTIC_MS,
  PRESSABLE_SELECTOR,
  hapticsEnabled,
  hapticsSupported,
  inkColor,
} from "@/lib/press-feedback";

// Una huella de luz nace donde cae el dedo, en cualquier botón o enlace, y una
// vibración corta confirma el toque en los teléfonos que lo permiten. Nada de
// esto retrasa el toque: no se previene ningún evento.
export function PressFeedback() {
  useEffect(() => {
    const ink = document.createElement("span");
    ink.className = "press-ink";
    ink.setAttribute("aria-hidden", "true");
    document.body.appendChild(ink);
    let pulse = false;
    let lastPointer = "";

    const pressable = (target: EventTarget | null) => {
      const element = (target as Element | null)?.closest?.(
        PRESSABLE_SELECTOR,
      ) as HTMLElement | null;
      if (!element) return null;
      if (element.matches(':disabled, [aria-disabled="true"]')) return null;
      return element;
    };

    const onPointerDown = (event: PointerEvent) => {
      lastPointer = event.pointerType;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const element = pressable(event.target);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const style = getComputedStyle(element);
      ink.style.left = `${rect.left}px`;
      ink.style.top = `${rect.top}px`;
      ink.style.width = `${rect.width}px`;
      ink.style.height = `${rect.height}px`;
      ink.style.borderRadius = style.borderRadius;
      ink.style.setProperty("--press-x", `${event.clientX - rect.left}px`);
      ink.style.setProperty("--press-y", `${event.clientY - rect.top}px`);
      ink.style.setProperty("--press-color", inkColor(style.backgroundColor));
      // Dos nombres de animación idénticos: cada toque la reinicia.
      pulse = !pulse;
      ink.dataset.press = pulse ? "a" : "b";
    };

    // Si el toque se convierte en desplazamiento, la huella desaparece.
    const onPointerCancel = () => {
      delete ink.dataset.press;
    };

    // La vibración va en el clic y no al apoyar el dedo: así no vibra al
    // desplazarse sobre una lista de botones.
    const onClick = (event: MouseEvent) => {
      if (lastPointer !== "touch" || !pressable(event.target)) return;
      if (hapticsSupported() && hapticsEnabled()) navigator.vibrate(HAPTIC_MS);
    };

    // Safari en iPad y iPhone no aplica :active al tocar si la página no
    // escucha touchstart. Con esto se ve el «hundido» que ya tenían los botones.
    const enableActive = () => {};

    const capture = { capture: true, passive: true } as const;
    document.addEventListener("pointerdown", onPointerDown, capture);
    document.addEventListener("pointercancel", onPointerCancel, capture);
    document.addEventListener("click", onClick, capture);
    document.addEventListener("touchstart", enableActive, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, capture);
      document.removeEventListener("pointercancel", onPointerCancel, capture);
      document.removeEventListener("click", onClick, capture);
      document.removeEventListener("touchstart", enableActive);
      ink.remove();
    };
  }, []);

  return null;
}
