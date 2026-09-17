import { expect, test } from "@playwright/test";

test("abre Mi Tienda SM y conserva la navegación principal", async ({
  page,
}) => {
  await page.goto("/inicio");

  await expect(page).toHaveTitle(/Mi Tienda SM/i);
  await expect(page.getByRole("heading", { name: /buen día/i })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /venta/i }).first(),
  ).toBeVisible();
});

for (const viewport of [
  { name: "teléfono vertical", width: 390, height: 844 },
  { name: "iPad vertical", width: 768, height: 1024 },
  { name: "computadora", width: 1440, height: 800 },
  { name: "iPad horizontal", width: 1024, height: 768 },
]) {
  test(`permite llegar al final de Inicio en ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/inicio");
    const finalSale = page.getByText("V-000840");
    await expect(finalSale).toBeVisible();

    const workspace = page.locator(".workspace-main");
    await workspace.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    await expect
      .poll(async () =>
        workspace.evaluate((element) =>
          Math.abs(
            element.scrollHeight - element.clientHeight - element.scrollTop,
          ),
        ),
      )
      .toBeLessThanOrEqual(1);
    await expect(finalSale).toBeInViewport();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  });
}

for (const viewport of [
  { name: "teléfono", width: 390, height: 844 },
  { name: "iPad", width: 820, height: 1180 },
  { name: "computadora", width: 1440, height: 900 },
]) {
  test(`muestra Apartados sin desbordar en ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/apartados");
    await expect(
      page
        .getByRole("main")
        .getByRole("heading", { name: "Apartados", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /nuevo desde venta/i }),
    ).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByText(/conecta supabase/i)).toBeVisible();
  });
}

test("mantiene accesibles los seis destinos táctiles en teléfono vertical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inicio");

  const links = page.locator(".nav-rail .rail-link:visible");
  await expect(links).toHaveCount(6);
  for (const link of await links.all()) {
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(48);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  }
});

for (const route of [
  "/inicio",
  "/pos",
  "/productos",
  "/inventario",
  "/clientes",
  "/caja",
  "/tickets",
  "/apartados",
  "/reportes",
  "/administracion",
  "/ajustes",
]) {
  test(`conserva ${route} dentro del teléfono vertical`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(390);
    const workspace = page.locator(".workspace-main");
    await workspace.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(async () =>
        workspace.evaluate((element) =>
          Math.abs(
            element.scrollHeight - element.clientHeight - element.scrollTop,
          ),
        ),
      )
      .toBeLessThanOrEqual(1);
  });
}

test("el ticket de regalo usa un código real y no un cuadro simulado", async ({
  page,
}) => {
  await page.goto("/prueba-impresion");
  await page.locator(".receipt-type-switch button.gift").click();
  await expect(page.locator(".gift-receipt .label-barcode-svg")).toBeVisible();
  await expect(page.locator(".receipt-qr")).toHaveCount(0);
});

for (const viewport of [
  { name: "teléfono", width: 390, height: 844 },
  { name: "iPad", width: 820, height: 1180 },
  { name: "computadora", width: 1440, height: 900 },
]) {
  test(`muestra Reportes sin desbordar en ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/reportes");
    await expect(
      page.getByRole("heading", { name: "Reportes reales" }),
    ).toBeVisible();
    await expect(page.locator(".report-summary-grid article")).toHaveCount(4);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);

    const workspace = page.locator(".workspace-main");
    await workspace.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(async () =>
        workspace.evaluate((element) =>
          Math.abs(
            element.scrollHeight - element.clientHeight - element.scrollTop,
          ),
        ),
      )
      .toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("heading", { name: "Detalle vendido" }),
    ).toBeInViewport();
  });
}
