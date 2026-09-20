import { expect, test } from "@playwright/test";

test("el tamaño de texto y el color se aplican de inmediato y persisten", async ({
  page,
}) => {
  await page.goto("/ajustes");
  await page.getByRole("button", { name: /Apariencia y usuarios/ }).click();

  const select = page.getByLabel("Tamaño del texto del programa");
  const sample = page.getByText("Mi PIN de supervisor", { exact: true });
  const normalSize = await sample.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );

  await select.selectOption("xlarge");
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
  await expect
    .poll(() =>
      sample.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
    )
    .toBeGreaterThanOrEqual(normalSize + 5);

  await page.getByRole("button", { name: /Cuero/ }).click();
  await expect
    .poll(() =>
      page.locator("html").evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--accent").trim(),
      ),
    )
    .toBe("#9A5D32");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
  await expect
    .poll(() =>
      page.locator("html").evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--accent").trim(),
      ),
    )
    .toBe("#9A5D32");
});

test("el texto muy grande no crea desplazamiento horizontal en teléfono", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.addInitScript(() => {
    window.localStorage.setItem("mi-tienda:text-size:v1", "xlarge");
  });
  await page.goto("/inicio");

  await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
});
