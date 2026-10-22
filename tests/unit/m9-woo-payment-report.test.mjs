import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildWooPaymentReport,
  runWooPaymentReport,
  renderWooPaymentReport,
} from "../../scripts/m9/woo-payment-report.mjs";
import { paymentReviewFixture } from "../../scripts/m9/woo-payment-fixtures.mjs";
import { paymentDocumentSha256 } from "../../scripts/m9/woo-payment-eligibility.mjs";

const sample = () => ({
  protocol: "m9-woo-payment-review-batch-1",
  operational_import_allowed: false,
  cases: [{ key: "qa-1", input: paymentReviewFixture() }],
});
describe("reproducible batch payment review", () => {
  it("retains explicit no-execution counters and deterministic report bytes", () => {
    const a = buildWooPaymentReport(sample()),
      b = buildWooPaymentReport(sample());
    expect(a).toEqual(b);
    expect(renderWooPaymentReport(a)).toBe(renderWooPaymentReport(b));
    expect(a.native_sales_authorized).toBe(0);
    expect(a.gateway_payments_executed).toBe(0);
    expect(a.stock_commands_generated).toBe(0);
    expect(a.classifications).toEqual({ REHEARSAL_CANDIDATE: 1 });
  });
  it("escapes even an independently supplied report before rendering HTML", () => {
    const r = buildWooPaymentReport(sample());
    r.cases[0].key = '<script>alert("key")</script>';
    r.cases[0].result.reasons = ['<img src=x onerror="alert(1)">'];
    r.cases[0].result.components_cents.total = "<svg>";
    expect(renderWooPaymentReport(r)).not.toContain("<script>");
    expect(renderWooPaymentReport(r)).not.toContain("<img");
    expect(renderWooPaymentReport(r)).not.toContain("<svg>");
  });
  for (const [name, mutate] of [
    [
      "operational import",
      (b) => {
        b.operational_import_allowed = true;
      },
    ],
    [
      "unknown keys",
      (b) => {
        b.command = "POST";
      },
    ],
    [
      "empty batch",
      (b) => {
        b.cases = [];
      },
    ],
    [
      "over 500",
      (b) => {
        b.cases = Array.from({ length: 501 }, () => b.cases[0]);
      },
    ],
    [
      "unsafe key",
      (b) => {
        b.cases[0].key = "<script>";
      },
    ],
    [
      "duplicate key",
      (b) => {
        b.cases.push(b.cases[0]);
      },
    ],
  ])
    it(`rejects ${name}`, () => {
      const b = sample();
      mutate(b);
      expect(() => buildWooPaymentReport(b)).toThrow();
    });
  it("holds every duplicate reference even if separate documents claimed empty ledgers", () => {
    const b = sample(),
      second = paymentReviewFixture();
    for (const s of [second.first, second.second]) s.order_id = 9000009999;
    second.reservation.order_id = 9000009999;
    second.evidence.order_id = 9000009999;
    const { observed_at: ignored, ...body } = second.second;
    void ignored;
    second.evidence.order_sha256 = paymentDocumentSha256(body);
    b.cases.push({ key: "qa-2", input: second });
    const report = buildWooPaymentReport(b);
    expect(report.classifications).toEqual({ HOLD: 2 });
    for (const c of report.cases)
      expect(c.result.reasons).toContain(
        "PAYMENT_REFERENCE_DUPLICATED_IN_BATCH",
      );
  });
  it("holds two captures for the same order even with different references", () => {
    const b = sample(),
      second = paymentReviewFixture();
    second.evidence.reference = "qa_capture_2";
    for (const s of [second.first, second.second])
      s.payment.transaction_id = "qa_capture_2";
    const { observed_at: ignored, ...body } = second.second;
    void ignored;
    second.evidence.order_sha256 = paymentDocumentSha256(body);
    b.cases.push({ key: "qa-2", input: second });
    for (const c of buildWooPaymentReport(b).cases)
      expect(c.result.reasons).toContain("PAYMENT_MULTIPLE_CAPTURES_IN_BATCH");
  });
  it("writes private files, verifies hashes, rejects overwriting and detects altered report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m9-payment-report-"));
    try {
      const file = join(dir, "input.json"),
        output = join(dir, "report");
      await writeFile(file, JSON.stringify(sample()));
      await runWooPaymentReport(["--input", file, "--output", output]);
      expect((await stat(output)).mode & 0o777).toBe(0o700);
      expect((await stat(join(output, "reporte.json"))).mode & 0o777).toBe(
        0o600,
      );
      expect(
        execFileSync(process.execPath, [join(output, "verificar.mjs")], {
          encoding: "utf8",
        }),
      ).toContain("PASS");
      await expect(
        runWooPaymentReport(["--input", file, "--output", output]),
      ).rejects.toThrow();
      expect(
        await readFile(join(output, "reporte.html"), "utf8"),
      ).not.toContain("qa_sandbox_account");
      await writeFile(join(output, "reporte.json"), "changed");
      expect(() =>
        execFileSync(process.execPath, [join(output, "verificar.mjs")], {
          stdio: "pipe",
        }),
      ).toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("rejects malformed UTF-8 rather than rewriting literal codes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m9-payment-utf8-"));
    try {
      const file = join(dir, "input.json");
      await writeFile(file, Buffer.from([0xff]));
      await expect(
        runWooPaymentReport(["--input", file, "--output", join(dir, "out")]),
      ).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
