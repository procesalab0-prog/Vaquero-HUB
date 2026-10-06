import "server-only";
import { requirePermission } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import { remoteClient, TEST_ORIGIN } from "@/scripts/m9/woo-remote/client.mjs";
import { processRemoteJob } from "@/scripts/m9/woo-remote/process-job.mjs";

export function remoteWebConfigured() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL === WEB_STAGING_URL &&
    process.env.M9_REMOTE_WOO_ENABLED === "true" &&
    !!process.env.M9_REMOTE_WOO_USERNAME &&
    !!process.env.M9_REMOTE_WOO_PASSWORD &&
    !!process.env.SUPABASE_SECRET_KEY
  );
}
export async function processRemoteWeb(jobId: string) {
  if (!remoteWebConfigured()) throw new Error("REMOTE_NOT_CONFIGURED");
  const { userId } = await requirePermission("products.read");
  const admin = createAdminClient();
  const rpc = async (name: string, params: Record<string, unknown>) => {
    const result = await admin.rpc(name, params);
    if (result.error) throw new Error("REMOTE_DATABASE_REVIEW");
    return result.data;
  };
  return processRemoteJob({
    jobId,
    actorId: userId,
    rpc,
    client: remoteClient({
      origin: TEST_ORIGIN,
      username: process.env.M9_REMOTE_WOO_USERNAME!,
      password: process.env.M9_REMOTE_WOO_PASSWORD!,
    }),
  });
}

// Called only after the product/draft transaction has succeeded. Woo failure
// must never turn a saved product into a failed creation or encourage duplication.
export async function queueEligibleRemoteWeb(
  productId: string,
): Promise<string | null> {
  if (!remoteWebConfigured()) return null;
  try {
    const { supabase } = await requirePermission("products.read");
    const draft = await supabase.rpc("read_web_draft", {
      p_product_id: productId,
    });
    const status = await supabase.rpc("read_remote_web", {
      p_product_id: productId,
    });
    if (draft.error || status.error) throw new Error("REMOTE_READ_FAILED");
    let job = status.data.job;
    if (!job && status.data.eligible) {
      const enqueued = await supabase.rpc("enqueue_remote_web", {
        p_product_id: productId,
        p_revision: draft.data.revision,
        p_fingerprint: draft.data.fingerprint,
        p_request_id: crypto.randomUUID(),
      });
      if (enqueued.error) throw new Error("REMOTE_ENQUEUE_FAILED");
      job = enqueued.data.job;
    }
    if (!job)
      return "Ficha guardada. Revisa el alcance del ensayo remoto en su panel.";
    if (["READY", "RUNNING"].includes(job.state))
      await processRemoteWeb(job.id);
    const final = await supabase.rpc("read_remote_web", {
      p_product_id: productId,
    });
    return final.data?.job?.state === "SUCCEEDED"
      ? "Ficha guardada y alta recibida en Woo de pruebas. Las ediciones posteriores todavía no se reenvían."
      : "Ficha guardada. El estado del envío se puede consultar en el panel de Woo de pruebas.";
  } catch {
    return "Ficha guardada. El envío a Woo de pruebas necesita comprobación; actualiza su estado sin crear otro producto.";
  }
}
