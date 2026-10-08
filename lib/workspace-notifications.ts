export const WORKSPACE_NOTIFICATION_EVENT = "mi-tienda:notification:v1";
export const NOTIFICATION_SOUND_KEY = "mi-tienda:notification-sound:v1";
export const NOTIFICATION_SOUND_EVENT = "mi-tienda:notification-sound-change:v1";
export type WorkspaceNotification = {
  id: string; title: string; message: string; locationId: string; createdAt: string;
  kind?: "success" | "error";
};
let audioContext: AudioContext | null = null;
const publishedIds = new Set<string>();

export function notificationSoundEnabled() {
  try { return window.localStorage.getItem(NOTIFICATION_SOUND_KEY) === "on"; }
  catch { return false; }
}

/** Resume only from an explicit click. Never claim browser permission is physical audibility. */
export async function enableNotificationSound(enabled: boolean) {
  window.localStorage.setItem(NOTIFICATION_SOUND_KEY, enabled ? "on" : "off");
  window.dispatchEvent(new Event(NOTIFICATION_SOUND_EVENT));
  if (!enabled) return;
  if (!window.AudioContext) throw new Error("Este navegador no permite reproducir este sonido.");
  audioContext ??= new AudioContext();
  await audioContext.resume();
  if (audioContext.state !== "running") throw new Error("El navegador bloqueó el audio. Pulsa Probar notificación para intentarlo de nuevo.");
}

export async function publishWorkspaceNotification(input: { id?: string; title: string; message: string; locationId: string; kind?: "success" | "error" }, test = false) {
  const id = input.id ?? crypto.randomUUID();
  if (publishedIds.has(id)) return { played: false, reason: "Aviso ya mostrado en esta sesión." };
  publishedIds.add(id);
  if (publishedIds.size > 200) publishedIds.delete(publishedIds.values().next().value!);
  const notice: WorkspaceNotification = { ...input, id, createdAt: new Date().toISOString() };
  // Visible even if sound is disabled or browser audio is blocked.
  window.dispatchEvent(new CustomEvent(WORKSPACE_NOTIFICATION_EVENT, { detail: notice }));
  if (!notificationSoundEnabled()) return { played: false, reason: "Sonido desactivado; el aviso visual sí se muestra." };
  try {
    if (test) await enableNotificationSound(true);
    if (!audioContext || audioContext.state !== "running" || document.visibilityState !== "visible") {
      return { played: false, reason: "Audio bloqueado o aplicación en segundo plano. Actívalo y pruébalo desde Ajustes." };
    }
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(660, audioContext.currentTime + .12);
    gain.gain.setValueAtTime(0, audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(.12, audioContext.currentTime + .015);
    gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + .3);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + .32);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    return { played: true, reason: "Audio iniciado. Confirma que lo escuchas en este dispositivo." };
  } catch (error) {
    return { played: false, reason: error instanceof Error ? error.message : "No se pudo reproducir el audio; el aviso visual permanece." };
  }
}
