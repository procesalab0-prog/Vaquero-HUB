import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("genera una matriz de colores y tallas desde una sola captura en móvil", async ({
  page,
}) => {
  await page.goto("/productos");
  await page.getByRole("button", { name: "Nuevo producto" }).click();

  const dialog = page.getByRole("dialog", { name: "Nuevo producto" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Nombre del producto").fill("Bota de prueba M2");
  await dialog.getByLabel("Marca").fill("Vaquero SM");
  await dialog.getByLabel("Categoría").selectOption({ label: "Botas" });
  await dialog.getByLabel("Costo").fill("1200");
  await dialog.getByLabel("Precio").fill("2199");
  await dialog.locator("label.size-option", { hasText: "Negro" }).click();
  await dialog.locator("label.size-option", { hasText: "Café" }).click();

  const sizes = dialog.getByLabel(/^Talla /);
  await expect(sizes).toHaveCount(10);
  const sizeButtons = dialog.locator(
    ".size-picker:not(.color-picker) label.size-option",
  );
  for (let index = 0; index < 8; index += 1)
    await sizeButtons.nth(index).click();

  await expect(
    dialog.getByRole("button", { name: "Crear 16 variantes" }),
  ).toBeEnabled();
  await dialog.getByLabel("Café, talla 28.5").uncheck();
  await expect(
    dialog.getByRole("button", { name: "Crear 15 variantes" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Crear 15 variantes" }).click();

  await expect(page.getByText("Vista previa agregada")).toBeVisible();
  await expect(page.getByText("Bota de prueba M2").first()).toBeVisible();
  await expect(page.getByText("Se genera al guardar · 15")).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
});

test("agrega variantes y bloquea combinaciones que ya existen", async ({
  page,
}) => {
  await page.goto("/productos");
  await page.getByRole("button", { name: "Agregar variantes" }).click();

  const dialog = page.getByRole("dialog", { name: "Agregar variantes" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Producto existente")
    .selectOption({ label: "Bota Cuadra piel de venado · Cuadra" });
  await dialog.getByLabel("Costo").fill("1200");
  await dialog.getByLabel("Precio").fill("2199");
  await dialog.locator("label.size-option", { hasText: "Café" }).click();
  await dialog
    .locator(".size-picker:not(.color-picker) label.size-option")
    .filter({ hasText: /^25$/ })
    .click();
  await dialog
    .locator(".size-picker:not(.color-picker) label.size-option")
    .filter({ hasText: /^25\.5$/ })
    .click();

  await expect(
    dialog.getByLabel("Café, talla 25", { exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByText("Ya existe")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Agregar 1 variante" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Agregar 1 variante" }).click();

  await expect(page.getByText("Vista previa agregada")).toBeVisible();
  await expect(page.getByText("Café · 25.5")).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
});

test("registra un código físico desde una pantalla táctil", async ({
  page,
}) => {
  await page.goto("/productos");
  await page.getByRole("button", { name: "Registrar código" }).click();

  const dialog = page.getByRole("dialog", { name: "Registrar código" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Producto y variante")
    .selectOption({ label: "Bota Cuadra piel de venado · Café · talla 25" });
  await dialog.getByLabel("Motivo").selectOption("SUPPLIER");
  await dialog.getByLabel("Simbología").selectOption("EAN13");
  await dialog.getByLabel("Código leído").fill("7501234567893");
  await dialog.getByRole("button", { name: "Guardar como principal" }).click();

  await expect(page.getByText("Vista previa agregada")).toBeVisible();
  await expect(page.getByText("7501234567893")).toBeVisible();
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
});
