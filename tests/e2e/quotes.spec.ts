import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`cotización personalizada se captura sin encimar controles ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/cotizaciones");
    await page.getByRole("button", { name: "Nueva cotización" }).click();
    const dialog = page.getByRole("dialog", { name: "Arma la propuesta" });
    await dialog
      .getByLabel("Nombre para la cotización (sin registrar cliente)")
      .fill("Empresa sin cuenta");
    await dialog.getByRole("spinbutton").first().fill("2");
    await dialog.getByLabel("Precio unitario cotizado").fill("90.50");
    await dialog.getByLabel("Descuento del renglón").fill("10.25");
    await expect(dialog.getByText("Total $170.75")).toBeVisible();
    await dialog.getByRole("spinbutton").first().fill("1.5");
    await expect(
      dialog.getByRole("button", { name: "Crear cotización" }),
    ).toBeDisabled();
    await dialog.getByRole("spinbutton").first().fill("2");
    await dialog.getByLabel("Descuento del renglón").fill("9999");
    await expect(
      dialog.getByRole("button", { name: "Crear cotización" }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Cancelar", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "Cancelar", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "Nueva cotización" }).click();
    await expect(
      dialog.getByLabel("Nombre para la cotización (sin registrar cliente)"),
    ).toHaveValue("");
    expect(errors).toEqual([]);
  });
}
