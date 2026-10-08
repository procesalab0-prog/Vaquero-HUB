"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// El telón se recoge cada vez que se abre el programa —también justo después
// de iniciar sesión—, saliendo de la pantalla de carga. No se repite al
// navegar ni al cambiar de sucursal: el shell se vuelve a montar al cambiar de
// sucursal, y por eso este indicador vive en el módulo y no en el estado.
let entrancePlayed = false;

// Margen por si el navegador no dispara animationend (pestaña en segundo plano).
const ENTRANCE_LIMIT_MS = 1400;

export function useEntrance() {
  const [scene, setScene] = useState<"full" | "none">(() =>
    entrancePlayed ? "none" : "full",
  );

  useEffect(() => {
    if (scene === "none") return;
    entrancePlayed = true;

    // Cualquier toque o tecla termina la entrada al instante. El lector de
    // códigos escribe como teclado: sus teclas siguen su camino sin esperar.
    const finish = () => setScene("none");
    const options = { capture: true, passive: true, once: true } as const;
    window.addEventListener("pointerdown", finish, options);
    window.addEventListener("keydown", finish, options);
    const limit = window.setTimeout(finish, ENTRANCE_LIMIT_MS);
    return () => {
      window.removeEventListener("pointerdown", finish, options);
      window.removeEventListener("keydown", finish, options);
      window.clearTimeout(limit);
    };
  }, [scene]);

  return { scene, finish: () => setScene("none") };
}

// El negro del acceso se recoge hacia el riel negro del sistema: la persona ve
// que entró al mismo lugar, no que cambió de página. No recibe toques nunca.
export function EntranceCurtain({ onDone }: { onDone: () => void }) {
  return (
    <div
      className="entrance-curtain"
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) onDone();
      }}
    >
      <span className="entrance-curtain-logo">
        <Image
          src="/brand/logo-vaquerosm-blanco.png"
          alt=""
          width={520}
          height={226}
          priority
        />
      </span>
    </div>
  );
}
