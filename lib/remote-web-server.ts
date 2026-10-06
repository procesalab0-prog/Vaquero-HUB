import "server-only";
import { prepareGalleryPush } from "@/scripts/m9/woo-remote/push-gallery.mjs";
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
  const checkpoint = await admin.rpc("remote_gallery_checkpoint", {
    p_job_id: status.data.job.id,
    p_actor_id: userId,
  });
  if (checkpoint.error) throw new Error("REMOTE_CHECKPOINT_READ");
  const receipt = await client.receipt(status.data.job.id);
  const remote = await client.gallery(status.data.job.id);
  const plan = await prepareGalleryPull({
    packet: bound.data.packet,
    receipt,
    remote,
    current: draft.data.content,
    checkpoint: checkpoint.data.images,
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
  const remember = async (
    revision: number,
    images: { url: string; alt: string }[],
  ) => {
    const latest = await client.gallery(status.data.job.id);
    if (latest.revision !== plan.revision)
      throw new Error("REMOTE_PHOTO_CHANGED");
    const result = await admin.rpc("remote_gallery_checkpoint", {
      p_job_id: status.data.job.id,
      p_actor_id: userId,
      p_expected_version: checkpoint.data.version,
      p_draft_revision: revision,
      p_local_images: images,
      p_images: plan.common,
      p_remote_revision: plan.revision,
    });
    if (result.error) throw new Error("REMOTE_CHECKPOINT_CHANGED");
  };
  if (plan.unchanged) {
    await remember(draft.data.revision, draft.data.content.images);
    return "Las fotos ya coinciden con Woo de pruebas.";
  }
  const images = await storeVerifiedWebPhotos(supabase, productId, plan.images);
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
  await remember(saved.data.revision, images);
  return `Se copiaron ${images.length} fotos de Woo de pruebas a esta ficha.`;
}

// A durable outbox claims a send once. Unknown outcomes are recovered by receipt,
// never by replaying a POST with a fresh ID or importing another attachment.
export async function pushRemotePhotos(productId: string) {
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
  const rpc = async (name: string, params: Record<string, unknown>) => {
    const result = await admin.rpc(name, params);
    if (result.error) throw new Error("REMOTE_GALLERY_DATABASE_REVIEW");
    return result.data;
  };
  const parent = status.data.job.id;
  const client = remoteClient({
    origin: TEST_ORIGIN,
    username: process.env.M9_REMOTE_WOO_USERNAME!,
    password: process.env.M9_REMOTE_WOO_PASSWORD!,
  });
  const finish = async (id: string) => {
    const receipt = await client.galleryUpdateReceipt(id);
    if (receipt.state !== "SUCCEEDED")
      throw new Error("REMOTE_GALLERY_RECEIPT_REVIEW");
    const live = await client.gallery(parent);
    if (live.revision !== receipt.gallery?.revision)
      throw new Error("REMOTE_GALLERY_CHANGED_AFTER_SEND");
    await rpc("finish_remote_gallery_push", {
      p_job_id: id,
      p_actor_id: userId,
      p_receipt: receipt,
    });
    return "Fotos recibidas y verificadas en Woo de pruebas.";
  };
  const pending = await rpc("begin_remote_gallery_push", {
    p_parent_id: parent,
    p_actor_id: userId,
  });
  if (pending.job) return finish(pending.job.id);
  const bound = await rpc("claim_remote_web", {
    p_job_id: parent,
    p_actor_id: userId,
  });
  const checkpoint = await rpc("remote_gallery_checkpoint", {
    p_job_id: parent,
    p_actor_id: userId,
  });
  const remote = await client.gallery(parent);
  const receipt = await client.receipt(parent);
  const plan = await prepareGalleryPush({
    packet: bound.packet,
    receipt,
    remote,
    current: draft.data.content,
    checkpoint: checkpoint.images,
    readPhoto: async (
      url: string,
      _transport?: unknown,
      isRemote?: boolean,
    ) => {
      if (!isRemote) return fetchPhoto(url);
      const image = remote.images.find((i: { url: string }) => i.url === url);
      if (!image) throw new Error("REMOTE_PHOTO_IDENTITY");
      return client.photo(parent, image.id);
    },
  });
  if (plan.unchanged) return "Las fotos ya coinciden con Woo de pruebas.";
  const queued = await rpc("begin_remote_gallery_push", {
    p_parent_id: parent,
    p_actor_id: userId,
    p_draft_revision: draft.data.revision,
    p_local_images: draft.data.content.images,
    p_images: plan.common,
    p_checkpoint_version: checkpoint.version,
    p_remote_revision: plan.revision,
  });
  if (queued.dispatch) {
    // Claim precedes network access. A failed response leaves recovery-only state.
    try {
      await client.updateGallery({
        update_id: queued.job.id,
        parent_id: parent,
        expected_revision: plan.revision,
        images: plan.images,
      });
    } catch {
      /* GET below determines outcome; never retry POST automatically. */
    }
  }
  return finish(queued.job.id);
}

export async function storeVerifiedWebPhotos(
  supabase: Awaited<ReturnType<typeof requirePermission>>["supabase"],
  productId: string,
  photos: Array<{ base64: string; sha256: string; alt: string }>,
) {
  const images = [];
  for (const image of photos) {
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
  return images;
}
