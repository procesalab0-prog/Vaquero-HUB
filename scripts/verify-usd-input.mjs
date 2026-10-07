import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const req = createRequire(join(root, "package.json"));
const { build } = await import(
  pathToFileURL(
    createRequire(req.resolve("vitest/package.json")).resolve("vite"),
  ).href
);
const output = await mkdtemp(join(tmpdir(), "vaquero-usd-input-"));
await build({
  configFile: false,
  oxc: { jsx: { runtime: "automatic" } },
  root,
  define: { "process.env.NODE_ENV": '"production"' },
  resolve: { alias: { "@": root } },
  build: {
    outDir: output,
    emptyOutDir: false,
    lib: {
      entry: join(root, "tests/browser-fixtures/usd-checkout-harness.tsx"),
      name: "UsdQA",
      formats: ["iife"],
      fileName: () => "harness.js",
    },
  },
});
const browser = await req("@playwright/test").chromium.launch({
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({
    content: 'globalThis.process = {env:{NODE_ENV:"production"}};',
  });
  await page.addScriptTag({ path: join(output, "harness.js") });
  await page
    .waitForFunction(
      () =>
        document.getElementById("root")?.textContent?.length ||
        document.getElementById("root")?.childElementCount,
      {},
      { timeout: 5000 },
    )
    .catch(() => {
      throw new Error("USD QA render failed: " + errors.join("; "));
    });
  await page.getByRole("button", { name: "Consultar tasa FIX" }).click();
  const input = page.getByRole("textbox", { name: "Dólares recibidos (USD)" });
  const pay = page.getByRole("button", { name: "Cobrar en dólares" });
  for (const invalid of ["0", "1.", "5.501", "-1", "4.99"]) {
    await input.fill(invalid);
    assert.equal(await pay.isDisabled(), true);
  }
  await input.fill("5,50");
  assert.equal(await pay.isDisabled(), false);
  assert.match(await page.getByText("Cambio:").textContent(), /10\.00 MXN/);
  await pay.click();
  assert.deepEqual(JSON.parse(await page.locator("#result").textContent()), {
    quoteId: "QA-QUOTE",
    receivedUsdCents: 550,
  });
  assert.equal(
    await page.locator(".thermal-receipt").getByText("Recibido USD").count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "USD keyboard/comma/precision/change/confirmation/gift privacy: PASS. Isolated React, NOT live Auth/Banxico.",
  );
} finally {
  await browser.close();
}
