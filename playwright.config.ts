import { defineConfig, devices } from "@playwright/test";

const localChrome = process.env.CI ? {} : { channel: "chrome" as const };

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3107",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...localChrome },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], ...localChrome },
    },
  ],
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1 --port 3107",
    url: "http://127.0.0.1:3107/inicio",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
