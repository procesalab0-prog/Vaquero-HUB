import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "october-operations.spec.ts",
    "pos.spec.ts",
    "mobile-dialogs.spec.ts",
    "qa-caja-inicio.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3137",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [{ name: "october", use: { ...devices["Desktop Chrome"] } }],
});
