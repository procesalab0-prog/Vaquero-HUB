import { it, expect } from "vitest";
import { bindingSql } from "../../scripts/m9/persist-verified-categories.mjs";
function inputs() {
  const source = "a".repeat(64),
    evidence = "b".repeat(64);
  const items = Array.from({ length: 7 }, (_, n) => ({
    woo_product_id: n + 1,
    product_id: `00000000-0000-0000-0000-00000000000${n}`,
    source_sha256: source,
    category_evidence: [{ id: n + 10, path: "Dama > Camisa's" }],
    expected_suggested_content: { categories: ["A"] },
  }));
  return [
    { version: "m9-verified-categories-preparation-1", items },
    {
      products: items.map((i) => ({
        woo_product_id: i.woo_product_id,
        description_html: "Untrusted ' text",
      })),
    },
    source,
    evidence,
  ];
}
it("locks and checks exact source snapshots before invoking staging-only preparation", () => {
  const a = inputs(),
    before = JSON.stringify(a),
    sql = bindingSql(...a);
  expect(sql).toContain("app.assert_sicar_staging_enabled");
  expect(sql.match(/SOURCE_SNAPSHOT_CHANGED/g)).toHaveLength(7);
  expect(sql.match(/app.prepare_web_category_binding/g)).toHaveLength(7);
  expect(sql).toContain("Camisa''s");
  expect(sql).toContain("for update");
  expect(sql).not.toMatch(/\b(delete|inventory|fetch)\b/i);
  expect(JSON.stringify(a)).toBe(before);
  expect(bindingSql(...a)).toBe(sql);
});
it("rejects held commercial cases and duplicated target IDs", () => {
  const a = inputs();
  a[0].items[0].woo_product_id = 13560;
  expect(() => bindingSql(...a)).toThrow("INVALID_CANDIDATE_SCOPE");
  const b = inputs();
  b[0].items[1].product_id = b[0].items[0].product_id;
  expect(() => bindingSql(...b)).toThrow("SOURCE_MISMATCH");
});
it("rejects changed source hash, missing parent, or injected SQL identifiers", () => {
  const a = inputs();
  a[2] = "c".repeat(64);
  expect(() => bindingSql(...a)).toThrow("SOURCE_MISMATCH");
  const b = inputs();
  b[1].products = [];
  expect(() => bindingSql(...b)).toThrow("SOURCE_MISMATCH");
  const c = inputs();
  c[0].items[0].woo_product_id = "1;drop table x";
  expect(() => bindingSql(...c)).toThrow();
  const d = inputs();
  d[3] = "'bad";
  expect(() => bindingSql(...d)).toThrow("INVALID_EVIDENCE_HASH");
});
