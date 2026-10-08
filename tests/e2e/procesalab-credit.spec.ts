import { expect, test } from "@playwright/test";
import { APP_VERSION } from "../../lib/release";

test("el panel de versión muestra el crédito blanco animado", async ({
  page,
}) => {
  await page.goto("/inicio");
  await page
    .getByRole("button", { name: /Abrir información de .* y versión/ })
    .click();
  const panel = page.getByRole("complementary", {
    name: "Información de usuario y versión",
  });
  await expect(
    panel.getByText(`Versión ${APP_VERSION}`, { exact: true }),
  ).toBeVisible();
  await expect(panel.locator('img[src*="engrane-blanco"]')).toBeVisible();
  await expect(panel.locator('img[src*="engrane-blanco"]')).toHaveCSS(
    "animation-duration",
    "9s",
  );
  await expect(panel.getByRole("link")).toHaveAttribute(
    "href",
    "https://procesa-lab-web.vercel.app",
  );
});

test("crédito usa los recursos originales, respeta movimiento reducido y no imprime", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/ajustes");
  const credit = page.locator(".settings-developer-credit");
  await expect(credit.getByRole("link")).toHaveAttribute(
    "href",
    "https://procesa-lab-web.vercel.app",
  );
  await expect(credit.getByRole("link")).toHaveAttribute("target", "_blank");
  const gear = credit.locator('img[src*="engrane-rojo"]');
  await expect(gear).toBeVisible();
  await expect(gear).toHaveCSS("animation-duration", "9s");
  const dimensions = await credit.locator("img").evaluateAll((images) =>
    images.map((image) => ({
      width: parseFloat(getComputedStyle(image).width),
      height: parseFloat(getComputedStyle(image).height),
      loaded: (image as HTMLImageElement).naturalWidth > 0,
    })),
  );
  expect(dimensions.every((image) => image.loaded)).toBe(true);
  expect(dimensions[0].width / dimensions[0].height).toBeCloseTo(1200 / 129, 1);
  expect(dimensions[1].height / dimensions[0].height).toBeCloseTo(1.43, 1);
  await expect(
    page.locator('.rail-developer-credit img[src*="engrane-blanco"]'),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(gear).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ media: "print" });
  await expect(credit.getByRole("link")).toBeHidden();
});

test("crédito de acceso y ajustes cabe en teléfono sin ocupar barra inferior", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/login", "/ajustes"]) {
    await page.goto(route);
    const link = page
      .getByRole("link", {
        name: "Diseño y desarrollo: ProcesaLab (abre otra pestaña)",
      })
      .filter({ visible: true });
    await expect(link).toHaveCount(1);
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
