"use client";

import { useId, useRef, useState, type ReactNode } from "react";

/** Native top layer keeps menus outside the clipping/scroll of their panels. */
export function WorkspacePopover({
  label,
  trigger,
  children,
  className,
  triggerClassName,
  side = false,
  title,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className: string;
  triggerClassName: string;
  side?: boolean;
  title?: string;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 12,
    top: 80,
    maxHeight: 360,
  });
  function toggle() {
    if (panel.current?.matches(":popover-open")) {
      panel.current.hidePopover();
      return;
    }
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    const mobile = window.innerWidth <= 820;
    const railRight =
      button.current?.closest(".nav-rail")?.getBoundingClientRect().right ??
      box.right;
    const width = mobile
      ? Math.min(440, window.innerWidth - 24)
      : side
        ? 480
        : 360;
    const navTop = document
      .querySelector(".nav-rail")
      ?.getBoundingClientRect().top;
    const bottom =
      mobile && navTop !== undefined ? navTop - 12 : window.innerHeight - 16;
    const maxHeight = Math.min(side ? 620 : 360, Math.max(44, bottom - 16));
    setPosition({
      left: Math.max(
        12,
        Math.min(
          mobile ? 12 : side ? railRight + 12 : box.right - width,
          window.innerWidth - width - 12,
        ),
      ),
      maxHeight,
      top: Math.max(
        16,
        Math.min(
          mobile && side ? box.top - maxHeight - 12 : box.bottom + 8,
          bottom - maxHeight,
        ),
      ),
    });
    panel.current?.showPopover();
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
      >
        {trigger}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className={`workspace-popover ${className}`}
        style={position}
        aria-label={label}
        onToggle={(event) => setOpen(event.newState === "open")}
        onClickCapture={(event) => {
          if ((event.target as Element).closest("button,a"))
            panel.current?.hidePopover();
        }}
      >
        {title ? (
          <div className="popover-heading">
            <p className="rail-submenu-title">{title}</p>
            <button
              type="button"
              className="popover-close"
              aria-label={`Cerrar ${label}`}
              onClick={() => {
                panel.current?.hidePopover();
                button.current?.focus();
              }}
            >
              × <span>Cerrar</span>
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </>
  );
}
