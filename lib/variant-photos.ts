import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WEB_STAGING_URL, validWebImage, type WebImage } from "./web-draft";

export async function readVariantPhotos(
  supabase: SupabaseClient,
  ids: string[],
) {
  const photos = new Map<string, WebImage[]>();
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL) return photos;
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 200) {
    const { data, error } = await supabase.rpc("read_variant_photos", {
      ids: unique.slice(start, start + 200),
    });
    if (error) {
      console.error("[catalog] variant photos unavailable");
      continue;
    }
    for (const row of data ?? []) {
      if (
        Array.isArray(row.photos) &&
        row.photos.every((p: WebImage) => validWebImage(p.url))
      )
        photos.set(
          row.variant_id,
          row.photos.map((p: WebImage) => ({ url: p.url, alt: p.alt })),
        );
    }
  }
  return photos;
}
