import { createHash } from "node:crypto";
import { hash } from "./plan.mjs";

const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const check = (ok, code) => {
  if (!ok) throw Error(code);
};
// Trusted local reader + explicit source binding + actual verified bytes only.
// No transport, uploads, inferred name matching or production IDs.
export function prepareLocalVariantPhoto(context, binding, proof) {
  check(
    context?.protocol === "m9-local-variant-photo-1" &&
      context.origin === "http://127.0.0.1:9417" &&
      sha.test(context.revision),
    "LOCAL_PHOTO_CONTEXT_REQUIRED",
  );
  const p = context.parent,
    v = context.variant;
  const meta = (item, key) => {
    const found = item?.meta_data?.filter((m) => m.key === key);
    return found?.length === 1 ? found[0].value : null;
  };
  check(
    uuid.test(binding?.product_id) &&
      uuid.test(binding.variant_id) &&
      typeof binding.barcode === "string" &&
      binding.barcode.length > 0 &&
      binding.barcode === binding.barcode.trim() &&
      Number.isSafeInteger(binding.price_cents),
    "LITERAL_LOCAL_BINDING_REQUIRED",
  );
  check(
    p?.id === binding.local_product_id &&
      v?.id === binding.local_variant_id &&
      p.type === "variable" &&
      p.status === "draft" &&
      p.variations?.includes(v.id) &&
      (meta(p, "_mi_tienda_product_id") === binding.product_id ||
        // The original local worker recorded the parent operation, not its UUID.
        // Its explicit successful receipt/compiled plan supplies this binding.
        (p.meta_data?.filter((m) => m.key === "_mi_tienda_product_id")
          .length === 0 &&
          sha.test(binding.parent_operation) &&
          meta(p, "_mi_tienda_test_operation") === binding.parent_operation)) &&
      meta(v, "_mi_tienda_variant_id") === binding.variant_id &&
      meta(v, "_mi_tienda_barcode") === binding.barcode &&
      v.sku === binding.sku &&
      hash(v.attributes?.map(({ name, option }) => ({ name, option }))) ===
        hash(binding.attributes) &&
      typeof v.regular_price === "string" &&
      /^\d+(\.\d{1,2})?$/.test(v.regular_price) &&
      Math.round(Number(v.regular_price) * 100) === binding.price_cents,
    "LOCAL_VARIANT_IDENTITY_REVIEW",
  );
  const bytes = proof?.bytes_buffer;
  const magic =
    Buffer.isBuffer(bytes) &&
    ((proof.mime === "image/jpeg" &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255) ||
      (proof.mime === "image/png" &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (proof.mime === "image/webp" &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP"));
  check(
    magic &&
      bytes.length > 0 &&
      bytes.length <= 4194304 &&
      bytes.length === proof.bytes &&
      sha.test(proof.sha256) &&
      createHash("sha256").update(bytes).digest("hex") === proof.sha256 &&
      typeof proof.alt === "string",
    "LOCAL_PHOTO_BYTES_REQUIRED",
  );
  check(
    Array.isArray(context.media) &&
      context.media.length <= 20 &&
      new Set(context.media.map((m) => m.id)).size === context.media.length,
    "LOCAL_MEDIA_REVIEW",
  );
  const media = context.media.filter(
    (m) =>
      m.sha256 === proof.sha256 &&
      m.alt === proof.alt &&
      p.images?.some((i) => i.id === m.id),
  );
  check(media.length === 1, "VERIFIED_PARENT_ATTACHMENT_REQUIRED");
  check(
    Number.isSafeInteger(context.own_image_id) && context.own_image_id >= 0,
    "OWN_VARIANT_IMAGE_REQUIRED",
  );
  check(
    context.own_image_id === 0 || context.own_image_id === media[0].id,
    "EXISTING_VARIANT_PHOTO_REVIEW",
  );
  return {
    protocol: "m9-local-variant-photo-plan-1",
    origin: context.origin,
    product_id: p.id,
    variant_id: v.id,
    barcode: binding.barcode,
    expected_revision: context.revision,
    source_binding_sha256: hash(binding),
    image_id: media[0].id,
    image_sha256: proof.sha256,
    image_alt: proof.alt,
    before_own_image_id: context.own_image_id,
    state:
      context.own_image_id === media[0].id
        ? "ALREADY_ASSIGNED"
        : "ASSIGN_EXISTING_PHOTO",
    upload_allowed: false,
    production_allowed: false,
    remote_dispatch_allowed: false,
  };
}
