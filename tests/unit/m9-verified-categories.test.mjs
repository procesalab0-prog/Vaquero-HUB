import { it, expect } from "vitest";
import {
  prepareCategories,
  preflightSql,
} from "../../scripts/m9/prepare-verified-categories.mjs";
function inputs() {
  return [
    {
      products: [
        { woo_product_id: 1 },
        { woo_product_id: 13560 },
        { woo_product_id: 37102 },
      ],
    },
    {
      families: [
        {
          woo_product_id: 1,
          issues: [],
          categories: {
            state: "VERIFIED_PATH_AND_PUBLIC_MEMBERSHIP",
            verified_ids: [9, 10],
            source_csv: "Bota, Caballero > Bota",
          },
        },
      ],
      categories: [
        { id: 9, path: "Bota" },
        { id: 10, path: "Caballero > Bota" },
      ],
    },
    {
      project_id: "zsezjtswqeijboezvado",
      mode: "READ_ONLY",
      rows: [
        {
          product_id: "11111111-1111-1111-1111-111111111111",
          source_sha256: "a".repeat(64),
          snapshot: {
            woo_product_id: 1,
            categories_source: "Bota, Caballero > Bota",
          },
          suggested_content: {
            name: "Producto",
            categories: ["Bota, Caballero > Bota"],
          },
          human_content: null,
          revision: null,
        },
      ],
    },
  ];
}
it("preserves category hierarchy and holds pending commercial cases", () => {
  const a = inputs(),
    before = JSON.stringify(a),
    p = prepareCategories(...a);
  expect(p.items).toHaveLength(1);
  expect(p.items[0].category_evidence).toEqual([
    { id: 9, path: "Bota" },
    { id: 10, path: "Caballero > Bota" },
  ]);
  expect(p.items[0].send_allowed).toBe(false);
  expect(JSON.stringify(a)).toBe(before);
  expect(preflightSql(p)).toMatch(/^begin read only;/);
  expect(preflightSql(p)).not.toMatch(/\b(update|insert|delete)\b/i);
});
it("blocks stale sources, human changes and wrong environments", () => {
  const a = inputs();
  a[2].rows[0].human_content = { name: "Edición" };
  expect(() => prepareCategories(...a)).toThrow("HUMAN_DRAFT");
  const b = inputs();
  b[2].project_id = "production";
  expect(() => prepareCategories(...b)).toThrow("NOT_STAGING");
  const c = inputs();
  c[2].rows[0].snapshot.categories_source = "Otra";
  expect(() => prepareCategories(...c)).toThrow("SOURCE_CATEGORIES_CHANGED");
});
it("rejects missing category ID evidence and unresolved families", () => {
  const a = inputs();
  a[1].categories = [];
  expect(() => prepareCategories(...a)).toThrow("CATEGORY_ID_MISSING");
  const b = inputs();
  b[1].families[0].issues = ["REVIEW"];
  expect(() => prepareCategories(...b)).toThrow("CATEGORY_REVIEW_REQUIRED");
});
