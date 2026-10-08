import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await mkdir("/tmp/mi-tienda-redesign", { recursive: true });
const failures = [];
try {
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 768, 1024],
    ["phone", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const route of [
      "inicio",
      "pos",
      "productos",
      "inventario",
      "caja",
      "compras",
      "cotizaciones",
      "clientes",
      "reportes",
      "mas",
    ]) {
      await page.goto(`http://127.0.0.1:3127/${route}`, {
        waitUntil: "networkidle",
      });
      const shell = page.locator(".workspace-redesign");
      if (!(await shell.count())) {
        failures.push(`${name}/${route}: missing workspace`);
        continue;
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      if (overflow) failures.push(`${name}/${route}: document overflow`);
      await page.screenshot({
        path: `/tmp/mi-tienda-redesign/${name}-${route}.png`,
      });
      console.log(`${name}/${route}: ${overflow ? "OVERFLOW" : "OK"}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:3127/pos", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Contraer navegación" }).click();
  if (
    (await page.getByRole("button", { name: "Ampliar navegación" }).count()) !==
    1
  )
    failures.push("navigation collapse");
  await page.locator(".sale-tools summary").click();
  if (
    !(await page
      .getByRole("button", { name: "Producto rápido", exact: true })
      .isVisible())
  )
    failures.push("sale tools disclosure");
  for (const [width, height] of [
    [1440, 1000],
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "Buscar un módulo" }).click();
    await page
      .getByRole("textbox", { name: "Buscar módulo", exact: true })
      .fill("cotizacion");
    if ((await page.locator(".module-menu-dialog a").count()) !== 1)
      failures.push(`module search ${width}`);
    await page.screenshot({
      path: `/tmp/mi-tienda-redesign/menu-${width}.png`,
    });
    await page.keyboard.press("Escape");
    if (
      !(await page
        .getByRole("button", { name: "Buscar un módulo" })
        .evaluate((el) => document.activeElement === el))
    )
      failures.push(`menu focus return ${width}`);
    const clipped = await page
      .locator(".topbar-actions")
      .evaluate((el) => el.getBoundingClientRect().right > innerWidth);
    if (clipped) failures.push(`topbar clipped ${width}`);
    await page.evaluate(
      () => (document.documentElement.dataset.textSize = "xlarge"),
    );
    await page.screenshot({
      path: `/tmp/mi-tienda-redesign/large-${width}.png`,
    });
    await page.evaluate(() => delete document.documentElement.dataset.textSize);
  }
  console.log(JSON.stringify({ failures }));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
