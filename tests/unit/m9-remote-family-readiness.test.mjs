import { describe, it, expect } from "vitest";
import { reviewRemoteFamilies } from "../../scripts/m9/woo-remote/family-readiness.mjs";

function fixture() {
  const id = "11111111-1111-4111-8111-111111111111";
  const variants = ["0054", "0055"].map((barcode, i) => ({
    id: `22222222-2222-4222-8222-22222222222${i}`,
    active: true,
    barcode,
    price_cents: 219000,
    attributes: { TALLA: String(54 + i) },
    department: "UNISEX",
    section: "SOMBREROS",
    woo_product_id: 20,
    woo_variation_id: 21 + i,
  }));
  const row = {
    product_id: id,
    revision: 3,
    catalog_fingerprint: "cf",
    source_fingerprint: "sf",
    source_sha256: "a".repeat(64),
    catalog: { product_id: id, name: "Sombrero", active: true, variants },
    content: {
      name: "Sombrero",
      base_code: "SOM",
      short_description: "SOM",
      description: "Sombrero de prueba",
      categories: ["Unisex > Sombrero"],
      images: [
        {
          alt: "Portada",
          url: `https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/${id}/${"b".repeat(64)}.jpg`,
        },
      ],
    },
    source: {
      type: "variable",
      woo_product_id: 20,
      variants: variants.map((v) => ({ woo_variation_id: v.woo_variation_id })),
      unselected_woo_variation_ids: [],
    },
    category_evidence: {
      valid: true,
      woo_product_id: 20,
      evidence_sha256: "c".repeat(64),
      mappings: [{ id: 30, path: "Unisex > Sombrero" }],
    },
    family_evidence: {
      product_id: id,
      source_sha256: "a".repeat(64),
      source_fingerprint: "sf",
      catalog_fingerprint: "cf",
      evidence_sha256: "d".repeat(64),
    },
    sicar_evidence: variants.map((v) => ({
      variant_id: v.id,
      barcode: v.barcode,
      source_row: { ...v },
    })),
  };
  const latest = variants.map((v) => ({
    barcode: v.barcode,
    product_id: 20,
    variation_id: v.woo_variation_id,
    manual_review: false,
    classification: "MATCH_EXACT_VARIANT",
    issues: [],
    commercial_checks: [],
    attributes: [{ name: "Talla", value: v.attributes.TALLA }],
    fields: {
      "clave1 *": v.barcode,
      departamento: v.department,
      categoria: v.section,
      precio1: "2190.00",
      existencia: "999",
    },
  }));
  const snapshot = { project_id: "zsezjtswqeijboezvado", rows: [row] };
  return {
    row,
    latest,
    snapshot,
    review: () => reviewRemoteFamilies(snapshot, latest).families[0],
  };
}
describe("remote family preparation is read only and preserves whole identities", () => {
  it("retains literal codes, all sizes, gallery and category paths without inventory", () => {
    const f = fixture();
    const out = f.review();
    expect(out.reasons).toEqual([]);
    expect(out.proposal.variants.map((v) => v.barcode)).toEqual([
      "0054",
      "0055",
    ]);
    expect(out.proposal.category_paths).toEqual([
      { source_category_id: 30, path: "Unisex > Sombrero" },
    ]);
    expect(JSON.stringify(out.proposal)).not.toMatch(
      /existencia|stock|cost_cents/,
    );
    expect(reviewRemoteFamilies(f.snapshot, f.latest).dispatch_allowed).toBe(
      false,
    );
  });
  it("is reproducible and does not mutate sources", () => {
    const f = fixture();
    const before = JSON.stringify(f);
    expect(f.review()).toEqual(f.review());
    expect(JSON.stringify(f)).toBe(before);
  });
  it("refuses production", () => {
    const f = fixture();
    f.snapshot.project_id = "drubkjlmfbdeglucakmg";
    expect(f.review).toThrow("STAGING");
  });
  it("reports a corrected department without applying it", () => {
    const f = fixture();
    f.latest[0].fields.departamento = "CABALLERO";
    expect(f.review().changes).toEqual([
      {
        barcode: "0054",
        field: "department",
        before: "UNISEX",
        after: "CABALLERO",
      },
    ]);
    expect(f.review().proposal).toBeNull();
  });
  it("does not invent a physical variant for a web-only size", () => {
    const f = fixture();
    f.row.source.unselected_woo_variation_ids = [23];
    expect(f.review().woo_variations_outside_pilot).toEqual([23]);
    expect(f.review().staged_variants).toBe(2);
    expect(f.review().proposal).toBeNull();
  });
  it("rejects a partial pilot even when the source web snapshot omitted a SICAR row", () => {
    const f = fixture();
    f.latest.push({ ...f.latest[0], barcode: "0060" });
    expect(f.review().reasons).toContain("SICAR_FAMILY_NOT_FULLY_STAGED");
  });
  it.each([
    [
      "duplicate source barcode",
      (f) => f.latest.push(f.latest[0]),
      "SICAR_DUPLICATE_BARCODE",
    ],
    ["missing source barcode", (f) => f.latest.pop(), "SICAR_ABSENT_NO_DELETE"],
    [
      "duplicate attributes",
      (f) => {
        f.row.catalog.variants[1].attributes = { TALLA: "54" };
      },
      "DUPLICATE_ATTRIBUTE_COMBINATION",
    ],
    [
      "stale family review",
      (f) => {
        f.row.family_evidence.catalog_fingerprint = "old";
      },
      "FAMILY_EVIDENCE_REQUIRED",
    ],
    [
      "unverified categories",
      (f) => {
        f.row.category_evidence.valid = false;
      },
      "CATEGORY_EVIDENCE_REQUIRED",
    ],
    [
      "truncated category path",
      (f) => {
        f.row.content.categories = ["Sombrero"];
      },
      "CATEGORY_EVIDENCE_REQUIRED",
    ],
    [
      "foreign image",
      (f) => {
        f.row.content.images[0].url = "https://example.com/photo.jpg";
      },
      "OWN_STORED_PHOTO_REQUIRED",
    ],
    [
      "ambiguous match",
      (f) => {
        f.latest[0].manual_review = true;
      },
      "SOURCE_MANUAL_REVIEW",
    ],
    [
      "invented price",
      (f) => {
        f.latest[0].fields.precio1 = "2190.009";
      },
      "STAGING_REFRESH_REQUIRED",
    ],
  ])("holds %s for review", (_label, mutate, reason) => {
    const f = fixture();
    mutate(f);
    expect(f.review().reasons).toContain(reason);
    expect(f.review().proposal).toBeNull();
  });
});
