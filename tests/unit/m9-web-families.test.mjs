import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  categoryPaths,
  reviewWebFamilies,
  verifiedFile,
} from "../../scripts/m9/review-web-families.mjs";

function fixture() {
  const categories = [
    { id: 1, parent: 0, name: "Bota" },
    { id: 2, parent: 0, name: "Caballero" },
    { id: 3, parent: 2, name: "Bota" },
  ];
  const content = {
    products: [
      {
        woo_product_id: 10,
        categories_source: "Caballero > Bota, Bota",
        variants: [{ barcode: "001", woo_variation_id: 11 }],
        unselected_woo_variation_ids: [12],
      },
    ],
  };
  const woo = {
    pagination_complete: true,
    products: [
      {
        id: 10,
        name: "Bota",
        type: "variable",
        status: "publish",
        categories: "Caballero > Bota, Bota",
        variations: [
          { id: 11, status: "publish" },
          { id: 12, status: "private" },
        ],
      },
    ],
  };
  const rows = [
    {
      barcode: "001",
      row: 2,
      product_id: 10,
      variation_id: 11,
      candidate_product_ids: [10],
      classification: "MATCH_EXACT_VARIANT",
      manual_review: false,
      fields: { departamento: "JUVENIL", categoria: "BOTAS", precio1: "100" },
    },
  ];
  const taxonomy = {
    categories,
    total: 3,
    pagination_complete: true,
    products: [
      {
        id: 10,
        status: 200,
        data: { id: 10, categories: [{ id: 1 }, { id: 3 }] },
      },
    ],
  };
  return [content, woo, rows, taxonomy];
}
describe("M9 readonly complete family review", () => {
  it("uses complete category paths and preserves non-pilot/private members and exact barcodes", () => {
    const args = fixture(),
      before = JSON.stringify(args);
    const report = reviewWebFamilies(...args),
      f = report.families[0];
    expect(f.categories.verified_ids).toEqual([1, 3]);
    expect(f.woo_members[0].sicar[0].barcode).toBe("001");
    expect(f.woo_members[1]).toMatchObject({
      woo_id: 12,
      status: "private",
      preserve_existing: true,
      state: "NO_CONFIRMED_SICAR_LINK",
    });
    expect(f.delete_ids).toEqual([]);
    expect(f.send_allowed).toBe(false);
    expect(report.counts).toMatchObject({
      woo_members: 2,
      exact_members: 1,
      unresolved_members: 1,
    });
    expect(JSON.stringify(args)).toBe(before);
    expect(reviewWebFamilies(...args)).toEqual(report);
  });
  it("does not verify category membership that changed since the CSV", () => {
    const args = fixture();
    args[3].products[0].data.categories = [{ id: 2 }];
    expect(
      reviewWebFamilies(...args).families[0].categories.verified_ids,
    ).toBeNull();
  });
  it("keeps unavailable public products in manual review", () => {
    const args = fixture();
    args[3].products[0] = { id: 10, status: 404 };
    expect(reviewWebFamilies(...args).families[0].issues).toContain(
      "CATEGORY_REVIEW",
    );
  });
  it("rejects ambiguous identical full paths", () => {
    const args = fixture();
    args[3].categories.push({ id: 4, parent: 0, name: "Bota" });
    args[3].total++;
    expect(
      reviewWebFamilies(...args).families[0].categories.verified_ids,
    ).toBeNull();
  });
  it("does not guess escaped category delimiters", () => {
    const args = fixture();
    args[0].products[0].categories_source = args[1].products[0].categories =
      "Bota\\, Caballero";
    expect(
      reviewWebFamilies(...args).families[0].categories.verified_ids,
    ).toBeNull();
  });
  it("rejects incomplete taxonomy, cycles and missing parents", () => {
    const args = fixture();
    args[3].total++;
    expect(() => reviewWebFamilies(...args)).toThrow("INCOMPLETE_INPUT");
    expect(() => categoryPaths([{ id: 1, parent: 1, name: "A" }])).toThrow(
      "CATEGORY_CYCLE",
    );
    expect(() => categoryPaths([{ id: 1, parent: 2, name: "A" }])).toThrow(
      "CATEGORY_PARENT_MISSING",
    );
  });
  it("rejects global Woo ID collisions and duplicate barcodes", () => {
    const args = fixture();
    args[1].products[0].variations.push({ id: 12 });
    expect(() => reviewWebFamilies(...args)).toThrow(
      "INVALID_OR_DUPLICATE_WOO_ID",
    );
    const other = fixture();
    other[2].push({ ...other[2][0] });
    expect(() => reviewWebFamilies(...other)).toThrow(
      "INVALID_OR_DUPLICATE_BARCODE",
    );
  });
  it("does not promote ambiguous candidates or commercial holds", () => {
    const args = fixture();
    args[2].push({
      ...args[2][0],
      barcode: "002",
      variation_id: 12,
      manual_review: true,
      commercial_checks: ["PRICE_DIFFERENCE"],
    });
    args[2].push({
      ...args[2][0],
      barcode: "003",
      product_id: null,
      variation_id: null,
      classification: "CONFLICT",
      manual_review: true,
    });
    const f = reviewWebFamilies(...args).families[0];
    expect(f.woo_members[1].state).toBe("CANONICAL_REVIEW");
    expect(f.sicar_candidate_rows[0].barcode).toBe("003");
    expect(f.issues).toContain("UNRESOLVED_SICAR_CANDIDATES");
  });
  it("rejects stale pilot links and lost omitted variants", () => {
    const args = fixture();
    args[0].products[0].variants[0].barcode = "1";
    expect(() => reviewWebFamilies(...args)).toThrow("PILOT_LINK_CHANGED");
    const other = fixture();
    other[0].products[0].unselected_woo_variation_ids = [];
    expect(() => reviewWebFamilies(...other)).toThrow(
      "PILOT_OMISSIONS_CHANGED",
    );
  });
  it("rejects altered evidence before generating reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "m9-family-test-"));
    try {
      await writeFile(join(dir, "filas.json"), "[]");
      await writeFile(
        join(dir, "sha256.json"),
        JSON.stringify({ "filas.json": "wrong" }),
      );
      await expect(verifiedFile(dir, "filas.json")).rejects.toThrow(
        "SOURCE_HASH_MISMATCH",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
