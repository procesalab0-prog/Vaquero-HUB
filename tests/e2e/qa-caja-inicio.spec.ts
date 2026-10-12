import { expect, test } from "@playwright/test";

test("Inicio no presenta las cifras ni folios de demostración como datos reales", async ({
  page,
}) => {
  await page.goto("/inicio");
  await expect(page.getByText("Vista de demostración:")).toBeVisible();
  await expect(page.getByText("$16,240.00")).toHaveCount(0);
  await expect(page.getByText("V-000842")).toHaveCount(0);
});

test("un corte nuevo no hereda conteo ni motivo del anterior", async ({
  page,
}) => {
  await page.goto("/caja");
  await page.getByRole("button", { name: "Cerrar turno" }).click();
  await page.getByLabel("Efectivo contado").fill("100");
  await page.getByRole("button", { name: "Comparar conteo" }).click();
  await page.getByLabel("Motivo de la diferencia").fill("Prueba de cierre");
  await page.getByRole("button", { name: "Confirmar y cerrar" }).click();
  await page.getByRole("button", { name: "Cerrar turno" }).click();
  await expect(page.getByLabel("Efectivo contado")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Confirmar y cerrar" }),
  ).toHaveCount(0);
});

test("la sucursal de la URL persiste y acompaña la navegación de la caja", async ({
  page,
}) => {
  await page.goto("/caja?ubicacion=demo-la-piedad");
  await expect(page.locator(".location-pill .location-name")).toHaveText(
    "La Piedad",
  );
  await expect
    .poll(
      async () =>
        (await page.context().cookies()).find(
          (cookie) => cookie.name === "mi_tienda_active_location",
        )?.value,
    )
    .toBe("demo-la-piedad");
  const inventoryLink = page
    .locator(".nav-rail")
    .getByRole("link", { name: "Inventario", exact: true });
  await expect(inventoryLink).toHaveAttribute(
    "href",
    "/inventario?ubicacion=demo-la-piedad",
  );
  await inventoryLink.click();
  await expect(page).toHaveURL(/\/inventario\?ubicacion=demo-la-piedad/);
  await page.goBack();
  await expect(page.locator(".location-pill .location-name")).toHaveText(
    "La Piedad",
  );
  await page.reload();
  await expect(page.locator(".location-pill .location-name")).toHaveText(
    "La Piedad",
  );
});
