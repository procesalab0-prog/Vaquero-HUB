import { expect, it } from "vitest";
import { TEST_ORIGIN } from "../../scripts/m9/woo-remote/client.mjs";
import {
  planRemoteVariantAssignments,
  validateVariantPhotoPacket,
} from "../../scripts/m9/woo-remote/variant-photo-packet.mjs";
const id = "97c82026-b3cc-4c60-8f22-13d7c00fb33a";
const second = "ba239bba-7691-43cc-9c76-8768a1af9f21";
const hash = "a4d55159c147562de6d990134c1f9259d96be3a3a107c748d362d7db7b6f0c25";
function fixture(two = false) {
  const codes = two
    ? ["10315", "10316", "10317", "10324", "10325"]
    : ["10581", "10582", "10583", "10584", "10585"];
  const variants = codes.map((barcode, i) => ({
    variant_id: `33333333-3333-4333-8333-33333333333${i}`,
    barcode,
    woo_variant_id: 26 + i,
    own_image_id: 0,
    own_image: null,
  }));
  const remote = {
    protocol: "m9-remote-variant-photo-read-1",
    origin: TEST_ORIGIN,
    request_id: two ? second : id,
    product_id: "14f3af61-18f0-4adb-b1d8-29b447ae9cdb",
    complete: true,
    write_enabled: false,
    revision: "a".repeat(64),
    gallery_revision: "b".repeat(64),
    images: [
      {
        id: 31,
        sha256: two
          ? "812a400b0264f59b6eb90a04d98f2a1c9c3ceb269312076480b4a9daf0438ec5"
          : hash,
        alt: "",
      },
    ],
    variants,
  };
  const preparation = {
    protocol: "m9-remote-variant-photo-preparation-1",
    request_id: remote.request_id,
    product_id: remote.product_id,
    revision: remote.revision,
    gallery_revision: remote.gallery_revision,
    write_enabled: false,
    upload_allowed: false,
    variants: variants.map((v) => ({
      ...v,
      state:
        v.barcode === "10324"
          ? "NO_OWN_PHOTO_RETAINED"
          : "EXISTING_ATTACHMENT_CANDIDATE",
      image_id: v.barcode === "10324" ? null : 31,
      remote_dispatch_allowed: false,
    })),
  };
  return {
    remote,
    preparation,
    updateId: "11111111-1111-4111-8111-111111111111",
  };
}
it("plans exact five-variant packet without uploads, network or mutation", () => {
  const f = fixture(),
    before = JSON.stringify(f),
    p = planRemoteVariantAssignments(f);
  expect(validateVariantPhotoPacket(p)).toBe(p);
  expect(p.assignments).toHaveLength(5);
  expect(JSON.stringify(f)).toBe(before);
  expect(
    p.assignments.every((a) => a.sha256 === hash && a.image_id === 31),
  ).toBe(true);
  expect(Object.keys(p).sort()).toEqual(
    [
      "protocol",
      "update_id",
      "parent_id",
      "expected_revision",
      "gallery_revision",
      "assignments",
    ].sort(),
  );
});
it("preserves missing own photo of 10324 while preparing the other four", () => {
  const p = planRemoteVariantAssignments(fixture(true));
  expect(p.assignments.find((a) => a.barcode === "10324")).toMatchObject({
    image_id: 0,
    sha256: null,
    alt: null,
  });
});
it.each([
  ["production", (f) => (f.remote.origin = "https://vaquerosm.com")],
  ["stale context", (f) => (f.remote.revision = "c".repeat(64))],
  ["stale gallery", (f) => (f.remote.gallery_revision = "c".repeat(64))],
  [
    "another product",
    (f) => (f.remote.product_id = "33333333-3333-4333-8333-333333333333"),
  ],
  [
    "outside pilot",
    (f) => {
      f.remote.request_id = "11111111-1111-4111-8111-111111111111";
      f.preparation.request_id = f.remote.request_id;
    },
  ],
  ["partial evidence", (f) => f.preparation.variants.pop()],
  ["partial remote", (f) => f.remote.variants.pop()],
  ["changed barcode", (f) => (f.remote.variants[0].barcode = "010581")],
  ["different child", (f) => (f.remote.variants[0].woo_variant_id = 99)],
  ["changed own image", (f) => (f.remote.variants[0].own_image_id = 99)],
  [
    "ambiguous attachment",
    (f) => f.remote.images.push({ ...f.remote.images[0], id: 32 }),
  ],
  ["different bytes", (f) => (f.remote.images[0].sha256 = "c".repeat(64))],
  ["different alt", (f) => (f.remote.images[0].alt = "Another")],
  [
    "independent attachment required",
    (f) => (f.preparation.variants[0].state = "SEPARATE_ATTACHMENT_REQUIRED"),
  ],
  [
    "manual review",
    (f) => (f.preparation.variants[0].state = "EXISTING_OWN_PHOTO_REVIEW"),
  ],
  [
    "approved client input",
    (f) => (f.preparation.variants[0].remote_dispatch_allowed = true),
  ],
  ["upload enabled", (f) => (f.preparation.upload_allowed = true)],
  [
    "duplicate child",
    (f) => {
      f.preparation.variants[1].woo_variant_id =
        f.preparation.variants[0].woo_variant_id;
      f.remote.variants[1].woo_variant_id = f.remote.variants[0].woo_variant_id;
    },
  ],
])("rejects %s", (_label, change) => {
  const f = fixture();
  change(f);
  expect(() => planRemoteVariantAssignments(f)).toThrow();
});
it("already assigned images need no different attachment", () => {
  const f = fixture();
  f.remote.variants[0].own_image_id = 31;
  f.preparation.variants[0].own_image_id = 31;
  f.preparation.variants[0].state = "ALREADY_ASSIGNED";
  expect(planRemoteVariantAssignments(f).assignments[0].image_id).toBe(31);
});
it.each(["stock", "approval", "base64"])(
  "packet refuses extra %s fields",
  (key) => {
    const p = planRemoteVariantAssignments(fixture());
    p[key] = true;
    expect(() => validateVariantPhotoPacket(p)).toThrow();
  },
);
it("cannot fill the deliberately absent size", () => {
  const p = planRemoteVariantAssignments(fixture(true));
  p.assignments[3].image_id = 31;
  expect(() => validateVariantPhotoPacket(p)).toThrow();
});
