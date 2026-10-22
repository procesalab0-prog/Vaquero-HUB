import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const runner = fileURLToPath(
  new URL("../../scripts/m9/verify-woo-web-settlement.mjs", import.meta.url),
);
describe("web ledger test runner refuses destinations before connecting", () => {
  for (const url of [
    "postgresql://localhost/postgres",
    "postgresql://db.zsezjtswqeijboezvado.supabase.co/qa_fake",
    "postgresql://db.drubkjlmfbdeglucakmg.supabase.co/qa_fake",
    "postgresql://example.invalid/qa_fake",
    "postgresql://localhost/qa_fake?host=example.invalid",
    "postgresql://localhost/qa_fake#remote",
    "https://localhost/qa_fake",
  ])
    it(`rejects ${new URL(url).hostname}${new URL(url).pathname}${new URL(url).search}`, () => {
      let error;
      try {
        execFileSync(process.execPath, [runner], {
          env: { ...process.env, QA_DATABASE_URL: url },
          stdio: "pipe",
        });
      } catch (e) {
        error = e;
      }
      expect(error?.status).toBe(1);
      expect(error?.stderr.toString()).toContain("LOCAL_QA_DATABASE_REQUIRED");
      expect(error?.stderr.toString()).not.toContain("connect ");
    });
});
