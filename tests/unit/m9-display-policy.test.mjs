import { afterEach, expect, it, vi } from "vitest";
import { compilePlan } from "../../scripts/m9/woo-test/plan.mjs";
import { sampleInput } from "../../scripts/m9/woo-test/fixtures.mjs";
import { wooClient } from "../../scripts/m9/woo-test/worker.mjs";
function exhibition() {
  const input = sampleInput();
  input.product_id = "200ca5b2-7e5f-44ee-9428-2bceebe282dc";
  input.type = "simple";
  input.variants = [{ ...input.variants[0], barcode: "10105", attributes: [] }];
  return input;
}
afterEach(() => vi.unstubAllGlobals());
it("binds exhibition to the approved identity and includes it in the verified payload", () => {
  const plan = compilePlan(exhibition());
  expect(plan.steps[0].payload.status).toBe("draft");
  expect(plan.steps[0].payload.meta_data).toContainEqual({
    key: "_m9_display_only",
    value: "yes",
  });
  expect(plan.steps[0].payload.description).toContain("sin compra en línea");
  expect(plan.steps[0].payload).not.toHaveProperty("stock_quantity");
});
it("does not infer exhibition for unrelated products", () => {
  expect(
    compilePlan(sampleInput()).steps[0].payload.meta_data.some(
      (m) => m.key === "_m9_display_only",
    ),
  ).toBe(false);
});
it("requires review when the approved barcode set changes", () => {
  const input = exhibition();
  input.variants[0].barcode = "10106";
  expect(() => compilePlan(input)).toThrow(
    "DISPLAY_POLICY_IDENTITY_REVIEW_REQUIRED",
  );
});
it("does not send the product when the destination policy is missing", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        environment: "local",
        url: "http://127.0.0.1:9417",
      }),
    });
  vi.stubGlobal("fetch", fetchMock);
  const input = exhibition();
  const step = compilePlan(input).steps[0];
  await expect(
    wooClient(input.store)("POST", step.path, step.payload),
  ).rejects.toThrow("DISPLAY_POLICY_CAPABILITY_REQUIRED");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("sends only after the exact local capability is confirmed", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        environment: "local",
        url: "http://127.0.0.1:9417",
        display_policy: "m9-display-only-1",
      }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 99 }) });
  vi.stubGlobal("fetch", fetchMock);
  const input = exhibition();
  const step = compilePlan(input).steps[0];
  await expect(
    wooClient(input.store)("POST", step.path, step.payload),
  ).resolves.toEqual({ id: 99 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
