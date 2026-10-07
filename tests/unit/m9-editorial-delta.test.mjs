import { expect, it } from "vitest";
import { reviewEditorialDelta } from "../../scripts/m9/review-editorial-delta.mjs";
function fixture() {
  const url = "https://vaquerosm.com/wp-content/uploads/new.jpg";
  return [
    [
      {
        woo_product_id: 10,
        product_id: "p",
        state: "SAVED_SOURCE_REVIEW_REQUIRED",
        parent_differences: [
          { field: "categories_source", before: "A, B", after: "B, A" },
        ],
        saved_variants: [
          {
            barcode: "001",
            woo_variation_id: 11,
            changes: [
              { field: "regular_price_woo", before: "10", after: "12" },
              { field: "images_woo", before: "", after: url },
            ],
          },
        ],
      },
    ],
    {
      project_id: "zsezjtswqeijboezvado",
      rows: 1,
      products: [
        {
          woo_id: 10,
          product_id: "p",
          source: {
            snapshot: {
              woo_product_id: 10,
              categories_source: "A, B",
              variants: [
                {
                  barcode: "001",
                  woo_variation_id: 11,
                  regular_price_woo: "10",
                  images_woo: "",
                },
              ],
            },
          },
        },
      ],
    },
    {
      pagination_complete: true,
      products: [
        {
          id: 10,
          categories: "B, A",
          variations: [{ id: 11, price: "12", images: url }],
        },
      ],
    },
    {
      version: "m9-catalog-public-taxonomy-1",
      mode: "PUBLIC_GET_ONLY",
      pagination_complete: true,
      captured_at: "2026-10-06T22:40:20Z",
      requested_ids: [10],
      categories: [
        { id: 1, name: "A", parent: 0 },
        { id: 2, name: "B", parent: 0 },
      ],
      products: [{ id: 10, categories: [{ id: 1 }, { id: 2 }] }],
    },
    {
      project_id: "zsezjtswqeijboezvado",
      inventory_balances: 0,
      inventory_movements: 0,
      rows: [
        {
          product_id: "p",
          current: { barcode: "001", woo_variation_id: 11, price_cents: 74000 },
        },
      ],
    },
  ];
}
it("verifies representation-only changes without rewriting source, prices or parent galleries", () => {
  const f = fixture(),
    before = structuredClone(f),
    result = reviewEditorialDelta(...f);
  expect(result.summary.same_membership_representations).toBe(1);
  expect(result.items[0].prices[0].retained_sicar_public_cents).toBe(74000);
  expect(result.items[0].photos[0].parent_gallery_modified).toBe(false);
  expect(result.send_allowed).toBe(false);
  expect(result.refresh_allowed).toBe(false);
  expect(reviewEditorialDelta(...f)).toEqual(result);
  expect(f).toEqual(before);
});
it("retains real membership changes, unknown paths and missing public evidence for review", () => {
  for (const change of [
    (f) => f[3].products[0].categories.pop(),
    (f) => (f[3].products = []),
    (f) => (f[3].requested_ids = []),
    (f) => {
      f[0][0].parent_differences[0].after = "A";
      f[2].products[0].categories = "A";
    },
  ]) {
    const f = fixture();
    change(f);
    expect(reviewEditorialDelta(...f).summary.category_reviews).toBe(1);
  }
});
it("does not promote an image from another host or an invalid URL to a download candidate", () => {
  for (const url of [
    "https://evil.example/x.jpg",
    "javascript:alert(1)",
    "https://u:p@vaquerosm.com/wp-content/uploads/x.jpg",
  ]) {
    const f = fixture();
    f[0][0].saved_variants[0].changes[1].after = url;
    f[2].products[0].variations[0].images = url;
    expect(reviewEditorialDelta(...f).items[0].photos[0].state).toBe(
      "VARIATION_PHOTO_URL_REVIEW",
    );
  }
});
it("rejects changed source, price and variation identity instead of explaining stale evidence", () => {
  for (const change of [
    (f) => (f[1].products[0].source.snapshot.categories_source = "B, A"),
    (f) => (f[2].products[0].variations[0].price = "11"),
    (f) => (f[4].rows[0].current.woo_variation_id = 12),
    (f) => (f[0][0].product_id = "other"),
  ]) {
    const f = fixture();
    change(f);
    expect(() => reviewEditorialDelta(...f)).toThrow();
  }
});
it("rejects wrong staging, inventory, duplicate parents and incomplete capture", () => {
  for (const change of [
    (f) => (f[4].project_id = "production"),
    (f) => (f[4].inventory_movements = 1),
    (f) => f[2].products.push(structuredClone(f[2].products[0])),
    (f) => (f[3].pagination_complete = false),
  ]) {
    const f = fixture();
    change(f);
    expect(() => reviewEditorialDelta(...f)).toThrow();
  }
});
