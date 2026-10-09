import { it, expect } from "vitest";
import { hash } from "../../scripts/m9/woo-test/plan.mjs";
import {
  prepareRevalidation,
  applyRevalidation,
} from "../../scripts/m9/woo-test/revalidation.mjs";
const snapshot = (id) => ({
  id,
  date_modified: "2026-10-01T10:00:00",
  date_modified_gmt: "2026-10-01T10:00:00",
  regular_price: "10.00",
  meta_data: [{ key: "barcode", value: "001" }],
  images: [{ id: 3 }],
  attributes: [{ name: "Talla", option: "M" }],
});
const input = () => ({
  mode: "update",
  type: "variable",
  product_id: "p",
  store: {
    id: "m9-local-2026-10-02",
    environment: "LOCAL_WOO_TEST",
    base_url: "http://127.0.0.1:9417",
  },
  target: {
    product_id: 1,
    snapshot: snapshot(1),
    variants: [{ id: 2, snapshot: snapshot(2) }],
  },
});
const evidenceHash = hash({ prior: true });
async function prepare(i = input()) {
  return prepareRevalidation({
    input: i,
    previousEvidenceHash: evidenceHash,
    reason: "Restored local rehearsal; dates reviewed",
    request: async (m, p) => {
      expect(m).toBe("GET");
      return {
        ...snapshot(Number(p.split("/").at(-1))),
        date_modified: "2026-10-05T10:00:00",
      };
    },
  });
}
it("refreshes only dates, preserves original evidence and every resource", async () => {
  const i = input(),
    before = hash(i),
    r = await prepare(i);
  const next = applyRevalidation(i, r, evidenceHash);
  expect(hash(i)).toBe(before);
  expect(next.target.snapshot.date_modified).toContain("10-05");
  expect(next.target.variants[0].snapshot.meta_data[0].value).toBe("001");
});
it.each([
  "regular_price",
  "meta_data",
  "images",
  "attributes",
  "name",
  "stock_quantity",
])("rejects a changed business field %s", async (key) => {
  const r = await prepare();
  r.resources[1].snapshot[key] = "changed";
  expect(() => applyRevalidation(input(), r, evidenceHash)).toThrow(
    "REVALIDATION_BUSINESS_CHANGE",
  );
});
it.each([
  "product_id",
  "store_sha256",
  "target_sha256",
  "previous_evidence_sha256",
])("rejects altered binding %s", async (key) => {
  const r = await prepare();
  r[key] = "other";
  expect(() => applyRevalidation(input(), r, evidenceHash)).toThrow(
    "REVALIDATION_BINDING_FAILED",
  );
});
it("rejects missing or duplicate children and malformed dates", async () => {
  const r = await prepare();
  r.resources.pop();
  expect(() => applyRevalidation(input(), r, evidenceHash)).toThrow();
  const d = await prepare();
  d.resources[1] = d.resources[0];
  expect(() => applyRevalidation(input(), d, evidenceHash)).toThrow();
  const b = await prepare();
  b.resources[0].snapshot.date_modified = null;
  expect(() => applyRevalidation(input(), b, evidenceHash)).toThrow(
    "REVALIDATION_INVALID_DATE",
  );
});
it("refreshes the same snapshot for a simple product and its variant", async () => {
  const i = input();
  i.type = "simple";
  i.target.variants = [{ id: 1, snapshot: i.target.snapshot }];
  const r = await prepare(i),
    next = applyRevalidation(i, r, evidenceHash);
  expect(hash(next.target.snapshot)).toBe(
    hash(next.target.variants[0].snapshot),
  );
});
