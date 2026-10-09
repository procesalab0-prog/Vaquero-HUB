import { expect, it } from "vitest";
import {
  reviewSourceSections,
  prepareSourceSectionReview,
} from "../../scripts/m9/review-source-sections.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture() {
  const row = {
    barcode: "0042",
    description: "AM",
    product_id: 10,
    variation_id: 11,
    candidate_product_ids: [10],
    classification: "MATCH_EXACT_VARIANT",
    fields: {
      "clave1 *": "0042",
      "descripción *": "AM",
      departamento: "CABALLERO",
      categoria: "CAMISAS",
    },
  };
  const parent = {
    id: 10,
    name: "Camisa",
    type: "variable",
    status: "publish",
    description: "Texto",
    short_description: "A",
    images: "https://vaquerosm.com/a.jpg",
    categories: "Ropa",
    attributes: [],
    variations: [
      { id: 11, attributes: [], images: "", price: "740", sale_price: "" },
    ],
  };
  const source = {
    product_id: "p",
    snapshot: {
      woo_product_id: 10,
      name: parent.name,
      type: parent.type,
      source_status: parent.status,
      description_html: parent.description,
      short_description_html: parent.short_description,
      image_urls: [parent.images],
      categories_source: parent.categories,
      parent_attributes_source: [],
      variants: [
        {
          barcode: "0042",
          woo_variation_id: 11,
          attributes_woo: [],
          images_woo: "",
          regular_price_woo: "740",
          sale_price_woo: "",
          promotion_start: "",
          promotion_end: "",
        },
      ],
    },
  };
  return {
    rows: [row],
    exclusions: [
      { barcode: "0042", reasons: ["FAMILIA_CON_SECCIONES_DISTINTAS"] },
    ],
    woo: {
      pagination_complete: true,
      expected_parents_from_panel: 1,
      products: [parent],
    },
    comparison: {
      version: "m9-woo-refresh-2",
      summary: {
        identity_movements: 0,
        states: { SOURCE_CHANGED_MANUAL_REVIEW: 1 },
      },
      items: [
        {
          woo_product_id: 10,
          state: "SOURCE_CHANGED_MANUAL_REVIEW",
          kinds: ["editorial"],
          parent_changes: [{ field: "images" }],
          variation_changes: [],
        },
      ],
    },
    context: {
      project_id: "zsezjtswqeijboezvado",
      rows: 0,
      inventory_balances: 0,
      inventory_movements: 0,
      products: [
        {
          woo_id: 10,
          product_id: "p",
          source,
          draft: { product_id: "p", revision: 7, content: { images: [] } },
        },
      ],
    },
    snapshot: {
      project_id: "zsezjtswqeijboezvado",
      rows: [],
      inventory_balances: 0,
      inventory_movements: 0,
    },
  };
}

it("does not repeat already incorporated source changes or approve a draft", () => {
  const f = fixture(),
    before = structuredClone(f),
    r = reviewSourceSections(f);
  expect(r.editorial[0].state).toBe("SAVED_SOURCE_ALREADY_CURRENT");
  expect(r.editorial[0].draft_revision).toBe(7);
  expect(r.editorial[0].refresh_allowed).toBe(false);
  expect(f).toEqual(before);
});
it("separates parent gallery from variant photos and keeps SICAR prices", () => {
  const f = fixture();
  f.woo.products[0].images = "https://vaquerosm.com/new.jpg";
  f.woo.products[0].variations[0].images = "https://vaquerosm.com/variant.jpg";
  f.woo.products[0].variations[0].price = "999";
  f.comparison.items[0].kinds.push("commercial");
  f.comparison.items[0].variation_changes = [
    {
      id: 11,
      state: "SOURCE_CHANGED_MANUAL_REVIEW",
      changes: [{ field: "images", kind: "editorial" }],
    },
  ];
  const r = reviewSourceSections(f).editorial[0];
  expect(r.parent_differences.map((x) => x.field)).toEqual(["image_urls"]);
  expect(r.saved_variants[0].changes.map((x) => x.field)).toEqual([
    "images_woo",
    "regular_price_woo",
  ]);
  expect(r.tasks).toContain(
    "KEEP_SICAR_PRICE1_REVIEW_WOO_PROMOTIONS_SEPARATELY",
  );
  expect(r.tasks).toContain(
    "REVIEW_VARIATION_PHOTOS_SEPARATELY_FROM_PARENT_GALLERY",
  );
});
it("never deletes absent variations or unpublished parents", () => {
  const f = fixture();
  f.woo.products[0].variations = [];
  f.woo.products[0].status = "draft";
  f.comparison.items[0].kinds = ["status"];
  f.comparison.items[0].variation_changes = [
    { id: 11, state: "ABSENT_VARIATION_NO_DELETE", changes: [] },
  ];
  const r = reviewSourceSections(f).editorial[0];
  expect(r.saved_variants[0].state).toBe("ABSENT_KEEP");
  expect(r.delete_allowed).toBe(false);
  expect(r.tasks).toContain("ABSENT_VARIATIONS_KEEP_NO_DELETE");
});
it("shows broad prefix contamination without removing ambiguous rows or changing holds", () => {
  const f = fixture();
  f.rows.push({
    ...structuredClone(f.rows[0]),
    barcode: "55",
    description: "OTHER",
    product_id: null,
    variation_id: null,
    classification: "CONFLICT",
    fields: {
      "clave1 *": "55",
      "descripción *": "OTHER",
      departamento: "DAMA",
      categoria: "BOTAS",
    },
  });
  const r = reviewSourceSections(f).sections[0];
  expect(r.state).toBe("CANDIDATE_SCOPE_REVIEW");
  expect(r.firm_sections).toEqual(["CAMISAS"]);
  expect(r.broad_sections).toEqual(["BOTAS", "CAMISAS"]);
  expect(r.unassigned_candidate_rows[0].barcode).toBe("55");
  expect(r.import_allowed).toBe(false);
});
it("keeps genuine mixed sections with owners and ignores other holds for scope proposals", () => {
  const f = fixture();
  f.rows.push({
    ...structuredClone(f.rows[0]),
    barcode: "55",
    description: "AL",
    variation_id: 12,
    fields: {
      "clave1 *": "55",
      "descripción *": "AL",
      departamento: "DAMA",
      categoria: "BOTAS",
    },
  });
  expect(reviewSourceSections(f).sections[0].state).toBe(
    "OWNER_SECTION_REVIEW",
  );
  f.rows.pop();
  f.exclusions[0].reasons.push("CLASIFICACION_PENDIENTE");
  expect(reviewSourceSections(f).summary.scope_review_codes).toBe(0);
});
it("rejects wrong projects, inventory, stale exclusions, altered codes and wrong saved identities", () => {
  for (const change of [
    (f) => (f.context.project_id = "production"),
    (f) => (f.snapshot.inventory_balances = 1),
    (f) => (f.exclusions[0].barcode = "MISSING"),
    (f) => (f.rows[0].barcode = "42"),
    (f) => (f.context.products[0].source.snapshot.woo_product_id = 20),
    (f) => f.rows.push(structuredClone(f.rows[0])),
    (f) => f.context.products.push(structuredClone(f.context.products[0])),
  ]) {
    const f = fixture();
    change(f);
    expect(() => reviewSourceSections(f)).toThrow();
  }
});
it("requires input hashes before creating output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m9-source-review-"));
  try {
    await writeFile(join(dir, "config.json"), "{}");
    await expect(
      prepareSourceSectionReview(join(dir, "config.json"), join(dir, "out")),
    ).rejects.toThrow("INPUT_HASH_REQUIRED");
  } finally {
    await rm(dir, { recursive: true });
  }
});
