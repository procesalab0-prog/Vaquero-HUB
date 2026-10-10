import { afterEach, beforeEach, expect, it, vi } from "vitest";

let events: CustomEvent[];
let storage: Map<string, string>;
let audioStarts: number;
beforeEach(() => {
  vi.resetModules();
  events = [];
  storage = new Map();
  audioStarts = 0;
  class FakeAudio {
    state = "running";
    currentTime = 0;
    destination = {};
    resume() {
      return Promise.resolve();
    }
    createOscillator() {
      return {
        type: "sine",
        frequency: { setValueAtTime() {} },
        connect() {},
        disconnect() {},
        onended: null,
        start() {
          audioStarts++;
        },
        stop() {},
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    }
  }
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    dispatchEvent: (event: CustomEvent) => {
      events.push(event);
      return true;
    },
    AudioContext: FakeAudio,
  });
  vi.stubGlobal("AudioContext", FakeAudio);
  vi.stubGlobal("document", { visibilityState: "visible" });
});
afterEach(() => vi.unstubAllGlobals());

it("un rechazo conserva su categoría y se muestra aun con sonido desactivado", async () => {
  const notices = await import("../../lib/workspace-notifications");
  const result = await notices.publishWorkspaceNotification({
    id: "failure",
    title: "No se guardó",
    message: "Revisa los datos",
    locationId: "branch",
    kind: "error",
  });
  expect(result.played).toBe(false);
  expect(audioStarts).toBe(0);
  expect(events[0].detail).toMatchObject({
    id: "failure",
    kind: "error",
    locationId: "branch",
  });
});
it("una respuesta repetida con el mismo documento no duplica el aviso ni el sonido", async () => {
  const notices = await import("../../lib/workspace-notifications");
  await notices.enableNotificationSound(true);
  const input = {
    id: "return:123",
    title: "Devolución",
    message: "Guardada",
    locationId: "branch",
  };
  expect((await notices.publishWorkspaceNotification(input)).played).toBe(true);
  expect((await notices.publishWorkspaceNotification(input)).played).toBe(
    false,
  );
  expect(
    events.filter(
      (event) => event.type === notices.WORKSPACE_NOTIFICATION_EVENT,
    ),
  ).toHaveLength(1);
  expect(audioStarts).toBe(1);
});
it("no programa audio en segundo plano, pero conserva el aviso", async () => {
  const notices = await import("../../lib/workspace-notifications");
  await notices.enableNotificationSound(true);
  vi.stubGlobal("document", { visibilityState: "hidden" });
  expect(
    (
      await notices.publishWorkspaceNotification({
        title: "Caja cerrada",
        message: "Guardada",
        locationId: "branch",
      })
    ).played,
  ).toBe(false);
  expect(audioStarts).toBe(0);
  expect(
    events.filter(
      (event) => event.type === notices.WORKSPACE_NOTIFICATION_EVENT,
    ),
  ).toHaveLength(1);
});
it("si la preferencia está guardada pero el audio no se reactivó, no promete sonido", async () => {
  const notices = await import("../../lib/workspace-notifications");
  storage.set(notices.NOTIFICATION_SOUND_KEY, "on");
  const result = await notices.publishWorkspaceNotification({
    title: "Entrada registrada",
    message: "Guardada",
    locationId: "branch",
  });
  expect(result.played).toBe(false);
  expect(result.reason).toMatch(/Audio bloqueado/);
  expect(events).toHaveLength(1);
});
it("el gesto posterior a recargar reactiva un opt-in sin cambiar preferencias ni crear aviso", async () => {
  const notices = await import("../../lib/workspace-notifications");
  storage.set(notices.NOTIFICATION_SOUND_KEY, "on");
  await notices.resumeNotificationSound();
  expect(events).toHaveLength(0);
  expect(
    (
      await notices.publishWorkspaceNotification({
        title: "Pedido nuevo",
        message: "Recibido",
        locationId: "branch",
      })
    ).played,
  ).toBe(true);
  expect(audioStarts).toBe(1);
});
it("reactivar desde un gesto respeta sonido apagado", async () => {
  const notices = await import("../../lib/workspace-notifications");
  await notices.resumeNotificationSound();
  expect(storage.has(notices.NOTIFICATION_SOUND_KEY)).toBe(false);
  expect(events).toHaveLength(0);
  expect(audioStarts).toBe(0);
});
