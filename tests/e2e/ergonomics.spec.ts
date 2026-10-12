import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1440]) {
  test(`seleccionar talla no cobra ni agrega hasta confirmar a ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/pos");
    if (await page.getByRole("button", { name: "Abrir catálogo" }).isVisible())
      await page.getByRole("button", { name: "Abrir catálogo" }).click();
    const family = page
      .locator(".pos-product-family")
      .filter({ hasText: "Bota Cuadra piel de venado" });
    await expect(family).toHaveCount(1);
    await family.getByRole("button", { name: /26 Café/ }).click();
    await expect(family.locator(".product-card code")).toHaveText(
      "750104020268",
    );
    await expect(page.locator(".sale-line")).toHaveCount(0);
    await family
      .getByRole("button", {
        name: "Agregar Bota Cuadra piel de venado, Café, talla 26",
        exact: true,
      })
      .click();
    await expect(family.locator(".product-in-cart")).toHaveText(
      "✓ 1 en carrito",
    );
    await expect(family.locator(".product-card")).toBeDisabled();
    await family.getByRole("button", { name: /25 Café/ }).click();
    await expect(family.locator(".product-card")).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("ficha de producto lleva el código y la sucursal a Inventario", async ({
  page,
}) => {
  await page.goto("/productos?ubicacion=demo-la-piedad");
  await page.locator(".catalog-inline-detail").first().click();
  const detail = page.locator(".catalog-variant-list").first();
  const code = (await detail.locator("code").first().innerText()).trim();
  const link = detail.getByRole("link", { name: "Ver existencias" }).first();
  await expect(link).toHaveAttribute("href", /ubicacion=demo-la-piedad/);
  await link.click();
  await expect(
    page.getByRole("textbox", { name: "Buscar inventario" }),
  ).toHaveValue(code);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Buscar inventario" }),
  ).toHaveValue(code);
});
