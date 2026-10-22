import { describe, it, expect } from "vitest";
import { planCatalogPhotoRefresh } from "../../scripts/m9/catalogo-fotos-refresh.mjs";
const vid = "de04cd57-d246-42e0-a61c-11a170ca3df4",
  pid = "001f9757-61be-44e0-852c-8b0b38a486e9",
  md5 = "a".repeat(32);
function fixture() {
  const attrs = [{ name: "Talla", option: "27" }];
  const before = {
    m9_rows: { rows: 7 },
    evidence: { rows: 4 },
    copies: { rows: 3 },
  };
  return {
    project_id: "zsezjtswqeijboezvado",
    before,
    after: structuredClone(before),
    coverage: {
      linked_woo: 6,
      sicar_only: 1,
      linked_simple: 1,
      without_evidence: 1,
      nonempty_without_copy: 0,
      copies_wrong_hash: 0,
    },
    gaps: [["0007779", vid, pid, 42, 101, ""]],
    bindings: [
      {
        variant_id: vid,
        product_id: pid,
        barcode: "0007779",
        woo_product_id: 42,
        woo_variation_id: 101,
        active: true,
        barcode_matches: true,
        stored_matches: true,
        binding_hash: md5,
        current_hash: md5,
        attributes: { TALLA: "27" },
      },
    ],
    contexts: [
      {
        product_id: pid,
        name: "Un modelo",
        image_path: null,
        woo_product_id: 42,
        source_woo_product_id: 42,
        source_status: "publish",
        source_type: "variable",
        source_hash: md5,
        draft_hash: md5,
        catalog_hash: md5,
        draft_present: true,
        draft_images: [{ url: "cover", alt: "Manual" }],
        existing_evidence_count: 3,
        source_variants: [
          {
            barcode: "0007779",
            woo_variation_id: 101,
            images_woo: "",
            attributes_woo: attrs,
            attributes_sicar: { TALLA: "27" },
          },
        ],
      },
    ],
    woo: {
      pagination_complete: true,
      products: [
        {
          id: 42,
          type: "variable",
          status: "publish",
          variations: [
            {
              id: 101,
              status: "publish",
              attributes: structuredClone(attrs),
              images: "https://vaquerosm.com/wp-content/uploads/new.jpg",
            },
          ],
        },
      ],
    },
  };
}
describe("exact photo additions with source refresh still held", () => {
  it("prepares an inert addition preserving prior evidence and gallery", () => {
    const f = fixture(),
      original = structuredClone(f),
      a = planCatalogPhotoRefresh(f);
    expect(a).toEqual(planCatalogPhotoRefresh(f));
    expect(f).toEqual(original);
    expect(a.summary.new_photos_to_prepare).toBe(1);
    expect(a.summary.existing_evidence_to_revalidate).toBe(3);
    expect(a.inert_batch.executable).toBe(false);
    expect(a.rows[0].barcode).toBe("0007779");
    expect(a.inert_batch.items[0].application_blockers).toContain(
      "EXISTING_EVIDENCE_MUST_BE_REVALIDATED_ATOMICALLY",
    );
  });
  for (const [name, mutate, reason] of [
    [
      "manual cover",
      (f) => (f.contexts[0].image_path = "manual.jpg"),
      "MANUAL_PRODUCT_COVER_PROTECTED",
    ],
    [
      "empty saved gallery",
      (f) => (f.contexts[0].draft_images = []),
      "EMPTY_OR_PARTIAL_SAVED_GALLERY_PROTECTED",
    ],
    [
      "changed barcode",
      (f) => (f.bindings[0].barcode = "7779"),
      "CURRENT_LITERAL_IDENTITY_CHANGED",
    ],
    [
      "changed attributes",
      (f) => (f.woo.products[0].variations[0].attributes = []),
      "SAVED_VARIANT_ATTRIBUTES_OR_BINDING_CHANGED",
    ],
    [
      "changed source",
      (f) => (f.contexts[0].source_woo_product_id = 43),
      "FRESH_PARENT_CONTEXT_REQUIRED",
    ],
    [
      "missing context",
      (f) => (f.contexts = []),
      "FRESH_PARENT_CONTEXT_REQUIRED",
    ],
  ])
    it(`holds ${name}`, () => {
      const f = fixture();
      mutate(f);
      const a = planCatalogPhotoRefresh(f);
      expect(a.rows[0].reasons).toContain(reason);
      expect(a.inert_batch.items).toEqual([]);
    });
  it("does not turn unpublished Woo into a photo candidate", () => {
    const f = fixture();
    f.woo.products[0].status = "draft";
    expect(planCatalogPhotoRefresh(f).rows[0].state).toBe(
      "PARENT_NOT_PUBLISHED_OR_CHANGED",
    );
  });
  it("preserves a missing photo without parent inheritance or zero stock", () => {
    const f = fixture();
    f.woo.products[0].variations[0].images = "";
    const a = planCatalogPhotoRefresh(f);
    expect(a.rows[0].state).toBe("NO_OWN_PHOTO_PRESERVED");
    expect(a.inert_batch.items).toEqual([]);
    expect(a.rows[0]).not.toHaveProperty("stock");
  });
  it("does not invent an absent saved variant binding", () => {
    const f = fixture();
    f.gaps[0][5] = null;
    expect(planCatalogPhotoRefresh(f).rows[0].state).toBe(
      "SAVED_VARIANT_LINK_MISSING",
    );
  });
  it("rejects a partial gap census and a changed audit", () => {
    const f = fixture();
    f.coverage.without_evidence = 2;
    expect(() => planCatalogPhotoRefresh(f)).toThrow("COMPLETE_GAP");
    const g = fixture();
    g.after.copies.rows = 4;
    expect(() => planCatalogPhotoRefresh(g)).toThrow("READ_CHANGED");
  });
  it("rejects a duplicate variation and a production destination", () => {
    const f = fixture();
    f.woo.products[0].variations.push(
      structuredClone(f.woo.products[0].variations[0]),
    );
    expect(() => planCatalogPhotoRefresh(f)).toThrow("DUPLICATE_WOO_VARIATION");
    const g = fixture();
    g.project_id = "drubkjlmfbdeglucakmg";
    expect(() => planCatalogPhotoRefresh(g)).toThrow("STAGING_ONLY");
  });
});
