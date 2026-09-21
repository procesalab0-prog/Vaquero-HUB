"use client";

import { Check, Maximize, RotateCw } from "lucide-react";
import { useRef, useState } from "react";
import { MemberCodes } from "./member-codes";
import { useScanWakeLock } from "./use-scan-wake-lock";

export function MemberCard({
  memberNumber,
  fullName,
  saved,
  onExpand,
}: {
  memberNumber: string;
  fullName: string | null;
  saved: boolean;
  onExpand: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const frontButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  useScanWakeLock(flipped);
  const flip = (next: boolean) => {
    setFlipped(next);
    requestAnimationFrame(() =>
      (next ? backButton : frontButton).current?.focus({ preventScroll: true }),
    );
  };
  const number = memberNumber.replace(/(.{4})/g, "$1 ").trim();
  return (
    <article className="mi-member-flipper" aria-label="Tu tarjeta de socio">
      <div className={`mi-member-rotation${flipped ? " is-flipped" : ""}`}>
        <div
          className="mi-member-panel mi-member-face"
          inert={flipped}
          aria-hidden={flipped}
        >
          <div className="mi-member-top">
            <div className="mi-member-identity">
              <span className="mi-eyebrow">SOCIO</span>
              <h2>{fullName || "Mi tarjeta"}</h2>
              <p className="mi-member-number">{number}</p>
            </div>
            <button
              ref={frontButton}
              className="mi-qr-button"
              onClick={() => flip(true)}
              aria-label="Voltear tarjeta para mostrar código de barras"
            >
              <MemberCodes memberNumber={memberNumber} />
              <span>TOCA PARA VER BARRAS</span>
            </button>
          </div>
          <div className="mi-member-bottom">
            <span>
              <Check size={15} />
              {saved ? "Disponible sin conexión" : "Tarjeta digital"}
            </span>
            <button className="mi-text-button" onClick={onExpand}>
              <Maximize size={16} /> Ver códigos
            </button>
          </div>
        </div>
        <div
          className="mi-member-panel mi-member-face mi-member-reverse"
          inert={!flipped}
          aria-hidden={!flipped}
        >
          <span className="mi-eyebrow">TU SOCIO EN CAJA</span>
          <MemberCodes memberNumber={memberNumber} barcode barcodeOnly />
          <p className="mi-member-number">{number}</p>
          <p className="mi-scan-hint">
            Si hace falta, aumenta el brillo de tu teléfono.
          </p>
          <div className="mi-member-bottom">
            <button
              ref={backButton}
              className="mi-text-button"
              onClick={() => flip(false)}
            >
              <RotateCw size={16} /> Volver al QR
            </button>
            <button className="mi-text-button" onClick={onExpand}>
              <Maximize size={16} /> Ampliar códigos
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
