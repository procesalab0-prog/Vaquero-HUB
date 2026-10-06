import { createHash } from "node:crypto";
import { PROTOCOL, TEST_ORIGIN } from "./client.mjs";

export async function fetchPhoto(url, transport = fetch) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !(
      (u.hostname === "vaquerosm.com" &&
        u.pathname.startsWith("/wp-content/uploads/")) ||
      (u.hostname === "zsezjtswqeijboezvado.supabase.co" &&
        u.pathname.startsWith("/storage/v1/object/public/product-images/"))
    )
  )
    throw new Error("IMAGE_ORIGIN_FORBIDDEN");
  const response = await transport(u.href, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok || !response.body) throw new Error("IMAGE_UNAVAILABLE");
  const limit = 4 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("IMAGE_TOO_LARGE");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("IMAGE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  if (!bytes.length) throw new Error("EMPTY_IMAGE");
  return {
    base64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

// Database claim determines whether dispatch is permitted. A repeated action can
// only GET the existing receipt. No clock-based lease and no automatic second POST.
export async function processRemoteJob({
  jobId,
  actorId,
  rpc,
  client,
  photoReader = fetchPhoto,
}) {
  const claim = await rpc("claim_remote_web", {
    p_job_id: jobId,
    p_actor_id: actorId,
  });
  if (claim.state !== "RUNNING") return claim.state;
  if (
    claim.id !== jobId ||
    claim.packet?.origin !== TEST_ORIGIN ||
    !claim.claim_id
  )
    throw new Error("REMOTE_CLAIM_INVALID");
  let receipt;
  if (claim.dispatch === true) {
    const p = claim.packet;
    if (p.content.images.length !== 1 || p.content.categories.length !== 0)
      throw new Error("REMOTE_CONTENT_SCOPE");
    const image = await photoReader(p.content.images[0].url);
    await rpc("bind_remote_web_image", {
      p_job_id: jobId,
      p_claim_id: claim.claim_id,
      p_sha256: image.sha256,
    });
    receipt = await client.createDraft({
      protocol: PROTOCOL,
      request_id: jobId,
      product_id: p.product_id,
      revision: p.revision,
      name: p.content.name,
      description: p.content.description,
      short_description: p.content.short_description,
      barcode: p.barcode,
      price_cents: p.price_cents,
      image,
    });
  } else {
    receipt = await client.receipt(jobId);
  }
  // The trusted database checks all receipt identity/content fields and the bound photo hash.
  if (receipt.state !== "SUCCEEDED") return "REVIEW_REQUIRED";
  await rpc("finish_remote_web", {
    p_job_id: jobId,
    p_claim_id: claim.claim_id,
    p_receipt: receipt,
  });
  return "SUCCEEDED";
}
