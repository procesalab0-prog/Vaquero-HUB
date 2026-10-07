import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Isolated local preview: never connects to the live shop.
export default defineConfig({
  ...base,
  webServer: undefined,
  use: { ...base.use, baseURL: "http://127.0.0.1:3127" },
});
