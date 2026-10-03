import { it, expect } from "vitest";
import {
  candidateReview,
  renderReview,
} from "../../scripts/m9/prepare-candidate-review.mjs";
function fixture() {
  const p = {
    id: 1,
    type: "variable",
    status: "publish",
    name: "Producto",
    description: "Texto",
    short_description: "BASE",
    images: "https://vaquerosm.com/wp-content/uploads/a.jpg",
    variations: [{ id: 2, status: "publish", price: "100.00", attributes: [] }],
  };
  const f = {
    woo_product_id: 1,
    issues: [],
    diagnostic_state: "IDENTITY_AND_CATEGORIES_CHECKED_NOT_APPROVED",
    categories: {
      verified_ids: [3],
      state: "VERIFIED_PATH_AND_PUBLIC_MEMBERSHIP",
    },
    woo_members: [
      {
        woo_id: 2,
        state: "EXACT_CANONICAL_LINK",
        in_pilot: false,
        sicar: [
          {
            barcode: "001",
            manual_review: false,
            classification: "MATCH_EXACT_VARIANT",
            retail_sicar: "100",
          },
        ],
      },
    ],
  };
  return [
    { version: "m9-web-family-review-1", families: [f] },
    { pagination_complete: true, products: [p] },
  ];
}
it("preserves barcode and all members without generating remote changes", () => {
  const args = fixture();
  const before = JSON.stringify(args);
  const r = candidateReview(...args);
  expect(r.counts.members).toBe(1);
  expect(r.products[0].variants[0].barcode).toBe("001");
  expect(r.products[0].send_allowed).toBe(false);
  expect(r.products[0].proposed_remote_changes).toEqual([]);
  expect(JSON.stringify(args)).toBe(before);
  expect(candidateReview(...args)).toEqual(r);
});
it("rejects changed prices and incomplete families", () => {
  const a = fixture();
  a[1].products[0].variations[0].price = "110";
  expect(() => candidateReview(...a)).toThrow("PRICE_CHANGED");
  const b = fixture();
  b[1].products[0].variations.push({ id: 4 });
  expect(() => candidateReview(...b)).toThrow("INCOMPLETE_FAMILY");
});
it("excludes unresolved families and rejects unverified categories", () => {
  const a = fixture();
  a[0].families[0].issues = ["REVIEW"];
  expect(candidateReview(...a).products).toEqual([]);
  const b = fixture();
  b[0].families[0].categories.verified_ids = null;
  expect(() => candidateReview(...b)).toThrow("UNVERIFIED_CATEGORIES");
});
it("flags and escapes untrusted HTML instead of executing it", () => {
  const a = fixture();
  a[1].products[0].description = "<script>alert(1)</script>";
  const r = candidateReview(...a);
  expect(r.products[0].editorial_flags).toContain(
    "SOURCE_HTML_REQUIRES_EDITORIAL_REVIEW",
  );
  const html = renderReview(r);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("Content-Security-Policy");
});
