import { describe, it, expect } from "vitest";
import {
  planCatalogPhotos,
  assertCatalogPhotoPlanFresh,
} from "../../scripts/m9/catalogo-fotos-plan.mjs";
import {
  CATALOG_PHOTO_PROJECT,
  CATALOG_PHOTO_COLUMNS,
  catalogPhotoReadQuery,
} from "../../scripts/m9/catalogo-fotos-queries.mjs";
const pid = "001f9757-61be-44e0-852c-8b0b38a486e9",
  vid = "de04cd57-d246-42e0-a61c-11a170ca3df4";
const url = "https://vaquerosm.com/wp-content/uploads/own.jpg",
  md5 = "a".repeat(32),
  sha = "b".repeat(64);
const stored = `https://${CATALOG_PHOTO_PROJECT}.supabase.co/storage/v1/object/public/product-images/${pid}/${sha}.jpg`;
function fixture() {
  const photo = {
    url,
    sha256: sha,
    bytes: 100,
    mime: "image/jpeg",
    alt: "Mi talla",
  };
  const sourceVariant = {
    id: 101,
    status: "publish",
    attributes: [{ name: "Talla", option: "27" }],
    images: url,
  };
  const snapshot = {
    protocol: "m9-catalog-photo-snapshot-1",
    project_id: CATALOG_PHOTO_PROJECT,
    complete: true,
    managed_count: 1,
    row_columns: CATALOG_PHOTO_COLUMNS,
    rows: [[vid, pid, "0007779", 42, 101, true, true, true, true, md5, md5]],
    products: [
      {
        product_id: pid,
        name: "Modelo",
        image_path: null,
        catalog_hash: md5,
        source_hash: md5,
        draft_hash: md5,
        woo_product_id: 42,
        source_woo_product_id: 42,
        source_status: "publish",
        source_type: "variable",
        draft_present: true,
        draft_images: [{ url, alt: "Mi talla" }],
        source_images: [{ url, alt: "Mi talla" }],
        source_variants: [
          { barcode: "0007779", woo_variation_id: 101, images_woo: url },
        ],
      },
    ],
    evidence: [
      {
        variant_id: vid,
        product_id: pid,
        barcode: "0007779",
        woo_product_id: 42,
        woo_variation_id: 101,
        source_fingerprint: md5,
        evidence_hash: md5,
        revision: 1,
        supplemental: false,
        photos: [photo],
        source_variant: sourceVariant,
      },
    ],
    copies: [],
    objects: [],
    import_allowed: false,
    send_allowed: false,
    writes_performed: 0,
  };
  const woo = {
    pagination_complete: true,
    products: [
      {
        id: 42,
        status: "publish",
        type: "variable",
        images: url,
        variations: [structuredClone(sourceVariant)],
      },
    ],
  };
  return { snapshot, woo };
}
function audit(s) {
  return {
    m9_rows: { rows: s.rows.length },
    evidence: { rows: s.evidence.length },
    copies: { rows: s.copies.length },
    objects: { rows: s.objects.length },
  };
}
function run(f) {
  let a = audit(f.snapshot);
  return planCatalogPhotos(f.snapshot, a, a, f.woo);
}
function copied(f) {
  f.snapshot.copies = [
    {
      variant_id: vid,
      evidence_hash: md5,
      photos: [{ url: stored, alt: "Mi talla" }],
    },
  ];
  f.snapshot.objects = [
    { name: `${pid}/${sha}.jpg`, bytes: 100, mime: "image/jpeg" },
  ];
  return f;
}
describe("read-only complete catalog photo adoption", () => {
  it("is deterministic, literal and inert, with no input mutation", () => {
    const f = fixture(),
      original = structuredClone(f),
      a = run(f),
      b = run(f);
    expect(a).toEqual(b);
    expect(f).toEqual(original);
    expect(a.items[0].barcode).toBe("0007779");
    expect(a.summary.states.EXACT_EVIDENCE_COPY_CANDIDATE).toBe(1);
    expect(a.inert_batch.executor_authorization).toBe(false);
    expect(a.import_allowed).toBe(false);
    expect(a.summary.byte_integrity_asserted).toBe(false);
    expect(a.summary.byte_downloads_performed).toBe(0);
  });
  it("recognizes the completed mapping idempotently without proposing another copy", () => {
    const a = run(copied(fixture()));
    expect(a.items[0].state).toBe("COPIED_METADATA_CURRENT");
    expect(a.items[0].proposal).toBeNull();
    expect(a.inert_batch.families).toHaveLength(0);
  });
  it("preserves a registered missing variant photo even when the parent has images", () => {
    const f = fixture();
    f.snapshot.evidence[0].photos = [];
    f.snapshot.evidence[0].source_variant.images = "";
    f.snapshot.products[0].source_variants[0].images_woo = "";
    f.woo.products[0].variations[0].images = "";
    expect(run(f).items[0].state).toBe("REGISTERED_ABSENCE_PRESERVED");
    expect(run(f).items[0].proposal).toBeNull();
  });
  it("does not convert missing evidence or unproved URLs into an import permission", () => {
    const f = fixture();
    f.snapshot.evidence = [];
    const a = run(f);
    expect(a.items[0].state).toBe("EXACT_LINK_NEEDS_BYTES_EVIDENCE");
    expect(a.items[0].proposal.kind).toBe("VERIFY_VARIANT_BYTES_ONLY");
    expect(a.items[0].proposal.import_allowed).toBe(false);
  });
  it("preserves an unregistered absence as absence, never zero stock or inherited photo", () => {
    const f = fixture();
    f.snapshot.evidence = [];
    f.snapshot.products[0].source_variants[0].images_woo = "";
    f.woo.products[0].variations[0].images = "";
    const a = run(f);
    expect(a.items[0].state).toBe("NO_OWN_VARIANT_PHOTO_PRESERVED");
    expect(a.items[0]).not.toHaveProperty("stock");
  });
  it("protects a manual product cover", () => {
    const f = fixture();
    f.snapshot.products[0].image_path = "manual/path.jpg";
    expect(run(f).items[0].reasons).toContain("MANUAL_PRODUCT_COVER_PROTECTED");
    expect(run(f).inert_batch.families).toEqual([]);
  });
  it("protects an intentionally empty saved gallery", () => {
    const f = fixture();
    f.snapshot.products[0].draft_images = [];
    expect(run(f).items[0].reasons).toContain("SAVED_EMPTY_GALLERY_PROTECTED");
  });
  for (const [name, mutate, reason] of [
    [
      "literal barcode",
      (f) => (f.snapshot.rows[0][7] = false),
      "LIVE_CATALOG_OR_LITERAL_BARCODE_CHANGED",
    ],
    [
      "catalog edit",
      (f) => (f.snapshot.rows[0][8] = false),
      "LIVE_CATALOG_OR_LITERAL_BARCODE_CHANGED",
    ],
    [
      "source revision",
      (f) => (f.snapshot.products[0].source_hash = "c".repeat(32)),
      "REGISTERED_EVIDENCE_IDENTITY_OR_SOURCE_CHANGED",
    ],
    [
      "evidence barcode",
      (f) => (f.snapshot.evidence[0].barcode = "7779"),
      "REGISTERED_EVIDENCE_IDENTITY_OR_SOURCE_CHANGED",
    ],
    [
      "Woo parent",
      (f) => (f.woo.products[0].id = 43),
      "EXPORTED_VARIATION_IDENTITY_OR_STATUS_CHANGED",
    ],
    [
      "publication",
      (f) => (f.woo.products[0].status = "draft"),
      "EXPORTED_PARENT_STATUS_OR_TYPE_CHANGED",
    ],
    [
      "Woo photograph",
      (f) =>
        (f.woo.products[0].variations[0].images = url.replace(
          "own",
          "changed",
        )),
      "EXPORTED_VARIATION_PHOTO_CHANGED",
    ],
    [
      "Woo attributes",
      (f) =>
        (f.woo.products[0].variations[0].attributes = [
          { name: "Talla", option: "28" },
        ]),
      "REGISTERED_EVIDENCE_IDENTITY_OR_SOURCE_CHANGED",
    ],
  ])
    it(`holds changed ${name}`, () => {
      const f = fixture();
      mutate(f);
      const a = run(f);
      expect(a.items[0].state).toBe("REVIEW_REQUIRED");
      expect(a.items[0].reasons).toContain(reason);
      expect(a.inert_batch.families).toHaveLength(0);
    });
  it("does not overwrite changed storage mapping", () => {
    const f = copied(fixture());
    f.snapshot.copies[0].photos[0].alt = "Manual edit";
    expect(run(f).items[0].reasons).toContain(
      "EXISTING_STORAGE_MAPPING_CHANGED",
    );
  });
  it("holds an absent object without manufacturing a new mapping", () => {
    const f = copied(fixture());
    f.snapshot.objects = [];
    expect(run(f).items[0].reasons).toContain(
      "STORAGE_OBJECT_MISSING_OR_METADATA_CHANGED",
    );
  });
  it("holds changed object metadata without asserting verified bytes", () => {
    const f = copied(fixture());
    f.snapshot.objects[0].bytes = 99;
    expect(run(f).items[0].reasons).toContain(
      "STORAGE_OBJECT_MISSING_OR_METADATA_CHANGED",
    );
  });
  it("retains SICAR-only variants without trying to attach a similar Woo model", () => {
    const f = fixture();
    f.snapshot.rows[0][3] = null;
    f.snapshot.rows[0][4] = null;
    f.snapshot.products = [];
    f.snapshot.evidence = [];
    expect(run(f).items[0].state).toBe("SICAR_ONLY_NO_WOO_PHOTO_EXPECTED");
  });
  it("does not select a partly held family", () => {
    const f = fixture();
    const second = structuredClone(f.snapshot.rows[0]);
    second[0] = "fe2c3b5e-7508-453d-848f-d492ae869137";
    second[2] = "other";
    second[4] = 102;
    second[8] = false;
    f.snapshot.rows.push(second);
    f.snapshot.managed_count = 2;
    const a = run(f);
    expect(a.families[0].held_count).toBe(1);
    expect(a.inert_batch.families).toHaveLength(0);
  });
  it("rejects duplicate target IDs rather than choosing a candidate", () => {
    const f = fixture();
    f.woo.products[0].variations.push(
      structuredClone(f.woo.products[0].variations[0]),
    );
    expect(() => run(f)).toThrow("DUPLICATE_WOO_VARIATION");
  });
  it("rejects stale input and tampered plan on replay", () => {
    const f = fixture(),
      a = audit(f.snapshot),
      plan = run(f);
    expect(assertCatalogPhotoPlanFresh(plan, f.snapshot, a, a, f.woo)).toEqual(
      plan,
    );
    f.snapshot.products[0].draft_hash = "d".repeat(32);
    expect(() =>
      assertCatalogPhotoPlanFresh(plan, f.snapshot, a, a, f.woo),
    ).toThrow("STALE_OR_CHANGED");
  });
  it("rejects truncated capture and changing audits", () => {
    const f = fixture(),
      a = audit(f.snapshot);
    f.snapshot.complete = false;
    expect(() => planCatalogPhotos(f.snapshot, a, a, f.woo)).toThrow(
      "COMPLETE_READ_ONLY",
    );
    f.snapshot.complete = true;
    expect(() =>
      planCatalogPhotos(f.snapshot, a, { ...a, changed: true }, f.woo),
    ).toThrow("SNAPSHOT_CHANGED");
  });
  it("rejects a production marker", () => {
    const f = fixture();
    f.snapshot.project_id = "drubkjlmfbdeglucakmg";
    expect(() => run(f)).toThrow("COMPLETE_READ_ONLY");
  });
  it("rejects SQL injection and oversized page parameters before query generation", () => {
    expect(() =>
      catalogPhotoReadQuery("rows;drop table public.products"),
    ).toThrow("SECTION");
    expect(() => catalogPhotoReadQuery("rows", -1)).toThrow("PAGE");
    expect(() => catalogPhotoReadQuery("rows", 0, 501)).toThrow("PAGE");
    for (const section of [
      "rows",
      "products",
      "evidence",
      "copies",
      "objects",
    ]) {
      const q = catalogPhotoReadQuery(section);
      expect(q).toMatch(/^select /i);
      expect(q).not.toMatch(
        /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/i,
      );
    }
  });
});
