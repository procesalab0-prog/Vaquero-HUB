import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1440]) {
  for (const method of [
    { name: "efectivo", control: "Efectivo recibido" },
    { name: "tarjeta", control: "Referencia de terminal" },
    { name: "transferencia", control: "Referencia de transferencia" },
    { name: "dividido", control: "Efectivo" },
  ]) {
    test(`método ${method.name} sólo al cobrar y sin cobro automático ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
      await page.goto("/pos");
      const search = page.getByRole("textbox", {
        name: "Buscar o escanear producto",
      });
      await search.fill("750104020251");
      await search.press("Enter");
      const toggle = page.locator(".mobile-cart-toggle");
      if (await toggle.isVisible()) await toggle.click();
      await expect(page.locator(".pay-button")).toBeInViewport();
      await expect(page.locator(".payment-options")).toHaveCount(0);
      await page.locator(".pay-button").click();
      if (method.name === "dividido")
        await page
          .getByRole("button", { name: "Dividir entre varios métodos" })
          .click();
      else
        await page
          .getByRole("dialog")
          .getByRole("button", {
            name:
              method.name === "tarjeta"
                ? /Tarjeta de débito/
                : method.name === "efectivo"
                  ? /^Efectivo/
                  : /^Transferencia/,
          })
          .click();
      await expect(
        page.getByRole("dialog").getByLabel(method.control, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Venta completada", { exact: true }),
      ).toHaveCount(0);
    });
  }
}

test("el lector agrega directamente y respeta existencias sin foco en el buscador", async ({
  page,
}) => {
  await page.goto("/pos");
  await page.getByText("Frecuentes").click();
  for (let quantity = 1; quantity <= 3; quantity++) {
    await page.keyboard.type("750104020251");
    await page.keyboard.press("Enter");
    await expect(
      page.locator(".sale-line .quantity-buttons strong"),
    ).toHaveText(String(quantity));
  }
  await page.keyboard.type("750104020251");
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("No hay más existencia disponible para este producto."),
  ).toBeVisible();
  await expect(page.locator(".sale-line .quantity-buttons strong")).toHaveText(
    "3",
  );
});

test("el escaneo en el buscador agrega sólo códigos exactos y conserva ceros iniciales", async ({
  page,
}) => {
  await page.goto("/pos");
  const search = page.getByRole("textbox", {
    name: "Buscar o escanear producto",
  });
  await search.fill("000078421034");
  await search.press("Enter");
  await expect(page.locator(".sale-line code")).toHaveText("000078421034");
  await expect(search).toHaveValue("");
  await search.fill("750104");
  await search.press("Enter");
  await expect(
    page.getByText(
      /No encontramos este código entre los productos disponibles/,
    ),
  ).toBeVisible();
  await expect(page.locator(".sale-line")).toHaveCount(1);
  await search.fill("195696170455");
  await search.press("Enter");
  await expect(
    page.getByText("No hay más existencia disponible para este producto."),
  ).toBeVisible();
  await expect(page.locator(".sale-line")).toHaveCount(1);
});

test("el acceso desde Venta abre Traspasos directamente en Inventario", async ({
  page,
}) => {
  await page.goto("/pos");
  const mobileCart = page.locator(".mobile-cart-toggle");
  if (await mobileCart.isVisible()) await mobileCart.click();
  await page.locator(".sale-tools summary").click();
  await page.getByRole("button", { name: "Traspasos", exact: true }).click();
  await expect(page).toHaveURL(/\/inventario\?.*accion=traspasos/);
  await expect(
    page.getByRole("dialog", { name: "Traspasos", exact: true }),
  ).toBeVisible();
});

test("en demostración no se abandona un carrito sin guardar al abrir Traspasos", async ({
  page,
}) => {
  await page.goto("/pos");
  const search = page.getByRole("textbox", {
    name: "Buscar o escanear producto",
  });
  await search.fill("750104020251");
  await search.press("Enter");
  const mobileCart = page.locator(".mobile-cart-toggle");
  if (await mobileCart.isVisible()) await mobileCart.click();
  await page.locator(".sale-tools summary").click();
  await page.getByRole("button", { name: "Traspasos", exact: true }).click();
  await expect(
    page.getByText(
      "La demostración no guarda el carrito. Vacíalo antes de abrir Traspasos.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/pos/);
  await expect(page.locator(".sale-line")).toHaveCount(1);
});

test("el carrito desplaza productos sin ocultar el cobro en escritorio", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/pos");
  await page.getByRole("button", { name: "Abrir catálogo" }).click();
  const cards = page.locator(".product-card");
  for (let index = 0; index < (await cards.count()); index++) {
    if (await cards.nth(index).isEnabled()) await cards.nth(index).click();
  }
  await expect(
    page.getByRole("button", { name: "Cobrar", exact: true }),
  ).toBeVisible();
  const layout = await page.locator(".sale-panel").evaluate((panel) => {
    const lines = panel.querySelector(".sale-lines")!;
    const footer = panel.querySelector(".sale-summary")!;
    return {
      tracks: getComputedStyle(panel).gridTemplateRows.split(" ").length,
      scroll: getComputedStyle(lines).overflowY,
      linesBottom: lines.getBoundingClientRect().bottom,
      footerTop: footer.getBoundingClientRect().top,
      footerBottom: footer.getBoundingClientRect().bottom,
      panelBottom: panel.getBoundingClientRect().bottom,
    };
  });
  expect(layout.tracks).toBe(5);
  expect(layout.scroll).toBe("auto");
  expect(layout.linesBottom).toBeLessThanOrEqual(layout.footerTop + 1);
  expect(layout.footerBottom).toBeLessThanOrEqual(layout.panelBottom + 1);
});

async function addProductAndOpenCheckout(
  page: import("@playwright/test").Page,
) {
  await page.goto("/pos");
  await page.getByRole("button", { name: "Abrir catálogo" }).click();
  await page
    .locator(".product-card")
    .filter({ hasText: "750104020251" })
    .click();

  const mobileCart = page.locator(".mobile-cart-toggle");
  if (await mobileCart.isVisible()) await mobileCart.click();
  await page.getByRole("button", { name: "Cobrar", exact: true }).click();
}

test("completa un pago combinado con efectivo y tarjeta", async ({ page }) => {
  await addProductAndOpenCheckout(page);
  await page
    .getByRole("button", { name: "Dividir entre varios métodos" })
    .click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Efectivo").fill("1000");
  await dialog.getByLabel("Tarjeta de crédito", { exact: true }).fill("3890");
  await dialog.getByLabel("Referencia de terminal").fill("1234");
  await dialog
    .getByRole("button", { name: "Confirmar pago combinado" })
    .click();

  await expect(page.getByText("Venta completada")).toBeVisible();
});

for (const method of [
  { name: "Tarjeta de débito", reference: "Referencia de terminal" },
  { name: "Transferencia", reference: "Referencia de transferencia" },
]) {
  test(`completa un pago con ${method.name.toLocaleLowerCase("es-MX")}`, async ({
    page,
  }) => {
    await addProductAndOpenCheckout(page);
    await page
      .getByRole("button", { name: new RegExp(`^${method.name}`) })
      .click();

    await page.getByLabel(method.reference).fill("1234");
    await page.getByRole("button", { name: "Confirmar cobro" }).click();
    await expect(page.getByText("Venta completada")).toBeVisible();
  });
}
