import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { prepareRemoteVariantPhotos } from "../../scripts/m9/woo-remote/prepare-variant-photo.mjs";
import {
  remoteClient,
  TEST_ORIGIN,
} from "../../scripts/m9/woo-remote/client.mjs";
const id = "97c82026-b3cc-4c60-8f22-13d7c00fb33a",
  product = "14f3af61-18f0-4adb-b1d8-29b447ae9cdb";
const bytes = Buffer.from([255, 216, 255, 0]),
  sha = createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const variants = [0, 1].map((i) => ({
    variant_id: `33333333-3333-4333-8333-33333333333${i}`,
    barcode: `000${i}`,
    price_cents: 82000,
    attributes: { TALLA: i ? "M" : "S" },
  }));
  const packet = {
    protocol: "m9-remote-family-1",
    request_id: id,
    product_id: product,
    variants,
  };
  const receipt = {
    ...packet,
    state: "SUCCEEDED",
    remote_product_id: 25,
    verified: {
      variants: variants.map((v, i) => ({ ...v, remote_variation_id: 26 + i })),
    },
  };
  const remote = {
    protocol: "m9-remote-variant-photo-read-1",
    origin: TEST_ORIGIN,
    request_id: id,
    product_id: product,
    woo_product_id: 25,
    complete: true,
    write_enabled: false,
    revision: "a".repeat(64),
    gallery_revision: "b".repeat(64),
    images: [{ id: 31, sha256: sha, alt: "Camisa" }],
    variants: variants.map((v, i) => ({
      ...v,
      woo_variant_id: 26 + i,
      own_image_id: 0,
      own_image: null,
    })),
  };
  const source = variants.map((v) => ({
    variant_id: v.variant_id,
    barcode: v.barcode,
    state: "VERIFIED_OWN_PHOTO",
    sha256: sha,
    alt: "Camisa",
    bytes: Buffer.from(bytes),
  }));
  return {
    packet,
    receipt,
    remote,
    source,
    readPhoto: async () => ({ base64: bytes.toString("base64"), sha256: sha }),
  };
}
it("distinguishes inherited covers, verifies original bytes once and never authorizes dispatch", async () => {
  const f = fixture();
  let reads = 0;
  f.readPhoto = async () => {
    reads++;
    return { base64: bytes.toString("base64"), sha256: sha };
  };
  const before = JSON.stringify(f);
  const result = await prepareRemoteVariantPhotos(f);
  expect(result.variants.map((v) => v.state)).toEqual([
    "EXISTING_ATTACHMENT_CANDIDATE",
    "EXISTING_ATTACHMENT_CANDIDATE",
  ]);
  expect(result.variants.map((v) => v.barcode)).toEqual(["0000", "0001"]);
  expect(reads).toBe(1);
  expect(result.write_enabled).toBe(false);
  expect(result.variants.every((v) => !v.remote_dispatch_allowed)).toBe(true);
  expect(JSON.stringify(f)).toBe(before);
});
it.each([
  [
    "production",
    (f) => {
      f.remote.origin = "https://vaquerosm.com";
    },
  ],
  [
    "unapproved family",
    (f) => {
      f.packet.request_id = "11111111-1111-4111-8111-111111111111";
    },
  ],
  [
    "partial",
    (f) => {
      f.remote.variants.pop();
    },
  ],
  [
    "duplicate source",
    (f) => {
      f.source[1] = f.source[0];
    },
  ],
  [
    "duplicate remote child",
    (f) => {
      f.remote.variants[1].woo_variant_id = 26;
    },
  ],
  [
    "barcode normalization",
    (f) => {
      f.remote.variants[0].barcode = "0";
    },
  ],
  [
    "different size",
    (f) => {
      f.remote.variants[0].attributes = { TALLA: "XL" };
    },
  ],
  [
    "price change",
    (f) => {
      f.remote.variants[0].price_cents = 82001;
    },
  ],
  [
    "receipt child mismatch",
    (f) => {
      f.receipt.verified.variants[0].remote_variation_id = 999;
    },
  ],
  [
    "missing own field",
    (f) => {
      delete f.remote.variants[0].own_image_id;
    },
  ],
  [
    "inherited own mismatch",
    (f) => {
      f.remote.variants[0].own_image = { id: 31, sha256: sha, alt: "Camisa" };
    },
  ],
  [
    "remote bytes changed",
    (f) => {
      f.readPhoto = async () => ({ base64: "AA==", sha256: sha });
    },
  ],
  [
    "source bytes changed",
    (f) => {
      f.source[0].bytes = Buffer.from([0]);
    },
  ],
  [
    "source oversized",
    (f) => {
      f.source[0].bytes = Buffer.alloc(4194305);
    },
  ],
  [
    "write enabled",
    (f) => {
      f.remote.write_enabled = true;
    },
  ],
  [
    "duplicate gallery IDs",
    (f) => {
      f.remote.images.push({ ...f.remote.images[0] });
    },
  ],
])("rejects %s", async (_label, change) => {
  const f = fixture();
  change(f);
  await expect(prepareRemoteVariantPhotos(f)).rejects.toThrow();
});
it("retains absence and does not clear an existing own image", async () => {
  const f = fixture();
  f.source = f.source.map((v) => ({
    variant_id: v.variant_id,
    barcode: v.barcode,
    state: "NO_VARIATION_PHOTO",
  }));
  f.remote.variants[1].own_image_id = 31;
  f.remote.variants[1].own_image = { id: 31, sha256: sha, alt: "Camisa" };
  f.readPhoto = () => {
    throw Error("unneeded read");
  };
  expect(
    (await prepareRemoteVariantPhotos(f)).variants.map((v) => v.state),
  ).toEqual(["NO_OWN_PHOTO_RETAINED", "EXISTING_OWN_PHOTO_REVIEW"]);
});
it("reserves duplicate attachments, independent photos and existing different own photos", async () => {
  let f = fixture();
  f.remote.images.push({ id: 32, sha256: sha, alt: "Camisa" });
  expect((await prepareRemoteVariantPhotos(f)).variants[0].state).toBe(
    "AMBIGUOUS_ATTACHMENT_REVIEW",
  );
  f = fixture();
  f.remote.images[0].alt = "Otro";
  expect((await prepareRemoteVariantPhotos(f)).variants[0].state).toBe(
    "SEPARATE_ATTACHMENT_REQUIRED",
  );
  f = fixture();
  f.remote.variants[0].own_image_id = 32;
  f.remote.variants[0].own_image = {
    id: 32,
    sha256: "c".repeat(64),
    alt: "Otra",
  };
  expect((await prepareRemoteVariantPhotos(f)).variants[0].state).toBe(
    "EXISTING_OWN_PHOTO_REVIEW",
  );
  f = fixture();
  f.remote.variants[0].own_image_id = 31;
  f.remote.variants[0].own_image = { id: 31, sha256: sha, alt: "Camisa" };
  expect((await prepareRemoteVariantPhotos(f)).variants[0].state).toBe(
    "ALREADY_ASSIGNED",
  );
});
it("only exposes GET for the two pilot families, with isolation preflight", async () => {
  const calls = [];
  const client = remoteClient({
    origin: TEST_ORIGIN,
    username: "fixture",
    password: "fixture",
    transport: async (url, options) => {
      calls.push({ url, method: options.method, redirect: options.redirect });
      return {
        ok: true,
        json: async () =>
          url.endsWith("isolation")
            ? {
                protocol: "m9-remote-draft-1",
                origin: TEST_ORIGIN,
                mail_blocked: true,
                outbound_blocked: true,
                purchase_blocked: true,
                orders_blocked: true,
                payment_gateways: 0,
              }
            : { complete: true },
      };
    },
  });
  await expect(
    client.variantPhotos("11111111-1111-4111-8111-111111111111"),
  ).rejects.toThrow("VARIANT_PHOTO_PILOT_REQUIRED");
  expect(calls).toHaveLength(0);
  await client.variantPhotos(id);
  expect(calls).toHaveLength(2);
  expect(calls.every((c) => c.method === "GET" && c.redirect === "error")).toBe(
    true,
  );
  expect(calls[1].url).toBe(
    `${TEST_ORIGIN}/wp-json/m9-test/v1/variant-photos/${id}`,
  );
});
