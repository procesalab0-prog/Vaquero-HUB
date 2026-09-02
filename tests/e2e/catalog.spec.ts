import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("genera varias tallas desde una sola captura en móvil", async ({
  page,
}) => {
  await page.goto("/productos");
  await page.getByRole("button", { name: "Nuevo producto" }).click();

  const dialog = page.getByRole("dialog", { name: "Nuevo producto" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Nombre del producto").fill("Bota de prueba M2");
  await dialog.getByLabel("Marca").fill("Vaquero SM");
  await dialog.getByLabel("Código base").fill("M2-PRUEBA");
  await dialog.getByLabel("Costo").fill("1200");
  await dialog.getByLabel("Precio").fill("2199");

  const sizes = dialog.locator('input[name="size_id"]');
  await expect(sizes).toHaveCount(10);
  const sizeButtons = dialog.locator("label.size-option");
  for (let index = 0; index < 8; index += 1)
    await sizeButtons.nth(index).click();

  await expect(
    dialog.getByRole("button", { name: "Crear 8 variantes" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Crear 8 variantes" }).click();

  await expect(page.getByText("Vista previa agregada")).toBeVisible();
  await expect(page.getByText("M2-PRUEBA-08")).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
});
