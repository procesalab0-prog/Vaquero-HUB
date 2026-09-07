import { expect, test } from "@playwright/test";

test("muestra inventario usable sin desbordar la pantalla", async ({
  page,
}) => {
  await page.goto("/inventario");

  await expect(
    page.getByRole("main").getByRole("heading", { name: "Inventario" }),
  ).toBeVisible();
  await expect(page.getByText("Disponibles para vender")).toBeVisible();
  await expect(
    page.locator(".inventory-row:not(.table-header)").first(),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => window.innerWidth),
  );

  await page.getByRole("button", { name: "Ver movimientos" }).click();
  const dialog = page.getByRole("dialog", { name: "Movimientos recientes" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Aún no hay movimientos")).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("captura 20 variantes seguidas con Enter y sin recargar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inventario");
  await page.getByRole("button", { name: "Conteos" }).click();
  const dialog = page.getByRole("dialog", { name: "Conteos" });
  const quantity = dialog.getByLabel("Cantidad física");

  for (let index = 1; index <= 20; index += 1) {
    await quantity.fill(String(index));
    await quantity.press("Enter");
    await expect(dialog.getByText(`${index} de 20 capturadas`)).toBeVisible();
  }

  await expect(dialog).toContainText("Conteo completo");
  await expect(
    dialog.getByRole("button", { name: "Cerrar y aplicar" }),
  ).toBeEnabled();
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
});

test("filtra mercancía al solicitar un traspaso y conserva lo elegido", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/inventario");
  await page.getByRole("button", { name: "Traspasos" }).click();
  const dialog = page.getByRole("dialog", { name: "Traspasos" });
  await dialog.getByText("Nueva solicitud").click();
  const search = dialog.getByLabel("Buscar mercancía");
  await search.fill("Cuadra");
  const quantity = dialog.getByLabel(/Cantidad de Bota Cuadra/).first();
  await quantity.fill("1");
  await expect(dialog.getByText("1 renglones seleccionados")).toBeVisible();
  await search.fill("sin coincidencia");
  await expect(
    dialog.getByText("No hay mercancía que coincida."),
  ).toBeVisible();
  await search.fill("Cuadra");
  await expect(
    dialog.getByLabel(/Cantidad de Bota Cuadra/).first(),
  ).toHaveValue("1");
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 1180);
});

for (const viewport of [
  { name: "iPad horizontal", width: 1180, height: 820 },
  { name: "computadora", width: 1440, height: 900 },
]) {
  test(`permite llegar al final en ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/inventario");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator("html")).toHaveJSProperty(
      "scrollWidth",
      viewport.width,
    );
    await expect(
      page.locator(".inventory-row:not(.table-header)").last(),
    ).toBeVisible();
  });
}
