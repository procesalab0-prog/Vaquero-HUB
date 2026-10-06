"use server";
import { requirePermission } from "@/lib/auth/authorization";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import { storeVerifiedWebPhotos } from "@/lib/remote-web-server";
import { prepareSourceGalleryCopy } from "@/scripts/m9/source-gallery-copy.mjs";
import { revalidatePath } from "next/cache";
export async function copyMigrationGallery(
  productId: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL)
      throw new Error("STAGING_ONLY");
    const { supabase } = await requirePermission("products.update");
    const source = await supabase.rpc("read_migration_galleries", {
      p_product_id: productId,
    });
    const draft = await supabase.rpc("read_web_draft", {
      p_product_id: productId,
    });
    if (
      source.error ||
      source.data?.length !== 1 ||
      draft.error ||
      !draft.data.can_edit
    )
      throw new Error("SOURCE_REVIEW");
    const plan = await prepareSourceGalleryCopy({
      productId,
      current: draft.data.content,
      source: source.data[0],
    });
    if (plan.unchanged)
      return { ok: true, message: "Fotos ya guardadas en Mi Tienda." };
    const images = await storeVerifiedWebPhotos(
      supabase,
      productId,
      plan.photos,
    );
    const latest = await supabase.rpc("read_migration_galleries", {
      p_product_id: productId,
    });
    if (
      latest.error ||
      JSON.stringify(latest.data) !== JSON.stringify(source.data)
    )
      throw new Error("SOURCE_CHANGED");
    const result = await supabase.rpc("save_web_draft", {
      p_product_id: productId,
      p_content: { ...draft.data.content, images },
      p_revision: draft.data.revision,
      p_fingerprint: draft.data.fingerprint,
      p_request_id: crypto.randomUUID(),
    });
    if (result.error) throw new Error("DRAFT_CHANGED");
    revalidatePath("/productos");
    revalidatePath("/productos/ficha-web");
    return {
      ok: true,
      message: `${images.length} fotos copiadas y verificadas.`,
    };
  } catch {
    return {
      ok: false,
      message:
        "Revisión pendiente: cambió la ficha o no se pudo verificar toda la galería. No se reemplazó la ficha.",
    };
  }
}
