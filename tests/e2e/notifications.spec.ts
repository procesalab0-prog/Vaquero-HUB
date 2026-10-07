import { expect, test } from "@playwright/test";
import { LA_PIEDAD_STORE } from "../../lib/business-profile";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`prueba visible, audio iniciado y preferencia persistente ${viewport.width}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Validate scheduling, not physical speakers or Safari's installed PWA.
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
              document.documentElement.dataset.soundCount = String(
                Number(document.documentElement.dataset.soundCount ?? "0") + 1,
              );
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
      Object.defineProperty(window, "AudioContext", { value: FakeAudio });
    });
    await page.setViewportSize(viewport);
    await page.goto("/ajustes");
    await page.getByRole("button", { name: /Notificaciones Avisos/ }).click();
    const toggle = page.getByRole("checkbox", {
      name: "Sonido de notificaciones",
    });
    await page.getByRole("button", { name: "Probar notificación" }).click();
    await expect(
      page.getByText("Sonido desactivado; el aviso visual sí se muestra."),
    ).toBeVisible();
    await expect(page.locator(".workspace-notification-toast")).toContainText(
      "Prueba de notificación",
    );
    await toggle.check();
    await page.getByRole("button", { name: "Probar notificación" }).click();
    await expect(
      page.getByText(
        "Audio iniciado. Confirma que lo escuchas en este dispositivo.",
      ),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-sound-count", "1");
    await page.getByRole("button", { name: "Cerrar aviso" }).click();
    await page
      .getByRole("button", { name: "Notificaciones", exact: true })
      .click();
    await expect(
      page
        .getByRole("complementary", { name: "Notificaciones" })
        .locator("article"),
    ).toHaveCount(2);
    await page.reload();
    await page.getByRole("button", { name: /Notificaciones Avisos/ }).click();
    await expect(toggle).toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("audio bloqueado informa el rechazo sin perder el aviso visual", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("mi-tienda:notification-sound:v1", "on");
    Object.defineProperty(window, "AudioContext", {
      value: class {
        state = "suspended";
        resume() {
          return Promise.resolve();
        }
      },
    });
  });
  await page.goto("/ajustes");
  await page.getByRole("button", { name: /Notificaciones Avisos/ }).click();
  await page.getByRole("button", { name: "Probar notificación" }).click();
  await expect(page.getByText(/El navegador bloqueó el audio/)).toBeVisible();
  await expect(page.locator(".workspace-notification-toast")).toBeVisible();
  await expect(page.getByText(/Audio iniciado/)).toHaveCount(0);
});

test("el rechazo queda encima del modal y no mezcla avisos de otra sucursal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pos");
  const mobileCart = page.locator(".mobile-cart-toggle");
  if (await mobileCart.isVisible()) await mobileCart.click();
  await page
    .getByRole("button", { name: "Producto rápido", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Producto rápido", exact: true }),
  ).toBeVisible();
  // Test only event presentation. This synthetic notice does not claim an RPC ran.
  await page.evaluate(
    (locationId) =>
      window.dispatchEvent(
        new CustomEvent("mi-tienda:notification:v1", {
          detail: {
            id: "qa-error",
            title: "No se guardó la operación",
            message: "Datos de prueba",
            locationId,
            kind: "error",
            createdAt: new Date().toISOString(),
          },
        }),
      ),
    LA_PIEDAD_STORE.id,
  );
  const toast = page.locator(".workspace-notification-toast");
  await expect(toast).toHaveAttribute("role", "alert");
  await expect(toast).toBeInViewport();
  expect(
    await toast.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(rect.x + 20, rect.y + 20),
      );
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "Cerrar aviso" }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("mi-tienda:notification:v1", {
        detail: {
          id: "qa-other",
          title: "Otra tienda",
          message: "No debe mostrarse aquí",
          locationId: "other-branch",
          createdAt: new Date().toISOString(),
        },
      }),
    ),
  );
  await expect(toast).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Producto rápido", exact: true }),
  ).toBeVisible();
});
