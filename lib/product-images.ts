import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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
