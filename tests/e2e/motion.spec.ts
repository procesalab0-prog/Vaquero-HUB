import { expect, test, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:3107";

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Mexico_City",
  }).format(new Date());

const animationName = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => getComputedStyle(element).animationName);

test.describe("acceso", () => {
  test("la primera vez del día se ve la escena completa", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator(".login-screen")).toHaveAttribute(
      "data-motion",
      "full",
    );
  });

  test("después, el mismo día, sólo la versión corta", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "mts_movimiento_dia", value: today(), url: BASE },
    ]);
    await page.goto("/login");
    await expect(page.locator(".login-screen")).toHaveAttribute(
      "data-motion",
      "short",
    );
  });

  test("al volver por un error no se repite ninguna entrada", async ({
    page,
  }) => {
    await page.goto("/login?error=credenciales");
    await expect(page.locator(".login-screen")).toHaveAttribute(
      "data-motion",
      "none",
    );
    expect(await animationName(page, ".login-card")).toBe("none");
  });

  test("con movimiento reducido no se anima nada", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login");
    expect(await animationName(page, ".login-card")).toBe("none");
    expect(
      await animationName(page, ".login-editorial-panel .motion-line > span"),
    ).toBe("none");
  });
});

test.describe("entrada al sistema", () => {
  test("el telón se recoge al abrir el programa y no se repite al navegar", async ({
    page,
  }) => {
    await page.goto("/inicio");
    const shell = page.locator(".workspace-shell");
    await expect(shell).toHaveAttribute("data-entrance", "full");
    // Termina solo, aunque nadie toque nada.
    await expect(page.locator(".entrance-curtain")).toHaveCount(0, {
      timeout: 3000,
    });
    await expect(shell).not.toHaveAttribute("data-entrance", /.+/);
    await page.getByRole("link", { name: "Nueva venta" }).first().click();
    await expect(page).toHaveURL(/\/pos/);
    await expect(page.locator(".entrance-curtain")).toHaveCount(0);
  });

  test("una tecla del lector termina la entrada al instante", async ({
    page,
  }) => {
    await page.goto("/inicio");
    await expect(page.locator(".entrance-curtain")).toHaveCount(1);
    await page.keyboard.press("7");
    await expect(page.locator(".entrance-curtain")).toHaveCount(0);
  });

  test("el telón nunca recibe toques", async ({ page }) => {
    await page.goto("/inicio");
    const curtain = page.locator(".entrance-curtain");
    await expect(curtain).toHaveCount(1);
    expect(
      await curtain.evaluate(
        (element) => getComputedStyle(element).pointerEvents,
      ),
    ).toBe("none");
    await page.getByRole("link", { name: "Nueva venta" }).first().click();
    await expect(page).toHaveURL(/\/pos/);
  });

  test("con movimiento reducido no hay telón visible", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/inicio");
    const curtain = page.locator(".entrance-curtain");
    if (await curtain.count())
      expect(
        await curtain.evaluate((element) => getComputedStyle(element).display),
      ).toBe("none");
  });
});

test.describe("punto de venta", () => {
  test("cada escaneo ilumina el renglón otra vez, sin encolarse", async ({
    page,
  }) => {
    await page.goto("/pos");
    await page.getByText("Frecuentes").click();
    await page.keyboard.type("750104020251");
    await page.keyboard.press("Enter");
    const line = page.locator(".sale-line").first();
    await expect(line).toHaveClass(/just-added-1/);
    await page.keyboard.type("750104020251");
    await page.keyboard.press("Enter");
    await expect(line).toHaveClass(/just-added-0/);
  });

  test("la venta completada se celebra sin retrasar la siguiente", async ({
    page,
  }) => {
    await page.goto("/pos");
    await page.getByRole("button", { name: "Abrir catálogo" }).click();
    await page
      .locator(".product-card")
      .filter({ hasText: "750104020251" })
      .click();
    const mobileCart = page.locator(".mobile-cart-toggle");
    if (await mobileCart.isVisible()) await mobileCart.click();
    await page.getByRole("button", { name: "Cobrar", exact: true }).click();
    await page.getByRole("button", { name: /^Tarjeta de débito/ }).click();
    await page.getByLabel("Referencia de terminal").fill("1234");
    await page.getByRole("button", { name: "Confirmar cobro" }).click();

    const success = page.locator(".sale-success");
    await expect(success).toHaveAttribute("data-state", "completed");
    expect(await animationName(page, ".success-seal")).toBe("motion-stamp");
    // «Nueva venta» no se anima: se puede tocar desde el primer cuadro.
    const next = page.getByRole("button", { name: "Nueva venta" });
    expect(
      await next.evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    await next.click();
    await expect(success).toHaveCount(0);
  });
});

test.describe("respuesta al tocar", () => {
  test("la huella aparece donde se toca, sin recibir toques", async ({
    page,
  }) => {
    await page.goto("/pos");
    const ink = page.locator(".press-ink");
    await expect(ink).toHaveCount(1);
    expect(
      await ink.evaluate((element) => getComputedStyle(element).pointerEvents),
    ).toBe("none");
    await page.getByRole("button", { name: "Abrir catálogo" }).click();
    await expect(ink).toHaveAttribute("data-press", /a|b/);
    // El botón tocado siguió funcionando.
    await expect(page.locator(".product-card").first()).toBeVisible();
  });
});

test.describe("cambio de sección", () => {
  test("si la sección tarda, la página actual se queda y brilla el logo", async ({
    page,
  }) => {
    // Retrasa la sección nueva para ver la espera. Las precargas se cancelan:
    // así el clic tiene que pedirla y esperar.
    await page.route(/\/inventario\?.*_rsc=/, async (route) => {
      if (route.request().headers()["next-router-prefetch"])
        return route.abort();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.goto("/inicio");
    await page.keyboard.press("Escape");
    await expect(page.locator(".entrance-curtain")).toHaveCount(0);
    const link = page
      .locator(".rail-links")
      .getByRole("link", { name: "Inventario", exact: true });
    await link.click();
    await expect(link).toHaveAttribute("data-pending", "true");
    const wait = page.locator(".nav-wait");
    await expect(wait).toHaveAttribute("data-state", "loading");
    // El logo con su destello dorado y el nombre de la sección destino: no una
    // barra que se llena.
    await expect(wait).toContainText("Inventario");
    await expect(wait.locator(".nav-wait-logo img")).toBeVisible();
    expect(
      await wait
        .locator(".nav-wait-shine i")
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("motion-logo-shine");
    // Nada de «Abriendo sección»: la página anterior sigue a la vista.
    await expect(page.getByText("Abriendo sección")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Buen día/ })).toBeVisible();
    await expect(page).toHaveURL(/\/inventario/, { timeout: 8000 });
    await expect(link).not.toHaveAttribute("data-pending", "true");
    await expect(page.locator(".nav-wait")).toHaveAttribute(
      "data-state",
      "idle",
    );
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-navigating",
      /.+/,
    );
    // Al llegar la sección, el destello se detiene: no queda nada corriendo.
    await expect(wait.locator(".nav-wait-shine i")).toHaveCSS(
      "animation-name",
      "none",
    );
  });

  test("si la sección llega rápido, no se ve ninguna espera", async ({
    page,
  }) => {
    await page.goto("/inicio");
    await page.keyboard.press("Escape");
    const states: string[] = [];
    await page.exposeFunction("reportState", (value: string) =>
      states.push(value),
    );
    await page.evaluate(() => {
      const bar = document.querySelector(".nav-wait")!;
      new MutationObserver(() =>
        (window as unknown as { reportState(v: string): void }).reportState(
          bar.getAttribute("data-state") ?? "",
        ),
      ).observe(bar, { attributes: true });
    });
    await page
      .locator(".rail-links")
      .getByRole("link", { name: "Venta", exact: true })
      .click();
    await expect(page).toHaveURL(/\/pos/);
    await expect(page.locator(".nav-wait")).toHaveAttribute(
      "data-state",
      "idle",
    );
    expect(states).toContain("waiting");
  });
});
