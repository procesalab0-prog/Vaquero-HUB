import { createHash } from "node:crypto";
import { fetchPhoto } from "./woo-remote/process-job.mjs";
import { parseVariantPhotoUrls } from "./prepare-variant-photos.mjs";
const origin =
  "https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/";
export async function prepareVariantPhotoCopy(ctx, readPhoto = fetchPhoto) {
  if (
    !ctx ||
    !/^[0-9a-f-]{36}$/.test(ctx.product_id) ||
    !Array.isArray(ctx.items) ||
    ctx.items.length > 200 ||
    new Set(ctx.items.map((x) => x.variant_id)).size !== ctx.items.length
  )
    throw Error("VARIANT_COPY_IDENTITY");
  const cache = new Map();
  const files = new Map();
  const items = [];
  let total = 0;
  for (const item of ctx.items) {
    if (!Array.isArray(item.photos) || item.photos.length > 20)
      throw Error("VARIANT_COPY_PHOTOS");
    if (!item.photos.length) continue;
    const photos = [];
    for (const p of item.photos) {
      if (
        !parseVariantPhotoUrls(p.url).valid ||
        parseVariantPhotoUrls(p.url).urls.length !== 1 ||
        !/^[a-f0-9]{64}$/.test(p.sha256) ||
        !Number.isSafeInteger(p.bytes) ||
        p.bytes < 1 ||
        p.bytes > 4194304 ||
        typeof p.alt !== "string" ||
        p.alt.length > 240
      )
        throw Error("VARIANT_COPY_PROOF");
      const ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      }[p.mime];
      if (!ext) throw Error("VARIANT_COPY_MIME");
      const image = {
        url: `${origin}${ctx.product_id}/${p.sha256}.${ext}`,
        alt: p.alt,
      };
      photos.push(image);
      if (item.stored) {
        if (
          !Array.isArray(item.stored) ||
          item.stored.length !== item.photos.length ||
          item.stored.some((stored, index) => {
            const q = item.photos[index];
            return (
              Object.keys(stored).length !== 2 ||
              stored.alt !== q.alt ||
              stored.url !==
                `${origin}${ctx.product_id}/${q.sha256}.${{ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[q.mime]}`
            );
          })
        )
          throw Error("VARIANT_COPY_ALREADY_EDITED");
        continue;
      }
      let file = cache.get(p.url);
      if (!file) {
        file = await readPhoto(p.url);
        cache.set(p.url, file);
      }
      const bytes = Buffer.from(file.base64, "base64");
      const magic =
        ext === "jpg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : ext === "png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP";
      if (
        !magic ||
        bytes.length !== p.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== p.sha256 ||
        file.sha256 !== p.sha256
      )
        throw Error("VARIANT_COPY_BYTES_CHANGED");
      if (!files.has(p.sha256)) {
        total += bytes.length;
        if (total > 16 * 1024 * 1024) throw Error("VARIANT_COPY_TOTAL_LIMIT");
        files.set(p.sha256, { ...file, alt: p.alt });
      }
    }
    items.push({ variant_id: item.variant_id, photos });
  }
  return { items, files: [...files.values()], downloaded_urls: cache.size };
}
