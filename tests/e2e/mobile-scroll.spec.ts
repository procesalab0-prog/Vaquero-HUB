import { expect, test } from "@playwright/test";

for (const route of [
  "inicio",
  "productos",
  "inventario",
  "caja",
  "compras",
  "clientes",
  "tickets",
  "reportes",
  "ajustes",
  "mas",
  "pos",
]) {
  test(`el menú inferior no cubre el área de scroll de ${route}`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${route}`);
    const main = page.locator(".workspace-main");
    const nav = page.locator(".nav-rail");
    await expect(main).toBeVisible();
    await expect
      .poll(async () => {
        const pane = await main.boundingBox(),
          bar = await nav.boundingBox();
        return Boolean(pane && bar && pane.y + pane.height <= bar.y + 1);
      })
      .toBe(true);
    if (route === "pos") {
      await expect(page.locator(".mobile-cart-toggle")).toBeVisible();
      const pane = await main.boundingBox(),
        cart = await page.locator(".mobile-cart-toggle").boundingBox();
      expect(pane && cart && pane.y + pane.height <= cart.y + 1).toBe(true);
    }
    const metrics = await main.evaluate((el) => ({
      scroll: el.scrollHeight,
      height: el.clientHeight,
    }));
    if (metrics.scroll > metrics.height + 2) {
      const box = await main.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      if (browserName === "webkit")
        await main.evaluate((el) => el.scrollBy(0, 240));
      else await page.mouse.wheel(0, 240);
      await expect
        .poll(() => main.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect
        .poll(() =>
          main.evaluate((el) =>
            Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
          ),
        )
        .toBeLessThanOrEqual(1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Más opciones", exact: true }),
    ).toBeInViewport();
  });
}

for (const size of [
  { width: 320, height: 568 },
  { width: 390, height: 664 },
  { width: 768, height: 1024 },
]) {
  test(`texto grande y cambio de altura conservan scroll seguro ${size.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/productos");
    await page.evaluate(() => {
      document.documentElement.dataset.textSize = "xlarge";
    });
    const main = page.locator(".workspace-main"),
      nav = page.locator(".nav-rail");

    await page
      .getByRole("button", { name: "Más opciones", exact: true })
      .click();
    const menu = page.locator(".rail-submenu");
    const menuBox = await menu.boundingBox(),
      barBox = await nav.boundingBox();
    expect(menuBox && barBox && menuBox.y + menuBox.height <= barBox.y).toBe(
      true,
    );
    await menu
      .getByRole("button", { name: "Cerrar Más opciones", exact: true })
      .click();
    for (const height of [size.height, size.height - 80, size.height]) {
      await page.setViewportSize({ width: size.width, height });
      await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const pane = await main.boundingBox(),
        bar = await nav.boundingBox();
      expect(pane && bar && pane.y + pane.height <= bar.y + 1).toBe(true);
      const last = main
        .locator("button:visible, a:visible, input:visible, select:visible")
        .last();
      await last.scrollIntoViewIfNeeded();
      const control = await last.boundingBox();
      expect(control && bar && control.y + control.height <= bar.y + 1).toBe(
        true,
      );
    }
  });
}

test("el acceso al carrito se puede pulsar tras navegar y hacer scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/inicio");
  await page.getByRole("link", { name: "Venta", exact: true }).click();
  const cart = page.getByRole("button", { name: /^Ver carrito,/ });
  const main = page.locator(".workspace-main");
  await expect(cart).toBeVisible();
  // A bounding box alone misses controls clipped by a scrolling ancestor.
  await expect(cart).toContainText("Ver carrito");
  expect(
    await cart.evaluate((el) => Boolean(el.closest(".workspace-main"))),
  ).toBe(false);
  for (const bottom of [false, true]) {
    await main.evaluate(
      (el, end) => el.scrollTo(0, end ? el.scrollHeight : 0),
      bottom,
    );
    await expect
      .poll(() =>
        cart.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ),
          );
        }),
      )
      .toBe(true);
    await cart.click();
    await expect(page.locator(".sale-panel.mobile-open")).toBeVisible();
    await expect(cart).toBeHidden();
    await page.locator(".mobile-cart-close").click();
    await expect(cart).toBeVisible();
  }
  await page.screenshot({
    path: "../../outputs/venta-redisenada-privada-2026-10-10/carrito-telefono-corregido.png",
  });
});
