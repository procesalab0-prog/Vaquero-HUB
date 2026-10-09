import { prepareGalleryPull } from "./pull-gallery.mjs";
import { fetchPhoto } from "./process-job.mjs";

// Verify identity and the live remote bytes using the inbound reader, then
// compare both sides against a server-owned checkpoint. No inferred links.
export async function prepareGalleryPush({
  packet,
  receipt,
  remote,
  current,
  checkpoint,
  readPhoto = fetchPhoto,
}) {
  if (!checkpoint?.length) throw new Error("GALLERY_CHECKPOINT_REQUIRED");
  await prepareGalleryPull({
    packet,
    receipt,
    remote,
    current: { images: remote.images },
    readPhoto: async (url) => {
      const found = remote.images.find((i) => i.url === url);
      if (!found) throw new Error("GALLERY_IMAGE_REVIEW");
      return readPhoto(url, undefined, true);
    },
  });
  if (
    !Array.isArray(current.images) ||
    current.images.length < 1 ||
    current.images.length > 20
  )
    throw new Error("GALLERY_CONTENT_REVIEW");
  const images = [];
  let size = 0;
  for (const image of current.images) {
    if (typeof image.alt !== "string" || image.alt.length > 500)
      throw new Error("GALLERY_IMAGE_REVIEW");
    const photo = await readPhoto(image.url);
    size += Buffer.from(photo.base64, "base64").length;
    if (size > 16 * 1024 * 1024) throw new Error("GALLERY_TOTAL_LIMIT");
    images.push({ ...photo, alt: image.alt });
  }
  if (new Set(images.map((i) => i.sha256)).size !== images.length)
    throw new Error("GALLERY_CONTENT_REVIEW");
  const sig = (items) => JSON.stringify(items.map((i) => [i.sha256, i.alt]));
  const common = images.map(({ sha256, alt }) => ({ sha256, alt }));
  if (sig(common) === sig(remote.images))
    return { unchanged: true, images: [], common, revision: remote.revision };
  if (sig(remote.images) !== sig(checkpoint))
    throw new Error("GALLERY_BOTH_CHANGED_REVIEW");
  if (checkpoint.some((old) => !images.some((i) => i.sha256 === old.sha256)))
    throw new Error("GALLERY_REMOVAL_REVIEW");
  return { unchanged: false, images, common, revision: remote.revision };
}
