"use server";
import { requirePermission } from "@/lib/auth/authorization";
import {
  remoteWebConfigured,
  processRemoteWeb,
  pullRemotePhotos,
} from "@/lib/remote-web-server";
import { revalidatePath } from "next/cache";
import type { RemoteWebResult } from "@/lib/remote-web";

export async function remoteWebAction(
  form: FormData,
): Promise<RemoteWebResult> {
  try {
    if (!remoteWebConfigured()) throw new Error("REMOTE_NOT_CONFIGURED");
    const { supabase } = await requirePermission("products.read");
    const product = String(form.get("product_id"));
    if (form.get("operation") === "pull_photos") {
      try {
        const message = await pullRemotePhotos(product);
        revalidatePath("/productos/ficha-web");
        return { message, refresh: true };
      } catch {
        return {
          error:
            "No se reemplazaron las fotos de la ficha. Comprueba permisos e identidad; si cambiaron en ambos lados o se retiró una foto, requiere revisión.",
        };
      }
    }
    const enqueue = form.get("operation") === "enqueue";
    const { data, error } = enqueue
      ? await supabase.rpc("enqueue_remote_web", {
          p_product_id: product,
          p_revision: Number(form.get("revision")),
          p_fingerprint: String(form.get("fingerprint")),
          p_request_id: String(form.get("request_id")),
        })
      : await supabase.rpc("read_remote_web", { p_product_id: product });
    if (error) throw new Error("REMOTE_REQUEST_REVIEW");
    let processingError: string | undefined;
    if (data.job && ["READY", "RUNNING"].includes(data.job.state)) {
      try {
        await processRemoteWeb(data.job.id);
      } catch {
        processingError =
          "El envío necesita comprobación. Actualiza el estado para consultar el recibo; no se creará otro producto.";
      }
    }
    const current = await supabase.rpc("read_remote_web", {
      p_product_id: product,
    });
    if (current.error) throw new Error("REMOTE_READ_FAILED");
    return { remote: current.data, error: processingError };
  } catch {
    return {
      error:
        "No se confirmó el envío. Conserva la ficha y actualiza el estado antes de reintentar.",
    };
  }
}
