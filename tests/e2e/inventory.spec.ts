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
