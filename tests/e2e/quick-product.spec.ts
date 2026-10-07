import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1440]) {
  test(`producto rápido mixto conserva captura y cobro visible ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/pos");
    const search = page.getByRole("textbox", {
      name: "Buscar o escanear producto",
    });
    await search.fill("750104020251");
    await search.press("Enter");
    const mobileCart = page.locator(".mobile-cart-toggle");
    if (await mobileCart.isVisible()) await mobileCart.click();
    await page
      .getByRole("button", { name: "Producto rápido", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Producto rápido",
      exact: true,
    });
    await dialog
      .getByLabel("Nombre", { exact: true })
      .fill("Accesorio sin catálogo");
    await dialog.getByLabel("Cantidad", { exact: true }).fill("2");
    await dialog.getByLabel("Precio unitario", { exact: true }).fill("19.99");
    await expect(dialog.getByLabel("Costo unitario (opcional)")).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Agregar al carrito" })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "Agregar al carrito" }),
    ).toBeInViewport();
    await dialog.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.locator(".sale-line")).toHaveCount(2);
    const quick = page
      .locator(".sale-line")
      .filter({ hasText: "Accesorio sin catálogo" });
    await expect(quick).toContainText("sin código ni movimiento de inventario");
    await expect(quick.locator(".quantity-buttons strong")).toHaveText("2");
    await expect(quick.locator("code")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Cobrar/ }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `/private/tmp/quick-product-${width}.png` });
  });
}
