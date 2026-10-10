import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1024, 1440]) {
  test(`Más despliega opciones en la navegación sin abandonar la pantalla ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/inicio?ubicacion=demo-la-piedad");
    const summary = page.getByRole("button", {
      name: "Más opciones",
      exact: true,
    });
    await summary.click();
    await expect(page).toHaveURL(/\/inicio\?/);
    const submenu = page.locator(".rail-submenu");
    await expect(submenu).toBeVisible();
    await expect(
      submenu.getByRole("link", { name: "Clientes", exact: true }),
    ).toBeInViewport();
    await expect(
      submenu.getByRole("link", { name: "Clientes", exact: true }),
    ).toHaveAttribute("href", "/clientes?ubicacion=demo-la-piedad");
    await summary.focus();
    await page.keyboard.press("Escape");
    await expect(submenu).not.toBeVisible();
    await summary.click();
    await submenu.getByRole("link", { name: "Clientes", exact: true }).click();
    await expect(page).toHaveURL(/\/clientes\?ubicacion=demo-la-piedad/);
    await expect(submenu).not.toBeVisible();
  });
}

test("la paleta cambia superficies y botones y persiste al recargar", async ({
  page,
}) => {
  await page.goto("/ajustes");
  await page.getByRole("button", { name: /Apariencia y usuarios/ }).click();
  const railColor = () =>
    page
      .locator(".nav-rail")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  const original = await railColor();
  await page.getByRole("button", { name: /Mezclilla/ }).click();
  await expect.poll(railColor).not.toBe(original);
  const blue = await railColor();
  await page.reload();
  await expect.poll(railColor).toBe(blue);
  await page.goto("/pos");
  await page
    .getByRole("textbox", { name: "Buscar o escanear producto" })
    .fill("750104020251");
  await page
    .getByRole("textbox", { name: "Buscar o escanear producto" })
    .press("Enter");
  const mobile = page.locator(".mobile-cart-toggle");
  if (await mobile.isVisible()) await mobile.click();
  await expect
    .poll(() =>
      page
        .locator(".pay-button")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .toBe("rgb(23, 103, 71)"); // Cobrar conserva verde operativo en todas las paletas.
  await expect(page.locator(".pay-brand")).toBeVisible();
});

test("el menú busca módulos, conserva sucursal y devuelve el foco", async ({
  page,
}) => {
  await page.goto("/inicio");
  const trigger = page.getByRole("button", { name: "Buscar un módulo" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "¿Qué necesitas hacer?" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Buscar módulo", exact: true })
    .fill("cotizacion");
  const link = dialog.getByRole("link", { name: /Cotizaciones/ });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", /\/cotizaciones\?ubicacion=/);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("plegar la navegación conserva accesos y destino activo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/pos");
  await page.getByRole("button", { name: "Contraer navegación" }).click();
  await expect(page.locator('.rail-link[aria-current="page"]')).toHaveAttribute(
    "aria-label",
    "Venta",
  );
  await expect(
    page.getByRole("link", { name: "Inventario", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ampliar navegación" }).click();
  await expect(page.locator(".rail-wordmark")).toBeVisible();
});

test("menú accesible en teléfono con texto grande y movimiento reducido", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pos");
  await page.evaluate(() => {
    document.documentElement.dataset.textSize = "xlarge";
  });
  const trigger = page.getByRole("button", { name: "Buscar un módulo" });
  await expect(trigger).toBeInViewport();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "¿Qué necesitas hacer?" });
  await dialog
    .getByRole("textbox", { name: "Buscar módulo", exact: true })
    .fill("inexistente");
  await expect(dialog.getByRole("status")).toContainText("No hay módulos");
  await page.keyboard.press("Escape");
  await page.locator(".mobile-cart-toggle").click();
  await expect(page.locator(".sale-panel")).toBeInViewport();
  await expect(page.locator(".pay-button")).toBeInViewport();
});
