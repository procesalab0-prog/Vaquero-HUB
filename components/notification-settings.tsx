"use client";
import { useState, useSyncExternalStore } from "react";
import { useWorkspace } from "./workspace-context";
import { enableNotificationSound, notificationSoundEnabled, NOTIFICATION_SOUND_EVENT, publishWorkspaceNotification } from "@/lib/workspace-notifications";

function subscribeSound(listener: () => void) {
  window.addEventListener(NOTIFICATION_SOUND_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(NOTIFICATION_SOUND_EVENT, listener); window.removeEventListener("storage", listener); };
}

export function NotificationSettings() {
  const { activeLocation } = useWorkspace();
  const enabled = useSyncExternalStore(subscribeSound, notificationSoundEnabled, () => false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function toggle(value: boolean) {
    try { await enableNotificationSound(value); setStatus(value ? "Sonido activado para este navegador. Puedes probarlo abajo." : "Sonido desactivado; se conservan los avisos visuales."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "No fue posible activar el audio."); }
  }
  async function test() {
    if (!activeLocation) { setStatus("Selecciona una sucursal antes de probar."); return; }
    setBusy(true);
    try {
      const result = await publishWorkspaceNotification({ title: "Prueba de notificación", message: "Este aviso es una prueba: no crea ventas ni movimientos de caja.", locationId: activeLocation.id }, true);
      setStatus(result.reason);
    } finally { setBusy(false); }
  }
  return <section className="settings-section">
    <h2>Notificaciones y sonido</h2>
    <p>Preferencia de este navegador. El sonido requiere activarlo con un toque; el volumen y modo silencio del dispositivo también influyen.</p>
    <label className="notification-sound-toggle"><input type="checkbox" checked={enabled} onChange={(event) => void toggle(event.target.checked)} /> Sonido de notificaciones</label>
    <button type="button" className="primary-button" disabled={busy || !activeLocation} onClick={() => void test()}>Probar notificación</button>
    {status ? <p role="status">{status}</p> : null}
    <p className="notice">Avisos con la aplicación abierta: Venta, Compras, Caja y Cambios/Devoluciones. También muestran los rechazos de estas operaciones por encima de las ventanas. No son alertas push del sistema ni mensajes de todas las sucursales. En segundo plano no se garantiza sonido. Tras recargar, prueba de nuevo para habilitar el audio.</p>
  </section>;
}
