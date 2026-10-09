import { TEST_ORIGIN } from "./client.mjs";

export const VARIANT_PHOTO_WRITE_PROTOCOL = "m9-remote-variant-photo-write-1";
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const scopes = {
  "97c82026-b3cc-4c60-8f22-13d7c00fb33a": {
    codes: ["10581", "10582", "10583", "10584", "10585"],
    sha: "a4d55159c147562de6d990134c1f9259d96be3a3a107c748d362d7db7b6f0c25",
  },
  "ba239bba-7691-43cc-9c76-8768a1af9f21": {
    codes: ["10315", "10316", "10317", "10324", "10325"],
    sha: "812a400b0264f59b6eb90a04d98f2a1c9c3ceb269312076480b4a9daf0438ec5",
  },
};
const exactKeys = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...keys].sort().join(",");
export function validateVariantPhotoPacket(p) {
  if (
    !exactKeys(p, [
      "protocol",
      "update_id",
      "parent_id",
      "expected_revision",
      "gallery_revision",
      "assignments",
    ]) ||
    p.protocol !== VARIANT_PHOTO_WRITE_PROTOCOL ||
    !uuid.test(p.update_id) ||
    !scopes[p.parent_id] ||
    !sha.test(p.expected_revision) ||
    !sha.test(p.gallery_revision) ||
    !Array.isArray(p.assignments) ||
    p.assignments.length !== 5
  )
    throw Error("VARIANT_PHOTO_PACKET_INVALID");
  const scope = scopes[p.parent_id];
  for (const a of p.assignments) {
    if (
      !exactKeys(a, [
        "variant_id",
        "barcode",
        "woo_variant_id",
        "image_id",
        "sha256",
        "alt",
      ]) ||
      !uuid.test(a.variant_id) ||
      !scope.codes.includes(a.barcode) ||
      !Number.isSafeInteger(a.woo_variant_id) ||
      a.woo_variant_id < 1 ||
      !Number.isSafeInteger(a.image_id) ||
      a.image_id < 0 ||
      (a.barcode === "10324"
        ? a.image_id !== 0 || a.sha256 !== null || a.alt !== null
        : a.image_id < 1 || a.sha256 !== scope.sha || a.alt !== "")
    )
      throw Error("VARIANT_PHOTO_ASSIGNMENT_INVALID");
  }
  for (const k of ["variant_id", "barcode", "woo_variant_id"]) {
    if (new Set(p.assignments.map((a) => a[k])).size !== 5)
      throw Error("VARIANT_PHOTO_ASSIGNMENT_DUPLICATE");
  }
  return p;
}

// Server-owned inputs only: preparation must have just verified the original
// local and authenticated remote bytes. Never accept these inputs from a form.
// Produces a packet; performs no network operation and grants no approval.
export function planRemoteVariantAssignments({
  preparation,
  remote,
  updateId,
}) {
  if (
    preparation?.protocol !== "m9-remote-variant-photo-preparation-1" ||
    remote?.protocol !== "m9-remote-variant-photo-read-1" ||
    remote.origin !== TEST_ORIGIN ||
    remote.complete !== true ||
    remote.write_enabled !== false ||
    preparation.write_enabled !== false ||
    preparation.upload_allowed !== false ||
    preparation.request_id !== remote.request_id ||
    preparation.product_id !== remote.product_id ||
    preparation.revision !== remote.revision ||
    preparation.gallery_revision !== remote.gallery_revision ||
    preparation.variants?.length !== 5 ||
    remote.variants?.length !== 5
  )
    throw Error("VARIANT_PHOTO_PREPARATION_STALE");
  const assignments = preparation.variants.map((v) => {
    const live = remote.variants.filter(
      (r) =>
        r.variant_id === v.variant_id &&
        r.barcode === v.barcode &&
        r.woo_variant_id === v.woo_variant_id,
    );
    if (
      live.length !== 1 ||
      v.own_image_id !== live[0].own_image_id ||
      v.remote_dispatch_allowed !== false
    )
      throw Error("VARIANT_PHOTO_IDENTITY_REVIEW");
    if (
      v.state === "NO_OWN_PHOTO_RETAINED" &&
      v.barcode === "10324" &&
      live[0].own_image_id === 0 &&
      live[0].own_image === null
    ) {
      return {
        variant_id: v.variant_id,
        barcode: v.barcode,
        woo_variant_id: v.woo_variant_id,
        image_id: 0,
        sha256: null,
        alt: null,
      };
    }
    if (
      !["EXISTING_ATTACHMENT_CANDIDATE", "ALREADY_ASSIGNED"].includes(v.state)
    )
      throw Error("VARIANT_PHOTO_MANUAL_REVIEW");
    const image = remote.images.filter((i) => i.id === v.image_id);
    if (
      image.length !== 1 ||
      remote.images.filter(
        (i) => i.sha256 === image[0].sha256 && i.alt === image[0].alt,
      ).length !== 1 ||
      (live[0].own_image_id !== 0 && live[0].own_image_id !== image[0].id)
    )
      throw Error("VARIANT_PHOTO_ATTACHMENT_REVIEW");
    return {
      variant_id: v.variant_id,
      barcode: v.barcode,
      woo_variant_id: v.woo_variant_id,
      image_id: image[0].id,
      sha256: image[0].sha256,
      alt: image[0].alt,
    };
  });
  return validateVariantPhotoPacket({
    protocol: VARIANT_PHOTO_WRITE_PROTOCOL,
    update_id: updateId,
    parent_id: remote.request_id,
    expected_revision: remote.revision,
    gallery_revision: remote.gallery_revision,
    assignments,
  });
}
