"use client";

import { useSyncExternalStore } from "react";

import {
  HAPTICS_EVENT,
  HAPTICS_KEY,
  hapticsEnabled,
  hapticsSupported,
} from "@/lib/press-feedback";

function subscribe(listener: () => void) {
  window.addEventListener(HAPTICS_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(HAPTICS_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function HapticsSetting() {
  const enabled = useSyncExternalStore(subscribe, hapticsEnabled, () => true);
  const supported = useSyncExternalStore(
    subscribe,
    hapticsSupported,
    () => true,
  );

  function choose(next: boolean) {
    try {
      window.localStorage.setItem(HAPTICS_KEY, next ? "on" : "off");
    } catch {
      // Sin almacenamiento la preferencia dura sólo esta visita.
    }
    window.dispatchEvent(new Event(HAPTICS_EVENT));
  }

  return (
    <label className="haptics-setting">
      <span>Vibrar al tocar botones</span>
      <span className="haptics-setting-control">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => choose(event.target.checked)}
        />
        {enabled ? "Activado" : "Desactivado"}
      </span>
      <small>
        {supported
          ? "Una vibración muy corta confirma cada toque. Se guarda en este dispositivo."
          : "Este dispositivo no permite vibrar desde el navegador (iPad e iPhone no lo permiten); los botones siguen respondiendo con luz."}
      </small>
    </label>
  );
}
