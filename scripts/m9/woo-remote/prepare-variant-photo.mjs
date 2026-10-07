import { createHash } from "node:crypto";
import { TEST_ORIGIN, FAMILY_PROTOCOL } from "./client.mjs";
const pilots = new Set([
  "97c82026-b3cc-4c60-8f22-13d7c00fb33a",
  "ba239bba-7691-43cc-9c76-8768a1af9f21",
]);
const check = (ok, code) => {
  if (!ok) throw Error(code);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const attrs = (a) =>
  Object.entries(a ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const sha = (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
// Prepare only. No transport for writes, no upload, and no new identity approval.
export async function prepareRemoteVariantPhotos({
  packet,
  receipt,
  remote,
  source,
  readPhoto,
}) {
  check(
    packet?.protocol === FAMILY_PROTOCOL &&
      pilots.has(packet.request_id) &&
      receipt?.state === "SUCCEEDED" &&
      receipt.protocol === FAMILY_PROTOCOL &&
      receipt.request_id === packet.request_id &&
      receipt.product_id === packet.product_id &&
      remote?.protocol === "m9-remote-variant-photo-read-1" &&
      remote.origin === TEST_ORIGIN &&
      remote.request_id === packet.request_id &&
      remote.product_id === packet.product_id &&
      remote.woo_product_id === receipt.remote_product_id &&
      remote.complete === true &&
      remote.write_enabled === false &&
      sha(remote.revision) &&
      sha(remote.gallery_revision),
    "REMOTE_VARIANT_PHOTO_IDENTITY",
  );
  check(
    Array.isArray(packet.variants) &&
      packet.variants.length >= 2 &&
      packet.variants.length <= 100 &&
      Array.isArray(remote.variants) &&
      Array.isArray(receipt.verified?.variants) &&
      Array.isArray(source) &&
      remote.variants.length === packet.variants.length &&
      receipt.verified.variants.length === packet.variants.length &&
      source.length === packet.variants.length,
    "REMOTE_VARIANT_PHOTO_COMPLETE",
  );
  for (const rows of [
    packet.variants,
    remote.variants,
    receipt.verified.variants,
    source,
  ]) {
    check(
      new Set(rows.map((v) => v.variant_id)).size === rows.length &&
        new Set(rows.map((v) => v.barcode)).size === rows.length,
      "REMOTE_VARIANT_PHOTO_DUPLICATE",
    );
  }
  check(
    Array.isArray(remote.images) &&
      remote.images.length > 0 &&
      remote.images.length <= 20 &&
      new Set(remote.images.map((i) => i.id)).size === remote.images.length &&
      remote.images.every(
        (i) =>
          Number.isSafeInteger(i.id) &&
          i.id > 0 &&
          sha(i.sha256) &&
          typeof i.alt === "string",
      ),
    "REMOTE_VARIANT_PHOTO_GALLERY",
  );
  check(
    new Set(remote.variants.map((v) => v.woo_variant_id)).size ===
      remote.variants.length,
    "REMOTE_VARIANT_PHOTO_DUPLICATE",
  );
  const results = [];
  const checked = new Map();
  for (const expected of packet.variants) {
    const live = remote.variants.find(
      (v) => v.variant_id === expected.variant_id,
    );
    const saved = receipt.verified.variants.find(
      (v) => v.variant_id === expected.variant_id,
    );
    const photo = source.find((v) => v.variant_id === expected.variant_id);
    check(
      live &&
        saved &&
        photo &&
        typeof expected.barcode === "string" &&
        expected.barcode.length > 0 &&
        expected.barcode === expected.barcode.trim() &&
        live.barcode === expected.barcode &&
        saved.barcode === expected.barcode &&
        photo.barcode === expected.barcode &&
        Number.isSafeInteger(expected.price_cents) &&
        expected.price_cents >= 0 &&
        expected.price_cents <= 100000000 &&
        live.woo_variant_id === saved.remote_variation_id &&
        Number.isSafeInteger(live.woo_variant_id) &&
        live.woo_variant_id > 0 &&
        live.price_cents === expected.price_cents &&
        saved.price_cents === expected.price_cents &&
        same(attrs(live.attributes), attrs(expected.attributes)) &&
        same(attrs(saved.attributes), attrs(expected.attributes)) &&
        Number.isSafeInteger(live.own_image_id) &&
        live.own_image_id >= 0 &&
        (live.own_image_id === 0
          ? live.own_image === null
          : live.own_image?.id === live.own_image_id &&
            sha(live.own_image.sha256) &&
            typeof live.own_image.alt === "string"),
      "REMOTE_VARIANT_PHOTO_BINDING",
    );
    let state,
      image_id = null;
    if (photo.state === "NO_VARIATION_PHOTO") {
      state =
        live.own_image_id === 0
          ? "NO_OWN_PHOTO_RETAINED"
          : "EXISTING_OWN_PHOTO_REVIEW";
    } else {
      check(
        photo.state === "VERIFIED_OWN_PHOTO" &&
          sha(photo.sha256) &&
          typeof photo.alt === "string" &&
          Buffer.isBuffer(photo.bytes) &&
          photo.bytes.length > 0 &&
          photo.bytes.length <= 4194304 &&
          createHash("sha256").update(photo.bytes).digest("hex") ===
            photo.sha256,
        "REMOTE_VARIANT_PHOTO_SOURCE_BYTES",
      );
      const matches = remote.images.filter(
        (i) => i.sha256 === photo.sha256 && i.alt === photo.alt,
      );
      if (
        live.own_image_id !== 0 &&
        (live.own_image.sha256 !== photo.sha256 ||
          live.own_image.alt !== photo.alt)
      )
        state = "EXISTING_OWN_PHOTO_REVIEW";
      else if (matches.length > 1) state = "AMBIGUOUS_ATTACHMENT_REVIEW";
      else if (matches.length === 0) state = "SEPARATE_ATTACHMENT_REQUIRED";
      else {
        const image = matches[0];
        if (!checked.has(image.id)) {
          check(
            typeof readPhoto === "function",
            "AUTHENTICATED_PHOTO_READER_REQUIRED",
          );
          const read = await readPhoto(packet.request_id, image.id);
          const bytes =
            typeof read?.base64 === "string"
              ? Buffer.from(read.base64, "base64")
              : Buffer.alloc(0);
          check(
            bytes.length > 0 &&
              bytes.length <= 4194304 &&
              bytes.toString("base64") === read.base64 &&
              read.sha256 === photo.sha256 &&
              createHash("sha256").update(bytes).digest("hex") ===
                photo.sha256 &&
              bytes.equals(photo.bytes),
            "REMOTE_VARIANT_PHOTO_BYTES_CHANGED",
          );
          checked.set(image.id, true);
        }
        image_id = image.id;
        state =
          live.own_image_id === image.id
            ? "ALREADY_ASSIGNED"
            : live.own_image_id === 0
              ? "EXISTING_ATTACHMENT_CANDIDATE"
              : "EXISTING_OWN_PHOTO_REVIEW";
      }
    }
    results.push({
      variant_id: expected.variant_id,
      barcode: expected.barcode,
      woo_variant_id: live.woo_variant_id,
      own_image_id: live.own_image_id,
      image_id,
      state,
      remote_dispatch_allowed: false,
    });
  }
  return {
    protocol: "m9-remote-variant-photo-preparation-1",
    request_id: packet.request_id,
    product_id: packet.product_id,
    revision: remote.revision,
    gallery_revision: remote.gallery_revision,
    variants: results,
    authenticated_photos_verified: checked.size,
    write_enabled: false,
    upload_allowed: false,
  };
}
