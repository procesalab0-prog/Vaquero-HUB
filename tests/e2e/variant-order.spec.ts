import { expect, test } from "@playwright/test";

test("ordena tallas numéricas capturadas en distinto orden sin perder variantes", async ({
  page,
}) => {
  await page.goto("/productos");
  await page.getByRole("button", { name: "Nuevo producto" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo producto" });
  await dialog.getByLabel("Nombre del producto").fill("Orden de tallas M9");
  await dialog.getByLabel("Marca").fill("Prueba local");
  await dialog.getByLabel("Categoría").selectOption({ label: "Botas" });
  await dialog.getByLabel("Costo").fill("100");
  await dialog.getByLabel("Precio").fill("200");
  await dialog
    .locator("label.size-option")
    .filter({ hasText: /^Negro$/ })
    .click();
  for (const size of ["28", "25.5", "26"])
    await dialog
      .locator("label.size-option")
      .filter({ hasText: new RegExp(`^${size.replace(".", "\\.")}$`) })
      .click();
  await dialog.getByRole("button", { name: "Crear 3 variantes" }).click();
  await page.getByLabel("Buscar productos").fill("Orden de tallas M9");
  const rows = page.locator(".data-table > .table-row:not(.table-header)");
  await expect(rows).toHaveCount(3);
  await expect(rows.locator(":scope > span").nth(0)).toHaveText("Negro · 25.5");
  const labels = rows.locator('input[type="checkbox"]').locator("..");
  await expect(labels).toHaveText([
    "Seleccionar Orden de tallas M9, Negro, talla 25.5",
    "Seleccionar Orden de tallas M9, Negro, talla 26",
    "Seleccionar Orden de tallas M9, Negro, talla 28",
  ]);
  await page.screenshot({
    path: test.info().outputPath("tallas-ordenadas.png"),
    fullPage: true,
  });
});
