import "server-only";
import { WEB_STAGING_URL, validWebImage } from "./web-draft";

import type { SupabaseClient } from "@supabase/supabase-js";
import { wooImageUrl } from "./woo-image-url";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const extensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function productImageUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
) {
  if (!path) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return wooImageUrl(path);
  return supabase.storage.from("product-images").getPublicUrl(path).data
    .publicUrl;
}

export async function uploadProductImage({
  supabase,
  productId,
  image,
}: {
  supabase: SupabaseClient;
  productId: string;
  image: FormDataEntryValue | null;
}) {
  if (!(image instanceof File) || image.size === 0) return null;
  const extension = extensions.get(image.type);
  if (!extension || image.size > MAX_IMAGE_BYTES) {
    throw new Error("INVALID_PRODUCT_IMAGE");
  }

  const path = `${productId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, image, {
      cacheControl: "31536000",
      contentType: image.type,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { error: linkError } = await supabase.rpc("set_product_image", {
    p_product_id: productId,
    p_storage_path: path,
  });
  if (linkError) {
    await supabase.storage.from("product-images").remove([path]);
    throw linkError;
  }
  return path;
}

export async function readCatalogCoverUrls(
  supabase: SupabaseClient,
  productIds: string[],
) {
  const covers = new Map<string, string>();
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL) return covers;
  const ids = [...new Set(productIds)];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) batches.push(ids.slice(i, i + 200));
  const results = await Promise.all(
    batches.map((batch) =>
      supabase.rpc("read_catalog_covers", { p_product_ids: batch }),
    ),
  );
  for (const result of results) {
    if (result.error) {
      console.error("[catalog] covers unavailable");
      continue;
    }
    for (const row of result.data ?? [])
      if (validWebImage(row.image_url))
        covers.set(row.product_id, row.image_url);
  }
  return covers;
}
