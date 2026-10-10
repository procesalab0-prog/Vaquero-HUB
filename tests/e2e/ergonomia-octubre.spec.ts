import { expect, test } from "@playwright/test";
for (const size of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 768, height: 1024 },
]) {
  test(`catálogo, carrito y navegación no se tapan ${size.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/pos");
    await expect(page.locator(".product-card").first()).toBeVisible();
    await expect(page.locator(".sale-panel")).not.toBeVisible();
    const search = page.getByRole("textbox", {
      name: "Buscar o escanear producto",
    });
    await search.fill("750104020251");
    await search.press("Enter");
    await expect(page.locator(".mobile-cart-toggle")).toContainText(
      "1 artículos",
    );
    await expect(page.locator(".sale-panel")).not.toBeVisible();
    const toggle = await page.locator(".mobile-cart-toggle").boundingBox();
    const nav = await page.locator(".nav-rail").boundingBox();
    expect(toggle && nav && toggle.y + toggle.height <= nav.y).toBe(true);
    await page.locator(".product-card").last().scrollIntoViewIfNeeded();
    await page
      .locator(".workspace-main")
      .evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect
      .poll(async () => {
        const last = await page.locator(".product-card").last().boundingBox();
        return Boolean(last && toggle && last.y + last.height <= toggle.y);
      })
      .toBe(true);
    await page.locator(".mobile-cart-toggle").click();
    await expect(page.locator(".pay-button")).toBeInViewport();
    await expect(page.locator(".sale-line")).toContainText("750104020251");
    const before = await page.locator(".sale-lines").boundingBox();
    await page
      .getByRole("button", { name: "Herramientas de venta", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Producto rápido", exact: true }),
    ).toBeVisible();
    expect(await page.locator(".sale-lines").boundingBox()).toEqual(before);
    await page.keyboard.press("Escape");
    if (size.width === 390 && test.info().project.name === "chromium") {
      await expect(page.locator(".pos-toast")).not.toBeVisible();
      await expect(
        page.locator(".workspace-notification-toast"),
      ).not.toBeVisible();
      await page.locator(".sale-panel-header").click();
      await page.screenshot({
        path: "../../outputs/venta-redisenada-privada-2026-10-10/venta-telefono.png",
      });
    }
    await page.locator(".pay-button").click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Descuento", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Descuento", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Confirmar cobro", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Descuento", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
test("Más abre al costado y herramientas no contraen la venta", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/pos");
  const more = page.getByRole("button", { name: "Más opciones", exact: true });
  await more.click();
  const submenu = await page.locator(".rail-submenu").boundingBox(),
    rail = await page.locator(".nav-rail").boundingBox();
  expect(submenu && rail && submenu.x >= rail.x + rail.width).toBe(true);
  await expect(
    page
      .locator(".rail-submenu")
      .getByRole("link", { name: "Clientes", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "Cerrar Más opciones", exact: true })
    .click();
  await expect(page.locator(".rail-submenu")).not.toBeVisible();
  await expect(more).toBeFocused();
  await page.getByRole("separator").press("Home");
  const lines = await page.locator(".sale-lines").boundingBox();
  await page
    .getByRole("button", { name: "Herramientas de venta", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Producto rápido", exact: true }),
  ).toBeInViewport();
  expect(await page.locator(".sale-lines").boundingBox()).toEqual(lines);
  await page.keyboard.press("Escape");
  const search = page.getByRole("textbox", {
    name: "Buscar o escanear producto",
  });
  await search.fill("750104020251");
  await search.press("Enter");
  expect(
    await page
      .locator(".sale-line")
      .evaluate((el) =>
        parseFloat(getComputedStyle(el.querySelector(".sale-thumb")!).height),
      ),
  ).toBeGreaterThan(100);
  const imageBounds = await page
    .locator(".sale-thumb img")
    .first()
    .evaluate((el) => {
      const img = el.getBoundingClientRect(),
        box = el.parentElement!.getBoundingClientRect();
      return {
        imageBottom: img.bottom,
        imageRight: img.right,
        boxBottom: box.bottom,
        boxRight: box.right,
      };
    });
  expect(imageBounds.imageBottom).toBeLessThanOrEqual(
    imageBounds.boxBottom + 1,
  );
  expect(imageBounds.imageRight).toBeLessThanOrEqual(imageBounds.boxRight + 1);
  await expect(
    page.getByRole("button", { name: "Descuento", exact: true }),
  ).toHaveCount(0);
  if (test.info().project.name === "chromium") {
    await expect(page.locator(".pos-toast")).not.toBeVisible();
    await expect(
      page.locator(".workspace-notification-toast"),
    ).not.toBeVisible();
    await page.locator(".sale-panel-header").click();
    await page.screenshot({
      path: "../../outputs/venta-redisenada-privada-2026-10-10/venta-computadora.png",
    });
  }
  await page.locator(".pay-button").click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Descuento", exact: true }),
  ).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`Cerrar cobro conserva carrito y colores ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/pos");
    const search = page.getByRole("textbox", {
      name: "Buscar o escanear producto",
    });
    await search.fill("750104020251");
    await search.press("Enter");
    if (width < 820) await page.locator(".mobile-cart-toggle").click();
    await page.locator(".pay-button").click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Cerrar cobro" }),
    ).toBeInViewport();
    const colors = await dialog
      .locator(".checkout-extras button")
      .evaluateAll((buttons) =>
        buttons.map((button) => getComputedStyle(button).backgroundColor),
      );
    expect(new Set(colors).size).toBe(3);
    if (width === 390 && test.info().project.name === "chromium")
      await page.screenshot({
        path: "../../outputs/venta-redisenada-privada-2026-10-10/cobro-cerrar.png",
      });
    await dialog.getByRole("button", { name: "Cerrar cobro" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".sale-panel")).toBeVisible();
    await expect(page.locator(".sale-line")).toContainText("750104020251");
    await page.locator(".pay-button").click();
    await page.locator(".payment-cash").click();
    await page.getByRole("button", { name: "Cerrar cobro" }).click();
    await expect(page.locator(".sale-line")).toHaveCount(1);
    await page.locator(".pay-button").click();
    await expect(page.locator(".payment-cash")).toBeVisible();
  });
}
