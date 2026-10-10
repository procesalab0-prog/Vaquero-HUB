import { expect, test } from "@playwright/test";
for (const width of [390, 768, 1440]) {
  test(`venta visible y cobro después de Cobrar ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await page.goto("/pos");
    const search = page.getByRole("textbox", {
      name: "Buscar o escanear producto",
    });
    await search.fill("750104020251");
    await search.press("Enter");
    await expect(page.locator(".sale-line")).toHaveCount(1);
    if (width <= 820) await page.locator(".mobile-cart-toggle").click();
    await expect(page.locator(".sale-line").first()).toBeInViewport();
    await expect(page.locator(".pay-button")).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Tarjeta de débito" }),
    ).toHaveCount(0);
    if (width > 820) {
      await page.getByRole("separator").press("Home");
      await expect(page.getByRole("separator")).toHaveAttribute(
        "aria-valuenow",
        "35",
      );
      await page.getByRole("separator").press("End");
    }
    await expect(page.locator(".sale-line").first()).toBeInViewport();
    await expect(page.locator(".pay-button")).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    expect(overflow).toBe(false);
    if (await page.locator(".mobile-cart-toggle").isVisible())
      await page.locator(".mobile-cart-toggle").click();
    await page.locator(".pay-button").click();
    await expect(
      page.getByRole("button", { name: "Tarjeta de débito" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tarjeta de crédito" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Dividir entre varios métodos" })
      .click();
    await expect(
      page.getByLabel("Tarjeta de débito", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Tarjeta de crédito", { exact: true }),
    ).toBeVisible();
  });
}
test("categoría nueva sin perder nombre del producto", async ({ page }) => {
  await page.goto("/productos");
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre del producto").fill("Mi bota nueva");
  await dialog
    .getByRole("button", { name: "Nueva categoría", exact: true })
    .click();
  await dialog
    .getByLabel("Nombre de la nueva categoría")
    .fill("Categoría octubre");
  await dialog.getByRole("button", { name: "Crear y seleccionar" }).click();
  await expect(dialog.getByLabel("Nombre del producto")).toHaveValue(
    "Mi bota nueva",
  );
  await expect(
    dialog.locator("select[name=category_id] option:checked"),
  ).toHaveText("Categoría octubre");
});
test("inventario captura directa y selección por marca", async ({ page }) => {
  await page.goto("/inventario");
  await page.getByRole("button", { name: /Seleccionar visibles/ }).click();
  await expect(
    page.getByLabel("Cantidad a agregar a cada variante"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Limpiar selección" }).click();
  await page.getByRole("button", { name: "Desplegar variantes" }).click();
  const quantity = page.locator(".inline-inventory-quantity").first();
  await quantity.getByRole("spinbutton").fill("4");
  await expect(quantity.getByPlaceholder("Motivo del ajuste")).toBeVisible();
  await quantity.getByPlaceholder("Motivo del ajuste").fill("QA demostración");
  await quantity.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(quantity.getByRole("status")).toContainText("Demostración");
});
test("conteos permanece abierto por URL y costos tiene rango", async ({
  page,
}) => {
  await page.goto("/inventario?accion=conteos");
  await expect(
    page.getByRole("heading", { name: "Conteos", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Conteos", exact: true }),
  ).toBeVisible();
  await page.goto("/reportes/costos");
  await expect(
    page.getByRole("heading", { name: "Costos y entradas" }),
  ).toBeVisible();
  await expect(page.getByLabel("Desde")).toBeVisible();
});
test("cliente se crea dentro de Venta sin perder el carrito (transporte simulado)", async ({
  page,
}) => {
  await page.route("**/api/operaciones", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.operation).toBe("customer.create");
    expect(payload.input.full_name).toBe("Cliente QA Octubre");
    await route.fulfill({
      json: {
        ok: true,
        customer: {
          id: "qa-customer",
          member_number: "QA001",
          full_name: "Cliente QA Octubre",
          phone_e164: "+523521234567",
          email: "qa@example.test",
        },
      },
    });
  });
  await page.goto("/pos");
  const search = page.getByRole("textbox", {
    name: "Buscar o escanear producto",
  });
  await search.fill("750104020251");
  await search.press("Enter");
  if (await page.locator(".mobile-cart-toggle").isVisible())
    await page.locator(".mobile-cart-toggle").click();
  await page.getByRole("button", { name: /Agregar cliente/ }).click();
  const dialog = page.getByRole("dialog", { name: "Asociar cliente" });
  await dialog.getByRole("button", { name: "Crear cliente aquí" }).click();
  await dialog.getByLabel("Nombre", { exact: true }).fill("Cliente QA Octubre");
  await dialog.getByLabel("Teléfono", { exact: true }).fill("3521234567");
  await dialog.getByLabel("Versión del aviso entregado").fill("QA-2026");
  await dialog.getByLabel("El cliente aceptó el aviso entregado").check();
  await dialog
    .getByRole("button", { name: "Guardar y asociar a esta venta" })
    .click();
  await expect(page.locator(".sale-line")).toHaveCount(1);
  await expect(
    page.getByText("Cliente QA Octubre", { exact: true }),
  ).toBeVisible();
});
test("ticket de regalo disponible después de una venta no marcada", async ({
  page,
}) => {
  await page.goto("/pos");
  const search = page.getByRole("textbox", {
    name: "Buscar o escanear producto",
  });
  await search.fill("750104020251");
  await search.press("Enter");
  if (await page.locator(".mobile-cart-toggle").isVisible())
    await page.locator(".mobile-cart-toggle").click();
  await page.locator(".pay-button").click();
  await page.getByRole("button", { name: /^Efectivo/ }).click();
  await page.getByLabel("Efectivo recibido", { exact: true }).fill("5000");
  await page.getByRole("button", { name: "Confirmar efectivo" }).click();
  await page
    .getByRole("button", { name: "Generar ticket de regalo", exact: true })
    .click();
  await expect(page.locator(".receipt-paper-stage .thermal-line")).toHaveCount(
    1,
  );
  await expect(page.locator(".receipt-paper-stage")).not.toContainText(
    "$4,890",
  );
});
test("rueda sobre el menú no desplaza Productos", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/productos");
  const positions = () =>
    page.evaluate(() => [
      document.scrollingElement?.scrollTop ?? 0,
      document.querySelector(".workspace-main")?.scrollTop ?? 0,
    ]);
  await page.locator(".rail-wordmark").hover();
  const before = await positions();
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(200);
  expect(await positions()).toEqual(before);
});
test("corte de sucursal y versión de esta entrega visibles", async ({
  page,
}) => {
  await page.goto("/caja");
  await page
    .getByRole("button", { name: "Preparar corte de sucursal" })
    .click();
  await expect(page.getByText(/Efectivo contado:/)).toBeVisible();
  await page
    .getByRole("button", { name: "Confirmar corte de sucursal", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Corte de sucursal guardado" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: /Abrir información de .* y versión/ })
    .click();
  await expect(page.getByText("Versión 0.64.1", { exact: true })).toBeVisible();
});

for (const width of [1024, 1440]) {
  test(`división se arrastra y conserva venta ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/pos");
    const divider = page.getByRole("separator");
    await expect(divider).toHaveAttribute(
      "aria-orientation",
      width <= 820 ? "horizontal" : "vertical",
    );
    const box = await divider.boundingBox();
    if (!box) throw Error("Missing divider");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + (width > 820 ? 100 : 0),
      box.y + box.height / 2 + (width <= 820 ? 70 : 0),
      { steps: 8 },
    );
    await page.mouse.up();
    expect(Number(await divider.getAttribute("aria-valuenow"))).toBeGreaterThan(
      50,
    );
    await expect(page.locator(".pay-button")).toBeInViewport();
    await expect(
      page.getByRole("slider", { name: "Espacio del catálogo" }),
    ).toHaveCount(0);
    await divider.press("Home");
    await expect(divider).toHaveAttribute("aria-valuenow", "35");
    await divider.press("End");
    await expect(divider).toHaveAttribute("aria-valuenow", "65");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
  });
}
