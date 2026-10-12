"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// La pantalla del logo se ve cada vez que se abre el programa —también justo
// después de iniciar sesión— y luego se desvanece. No se repite al navegar ni
// al cambiar de sucursal: el shell se vuelve a montar al cambiar de sucursal, y
// por eso este indicador vive en el módulo y no en el estado.
let entrancePlayed = false;

// Emmanuel pidió que el logo se vea dos segundos al abrir el programa.
const ENTRANCE_HOLD_MS = 2000;
// Margen por si el navegador no dispara animationend (pestaña en segundo plano).
const ENTRANCE_LIMIT_MS = ENTRANCE_HOLD_MS + 1000;

export type EntranceScene = "hold" | "leaving" | "none";

export function useEntrance() {
  const [scene, setScene] = useState<EntranceScene>(() =>
    entrancePlayed ? "none" : "hold",
  );
  const active = scene !== "none";

  useEffect(() => {
    if (!active) return;
    entrancePlayed = true;

    // Una tecla termina la entrada al instante. El lector de códigos escribe
    // como teclado: sus teclas siguen su camino sin esperar los dos segundos.
    const finish = () => setScene("none");
    const options = { capture: true, passive: true, once: true } as const;
    window.addEventListener("keydown", finish, options);
    const hold = window.setTimeout(() => setScene("leaving"), ENTRANCE_HOLD_MS);
    const limit = window.setTimeout(finish, ENTRANCE_LIMIT_MS);
    return () => {
      window.removeEventListener("keydown", finish, options);
      window.clearTimeout(hold);
      window.clearTimeout(limit);
    };
  }, [active]);

  return { scene, finish: () => setScene("none") };
}

// Logo completo con destello dorado sobre negro, a pantalla completa: continúa
// la pantalla de carga sin corte. Un toque la cierra y no llega a los botones
// que están debajo, que todavía no se ven.
export function EntranceCurtain({
  scene,
  onDone,
}: {
  scene: Exclude<EntranceScene, "none">;
  onDone: () => void;
}) {
  return (
    <div
      className="entrance-curtain"
      data-scene={scene}
      aria-hidden="true"
      onPointerDown={(event) => {
        event.preventDefault();
        onDone();
      }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && scene === "leaving")
          onDone();
      }}
    >
      <span className="brand-logo-shine">
        <Image
          src="/brand/logo-vaquerosm-blanco-recortado.png"
          alt=""
          width={480}
          height={350}
          priority
        />
        <span className="nav-wait-shine" aria-hidden="true">
          <i />
        </span>
      </span>
    </div>
  );
}
