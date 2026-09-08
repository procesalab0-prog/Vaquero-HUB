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

  test("crea varias tallas sin abandonar la orden de compra", async ({
    page,
  }) => {
    await page.goto("/compras");
    await page.getByRole("button", { name: /Nueva orden/ }).click();
    await page
      .getByRole("button", {
        name: /Crear producto nuevo sin salir de la orden/,
      })
      .click();

    const dialog = page.getByRole("dialog", {
      name: "Crear producto faltante",
    });
    await dialog.getByLabel("Nombre del producto").fill("Bota prueba rápida");
    await dialog.getByLabel("Categoría").selectOption("preview-botas");
    await dialog.getByLabel("Costo por pieza").fill("500");
    await dialog.getByLabel("Precio de venta").fill("999");
    await dialog.getByText("Negro", { exact: true }).click();
    await dialog.getByText("25", { exact: true }).click();
    await dialog.getByText("25.5", { exact: true }).click();
    await expect(
      dialog.getByText("2 variantes", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Crear y agregar 2" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Bota prueba rápida")).toHaveCount(2);
    await expect(page.getByText(/2 variantes agregadas/)).toBeVisible();
  });

  test("conserva la cantidad exacta de etiquetas de una recepción", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "mi-tienda-label-selection",
        JSON.stringify({ "var-001": 120 }),
      );
    });
    await page.goto("/etiquetas?desde=recepcion");
    await expect(
      page.getByRole("button", { name: "Imprimir 120 etiquetas" }),
    ).toBeVisible();
  });
});
