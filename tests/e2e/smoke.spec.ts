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

    const workspace = page.locator(".workspace-main");
    await workspace.evaluate((element) =>
      element.scrollTo({ top: element.scrollHeight }),
    );

    await expect(page.getByText("Ventas recientes")).toBeInViewport();
    await expect(workspace).toHaveJSProperty(
      "scrollTop",
      await workspace.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    );
  });
}
