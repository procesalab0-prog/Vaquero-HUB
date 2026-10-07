import { expect, test } from "@playwright/test";
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`filtros independientes de reportes conservan URL ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/reportes");
    await page
      .getByLabel("Categoría", { exact: true })
      .selectOption("preview-botas");
    await page
      .getByLabel("Departamento", { exact: true })
      .selectOption("CABALLERO");
    await page.getByRole("button", { name: "Consultar", exact: true }).click();
    await expect(page).toHaveURL(/categoria=preview-botas/);
    await expect(page.getByLabel("Departamento", { exact: true })).toHaveValue(
      "CABALLERO",
    );
    await page.reload();
    await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(
      "preview-botas",
    );
    await page
      .getByRole("link", { name: "Inventario", exact: true })
      .last()
      .click();
    await expect(page).toHaveURL(/departamento=CABALLERO/);
    await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(
      "preview-botas",
    );
    await page.goBack();
    await expect(page.getByLabel("Departamento", { exact: true })).toHaveValue(
      "CABALLERO",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByText(/Datos de demostración/)).toBeVisible();
  });
}
