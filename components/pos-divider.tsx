"use client";

import { useEffect, useRef, useState } from "react";

export function PosDivider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const update = () => setStacked(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const active = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (next: number) =>
    onChange(Math.max(35, Math.min(65, Math.round(next))));
  // WAI-ARIA window splitter: a focusable separator with a numeric value.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className="pos-divider"
      data-dragging={dragging || undefined}
      role="separator"
      aria-orientation={stacked ? "horizontal" : "vertical"}
      aria-label="Cambiar tamaño de catálogo y venta"
      aria-valuemin={35}
      aria-valuemax={65}
      aria-valuenow={value}
      aria-valuetext={`Catálogo ${value}%, venta ${100 - value}%`}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      title="Arrastra para cambiar el tamaño. También puedes usar las flechas."
      onPointerDown={(event) => {
        if (event.button !== 0 || active.current !== null) return;
        active.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (active.current !== event.pointerId) return;
        const parent = event.currentTarget.parentElement;
        if (!parent) return;
        const bounds = parent.getBoundingClientRect();
        const stacked = window.matchMedia("(max-width: 820px)").matches;
        const length = stacked ? bounds.height : bounds.width;
        if (length <= 0) return;
        clamp(
          100 *
            ((stacked
              ? event.clientY - bounds.top
              : event.clientX - bounds.left) /
              length),
        );
      }}
      onPointerUp={(event) => {
        if (active.current !== event.pointerId) return;
        active.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        active.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        active.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (
          [
            "ArrowLeft",
            "ArrowUp",
            "ArrowRight",
            "ArrowDown",
            "Home",
            "End",
          ].includes(event.key)
        ) {
          event.preventDefault();
          clamp(
            event.key === "Home"
              ? 35
              : event.key === "End"
                ? 65
                : value +
                  (["ArrowLeft", "ArrowUp"].includes(event.key) ? -2 : 2),
          );
        }
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
