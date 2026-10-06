import { createHash } from "node:crypto";
import { TEST_ORIGIN } from "./client.mjs";

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sha = /^[0-9a-f]{64}$/;
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const requireValue = (ok, code) => {
  if (!ok) throw new Error(code);
};

// Pure planning only. Inputs must be assembled by a trusted reader, not accepted
// from browser assertions. A worker must re-read BOTH sides before applying a plan.
function identity(binding) {
  requireValue(
    binding?.origin === TEST_ORIGIN &&
      uuid.test(binding.product_id) &&
      Number.isSafeInteger(binding.woo_product_id) &&
      binding.woo_product_id > 0 &&
      binding.match === "verified" &&
      sha.test(binding.evidence_sha256),
    "VERIFIED_TEST_BINDING_REQUIRED",
  );
  requireValue(
    Array.isArray(binding.barcodes) &&
      binding.barcodes.length > 0 &&
      binding.barcodes.every(
        (code) =>
          typeof code === "string" &&
          code.length > 0 &&
          code.length <= 100 &&
          code === code.trim(),
      ) &&
      new Set(binding.barcodes).size === binding.barcodes.length,
    "LITERAL_UNIQUE_BARCODES_REQUIRED",
  );
  return {
    origin: binding.origin,
    product_id: binding.product_id,
    woo_product_id: binding.woo_product_id,
    barcodes: [...binding.barcodes].sort(),
    evidence_sha256: binding.evidence_sha256,
  };
}

function snapshot(value, expectedIdentity) {
  requireValue(value?.complete === true, "COMPLETE_GALLERY_REQUIRED");
  requireValue(
    value.identity_sha256 === expectedIdentity,
    "GALLERY_IDENTITY_MISMATCH",
  );
  requireValue(
    typeof value.revision === "string" &&
      value.revision.length > 0 &&
      value.revision.length <= 200,
    "GALLERY_REVISION_REQUIRED",
  );
  requireValue(
    Array.isArray(value.images) && value.images.length <= 20,
    "INVALID_GALLERY",
  );
  const images = value.images.map((item) => {
    requireValue(
      sha.test(item?.sha256) &&
        typeof item.alt === "string" &&
        item.alt.length <= 1000,
      "INVALID_GALLERY_IMAGE",
    );
    // Compare bytes and editorial order/alt, never URLs, names or attachment IDs.
    // Woo and Mi Tienda necessarily have different storage locations and IDs.
    return { sha256: item.sha256, alt: item.alt };
  });
  requireValue(
    new Set(images.map((item) => item.sha256)).size === images.length,
    "DUPLICATE_GALLERY_IMAGE",
  );
  return { revision: value.revision, images, content_sha256: digest(images) };
}

export function photoIdentityHash(binding) {
  return digest(identity(binding));
}

export function planPhotoSync({ binding, miTienda, woo, baseline = null }) {
  const identity_sha256 = photoIdentityHash(binding);
  const local = snapshot(miTienda, identity_sha256);
  const remote = snapshot(woo, identity_sha256);
  let previous = null;
  if (baseline !== null) {
    requireValue(
      baseline.identity_sha256 === identity_sha256,
      "BASELINE_IDENTITY_MISMATCH",
    );
    previous = {
      local: snapshot(baseline.miTienda, identity_sha256),
      remote: snapshot(baseline.woo, identity_sha256),
    };
    requireValue(
      previous.local.content_sha256 === previous.remote.content_sha256,
      "BASELINE_NOT_SYNCHRONIZED",
    );
  }
  const same = local.content_sha256 === remote.content_sha256;
  let action = "REVIEW_REQUIRED";
  let reason = "INITIAL_GALLERIES_DIFFER";
  if (same) {
    action = "IN_SYNC";
    reason = "SAME_CONTENT_AND_ORDER";
  } else if (!previous) {
    if (local.images.length === 0) {
      action = "PULL_FROM_WOO";
      reason = "INITIAL_WOO_GALLERY";
    } else if (remote.images.length === 0) {
      action = "PUSH_TO_WOO";
      reason = "INITIAL_MI_TIENDA_GALLERY";
    }
  } else {
    const localChanged = local.content_sha256 !== previous.local.content_sha256;
    const remoteChanged =
      remote.content_sha256 !== previous.remote.content_sha256;
    if (localChanged && remoteChanged) {
      reason = "BOTH_SIDES_CHANGED";
    } else {
      const changed = localChanged ? local : remote;
      const old = localChanged ? previous.local : previous.remote;
      const hashes = new Set(changed.images.map((image) => image.sha256));
      if (old.images.some((image) => !hashes.has(image.sha256))) {
        reason = "REMOVAL_OR_REPLACEMENT_REQUIRES_REVIEW";
      } else {
        action = localChanged ? "PUSH_TO_WOO" : "PULL_FROM_WOO";
        reason = "ONE_SIDE_CHANGED";
      }
    }
  }
  const plan = {
    protocol: "m9-photo-plan-1",
    identity_sha256,
    action,
    reason,
    expected: { miTienda: local, woo: remote },
    baseline_sha256: digest(previous),
    // Explicitly not an executable network command, nor authorization to write.
    writes_performed: 0,
  };
  return { ...plan, plan_sha256: digest(plan) };
}

export function assertPhotoPlanFresh(
  plan,
  { binding, miTienda, woo, baseline = null },
) {
  const current = planPhotoSync({ binding, miTienda, woo, baseline });
  requireValue(
    current.plan_sha256 === plan?.plan_sha256 &&
      digest(plan) === digest(current),
    "PHOTO_PLAN_STALE_OR_CHANGED",
  );
  requireValue(
    ["PULL_FROM_WOO", "PUSH_TO_WOO"].includes(current.action),
    "PHOTO_PLAN_NOT_ACTIONABLE",
  );
  return current;
}
