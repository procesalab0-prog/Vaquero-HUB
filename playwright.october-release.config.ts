import { defineConfig } from "@playwright/test";
import base from "./playwright.october.config";
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: "http://127.0.0.1:5940" },
});
