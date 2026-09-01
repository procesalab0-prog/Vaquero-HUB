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
