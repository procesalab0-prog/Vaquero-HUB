import "server-only";
import { createHash } from "node:crypto";
import { prepareGalleryPull } from "@/scripts/m9/woo-remote/pull-gallery.mjs";
import { requirePermission } from "@/lib/auth/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { WEB_STAGING_URL } from "@/lib/web-draft";
import { remoteClient, TEST_ORIGIN } from "@/scripts/m9/woo-remote/client.mjs";
import {
  fetchPhoto,
  processRemoteJob,
} from "@/scripts/m9/woo-remote/process-job.mjs";

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

// Explicit pull: preserve texts/prices and commit against the draft revision read
// before downloading. Never overwrite a concurrent local edit.
export async function pullRemotePhotos(productId: string) {
  if (!remoteWebConfigured()) throw new Error("REMOTE_NOT_CONFIGURED");
  const { userId, supabase } = await requirePermission("products.read");
  const status = await supabase.rpc("read_remote_web", {
    p_product_id: productId,
  });
  const draft = await supabase.rpc("read_web_draft", {
    p_product_id: productId,
  });
  if (
    status.error ||
    draft.error ||
    !draft.data.can_edit ||
    status.data.job?.state !== "SUCCEEDED"
  )
    throw new Error("REMOTE_PHOTO_PERMISSION");
  const admin = createAdminClient();
  const bound = await admin.rpc("claim_remote_web", {
    p_job_id: status.data.job.id,
    p_actor_id: userId,
  });
  if (
    bound.error ||
    bound.data.state !== "SUCCEEDED" ||
    bound.data.packet.product_id !== productId
  )
    throw new Error("REMOTE_PHOTO_IDENTITY");
  const client = remoteClient({
    origin: TEST_ORIGIN,
    username: process.env.M9_REMOTE_WOO_USERNAME!,
    password: process.env.M9_REMOTE_WOO_PASSWORD!,
  });
  const receipt = await client.receipt(status.data.job.id);
  const remote = await client.gallery(status.data.job.id);
  const plan = await prepareGalleryPull({
    packet: bound.data.packet,
    receipt,
    remote,
    current: draft.data.content,
    readPhoto: async (
      url: string,
      _transport?: unknown,
      remotePhoto?: boolean,
    ) => {
      if (!remotePhoto) return fetchPhoto(url);
      const image = remote.images.find((i: { url: string }) => i.url === url);
      if (!image) throw new Error("REMOTE_PHOTO_IDENTITY");
      return client.photo(status.data.job.id, image.id);
    },
  });
  if (plan.unchanged) return "Las fotos ya coinciden con Woo de pruebas.";
  const images = [];
  for (const image of plan.images) {
    const bytes = Buffer.from(image.base64, "base64");
    const ext =
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? "jpg"
        : bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "png"
          : bytes.subarray(0, 4).toString() === "RIFF" &&
              bytes.subarray(8, 12).toString() === "WEBP"
            ? "webp"
            : null;
    if (!ext) throw new Error("REMOTE_PHOTO_FORMAT");
    const path = `${productId}/${image.sha256}.${ext}`;
    const bucket = supabase.storage.from("product-images");
    const uploaded = await bucket.upload(path, bytes, {
      contentType: ext === "jpg" ? "image/jpeg" : `image/${ext}`,
      upsert: false,
    });
    if (uploaded.error) {
      // Unknown outcome or prior copy: verify existing bytes, never overwrite.
      const existing = await bucket.download(path);
      if (
        existing.error ||
        !existing.data ||
        createHash("sha256")
          .update(Buffer.from(await existing.data.arrayBuffer()))
          .digest("hex") !== image.sha256
      )
        throw new Error("REMOTE_PHOTO_STORAGE");
    }
    images.push({
      url: bucket.getPublicUrl(path).data.publicUrl,
      alt: image.alt,
    });
  }
  const latest = await client.gallery(status.data.job.id);
  if (latest.revision !== plan.revision)
    throw new Error("REMOTE_PHOTO_CHANGED");
  const saved = await supabase.rpc("save_web_draft", {
    p_product_id: productId,
    p_content: { ...draft.data.content, images },
    p_revision: draft.data.revision,
    p_fingerprint: draft.data.fingerprint,
    p_request_id: crypto.randomUUID(),
  });
  if (saved.error) throw new Error("REMOTE_PHOTO_DRAFT_CHANGED");
  return `Se copiaron ${images.length} fotos de Woo de pruebas a esta ficha.`;
}
