import { expect, test } from "@playwright/test";

async function addProductAndOpenCheckout(
  page: import("@playwright/test").Page,
) {
  await page.goto("/pos");
  await page.getByRole("button", { name: "Abrir catálogo" }).click();
  await page
    .locator(".product-card")
    .filter({ hasText: "750104020251" })
    .click();

  const mobileCart = page.locator(".mobile-cart-toggle");
  if (await mobileCart.isVisible()) await mobileCart.click();
  await page.getByRole("button", { name: "Cobrar" }).click();
}

test("completa un pago combinado con efectivo y tarjeta", async ({ page }) => {
  await addProductAndOpenCheckout(page);
  await page
    .getByRole("button", { name: "Dividir entre varios métodos" })
    .click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Efectivo").fill("1000");
  await dialog.getByLabel("Tarjeta").fill("3890");
  await dialog.getByLabel("Referencia de terminal").fill("1234");
  await dialog
    .getByRole("button", { name: "Confirmar pago combinado" })
    .click();

  await expect(page.getByText("Venta completada")).toBeVisible();
});

for (const method of [
  { name: "Tarjeta", reference: "Referencia de terminal" },
  { name: "Transferencia", reference: "Referencia de transferencia" },
]) {
  test(`completa un pago con ${method.name.toLocaleLowerCase("es-MX")}`, async ({
    page,
  }) => {
    await addProductAndOpenCheckout(page);
    await page
      .getByRole("button", { name: new RegExp(`^${method.name}`) })
      .click();

    await page.getByLabel(method.reference).fill("1234");
    await page.getByRole("button", { name: "Confirmar cobro" }).click();
    await expect(page.getByText("Venta completada")).toBeVisible();
  });
}
