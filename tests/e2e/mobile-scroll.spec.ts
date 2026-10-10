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
      await page.mouse.wheel(0, 240);
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
