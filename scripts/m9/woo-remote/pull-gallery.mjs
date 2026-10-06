import { TEST_ORIGIN } from "./client.mjs";
import { fetchPhoto } from "./process-job.mjs";

// Only adopt photos into an unchanged initial gallery, or recognize an exact
// repeat. A later divergent edit requires review until a durable baseline exists.
export async function prepareGalleryPull({
  packet,
  receipt,
  remote,
  current,
  readPhoto = fetchPhoto,
}) {
  if (
    receipt.state !== "SUCCEEDED" ||
    receipt.product_id !== packet.product_id ||
    remote.origin !== TEST_ORIGIN ||
    remote.product_id !== packet.product_id ||
    remote.woo_product_id !== receipt.remote_product_id ||
    remote.barcode !== packet.barcode ||
    receipt.verified?.barcode !== packet.barcode ||
    remote.complete !== true ||
    typeof remote.revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(remote.revision)
  )
    throw new Error("GALLERY_IDENTITY_REVIEW");
  if (
    !Array.isArray(remote.images) ||
    remote.images.length < 1 ||
    remote.images.length > 20 ||
    new Set(remote.images.map((i) => i.id)).size !== remote.images.length ||
    new Set(remote.images.map((i) => i.sha256)).size !== remote.images.length
  )
    throw new Error("GALLERY_CONTENT_REVIEW");
  const incoming = [];
  let total = 0;
  for (const image of remote.images) {
    const url = new URL(image.url);
    if (
      !Number.isSafeInteger(image.id) ||
      image.id < 1 ||
      url.origin !== TEST_ORIGIN ||
      url.username ||
      url.password ||
      !url.pathname.startsWith("/wp-content/uploads/") ||
      typeof image.alt !== "string" ||
      image.alt.length > 500 ||
      !/^[a-f0-9]{64}$/.test(image.sha256)
    )
      throw new Error("GALLERY_IMAGE_REVIEW");
    const photo = await readPhoto(image.url, undefined, true);
    if (photo.sha256 !== image.sha256) throw new Error("GALLERY_HASH_CHANGED");
    total += Buffer.from(photo.base64, "base64").length;
    if (total > 16 * 1024 * 1024) throw new Error("GALLERY_TOTAL_LIMIT");
    incoming.push({ ...photo, alt: image.alt });
  }
  const local = [];
  for (const image of current.images) {
    const photo = await readPhoto(image.url);
    local.push({ sha256: photo.sha256, alt: image.alt });
  }
  const signature = (images) =>
    JSON.stringify(images.map((i) => [i.sha256, i.alt]));
  if (signature(local) === signature(incoming))
    return { unchanged: true, images: [], revision: remote.revision };
  const baseline = [
    {
      sha256: receipt.verified.image_sha256,
      alt: packet.content.images[0].alt,
    },
  ];
  if (signature(local) !== signature(baseline))
    throw new Error("GALLERY_BOTH_CHANGED_REVIEW");
  if (!incoming.some((i) => i.sha256 === baseline[0].sha256))
    throw new Error("GALLERY_REMOVAL_REVIEW");
  return { unchanged: false, images: incoming, revision: remote.revision };
}
