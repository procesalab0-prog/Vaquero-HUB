import { describe, it, expect, vi } from "vitest";
import {
  capturePhotoRefreshCategories,
  PHOTO_CATEGORY_IDS,
} from "../../scripts/m9/catalogo-categorias-capturar.mjs";
import {
  photoCategoryNodes,
  preparePhotoCategoryReview,
  PHOTO_REFRESH_ID,
} from "../../scripts/m9/catalogo-categorias-plan.mjs";
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const captured = "2026-10-22T23:30:00.000Z",
  old = "2026-10-22T20:00:00.000Z",
  sha = "a".repeat(64),
  md5 = "a".repeat(32);
const category = {
  id: 1,
  name: "Common",
  slug: "common",
  link: "https://vaquerosm.com/product-category/common/",
};
function fixture() {
  const current = [],
    before = [],
    after = [],
    families = [];
  for (let n = 0; n < 7; n++) {
    const pid = uid(n + 1),
      woo = PHOTO_CATEGORY_IDS[n],
      binding = {
        product_id: pid,
        woo_product_id: woo,
        mappings: [{ id: 1, path: "Common" }],
        category_paths: ["Common"],
        source_fingerprint: md5,
        source_sha256: sha,
        evidence_sha256: sha,
        verified_at: old,
        invalidated_at: null,
        invalidation_reason: null,
      };
    const evidence = Array.from({ length: 7 }, (_, i) => ({
      variant_id: uid(100 + n * 7 + i),
      product_id: pid,
      barcode: "000" + (n * 7 + i),
      photos: [
        {
          url: "https://vaquerosm.com/wp-content/uploads/p.jpg",
          sha256: sha,
          bytes: 100,
          mime: "image/jpeg",
          alt: "",
        },
      ],
    }));
    const copies = evidence.map((e) => ({
      variant_id: e.variant_id,
      evidence_hash: md5,
      photos: [
        {
          url: `https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/${pid}/${sha}.jpg`,
          alt: "",
        },
      ],
    }));
    const f = {
      product_id: pid,
      product: { id: pid, image_path: null },
      catalog: { product_id: pid },
      source: {
        snapshot: {
          source_status: "publish",
          type: "variable",
          woo_product_id: woo,
        },
        suggested_content: { categories: ["Common"] },
      },
      draft: { content: { categories: ["Common"] } },
      variants: [],
      managed: [],
      evidence,
      copies,
      objects: [
        {
          name: `${pid}/${sha}.jpg`,
          metadata: { size: 100, mimetype: "image/jpeg" },
        },
      ],
      category_binding: {
        ...binding,
        invalidated_at: old,
        invalidation_reason: "SOURCE_CHANGED",
      },
    };
    current.push(f);
    before.push({ product_id: pid, category_binding: binding });
    after.push({
      ...structuredClone(f),
      copies: structuredClone(copies.slice(0, 3)),
    });
    families.push({ product_id: pid, woo_product_id: woo });
  }
  return {
    context: {
      current,
      receipt: {
        request_id: PHOTO_REFRESH_ID,
        reversed_at: null,
        packet: { protocol: "m9-variant-photo-refresh-1", families },
        result: { created: 24, previous_evidence_revalidated: 25 },
        before_state: before,
        after_state: after,
      },
    },
    capture: {
      protocol: "m9-photo-category-public-capture-1",
      complete: true,
      origin: "https://vaquerosm.com",
      credentials_sent: false,
      writes_performed: 0,
      started_at: captured,
      captured_at: captured,
      products: PHOTO_CATEGORY_IDS.map((id) => ({
        id,
        status: 200,
        observed_at: captured,
        data: { id, categories: [structuredClone(category)] },
      })),
    },
    receipt_meta: { receipt_sha256: sha, exact_copy_evidence_hashes: 49 },
    capture_sha256: sha,
    request_id: uid(999),
    now: new Date(captured),
  };
}
describe("photo refresh categories retain canonical evidence", () => {
  it("prepares allseven without mutating sources,drafts,copies or capture dates", () => {
    const f = fixture(),
      before = structuredClone(f),
      a = preparePhotoCategoryReview(f);
    expect(f).toEqual(before);
    expect(a.summary).toMatchObject({
      ready: 7,
      held: 0,
      photo_evidence: 49,
      photo_copies: 49,
      public_capture_at: captured,
    });
    expect(a).toEqual(preparePhotoCategoryReview(f));
    expect(a.writes_performed).toBe(0);
    expect(a.send_allowed).toBe(false);
  });
  for (const [label, mutate, reason] of [
    [
      "other invalidation",
      (f) =>
        (f.context.current[0].category_binding.invalidation_reason =
          "DRAFT_CATEGORIES_CHANGED"),
      "CATEGORY_INVALIDATION_NOT_FROM_THIS_REFRESH",
    ],
    [
      "manual draft",
      (f) => (f.context.current[0].draft.content.categories = ["Changed"]),
      "PHOTO_REFRESH_CURRENT_CONTEXT_CHANGED",
    ],
    [
      "new copy changed",
      (f) => (f.context.current[0].copies[6].photos[0].alt = "manual"),
      "PHOTO_OBJECT_OR_LINK_CHANGED",
    ],
    [
      "object missing",
      (f) => (f.context.current[0].objects = []),
      "PHOTO_OBJECT_OR_LINK_CHANGED",
    ],
    [
      "copy missing",
      (f) => f.context.current[0].copies.pop(),
      "PHOTO_COPY_COVERAGE_CHANGED",
    ],
    [
      "Woo parent mismatch",
      (f) => (f.context.current[0].source.snapshot.woo_product_id = 999),
      "WOO_PARENT_SOURCE_CHANGED",
    ],
    [
      "published state changed",
      (f) => (f.context.current[0].source.snapshot.source_status = "draft"),
      "WOO_PARENT_SOURCE_CHANGED",
    ],
    [
      "canonical mapping changed",
      (f) => (f.context.current[0].category_binding.mappings[0].path = "Other"),
      "PUBLIC_MEMBERSHIP_OR_CANONICAL_PATH_CHANGED",
    ],
  ])
    it(`holds ${label}`, () => {
      const f = fixture();
      mutate(f);
      const a = preparePhotoCategoryReview(f);
      expect(a.rows[0].reasons).toContain(reason);
      expect(a.payload).toBeNull();
    });
  it("rejects old capture rather than re-dating it", () => {
    const f = fixture();
    f.now = new Date("2026-10-25T00:00:00Z");
    expect(() => preparePhotoCategoryReview(f)).toThrow("STALE");
  });
  it("rejects future capture", () => {
    const f = fixture();
    f.now = new Date("2026-10-20T00:00:00Z");
    expect(() => preparePhotoCategoryReview(f)).toThrow("STALE");
  });
  it("rejects missing products and duplicate product identities", () => {
    const f = fixture();
    f.capture.products.pop();
    expect(() => preparePhotoCategoryReview(f)).toThrow("SEVEN_PUBLIC");
    const g = fixture();
    g.capture.products[1].id = g.capture.products[0].id;
    expect(() => preparePhotoCategoryReview(g)).toThrow("SEVEN_PUBLIC");
  });
  it("holds an observed name change even with the same categoryID", () => {
    const f = fixture();
    for (const p of f.capture.products) p.data.categories[0].name = "Other";
    const a = preparePhotoCategoryReview(f);
    expect(a.summary.ready).toBe(0);
    expect(a.payload).toBeNull();
  });
  it("requires all parent permalinks to be observed within the authorizedproducts", () => {
    const f = fixture();
    for (const p of f.capture.products)
      p.data.categories[0].link =
        "https://vaquerosm.com/product-category/unobserved/common/";
    expect(() => photoCategoryNodes(f.capture)).toThrow(
      "ANCESTOR_NOT_OBSERVED",
    );
  });
  it("reconstructs canonical parentpaths using IDs and observedpermalinks", () => {
    const f = fixture();
    for (const p of f.capture.products)
      p.data.categories.push({
        id: 2,
        name: "Child",
        slug: "child",
        link: category.link + "child/",
      });
    const nodes = photoCategoryNodes(f.capture);
    expect(nodes.find((c) => c.id === 2).parent).toBe(1);
  });
  it("rejects inconsistent terms between products", () => {
    const f = fixture();
    f.capture.products[1].data.categories[0].name = "Changed";
    expect(() => photoCategoryNodes(f.capture)).toThrow("BETWEEN_PRODUCTS");
  });
});
describe("seven scoped public category GETs", () => {
  it("transmits only known publicIDs,no headers,credentials or internal data", async () => {
    const transport = vi.fn(async (url) => {
      const id = Number(new URL(url).pathname.split("/").at(-1));
      return new Response(JSON.stringify({ id, categories: [category] }), {
        headers: { "content-type": "application/json" },
      });
    });
    const a = await capturePhotoRefreshCategories(
      transport,
      () => new Date(captured),
    );
    expect(a.products).toHaveLength(7);
    for (const [url, options] of transport.mock.calls) {
      expect(url).toMatch(/products\/[0-9]+\?_fields=id,categories$/);
      expect(options).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      expect(options).not.toHaveProperty("headers");
      expect(options).not.toHaveProperty("body");
    }
  });
  it("rejects an unavailable product instead of interpreting absence as no categories", async () => {
    await expect(
      capturePhotoRefreshCategories(
        async () => new Response("{}", { status: 404 }),
      ),
    ).rejects.toThrow("NOT_PUBLIC");
  });
  it("rejects changed productidentity and emptycategorylist", async () => {
    await expect(
      capturePhotoRefreshCategories(
        async () =>
          new Response(JSON.stringify({ id: 1, categories: [category] })),
      ),
    ).rejects.toThrow("IDENTITY_OR_COMPLETENESS");
    await expect(
      capturePhotoRefreshCategories(
        async (url) =>
          new Response(
            JSON.stringify({
              id: Number(new URL(url).pathname.split("/").at(-1)),
              categories: [],
            }),
          ),
      ),
    ).rejects.toThrow("IDENTITY_OR_COMPLETENESS");
  });
});
