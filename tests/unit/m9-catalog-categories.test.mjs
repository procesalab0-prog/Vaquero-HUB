import { describe, it, expect } from "vitest";
import {
  parseCategoryPaths,
  reviewCatalogCategories,
} from "../../scripts/m9/review-catalog-categories.mjs";
const categories = [
  { id: 1, name: "Dama", parent: 0 },
  { id: 2, name: "Camisa", parent: 1 },
  { id: 3, name: "Wrangler", parent: 0 },
];
const fixture = () => ({
  snapshot: {
    project_id: "zsezjtswqeijboezvado",
    rows: [
      {
        product_id: "internal-secret-id",
        current: { barcode: "private-sicar-code", woo_product_id: 10 },
      },
    ],
  },
  woo: {
    products: [
      {
        id: 10,
        name: "Camisa",
        status: "publish",
        categories: "Dama, Dama > Camisa, Wrangler",
      },
    ],
  },
  taxonomy: {
    pagination_complete: true,
    total: 3,
    categories,
    captured_at: "2026-10-03",
    products: [
      {
        id: 10,
        status: 200,
        data: { id: 10, categories: [{ id: 3 }, { id: 2 }, { id: 1 }] },
      },
    ],
  },
});
describe("catalog category evidence", () => {
  it("recognizes a single ampersand representation while holding ID collisions", () => {
    const encoded = [{ id: 1, name: "Ranch&amp;Brand", parent: 0 }];
    const parsed = parseCategoryPaths("Ranch&Brand", encoded);
    expect(parsed.mappings).toEqual([{ id: 1, path: "Ranch&amp;Brand" }]);
    expect(parsed.representation_alias_used).toBe(true);
    const collision = [...encoded, { id: 2, name: "Ranch&Brand", parent: 0 }];
    expect(parseCategoryPaths("Ranch&Brand", collision).state).toBe(
      "MANUAL_REVIEW",
    );
    expect(
      parseCategoryPaths("Ranch&Brand", [
        { id: 1, name: "Ranch&amp;amp;Brand", parent: 0 },
      ]).state,
    ).toBe("MANUAL_REVIEW");
  });
  it("keeps hierarchical IDs exact and never authorizes a historical match for current dispatch", () => {
    const { snapshot, woo, taxonomy } = fixture(),
      r = reviewCatalogCategories(snapshot, woo, taxonomy);
    expect(r.summary).toMatchObject({
      products: 1,
      unique_path_proposals: 1,
      historical_membership_matches: 1,
      verified_current_memberships: 0,
      approved_for_send: 0,
    });
    expect(r.items[0].mappings).toEqual([
      { id: 1, path: "Dama" },
      { id: 2, path: "Dama > Camisa" },
      { id: 3, path: "Wrangler" },
    ]);
    expect(r.items[0].requires_fresh_public_membership).toBe(true);
    expect(r.items[0].send_allowed).toBe(false);
  });
  it("does not split a comma inside a known category name, but holds multiple valid interpretations", () => {
    const withComma = [{ id: 1, name: "A, B", parent: 0 }];
    expect(parseCategoryPaths("A, B", withComma).mappings).toEqual([
      { id: 1, path: "A, B" },
    ]);
    const ambiguous = [
      ...withComma,
      { id: 2, name: "A", parent: 0 },
      { id: 3, name: "B", parent: 0 },
    ];
    expect(parseCategoryPaths("A, B", ambiguous).reasons).toContain(
      "AMBIGUOUS_CATEGORY_PATHS",
    );
    expect(parseCategoryPaths("A, B", ambiguous).mappings).toEqual([]);
  });
  it("does not invent category paths, decode unknown escape syntax or accept duplicate IDs", () => {
    expect(parseCategoryPaths("Dama, Unknown", categories).state).toBe(
      "MANUAL_REVIEW",
    );
    expect(parseCategoryPaths("Dama\\,Camisa", categories).state).toBe(
      "MANUAL_REVIEW",
    );
    expect(parseCategoryPaths("Dama, Dama", categories).reasons).toContain(
      "REPEATED_CATEGORY_ID",
    );
    expect(() =>
      parseCategoryPaths("Dama", [...categories, categories[0]]),
    ).toThrow("INVALID_OR_DUPLICATE_CATEGORY");
  });
  it("does not treat a private or missing public product as absent from the catalog", () => {
    const { snapshot, woo, taxonomy } = fixture();
    taxonomy.products = [];
    woo.products[0].status = "private";
    const r = reviewCatalogCategories(snapshot, woo, taxonomy);
    expect(r.items[0].source_status).toBe("private");
    expect(r.items[0].historical_membership).toBe("NOT_CAPTURED_OR_NOT_PUBLIC");
    expect(r.items[0].state).toBe("UNIQUE_PATH_PROPOSAL");
  });
  it("excludes internal IDs, barcodes, inventory and prices from the proposed public requests", () => {
    const { snapshot, woo, taxonomy } = fixture();
    const p = reviewCatalogCategories(
      snapshot,
      woo,
      taxonomy,
    ).public_request_proposal;
    expect(p.requires_authorization).toBe(true);
    expect(p.requests[0].method).toBe("GET");
    const wire = JSON.stringify(p.requests);
    expect(wire).toContain("include=10");
    expect(wire).not.toContain("internal-secret-id");
    expect(wire).not.toContain("private-sicar-code");
  });
  it("rejects missing or conflicting source identity and incomplete taxonomy", () => {
    const { snapshot, woo, taxonomy } = fixture();
    expect(() =>
      reviewCatalogCategories(snapshot, { products: [] }, taxonomy),
    ).toThrow("WOO_SOURCE_ID_MISSING");
    expect(() =>
      reviewCatalogCategories(snapshot, woo, { ...taxonomy, total: 4 }),
    ).toThrow("VERIFIED_INPUT_REQUIRED");
    snapshot.rows.push({
      product_id: "other",
      current: { barcode: "other-code", woo_product_id: 10 },
    });
    expect(() => reviewCatalogCategories(snapshot, woo, taxonomy)).toThrow(
      "WOO_PARENT_MULTIPLE_DESTINATIONS",
    );
  });
});
