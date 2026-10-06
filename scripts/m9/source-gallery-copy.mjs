import { fetchPhoto } from "./woo-remote/process-job.mjs";
const storage =
  "https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/";
export async function prepareSourceGalleryCopy({
  productId,
  current,
  source,
  readPhoto = fetchPhoto,
}) {
  if (
    source.product_id !== productId ||
    !Number.isSafeInteger(source.woo_product_id) ||
    !Array.isArray(source.images)
  )
    throw new Error("SOURCE_IDENTITY_REVIEW");
  if (!Array.isArray(current.images) || current.images.length > 20)
    throw new Error("SOURCE_GALLERY_REVIEW");
  const allowed = new Set(source.images.map((i) => i.url));
  let total = 0;
  const photos = [];
  if (current.images.every((i) => i.url.startsWith(storage + productId + "/")))
    return { unchanged: true, photos: [] };
  for (const image of current.images) {
    if (
      !allowed.has(image.url) &&
      !image.url.startsWith(storage + productId + "/")
    )
      throw new Error("SOURCE_GALLERY_CHANGED_REVIEW");
    const photo = await readPhoto(image.url);
    total += Buffer.from(photo.base64, "base64").length;
    if (total > 16 * 1024 * 1024) throw new Error("SOURCE_GALLERY_LIMIT");
    photos.push({ ...photo, alt: image.alt });
  }
  if (new Set(photos.map((p) => p.sha256)).size !== photos.length)
    throw new Error("SOURCE_DUPLICATE_PHOTO_REVIEW");
  return { unchanged: false, photos };
}
