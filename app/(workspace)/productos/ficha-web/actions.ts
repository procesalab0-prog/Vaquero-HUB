"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/authorization";
import { WEB_STAGING_URL, webContentFromForm } from "@/lib/web-draft";
import type { SaveWebState } from "@/lib/web-draft";
export async function saveWebDraft(form: FormData): Promise<SaveWebState> {
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL)
      throw new Error("STAGING_ONLY");
    const { supabase } = await requirePermission("products.read");
    const { data, error } = await supabase.rpc("save_web_draft", {
      p_product_id: String(form.get("product_id")),
      p_content: webContentFromForm(form),
      p_revision: Number(form.get("revision")),
      p_fingerprint: String(form.get("fingerprint")),
      p_request_id: String(form.get("request_id")),
    });
    if (error) throw new Error(error.message);
    revalidatePath("/productos/ficha-web");
    return {
      ok: true,
      message: "Ficha guardada en staging. No se envió a WooCommerce.",
      revision: data.revision,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const conflict = /WEB_DRAFT_CHANGED|WEB_CATALOG_CHANGED/.test(message);
    return {
      ok: false,
      conflict,
      message: conflict
        ? "Otra persona cambió la ficha o sus variantes. Tus textos siguen aquí: copia tus cambios y recarga para comparar antes de guardar."
        : /INVALID|DUPLICATE/.test(message)
          ? "Revisa los textos y fotos: máximo 20 fotos sin repetir, de vaquerosm.com o del almacenamiento de staging."
          : /NOT_AUTH/.test(message)
            ? "Tu usuario no tiene permiso para guardar esta ficha."
            : "No se confirmó el guardado. Conservamos tus cambios; puedes reintentar.",
    };
  }
}
export async function uploadWebPhoto(
  form: FormData,
): Promise<{ url?: string; error?: string }> {
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL)
      throw new Error("STAGING_ONLY");
    const { supabase } = await requirePermission("products.read");
    const id = String(form.get("product_id"));
    const { data, error } = await supabase.rpc("read_web_draft", {
      p_product_id: id,
    });
    if (error || !data?.can_edit) throw new Error("NOT_AUTHORIZED");
    const file = form.get("photo");
    if (!(file instanceof File) || !file.size || file.size > 4 * 1024 * 1024)
      throw new Error("INVALID_IMAGE");
    const exts: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const ext = exts[file.type];
    if (!ext) throw new Error("INVALID_IMAGE");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid =
      ext === "jpg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : ext === "png"
          ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
          : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (!valid) throw new Error("INVALID_IMAGE");
    const path = `${id}/${crypto.randomUUID()}.${ext}`;
    const result = await supabase.storage
      .from("product-images")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (result.error) throw new Error("UPLOAD_FAILED");
    return {
      url: supabase.storage.from("product-images").getPublicUrl(path).data
        .publicUrl,
    };
  } catch {
    return {
      error:
        "No se subió la foto. Usa JPG, PNG o WebP de hasta 4 MB y vuelve a intentar.",
    };
  }
}

export async function webLabAction(
  form: FormData,
): Promise<import("@/lib/web-draft").WebLabResult> {
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== WEB_STAGING_URL)
      throw new Error("STAGING_ONLY");
    const { supabase } = await requirePermission("products.read");
    const product = String(form.get("product_id"));
    const result =
      form.get("operation") === "enqueue"
        ? await supabase.rpc("enqueue_web_lab", {
            p_product_id: product,
            p_revision: Number(form.get("revision")),
            p_fingerprint: String(form.get("fingerprint")),
            p_request_id: String(form.get("request_id")),
          })
        : await supabase.rpc("read_web_lab", { p_product_id: product });
    if (result.error) throw new Error(result.error.message);
    return { lab: result.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      error: /LAB_ALREADY_REQUESTED/.test(message)
        ? "Ya existe una solicitud. Actualiza su estado; no hace falta enviarla otra vez."
        : /LAB_.*CHANGED|LAB_CATEGORY_REVIEW/.test(message)
          ? "La ficha o su evidencia cambió. Recarga y revisa antes de solicitar otro ensayo."
          : "No se confirmó la solicitud. Actualiza el estado antes de reintentar.",
    };
  }
}
