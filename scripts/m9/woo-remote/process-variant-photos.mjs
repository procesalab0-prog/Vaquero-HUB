import { createHash, randomUUID } from "node:crypto";
import { prepareRemoteVariantPhotos } from "./prepare-variant-photo.mjs";
import { planRemoteVariantAssignments } from "./variant-photo-packet.mjs";
import { fetchPhoto } from "./process-job.mjs";

// A durable claim precedes POST. Existing claims recover only by authenticated
// receipt; no lease expiry or retry with another operation ID.
export async function processRemoteVariantPhotos({
  parentId,
  actorId,
  rpc,
  client,
  photoReader = fetchPhoto,
  newId = randomUUID,
  prepare = prepareRemoteVariantPhotos,
  plan = planRemoteVariantAssignments,
}) {
  await client.variantPhotoWritePreflight();
  const pending = await rpc("begin_remote_variant_photos", {
    p_parent: parentId,
    p_actor: actorId,
  });
  const finish = async (job) => {
    const receipt = await client.variantPhotoReceipt(job.id);
    if (receipt.state !== "SUCCEEDED")
      throw Error("VARIANT_PHOTO_RESULT_REVIEW");
    const live = await client.variantPhotos(parentId);
    const result = await rpc("finish_remote_variant_photos", {
      p_job: job.id,
      p_actor: actorId,
      p_receipt: receipt,
      p_live: live,
    });
    if (result.state !== "SUCCEEDED")
      throw Error("VARIANT_PHOTO_FINISH_REVIEW");
    return "Fotos por talla recibidas y comprobadas en Woo de pruebas.";
  };
  if (pending.job) return finish(pending.job);
  const context = await rpc("remote_variant_photo_context", {
    p_parent: parentId,
    p_actor: actorId,
  });
  const remote = await client.variantPhotos(parentId),
    receipt = await client.receipt(parentId);
  if (JSON.stringify(receipt) !== JSON.stringify(context.receipt)) {
    // PostgreSQL JSONB may reorder keys. Compare canonical values, not key order.
    const canonical = (v) =>
      Array.isArray(v)
        ? v.map(canonical)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, x]) => [k, canonical(x)]),
            )
          : v;
    if (
      JSON.stringify(canonical(receipt)) !==
      JSON.stringify(canonical(context.receipt))
    )
      throw Error("VARIANT_PHOTO_PARENT_RECEIPT_CHANGED");
  }
  const cache = new Map(),
    source = [];
  for (const item of context.items) {
    if (!item.photos.length) {
      source.push({
        variant_id: item.variant_id,
        barcode: item.barcode,
        state: "NO_VARIATION_PHOTO",
      });
      continue;
    }
    if (
      item.photos.length !== 1 ||
      item.stored?.length !== 1 ||
      item.stored[0].alt !== item.photos[0].alt
    )
      throw Error("VARIANT_PHOTO_STORAGE_REVIEW");
    const p = item.photos[0],
      url = item.stored[0].url;
    // Source bytes come only from the already verified staging copy, never a
    // browser URL or a fresh request against the production catalogue.
    if (
      typeof url !== "string" ||
      !url.startsWith(
        `https://zsezjtswqeijboezvado.supabase.co/storage/v1/object/public/product-images/${context.product_id}/`,
      )
    )
      throw Error("VARIANT_PHOTO_STORAGE_ORIGIN");
    if (!cache.has(url)) {
      const image = await photoReader(url),
        bytes = Buffer.from(image.base64, "base64");
      if (
        !bytes.length ||
        bytes.length !== p.bytes ||
        bytes.toString("base64") !== image.base64 ||
        image.sha256 !== p.sha256 ||
        createHash("sha256").update(bytes).digest("hex") !== p.sha256
      )
        throw Error("VARIANT_PHOTO_STORAGE_BYTES");
      cache.set(url, bytes);
    }
    const bytes = cache.get(url);
    if (
      bytes.length !== p.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== p.sha256
    )
      throw Error("VARIANT_PHOTO_STORAGE_BYTES");
    source.push({
      variant_id: item.variant_id,
      barcode: item.barcode,
      state: "VERIFIED_OWN_PHOTO",
      sha256: p.sha256,
      alt: p.alt,
      bytes,
    });
  }
  const preparation = await prepare({
    packet: context.packet,
    receipt,
    remote,
    source,
    readPhoto: (id, media) => client.photo(id, media),
  });
  const packet = plan({ preparation, remote, updateId: newId() });
  const queued = await rpc("begin_remote_variant_photos", {
    p_parent: parentId,
    p_actor: actorId,
    p_context_hash: context.context_hash,
    p_packet: packet,
    p_remote: remote,
  });
  if (!queued.job) throw Error("VARIANT_PHOTO_QUEUE_REVIEW");
  if (queued.dispatch === true) {
    try {
      await client.assignVariantPhotos(queued.job.packet);
    } catch {
      /* Receipt determines outcome; never POST again automatically. */
    }
  }
  return finish(queued.job);
}
