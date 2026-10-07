import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  parseVariantPhotoUrls,
  prepareVariantPhotos,
} from "../../scripts/m9/prepare-variant-photos.mjs";
function fixture() {
  const url = "https://vaquerosm.com/wp-content/uploads/2026/foto.jpg";
  const current = {
    barcode: "0001",
    description: "MODEL27",
    department: "CABALLERO",
    section: "BOTAS",
    cost_cents: null,
    price_cents: 74000,
    attributes: { TALLA: "27" },
    woo_product_id: 10,
    woo_variation_id: 11,
  };
  const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 3]);
  return [
    {
      project_id: "zsezjtswqeijboezvado",
      inventory_balances: 0,
      inventory_movements: 0,
      rows: [
        {
          product_id: "p",
          variant_id: "v",
          current,
          stored: structuredClone(current),
        },
      ],
    },
    {
      project_id: "zsezjtswqeijboezvado",
      rows: 1,
      products: [
        {
          product_id: "p",
          woo_id: 10,
          source: {
            snapshot: {
              woo_product_id: 10,
              variants: [
                { barcode: "0001", woo_variation_id: 11, images_woo: "" },
              ],
            },
          },
        },
      ],
    },
    [
      {
        barcode: "0001",
        description: "MODEL27",
        product_id: 10,
        variation_id: 11,
        attributes: [{ name: "Talla", value: "27" }],
        fields: {
          "clave1 *": "0001",
          "descripción *": "MODEL27",
          departamento: "CABALLERO",
          categoria: "BOTAS",
          precio1: "740",
        },
      },
    ],
    {
      pagination_complete: true,
      products: [
        {
          id: 10,
          type: "variable",
          status: "publish",
          images: url,
          variations: [{ id: 11, status: "publish", images: url }],
        },
      ],
    },
    [
      {
        url,
        mime: "image/jpeg",
        bytes: bytes.length,
        bytes_buffer: bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  ];
}
it("binds exact literal barcode and variant, retaining price and all inputs", () => {
  const f = fixture(),
    before = JSON.stringify(f),
    a = prepareVariantPhotos(...f);
  expect(a.items[0].state).toBe("VARIATION_BYTES_VERIFIED");
  expect(a.items[0].barcode).toBe("0001");
  expect(a.items[0].current_sicar_price_cents).toBe(74000);
  expect(a.items[0].source_photo_changed).toBe(true);
  expect(a.import_allowed).toBe(false);
  expect(a.send_allowed).toBe(false);
  expect(a).toEqual(prepareVariantPhotos(...f));
  expect(JSON.stringify(f)).toBe(before);
});
it("lists unverified URLs without granting permission or inventing byte proofs", () => {
  const f = fixture();
  f[4] = [];
  const a = prepareVariantPhotos(...f);
  expect(a.items[0].state).toBe("VARIATION_BYTES_PENDING");
  expect(a.downloads[0].sha256).toBeNull();
});
it("never inherits the parent cover when a variation has no photo", () => {
  const f = fixture();
  f[3].products[0].variations[0].images = "";
  const a = prepareVariantPhotos(...f);
  expect(a.items[0].state).toBe("NO_VARIATION_PHOTO");
  expect(a.items[0].photos).toEqual([]);
});
it("holds unpublished parents, changed source links and mismatched barcodes", () => {
  for (const change of [
    (f) => (f[3].products[0].status = "draft"),
    (f) => (f[1].products[0].source.snapshot.woo_product_id = 12),
    (f) => (f[1].products[0].source.snapshot.variants[0].barcode = "1"),
    (f) => (f[2][0].variation_id = 12),
    (f) => (f[3].products[0].variations[0].status = "private"),
    (f) => (f[0].rows[0].current.price_cents = 1),
  ]) {
    const f = fixture();
    change(f);
    const a = prepareVariantPhotos(...f);
    expect(a.items[0].state).toBe("REVIEW_REQUIRED");
    expect(a.downloads).toEqual([]);
  }
});
it("rejects duplicate variant IDs anywhere in Woo rather than guessing the parent", () => {
  const f = fixture();
  f[3].products.push({ id: 12, type: "variable", variations: [{ id: 11 }] });
  expect(() => prepareVariantPhotos(...f)).toThrow(
    "DUPLICATE_OR_INVALID_WOO_VARIATION",
  );
});
it("rejects duplicate local codes and identities", () => {
  for (const change of [
    (f) => f[0].rows.push(structuredClone(f[0].rows[0])),
    (f) => f[1].products.push(structuredClone(f[1].products[0])),
  ]) {
    const f = fixture();
    change(f);
    f[1].rows = f[0].rows.length;
    expect(() => prepareVariantPhotos(...f)).toThrow();
  }
});
it("rejects forged, truncated, wrong MIME and overlimit photo byte evidence", () => {
  for (const change of [
    (f) => (f[4][0].sha256 = "0".repeat(64)),
    (f) => (f[4][0].mime = "image/png"),
    (f) => (f[4][0].url = ""),
    (f) => f[4][0].bytes++,
    (f) => (f[4][0].bytes_buffer = Buffer.alloc(4 * 1024 * 1024 + 1)),
  ]) {
    const f = fixture();
    change(f);
    expect(() => prepareVariantPhotos(...f)).toThrow(
      "INVALID_PHOTO_BYTES_PROOF",
    );
  }
});
it("accepts exact shared-photo references without conflating variant identities", () => {
  const f = fixture(),
    r = structuredClone(f[0].rows[0]);
  r.variant_id = "v2";
  r.current.barcode = r.stored.barcode = "0002";
  r.current.woo_variation_id = r.stored.woo_variation_id = 12;
  f[0].rows.push(r);
  f[1].rows = 2;
  f[1].products[0].source.snapshot.variants.push({
    barcode: "0002",
    woo_variation_id: 12,
    images_woo: "",
  });
  const source = structuredClone(f[2][0]);
  source.barcode = source.fields["clave1 *"] = "0002";
  source.variation_id = 12;
  f[2].push(source);
  f[3].products[0].variations.push({
    ...f[3].products[0].variations[0],
    id: 12,
  });
  const a = prepareVariantPhotos(...f);
  expect(a.downloads).toHaveLength(1);
  expect(a.downloads[0].references).toHaveLength(2);
  expect(a.items.map((r) => r.variant_id)).toEqual(["v", "v2"]);
});
it("parses Woo URL lists without breaking comma filenames and excludes unsafe origins", () => {
  expect(
    parseVariantPhotoUrls("https://vaquerosm.com/wp-content/uploads/a,b.jpg")
      .urls,
  ).toHaveLength(1);
  expect(
    parseVariantPhotoUrls(
      "https://vaquerosm.com/wp-content/uploads/a.jpg, https://vaquerosm.com/wp-content/uploads/b.jpg",
    ).urls,
  ).toHaveLength(2);
  for (const url of [
    "http://vaquerosm.com/wp-content/uploads/a.jpg",
    "https://evil.example/a.jpg",
    "https://u:p@vaquerosm.com/wp-content/uploads/a.jpg",
    "https://vaquerosm.com/wp-content/uploads/a.jpg?x=1",
    "https://vaquerosm.com/wp-content/uploads/a.jpg#x",
    "https://vaquerosm.com/wp-content/uploads/a.jpg, https://vaquerosm.com/wp-content/uploads/a.jpg",
  ])
    expect(parseVariantPhotoUrls(url).valid).toBe(false);
});
it("requires staging, empty inventories and complete pagination", () => {
  for (const change of [
    (f) => (f[0].project_id = "production"),
    (f) => (f[0].inventory_balances = 1),
    (f) => (f[3].pagination_complete = false),
  ]) {
    const f = fixture();
    change(f);
    expect(() => prepareVariantPhotos(...f)).toThrow();
  }
});

function supplementalFixture() {
  const f = fixture();
  f[1].products[0].source.snapshot.variants = [];
  f[1].products[0].source.snapshot.source_status = "publish";
  const c = f[0].rows[0].current;
  f.push({
    project_id: f[0].project_id,
    inventory_balances: 0,
    inventory_movements: 0,
    evidence: [
      {
        variant_id: "v",
        product_id: "p",
        barcode: c.barcode,
        woo_product_id: 10,
        woo_variation_id: 11,
        supplemental: true,
        revision: 1,
        export_sha256: createHash("sha256")
          .update(JSON.stringify(f[3], null, 2) + "\n")
          .digest("hex"),
        catalog_fingerprint: "a".repeat(32),
        source_fingerprint: "b".repeat(32),
        source_variant: {
          id: 11,
          status: "publish",
          attributes: [],
          images: f[4][0].url,
        },
        photos: [
          {
            url: f[4][0].url,
            sha256: f[4][0].sha256,
            bytes: f[4][0].bytes,
            mime: f[4][0].mime,
            alt: "",
          },
        ],
      },
    ],
    parents: [
      {
        product_id: "p",
        catalog_hash: "a".repeat(32),
        source_hash: "b".repeat(32),
        snapshot: structuredClone(f[1].products[0].source.snapshot),
        catalog: {
          product_id: "p",
          active: true,
          variants: [{ ...c, id: "v", active: true }],
        },
      },
    ],
  });
  return f;
}
it("reads registered complementary evidence without rewriting the historical source", () => {
  const f = supplementalFixture(),
    before = JSON.stringify(f);
  const result = prepareVariantPhotos(...f);
  expect(result.items[0].state).toBe("VARIATION_BYTES_VERIFIED");
  expect(result.summary.supplemental_sources_used).toBe(1);
  expect(result.items[0].source_photo_changed).toBe(false);
  expect(result.items[0].supplemental_evidence_fingerprint).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect(result).toEqual(prepareVariantPhotos(...f));
  expect(JSON.stringify(f)).toBe(before);
  expect(result.import_allowed).toBe(false);
  expect(result.send_allowed).toBe(false);
  expect(prepareVariantPhotos(...f.slice(0, 5)).items[0].state).toBe(
    "REVIEW_REQUIRED",
  );
});
it("retains review for stale, conflicting or incomplete complementary evidence", () => {
  for (const change of [
    (f) => (f[5].evidence[0].catalog_fingerprint = "c".repeat(32)),
    (f) => (f[5].evidence[0].source_fingerprint = "c".repeat(32)),
    (f) => (f[5].evidence[0].export_sha256 = "c".repeat(64)),
    (f) => (f[5].evidence[0].barcode = "1"),
    (f) => (f[5].evidence[0].product_id = "other"),
    (f) => (f[5].evidence[0].woo_variation_id = 12),
    (f) => (f[5].evidence[0].supplemental = false),
    (f) => (f[5].parents[0].snapshot.woo_product_id = 12),
    (f) => f[5].parents[0].catalog.variants[0].price_cents++,
    (f) => (f[5].parents[0].catalog.variants[0].active = false),
    (f) =>
      f[5].parents[0].catalog.variants.push(
        structuredClone(f[5].parents[0].catalog.variants[0]),
      ),
    (f) =>
      (f[5].evidence[0].source_variant.attributes = [
        { name: "Talla", option: "28" },
      ]),
    (f) => (f[5].evidence[0].source_variant.status = "private"),
    (f) => (f[5].evidence[0].photos[0].sha256 = "c".repeat(64)),
    (f) => f[5].evidence[0].photos[0].bytes++,
    (f) => (f[5].evidence[0].photos[0].mime = "image/png"),
    (f) => (f[5].evidence[0].photos = []),
    (f) =>
      f[1].products[0].source.snapshot.variants.push({
        barcode: "0001",
        woo_variation_id: 12,
      }),
    (f) => (f[2][0].fields.precio1 = "1"),
    (f) => (f[3].products[0].status = "draft"),
  ]) {
    const f = supplementalFixture();
    change(f);
    expect(prepareVariantPhotos(...f).items[0].state).toBe("REVIEW_REQUIRED");
    expect(prepareVariantPhotos(...f).downloads).toEqual([]);
  }
});
it("complementary no-photo records never inherit the parent's cover", () => {
  const f = supplementalFixture();
  f[3].products[0].variations[0].images = "";
  f[5].evidence[0].source_variant.images = "";
  f[5].evidence[0].photos = [];
  f[5].evidence[0].export_sha256 = createHash("sha256")
    .update(JSON.stringify(f[3], null, 2) + "\n")
    .digest("hex");
  const result = prepareVariantPhotos(...f);
  expect(result.items[0].state).toBe("NO_VARIATION_PHOTO");
  expect(result.items[0].photos).toEqual([]);
  expect(result.summary.supplemental_sources_used).toBe(1);
});
it("rejects duplicate complementary identities and non-isolated evidence contexts", () => {
  for (const change of [
    (f) => f[5].evidence.push(structuredClone(f[5].evidence[0])),
    (f) => f[5].parents.push(structuredClone(f[5].parents[0])),
    (f) => (f[5].project_id = "production"),
    (f) => (f[5].inventory_movements = 1),
  ]) {
    const f = supplementalFixture();
    change(f);
    expect(() => prepareVariantPhotos(...f)).toThrow();
  }
});
