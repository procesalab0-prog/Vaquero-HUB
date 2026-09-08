import { expect, test } from "@playwright/test";

test.describe("M6 compras", () => {
  test("muestra el flujo completo sin ocultar acciones en computadora", async ({
    page,
  }) => {
    await page.goto("/compras");
    await expect(
      page.getByRole("heading", { name: "Compras y recepción" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Nueva orden/ }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Recibir/ }).click();
    await expect(page.getByText("Recepción rápida")).toBeVisible();
    await page.getByRole("tab", { name: /Proveedores/ }).click();
    await expect(
      page.getByRole("button", { name: /Agregar proveedor/ }),
    ).toBeVisible();
  });

  test("en teléfono vertical permite recorrer y tocar las cuatro secciones", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/compras");
    for (const name of [/Órdenes/, /Recibir/, /Proveedores/, /Historial/]) {
      const tab = page.getByRole("tab", { name });
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
