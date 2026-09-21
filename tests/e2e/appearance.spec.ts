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
  await expect(page.locator("html")).toHaveAttribute(
    "data-text-size",
    "xlarge",
  );
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
      page
        .locator("html")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--accent").trim(),
        ),
    )
    .toBe("#9A5D32");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-text-size",
    "xlarge",
  );
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--accent").trim(),
        ),
    )
    .toBe("#9A5D32");
});

const accentTokens = (element: Element) => {
  const style = getComputedStyle(element);
  return {
    accent: style.getPropertyValue("--accent").trim(),
    hover: style.getPropertyValue("--accent-hover").trim(),
    pressed: style.getPropertyValue("--accent-pressed").trim(),
    soft: style.getPropertyValue("--accent-soft").trim(),
  };
};

test("el acento de la identidad manda mientras nadie elija otro", async ({
  page,
}) => {
  await page.goto("/ajustes");
  const identidad = await page.locator("html").evaluate(accentTokens);
  // Forzar un acento al cargar dejaba sin efecto el color de la identidad.
  expect(identidad.accent.toLowerCase()).toBe("#5b4021");

  await page.getByRole("button", { name: /Apariencia y usuarios/ }).click();
  await page.getByRole("button", { name: /Vino Vaquero/ }).click();

  const vino = await page.locator("html").evaluate(accentTokens);
  expect(vino.accent).toBe("#8E2A1C");
  // Los tonos derivados tienen que moverse con el acento: si no, el botón
  // cambia de color al tocarlo.
  expect(vino.hover).not.toBe(identidad.hover);
  expect(vino.pressed).not.toBe(identidad.pressed);
  expect(vino.soft).not.toBe(identidad.soft);

  await page.getByRole("button", { name: /Identidad/ }).click();
  await expect
    .poll(() => page.locator("html").evaluate(accentTokens))
    .toEqual(identidad);

  await page.reload();
  await expect
    .poll(() => page.locator("html").evaluate(accentTokens))
    .toEqual(identidad);
});

test("el texto muy grande no crea desplazamiento horizontal en teléfono", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.addInitScript(() => {
    window.localStorage.setItem("mi-tienda:text-size:v1", "xlarge");
  });
  await page.goto("/inicio");

  await expect(page.locator("html")).toHaveAttribute(
    "data-text-size",
    "xlarge",
  );
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
});
