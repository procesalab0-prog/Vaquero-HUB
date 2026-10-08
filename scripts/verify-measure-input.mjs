import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Isolated real React/Chromium capture, not a mock of the quantity component.
// Does not claim authenticated checkout or authorize the product assignment gate.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const req = createRequire(join(root, "package.json"));
const vitePath = createRequire(req.resolve("vitest/package.json")).resolve(
  "vite",
);
const { build } = await import(pathToFileURL(vitePath).href);
const output = await mkdtemp(join(tmpdir(), "vaquero-measure-input-"));
await build({
  configFile: false,
  root,
  define: { "process.env.NODE_ENV": '"production"' },
  resolve: { alias: { "@": root } },
  build: {
    outDir: output,
    emptyOutDir: false,
    lib: {
      entry: join(root, "tests/browser-fixtures/measure-input-harness.tsx"),
      name: "MeasureQA",
      formats: ["iife"],
      fileName: () => "harness.js",
    },
  },
});
const { chromium } = req("@playwright/test");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: join(output, "harness.js") });
  const input = page.getByRole("textbox", { name: "Kilos" });
  const button = page.getByRole("button", { name: "Cobrar" });
  await input.fill("1.");
  assert.equal(await input.inputValue(), "1.");
  assert.equal(await button.isDisabled(), true);
  await input.press("2");
  assert.equal(await input.inputValue(), "1.2");
  assert.equal(await button.isDisabled(), false);
  assert.equal(await page.locator("output").textContent(), "1.2");
  for (const invalid of ["1.2345", "0", "2.001", "-1", ""]) {
    await input.fill(invalid);
    assert.equal(await button.isDisabled(), true);
    assert.equal(await input.getAttribute("aria-invalid"), "true");
  }
  await input.fill("0,625");
  assert.equal(await button.isDisabled(), false);
  assert.equal(await page.locator("output").textContent(), "0.625");
  assert.equal(
    await page.locator("html").evaluate((el) => el.scrollWidth),
    390,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Measured input: partial decimal, invalid payment blocking, comma decimal, 390px overflow: PASS. Isolated component, NOT authenticated checkout.",
  );
} finally {
  await browser.close();
}
