import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectDialogErgonomic(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();

  const viewport = page.viewportSize();
  const box = await dialog.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);

  const metrics = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(["auto", "scroll"]).toContain(metrics.overflowY);

  if (metrics.scrollHeight > metrics.clientHeight) {
    await dialog.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() =>
        dialog.evaluate((element) =>
          Math.abs(
            element.scrollHeight - element.clientHeight - element.scrollTop,
          ),
        ),
      )
      .toBeLessThanOrEqual(1);
  }

  const overlaps = await dialog
    .locator("button:visible, input:visible, select:visible, textarea:visible")
    .evaluateAll((controls) => {
      const boxes = controls.map((control) => ({
        label:
          control.getAttribute("aria-label") ??
          control.textContent?.trim() ??
          control.tagName,
        rect: control.getBoundingClientRect(),
      }));
      const collisions: string[] = [];
      for (let first = 0; first < boxes.length; first += 1) {
        for (let second = first + 1; second < boxes.length; second += 1) {
          const a = boxes[first];
          const b = boxes[second];
          const overlapX =
            Math.min(a.rect.right, b.rect.right) -
            Math.max(a.rect.left, b.rect.left);
          const overlapY =
            Math.min(a.rect.bottom, b.rect.bottom) -
            Math.max(a.rect.top, b.rect.top);
          if (overlapX > 1 && overlapY > 1)
            collisions.push(`${a.label} / ${b.label}`);
        }
      }
      return collisions;
    });
  expect(overlaps).toEqual([]);
}

for (const viewport of [
  { name: "teléfono compacto", width: 390, height: 667 },
  { name: "iPad vertical", width: 768, height: 1024 },
  { name: "computadora", width: 1280, height: 800 },
]) {
  test(`las ventanas principales caben, desplazan y no enciman controles en ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);

    await page.goto("/productos");
    await page.getByRole("button", { name: "Nuevo producto" }).click();
    await expectDialogErgonomic(
      page,
      page.getByRole("dialog", { name: "Nuevo producto" }),
    );

    await page.goto("/inventario");
    await page.getByRole("button", { name: "Conteos" }).click();
    await expectDialogErgonomic(
      page,
      page.getByRole("dialog", { name: "Conteos" }),
    );

    await page.goto("/compras?tab=proveedores");
    await page.getByRole("button", { name: /Agregar proveedor/ }).click();
    await expectDialogErgonomic(
      page,
      page.getByRole("dialog", { name: "Nuevo proveedor" }),
    );

    await page.goto("/caja");
    await page.getByRole("button", { name: /Realizar corte/ }).click();
    await expectDialogErgonomic(
      page,
      page.getByRole("heading", { name: "Realizar corte" }).locator(".."),
    );
  });
}

test("muestra el error de cobro por encima de la ventana en teléfono", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto("/pos");
  await page.getByRole("button", { name: "Abrir catálogo" }).click();
  await page.locator(".product-card").first().click();
  await page.locator(".mobile-cart-toggle").click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  await page
    .getByRole("button", { name: "Dividir entre varios métodos" })
    .click();
  await page.getByLabel("Efectivo").fill("1");
  await page.getByRole("button", { name: "Confirmar pago combinado" }).click();

  const feedback = page.locator(".operation-feedback");
  await expect(feedback).toContainText("debe coincidir exactamente");
  await expect(feedback).toBeInViewport();
  const layers = await page.evaluate(() => ({
    feedback: Number(
      getComputedStyle(document.querySelector(".operation-feedback")!).zIndex,
    ),
    modal: Number(
      getComputedStyle(document.querySelector(".modal-backdrop")!).zIndex,
    ),
  }));
  expect(layers.feedback).toBeGreaterThan(layers.modal);
});
