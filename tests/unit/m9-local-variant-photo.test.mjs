import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prepareLocalVariantPhoto } from "../../scripts/m9/woo-test/variant-photo-plan.mjs";
const pid = "11111111-1111-4111-8111-111111111111",
  vid = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 3]);
  const proof = {
    bytes_buffer: bytes,
    bytes: bytes.length,
    mime: "image/jpeg",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    alt: "",
  };
  const attributes = [{ name: "Talla", option: "S" }];
  const binding = {
    product_id: pid,
    variant_id: vid,
    barcode: "0001",
    sku: "LAB-0001",
    price_cents: 82000,
    attributes,
    local_product_id: 23,
    local_variant_id: 24,
  };
  const context = {
    protocol: "m9-local-variant-photo-1",
    origin: "http://127.0.0.1:9417",
    revision: "a".repeat(64),
    own_image_id: 0,
    parent: {
      id: 23,
      type: "variable",
      status: "draft",
      variations: [24, 25],
      images: [{ id: 19 }],
      meta_data: [{ key: "_mi_tienda_product_id", value: pid }],
    },
    variant: {
      id: 24,
      sku: "LAB-0001",
      regular_price: "820.00",
      attributes,
      image: { id: 19 },
      meta_data: [
        { key: "_mi_tienda_variant_id", value: vid },
        { key: "_mi_tienda_barcode", value: "0001" },
      ],
    },
    media: [{ id: 19, sha256: proof.sha256, alt: "" }],
  };
  return [context, binding, proof];
}
it("distinguishes an inherited visible cover from an explicitly assigned own image", () => {
  const f = fixture(),
    before = JSON.stringify(f);
  const p = prepareLocalVariantPhoto(...f);
  expect(p.state).toBe("ASSIGN_EXISTING_PHOTO");
  expect(p.before_own_image_id).toBe(0);
  expect(p.barcode).toBe("0001");
  expect(p.remote_dispatch_allowed).toBe(false);
  expect(p.upload_allowed).toBe(false);
  expect(prepareLocalVariantPhoto(...f)).toEqual(p);
  expect(JSON.stringify(f)).toBe(before);
  f[0].own_image_id = 19;
  expect(prepareLocalVariantPhoto(...f).state).toBe("ALREADY_ASSIGNED");
});
it("holds changed identities, price, size, existing photos and ambiguous attachments", () => {
  for (const change of [
    (f) => (f[0].origin = "https://vaquerosm.com"),
    (f) => (f[0].parent.status = "publish"),
    (f) => (f[0].variant.meta_data[1].value = "1"),
    (f) => (f[1].barcode = "1"),
    (f) => (f[0].variant.regular_price = "1"),
    (f) => (f[0].variant.sku = "other"),
    (f) => (f[0].parent.variations = []),
    (f) => (f[1].local_variant_id = 25),
    (f) => (f[0].variant.attributes = [{ name: "Talla", option: "M" }]),
    (f) => (f[0].own_image_id = 20),
    (f) => delete f[0].own_image_id,
    (f) => {
      f[0].media.push({ ...f[0].media[0], id: 20 });
      f[0].parent.images.push({ id: 20 });
    },
    (f) => (f[0].parent.images = []),
    (f) => (f[0].media[0].alt = "changed"),
    (f) => (f[2].sha256 = "b".repeat(64)),
    (f) => (f[2].mime = "image/png"),
    (f) => f[2].bytes++,
  ]) {
    const f = fixture();
    change(f);
    expect(() => prepareLocalVariantPhoto(...f)).toThrow();
  }
});

it("requires the explicit recorded operation for a legacy local parent receipt", () => {
  const f = fixture();
  f[0].parent.meta_data = [
    { key: "_mi_tienda_test_operation", value: "c".repeat(64) },
  ];
  expect(() => prepareLocalVariantPhoto(...f)).toThrow();
  f[1].parent_operation = "c".repeat(64);
  expect(prepareLocalVariantPhoto(...f).state).toBe("ASSIGN_EXISTING_PHOTO");
  f[0].parent.meta_data.push({ key: "_mi_tienda_product_id", value: "wrong" });
  expect(() => prepareLocalVariantPhoto(...f)).toThrow();
});
it("rejects duplicate identity metadata and oversize/truncated evidence", () => {
  for (const change of [
    (f) => f[0].variant.meta_data.push({ ...f[0].variant.meta_data[1] }),
    (f) => f[0].media.push({ ...f[0].media[0] }),
    (f) => (f[2].bytes_buffer = Buffer.alloc(4194305)),
    (f) => (f[2].bytes_buffer = Buffer.alloc(0)),
  ]) {
    const f = fixture();
    change(f);
    expect(() => prepareLocalVariantPhoto(...f)).toThrow();
  }
});
