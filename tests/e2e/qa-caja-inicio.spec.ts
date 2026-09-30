import { expect, test } from "@playwright/test";

test("Inicio no presenta las cifras ni folios de demostración como datos reales", async ({ page }) => {
  await page.goto("/inicio");
  await expect(page.getByText("Vista de demostración:")).toBeVisible();
  await expect(page.getByText("$16,240.00")).toHaveCount(0);
  await expect(page.getByText("V-000842")).toHaveCount(0);
});

test("un corte nuevo no hereda conteo ni motivo del anterior", async ({ page }) => {
  await page.goto("/caja");
  await page.getByRole("button", { name: "Realizar corte" }).click();
  await page.getByLabel("Efectivo contado").fill("100");
  await page.getByRole("button", { name: "Comparar conteo" }).click();
  await page.getByLabel("Motivo de la diferencia").fill("Prueba de cierre");
  await page.getByRole("button", { name: "Confirmar y cerrar" }).click();
  await page.getByRole("button", { name: "Realizar corte" }).click();
  await expect(page.getByLabel("Efectivo contado")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Confirmar y cerrar" })).toHaveCount(0);
});
