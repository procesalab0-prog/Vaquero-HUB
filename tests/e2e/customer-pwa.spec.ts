import { expect, test } from "@playwright/test";

const storageKey = "vaquero-hub-customer-card-v1";

test("Mi Vaquero conserva su instalación separada y el recorrido editorial", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/mi");
  await expect(
    page.getByRole("heading", { name: "LO QUE ERES. LO QUE LLEVAS." }),
  ).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/mi/manifest.webmanifest",
  );
  expect(
    (await (await request.get("/mi/manifest.webmanifest")).json()).start_url,
  ).toBe("/mi");
  expect(
    (await (await request.get("/manifest.webmanifest")).json()).start_url,
  ).toBe("/inicio");
  await expect(page.locator("video")).not.toHaveAttribute("src");
  await page
    .getByRole("button", { name: "Video siguiente", exact: true })
    .click();
  await expect(page.locator("video")).toHaveAttribute(
    "poster",
    "/mi-media/campaign-03.jpg",
  );
  await page.getByRole("button", { name: "Tarjeta", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Crear o activar mi tarjeta",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Crear o activar mi tarjeta",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Entra a tu cuenta." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Crear cuenta", exact: true }),
  ).toBeVisible();
});

test("la tarjeta guardada conserva QR, barras, navegación y retiro local", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/mi");
  await page.evaluate(
    ({ key }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, memberNumber: "10000016" }),
      ),
    { key: storageKey },
  );
  await page.reload();
  await expect(
    page.getByRole("article", { name: "Tu tarjeta de socio" }),
  ).toBeVisible();
  await expect(page.locator(".mi-qr-button img")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await page
    .getByRole("button", {
      name: "Voltear tarjeta para mostrar código de barras",
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Volver al QR" }),
  ).toBeVisible();
  await expect(
    page.locator(".mi-member-reverse svg[role=img] rect").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Volver al QR" }).click();
  await page.getByRole("button", { name: "Ver códigos", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").locator("svg[role=img] rect").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ["Inicio", "Tarjeta", "Perfil"]) {
      await page.getByRole("button", { name: view, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Quitar tarjeta de este dispositivo" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "se quitó únicamente de este dispositivo",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
});

test("la PWA conserva la tarjeta sin conexión sin guardar videos ni borrar otros cachés", async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_USE_PRODUCTION && !process.env.CI,
    "El service worker sólo se registra en producción",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/mi");
  await page.evaluate(async (key) => {
    await caches.open("pos-cache-test");
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, memberNumber: "10000016" }),
    );
    await navigator.serviceWorker.ready;
  }, storageKey);
  await page.reload();
  await expect(page.locator(".mi-qr-button img")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".mi-qr-button img")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(
    page.getByText("Sin conexión · Tu tarjeta sigue contigo", { exact: false }),
  ).toBeVisible();
  const cached = await page.evaluate(async () => ({
    keys: await caches.keys(),
    urls: (await (await caches.open("mi-vaquero-editorial-v1")).keys()).map(
      (entry) => entry.url,
    ),
  }));
  expect(cached.keys).toContain("pos-cache-test");
  expect(
    cached.urls.some((url) => url.includes(".mp4") || url.includes("/api/")),
  ).toBe(false);
  await context.setOffline(false);
});
