import { expect, test } from "@playwright/test";

test.describe("M6 compras", () => {
  test("la recepción de piezas conserva cantidades enteras", async ({
    page,
  }) => {
    await page.goto("/compras?tab=recibir");
    await page.getByRole("button", { name: /Orden #1/ }).click();
    const quantity = page.getByRole("spinbutton", { name: /Recibir/ });
    await expect(quantity).toHaveAttribute("step", "1");
    await expect(quantity).toHaveAttribute("max", "2");
    await quantity.fill("0.5");
    expect(
      await quantity.evaluate(
        (element: HTMLInputElement) => element.validity.stepMismatch,
      ),
    ).toBe(true);
    await quantity.fill("1");
    expect(
      await quantity.evaluate(
        (element: HTMLInputElement) => element.validity.valid,
      ),
    ).toBe(true);
    await expect(page.locator("html")).toHaveJSProperty(
      "scrollWidth",
      await page.evaluate(() => innerWidth),
    );
  });
  for (const viewport of [
    { name: "computadora", width: 1440, height: 900 },
    { name: "tableta", width: 768, height: 1024 },
    { name: "teléfono", width: 390, height: 844 },
  ]) {
    test(`descarga PDF de proveedor sin modificar la orden en ${viewport.name}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/compras");
      await page.getByRole("button", { name: "PDF para proveedor" }).click();
      const dialog = page.getByRole("dialog", {
        name: "PDF de orden de compra",
      });
      await expect(dialog).toBeVisible();
      await dialog
        .getByLabel(/Producto 1/)
        .fill("Nombre especial para el proveedor");
      await dialog
        .getByLabel("Condiciones de pago (opcional)")
        .fill("Pago acordado a 30 días");
      await dialog
        .getByLabel("Notas para el proveedor (opcional)")
        .fill("Entregar en recepción de la sucursal.");
      const download = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Descargar PDF" }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe("orden-compra-1.pdf");
      await file.saveAs(testInfo.outputPath("purchase-order.pdf"));
      await expect(dialog.getByText(/PDF generado/)).toBeVisible();
      await expect(dialog.getByRole("link", { name: /WhatsApp/ })).toHaveCount(
        0,
      );
      await expect(
        dialog.getByRole("button", { name: "Descargar PDF" }),
      ).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("purchase-pdf-dialog.png"),
      });
      await dialog.getByRole("button", { name: "Cerrar PDF" }).click();
      await page.getByRole("button", { name: "PDF para proveedor" }).click();
      await expect(page.getByLabel(/Producto 1/)).toHaveValue("");
      await expect(
        page.getByLabel("Condiciones de pago (opcional)"),
      ).toHaveValue("");
      expect(errors).toEqual([]);
    });
  }
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

  test("conserva la pestaña de Compras al recargar y navegar atrás", async ({
    page,
  }) => {
    await page.goto("/compras?tab=proveedores");
    await page.getByRole("tab", { name: /Órdenes/ }).click();
    await expect(page).toHaveURL(/tab=ordenes/);
    await page.reload();
    await expect(page.getByRole("tab", { name: /Órdenes/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.goBack();
    await expect(
      page.getByRole("tab", { name: /Proveedores/ }),
    ).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(page.getByRole("tab", { name: /Órdenes/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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
