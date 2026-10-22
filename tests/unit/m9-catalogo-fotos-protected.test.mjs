import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { prepareProtectedPhotoRefresh } from "../../scripts/m9/catalogo-fotos-preparar-refresh.mjs";
import {
  verifyCatalogPhotoBytes,
  existingPublicPhotoReader,
} from "../../scripts/m9/catalogo-fotos-verificar-bytes.mjs";
import { stable } from "../../scripts/m9/woo-test/plan.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex"),
  md5 = "a".repeat(32);
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const parentIds = [7981, 11949, 21265, 35045, 36300, 37110, 38374],
    counts = [8, 2, 1, 1, 3, 5, 4],
    oldCounts = [0, 10, 6, 5, 2, 1, 1];
  const families = [],
    categories = [],
    items = [],
    products = [],
    proofs = [];
  let serial = 1;
  for (let n = 0; n < 7; n++) {
    const id = parentIds[n],
      pid = uid(n + 1),
      url = `https://vaquerosm.com/wp-content/uploads/photo-${n}.jpg`,
      variants = [],
      evidence = [],
      copies = [],
      catalog = [],
      saved = [];
    proofs.push({
      url,
      sha256: "b".repeat(64),
      bytes: 100,
      mime: "image/jpeg",
    });
    for (let v = 0; v < oldCounts[n] + counts[n]; v++) {
      const vid = uid(100 + serial),
        woo_id = 1000 + serial++,
        barcode = `000${serial}`,
        attrs = [{ name: "Talla", option: String(v) }];
      const variable = {
        id: woo_id,
        status: "publish",
        attributes: attrs,
        images: url,
      };
      variants.push(variable);
      catalog.push({
        id: vid,
        barcode,
        woo_product_id: id,
        woo_variation_id: woo_id,
      });
      saved.push({
        barcode,
        woo_variation_id: woo_id,
        images_woo: v < oldCounts[n] ? url : "",
        attributes_woo: attrs,
      });
      if (v < oldCounts[n]) {
        evidence.push({
          variant_id: vid,
          barcode,
          woo_product_id: id,
          woo_variation_id: woo_id,
          source_fingerprint: md5,
          row_hash: md5,
          source_variant: structuredClone(variable),
        });
        copies.push({ variant_id: vid, evidence_hash: md5, row_hash: md5 });
      } else
        items.push({
          product_id: pid,
          variant_id: vid,
          barcode,
          woo_product_id: id,
          woo_variation_id: woo_id,
          new_images: url,
          urls: [url],
          expected: { source_hash: md5, catalog_hash: md5, draft_hash: md5 },
          import_allowed: false,
          send_allowed: false,
        });
    }
    families.push({
      product_id: pid,
      woo_product_id: id,
      source_hash: md5,
      catalog_hash: md5,
      draft_hash: md5,
      product: { id: pid, image_path: null },
      draft: { content: { images: [{ url, alt: "" }] } },
      source: { snapshot: { source_status: "publish", variants: saved } },
      catalog: { variants: catalog },
      evidence,
      copies,
    });
    categories.push({ product_id: pid, binding: null });
    products.push({
      id,
      status: "publish",
      type: "variable",
      variations: variants,
    });
  }
  const plan = {
    protocol: "m9-photo-gap-refresh-1",
    project_id: "zsezjtswqeijboezvado",
    import_allowed: false,
    send_allowed: false,
    summary: { new_photos_to_prepare: 24 },
    inert_batch: { executable: false, items },
  };
  plan.plan_sha256 = hash(stable(plan));
  return {
    plan,
    families,
    categories,
    woo: { pagination_complete: true, products },
    proofs: {
      protocol: "m9-photo-local-bytes-1",
      plan_sha256: plan.plan_sha256,
      proofs,
    },
    request_id: uid(999),
    export_sha256: "c".repeat(64),
  };
}
describe("protected refresh packet", () => {
  it("pins seven families,24 new variants and25 prior evidence rows without mutating input", () => {
    const f = fixture(),
      before = structuredClone(f),
      p = prepareProtectedPhotoRefresh(f);
    expect(f).toEqual(before);
    expect(p.families).toHaveLength(7);
    expect(p.families.reduce((n, f) => n + f.new_items.length, 0)).toBe(24);
    expect(p.families.reduce((n, f) => n + f.evidence_before.length, 0)).toBe(
      25,
    );
    expect(
      p.families
        .flatMap((f) => f.new_items)
        .every((x) => x.barcode.startsWith("000")),
    ).toBe(true);
  });
  for (const [name, mutate, error] of [
    [
      "old Woo photo",
      (f) => (f.woo.products[1].variations[0].images += "changed"),
      "PREVIOUS_PHOTO",
    ],
    [
      "old copy evidence hash",
      (f) => (f.families[1].copies[0].evidence_hash = "c".repeat(32)),
      "PREVIOUS_PHOTO",
    ],
    [
      "manual product cover",
      (f) => (f.families[0].product.image_path = "manual.jpg"),
      "MANUAL_REVIEW",
    ],
    [
      "empty explicit gallery",
      (f) => (f.families[0].draft.content.images = []),
      "MANUAL_REVIEW",
    ],
    [
      "draft Woo parent",
      (f) => (f.woo.products[0].status = "draft"),
      "MANUAL_REVIEW",
    ],
    [
      "changed evidence plan",
      (f) => f.plan.inert_batch.items.pop(),
      "EXACT_PROTECTED",
    ],
  ])
    it(`rejects ${name}`, () => {
      const f = fixture();
      mutate(f);
      expect(() => prepareProtectedPhotoRefresh(f)).toThrow(error);
    });
});
describe("bounded public bytes using existing downloader", () => {
  afterEach(() => vi.unstubAllGlobals());
  const jpg = Buffer.from([255, 216, 255, 0, 0, 0]);
  const reader = async () => ({
    base64: jpg.toString("base64"),
    sha256: hash(jpg),
    mime: "image/jpeg",
  });
  it("deduplicates seven URLs while preserving all24 target variants", async () => {
    const f = fixture();
    const spy = vi.fn(reader),
      r = await verifyCatalogPhotoBytes(f.plan, spy);
    expect(spy).toHaveBeenCalledTimes(7);
    expect(r.proofs).toHaveLength(7);
    expect(r.files.size).toBe(1);
    expect(f.plan.inert_batch.items).toHaveLength(24);
  });
  it("rejects mismatched bytes and untrusted MIME", async () => {
    await expect(
      verifyCatalogPhotoBytes(fixture().plan, async () => ({
        ...(await reader()),
        sha256: "a".repeat(64),
      })),
    ).rejects.toThrow("DIGEST_MISMATCH");
    await expect(
      verifyCatalogPhotoBytes(fixture().plan, async () => ({
        ...(await reader()),
        mime: "image/svg+xml",
      })),
    ).rejects.toThrow("BYTES_OR_MIME");
  });
  it("passes redirect rejection,timeout and no-store to the existing downloader", async () => {
    const transport = vi.fn(
      async () =>
        new Response(jpg, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );
    vi.stubGlobal("fetch", transport);
    const r = await existingPublicPhotoReader(
      "https://vaquerosm.com/wp-content/uploads/photo-0.jpg",
    );
    expect(r.sha256).toBe(hash(jpg));
    expect(transport.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      cache: "no-store",
    });
    expect(transport.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("rejects HTML responses before using their bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>error</html>", {
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    await expect(
      existingPublicPhotoReader(
        "https://vaquerosm.com/wp-content/uploads/photo.jpg",
      ),
    ).rejects.toThrow("CONTENT_TYPE");
  });
});
